import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { stripe } from '@/lib/stripe';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

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

// Initialize Firebase Admin if not already initialized
if (!getApps().length) {
  console.log('[Checkout] Initializing Firebase Admin');
  try {
    if (!requiredEnvVars.FIREBASE_ADMIN_PROJECT_ID || 
        !requiredEnvVars.FIREBASE_ADMIN_CLIENT_EMAIL || 
        !requiredEnvVars.FIREBASE_ADMIN_PRIVATE_KEY) {
      throw new Error('Missing required Firebase Admin environment variables');
    }

    initializeApp({
      credential: cert({
        projectId: requiredEnvVars.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: requiredEnvVars.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: requiredEnvVars.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
    console.log('[Checkout] Firebase Admin initialized successfully');
  } catch (error) {
    console.error('[Checkout] Firebase Admin initialization error:', {
      error,
      message: (error as Error).message,
      code: (error as any).code,
      stack: (error as Error).stack,
      envVars: {
        hasProjectId: !!requiredEnvVars.FIREBASE_ADMIN_PROJECT_ID,
        hasClientEmail: !!requiredEnvVars.FIREBASE_ADMIN_CLIENT_EMAIL,
        hasPrivateKey: !!requiredEnvVars.FIREBASE_ADMIN_PRIVATE_KEY,
      }
    });
    throw error;
  }
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

export async function POST(req: Request) {
  console.log('[Checkout] Starting checkout session creation');
  try {
    const body = await req.json();
    const { plan, userId } = body;
    console.log('[Checkout] Received request:', { plan, userId: userId?.substring(0, 10) + '...' });

    if (!plan || !userId) {
      console.error('[Checkout] Missing required fields:', { plan, userId });
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Verify the user exists in Firestore
    try {
      console.log('[Checkout] Checking user in Firestore:', { userId: userId.substring(0, 10) + '...' });
      // For XloudID users, we need to check both the custom ID and the Firebase UID
      const userDoc = await getDoc(doc(db, 'users', userId));
      console.log('[Checkout] User document exists:', userDoc.exists());
      
      if (!userDoc.exists()) {
        console.log('[Checkout] User not found with custom ID, trying Firebase UID');
        // If not found with custom ID, try to find by Firebase UID
        try {
          console.log('[Checkout] Attempting to verify token');
          const decodedToken = await getAuth().verifyIdToken(userId);
          console.log('[Checkout] Token verified successfully:', {
            uid: decodedToken.uid,
            provider: decodedToken.provider_id,
            email: decodedToken.email
          });
          
          const firebaseUid = decodedToken.uid;
          console.log('[Checkout] Looking up user by Firebase UID:', firebaseUid);
          const userDocByUid = await getDoc(doc(db, 'users', firebaseUid));
          console.log('[Checkout] User document exists by Firebase UID:', userDocByUid.exists());
          
          if (!userDocByUid.exists()) {
            console.error('[Checkout] User not found in Firestore:', { 
              customId: userId.substring(0, 10) + '...',
              firebaseUid 
            });
            return NextResponse.json(
              { error: 'User not found' },
              { status: 404 }
            );
          }
        } catch (tokenError) {
          console.log('[Checkout] Token verification failed:', {
            error: tokenError,
            message: (tokenError as Error).message,
            code: (tokenError as any).code
          });
          // If token verification fails, try to create the user document
          console.log('[Checkout] Creating new user document:', userId.substring(0, 10) + '...');
          try {
            await setDoc(doc(db, 'users', userId), {
              createdAt: new Date().toISOString(),
              lastLogin: new Date().toISOString(),
              provider: 'xloudid'
            });
            console.log('[Checkout] Successfully created user document');
          } catch (createError) {
            console.error('[Checkout] Error creating user document:', {
              error: createError,
              message: (createError as Error).message,
              code: (createError as any).code
            });
            throw createError;
          }
        }
      }
    } catch (error) {
      console.error('[Checkout] Error checking user in Firestore:', {
        error,
        message: (error as Error).message,
        code: (error as any).code,
        stack: (error as Error).stack
      });
      return NextResponse.json(
        { error: 'Error verifying user' },
        { status: 500 }
      );
    }

    const planDetails = PLANS[plan as keyof typeof PLANS];
    if (!planDetails) {
      console.error('[Checkout] Invalid plan selected:', plan);
      return NextResponse.json(
        { error: 'Invalid plan selected' },
        { status: 400 }
      );
    }

    console.log('[Checkout] Creating Stripe customer for user:', userId.substring(0, 10) + '...');
    // Get or create Stripe customer
    let customerId: string;
    try {
      console.log('[Checkout] Listing Stripe customers');
      const customers = await stripe.customers.list({
        limit: 100,
      });
      console.log('[Checkout] Found customers:', customers.data.length);
      
      const existingCustomer = customers.data.find(c => c.metadata?.userId === userId);
      
      if (existingCustomer) {
        customerId = existingCustomer.id;
        console.log('[Checkout] Found existing customer:', customerId);
      } else {
        console.log('[Checkout] Creating new Stripe customer');
        const customer = await stripe.customers.create({
          metadata: { userId },
        });
        customerId = customer.id;
        console.log('[Checkout] Created new customer:', customerId);
      }
    } catch (error) {
      console.error('[Checkout] Error with Stripe customer:', {
        error,
        message: (error as Error).message,
        code: (error as any).code,
        type: (error as any).type
      });
      throw error;
    }

    console.log('[Checkout] Creating checkout session for customer:', customerId);
    // Create checkout session
    try {
      console.log('[Checkout] Creating Stripe checkout session');
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
      console.log('[Checkout] Successfully created checkout session:', session.id);

      console.log('[Checkout] Storing checkout session in Firestore:', session.id);
      // Store checkout session in Firestore
      try {
        await setDoc(doc(db, 'checkout_sessions', session.id), {
          userId,
          customerId,
          plan,
          status: 'pending',
          createdAt: new Date().toISOString(),
          sessionId: session.id,
          metadata: session.metadata
        });
        console.log('[Checkout] Successfully stored checkout session');
      } catch (error) {
        console.error('[Checkout] Error storing checkout session in Firestore:', {
          error,
          message: (error as Error).message,
          code: (error as any).code,
          stack: (error as Error).stack
        });
        throw error;
      }

      return NextResponse.json({ 
        sessionId: session.id,
        url: session.url
      });
    } catch (error) {
      console.error('[Checkout] Error creating Stripe checkout session:', {
        error,
        message: (error as Error).message,
        code: (error as any).code,
        type: (error as any).type,
        stack: (error as Error).stack
      });
      throw error;
    }
  } catch (error) {
    console.error('[Checkout] Error in create-checkout-session:', {
      error,
      message: (error as Error).message,
      code: (error as any).code,
      type: (error as any).type,
      stack: (error as Error).stack
    });
    return NextResponse.json(
      { 
        error: 'Error creating checkout session',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 