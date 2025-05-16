import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { stripe } from '@/lib/stripe';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// Validate required environment variables
const requiredEnvVars = {
  FIREBASE_ADMIN_PROJECT_ID: process.env.FIREBASE_ADMIN_PROJECT_ID,
  FIREBASE_ADMIN_CLIENT_EMAIL: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
  FIREBASE_ADMIN_PRIVATE_KEY: process.env.FIREBASE_ADMIN_PRIVATE_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
};

console.log('[Checkout] Checking environment variables:', {
  hasProjectId: !!requiredEnvVars.FIREBASE_ADMIN_PROJECT_ID,
  hasClientEmail: !!requiredEnvVars.FIREBASE_ADMIN_CLIENT_EMAIL,
  hasPrivateKey: !!requiredEnvVars.FIREBASE_ADMIN_PRIVATE_KEY,
  hasAppUrl: !!requiredEnvVars.NEXT_PUBLIC_APP_URL,
  hasStripeKey: !!requiredEnvVars.STRIPE_SECRET_KEY,
});

// Cache Firebase Admin instances
let adminDb: FirebaseFirestore.Firestore;
let adminAuth: any;

// Initialize Firebase Admin if not already initialized
if (!getApps().length) {
  console.log('[Checkout] Initializing Firebase Admin');
  try {
    const app = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
    adminDb = getFirestore(app);
    adminAuth = getAuth(app);
    console.log('[Checkout] Firebase Admin initialized successfully');
  } catch (error) {
    console.error('[Checkout] Firebase Admin initialization error:', error);
    throw error;
  }
} else {
  adminDb = getFirestore();
  adminAuth = getAuth();
}

const PLANS = {
  pro: {
    price: 1200, // $12.00
    name: 'Pro Plan',
    features: [
      'Unlimited AI conversations',
      'AI memory and context',
      'File upload + analysis',
      'Web search + live data',
      'Customize assistant',
      'Save conversations',
      'No branding',
      'Add extra user (+20%)',
    ],
  },
  pro_plus: {
    price: 2500, // $25.00
    name: 'Pro Plus Plan',
    features: [
      'Everything in Pro, plus:',
      'Full offline access',
      'Higher file limits',
      'Longer memory depth',
      'Early beta access',
      'Priority features',
      '2 users included',
      'Add users (+30%)',
    ],
  },
};

// Cache for Stripe customers
const customerCache = new Map<string, string>();

// Helper function to get or create Stripe customer
async function getOrCreateStripeCustomer(userId: string): Promise<string> {
  // Check cache first
  if (customerCache.has(userId)) {
    return customerCache.get(userId)!;
  }

  // Search for existing customer
  const customers = await stripe.customers.list({
    limit: 1
  });

  const existingCustomer = customers.data.find(c => c.metadata?.userId === userId);
  let customerId: string;

  if (existingCustomer) {
    customerId = existingCustomer.id;
  } else {
    const customer = await stripe.customers.create({
      metadata: { userId },
    });
    customerId = customer.id;
  }

  // Cache the result
  customerCache.set(userId, customerId);
  return customerId;
}

// Cache for checkout sessions
const sessionCache = new Map<string, { sessionId: string; url: string }>();

export async function POST(req: Request) {
  console.log('[Checkout] Starting checkout session creation');
  try {
    const body = await req.json();
    const { plan, userId } = body;

    if (!plan || !userId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Check cache for existing session
    const cacheKey = `${userId}_${plan}`;
    if (sessionCache.has(cacheKey)) {
      console.log('[Checkout] Returning cached session');
      return NextResponse.json(sessionCache.get(cacheKey));
    }

    // Verify user exists
    const userDoc = await adminDb.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      try {
        const decodedToken = await adminAuth.verifyIdToken(userId);
        const userDocByUid = await adminDb.collection('users').doc(decodedToken.uid).get();
        
        if (!userDocByUid.exists) {
          await adminDb.collection('users').doc(userId).set({
            createdAt: new Date().toISOString(),
            lastLogin: new Date().toISOString(),
            provider: 'xloudid'
          });
        }
      } catch (error) {
        console.error('[Checkout] Error verifying user:', error);
        return NextResponse.json(
          { error: 'Error verifying user' },
          { status: 500 }
        );
      }
    }

    const planDetails = PLANS[plan as keyof typeof PLANS];
    if (!planDetails) {
      return NextResponse.json(
        { error: 'Invalid plan selected' },
        { status: 400 }
      );
    }

    // Get or create Stripe customer
    const customerId = await getOrCreateStripeCustomer(userId);

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: planDetails.name,
              description: planDetails.features.join('\n'),
              metadata: {
                plan,
                userId
              }
            },
            unit_amount: planDetails.price,
            recurring: {
              interval: 'month',
            },
          },
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `https://${process.env.NEXT_PUBLIC_APP_URL}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
      metadata: {
        userId,
        plan,
      },
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      customer_update: {
        address: 'auto',
        name: 'auto'
      }
    });

    // Store session in Firestore
    await adminDb.collection('checkout_sessions').doc(session.id).set({
      userId,
      customerId,
      plan,
      status: 'pending',
      createdAt: new Date().toISOString(),
      sessionId: session.id,
      metadata: session.metadata
    });

    // Cache the session
    const sessionData = { 
      sessionId: session.id, 
      url: session.url || '' // Ensure URL is never null
    };
    sessionCache.set(cacheKey, sessionData);

    return NextResponse.json(sessionData);
  } catch (error) {
    console.error('[Checkout] Error in create-checkout-session:', error);
    return NextResponse.json(
      { 
        error: 'Error creating checkout session',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 