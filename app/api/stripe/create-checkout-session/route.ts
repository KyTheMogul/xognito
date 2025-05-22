import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { stripe } from '@/lib/stripe';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import Stripe from 'stripe';
import { auth } from '@/lib/firebase';

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

const stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-04-30.basil'
});

export async function POST(request: Request) {
  try {
    console.log('[Checkout] Creating checkout session');
    
    const { plan } = await request.json();
    const user = auth.currentUser;

    if (!user) {
      console.error('[Checkout] No authenticated user found');
      return NextResponse.json(
        { error: 'User must be authenticated' },
        { status: 401 }
      );
    }

    console.log('[Checkout] User details:', {
      uid: user.uid,
      email: user.email,
      plan: plan
    });

    // Create a checkout session
    const session = await stripeInstance.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: plan === 'pro' ? process.env.STRIPE_PRO_PRICE_ID : process.env.STRIPE_PRO_PLUS_PRICE_ID,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/pricing`,
      metadata: {
        userId: user.uid,
        plan: plan
      },
      customer_email: user.email || undefined,
    });

    console.log('[Checkout] Session created:', {
      sessionId: session.id,
      customerId: session.customer,
      metadata: session.metadata
    });

    return NextResponse.json({ sessionId: session.id });
  } catch (error) {
    console.error('[Checkout] Error creating session:', error);
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    );
  }
} 