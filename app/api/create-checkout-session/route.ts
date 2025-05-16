import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin if not already initialized
let adminDb: Firestore;
try {
  if (!getApps().length) {
    const app = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
    console.log('[Checkout] Firebase Admin initialized successfully');
  }
  adminDb = getFirestore();
} catch (error) {
  console.error('[Checkout] Firebase Admin initialization failed:', {
    error,
    message: (error as any).message,
    code: (error as any).code
  });
  throw new Error('Firebase Admin initialization failed');
}

// Log Stripe configuration (without exposing the full key)
const stripeKeyPrefix = process.env.STRIPE_SECRET_KEY?.substring(0, 7) || 'missing';
console.log('[Checkout] Stripe configuration:', {
  keyPrefix: stripeKeyPrefix,
  apiVersion: '2025-04-30.basil'
});

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-04-30.basil',
});

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
  try {
    console.log('[Checkout] Received request');
    const body = await req.json();
    console.log('[Checkout] Request body:', {
      plan: body.plan,
      userId: body.userId
    });

    const { plan, userId } = body;

    if (!plan || !userId) {
      console.error('[Checkout] Missing required fields:', { plan, userId });
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
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

    // Verify user exists in Firestore
    try {
      console.log('[Checkout] Checking user in Firestore:', { userId });
      const userRef = adminDb.collection('users').doc(userId);
      const userDoc = await userRef.get();
      
      if (!userDoc.exists) {
        console.error('[Checkout] User not found in Firestore:', { userId });
        return NextResponse.json(
          { error: 'User not found' },
          { status: 404 }
        );
      }

      // Update user's subscription status
      try {
        const userData = userDoc.data();
        console.log('[Checkout] Current user data:', { 
          userId,
          existingData: userData 
        });

        const updateData = {
          ...userData,
          subscriptionStatus: 'pending',
          selectedPlan: plan,
          lastUpdated: new Date().toISOString()
        };

        console.log('[Checkout] Updating user with data:', { 
          userId,
          updateData 
        });

        await userRef.set(updateData, { merge: true });
        console.log('[Checkout] Successfully updated user subscription status:', { userId, plan });
      } catch (updateError) {
        console.error('[Checkout] Error updating user subscription:', {
          error: updateError,
          userId,
          plan,
          message: (updateError as any).message,
          code: (updateError as any).code
        });
        return NextResponse.json(
          { 
            error: 'Error updating user subscription',
            details: (updateError as any).message,
            code: (updateError as any).code
          },
          { status: 500 }
        );
      }
    } catch (error) {
      console.error('[Checkout] Error accessing Firestore:', {
        error,
        userId,
        message: (error as any).message,
        code: (error as any).code
      });
      return NextResponse.json(
        { 
          error: 'Error accessing user data',
          details: (error as any).message,
          code: (error as any).code
        },
        { status: 500 }
      );
    }

    // Create or get Stripe customer
    let customerId: string;
    try {
      console.log('[Checkout] Looking up customer:', { userId });
      // First try to find customer by metadata
      const customers = await stripe.customers.list({
        limit: 100, // Get more customers to search through
      });
      
      console.log('[Checkout] Found customers:', { 
        count: customers.data.length,
        hasMore: customers.has_more
      });
      
      const existingCustomer = customers.data.find(c => c.metadata?.userId === userId);
      
      if (existingCustomer) {
        customerId = existingCustomer.id;
        console.log('[Checkout] Found existing customer:', { 
          customerId,
          metadata: existingCustomer.metadata
        });
      } else {
        console.log('[Checkout] Creating new customer:', { userId });
        const customer = await stripe.customers.create({
          metadata: {
            userId,
          },
        });
        customerId = customer.id;
        console.log('[Checkout] Created new customer:', { 
          customerId,
          metadata: customer.metadata
        });
      }
    } catch (error) {
      console.error('[Checkout] Error with Stripe customer:', {
        error,
        message: (error as any).message,
        type: (error as any).type,
        code: (error as any).code,
        userId
      });
      return NextResponse.json(
        { 
          error: 'Error creating/retrieving customer',
          details: (error as any).message,
          type: (error as any).type,
          code: (error as any).code
        },
        { status: 500 }
      );
    }

    // Get base URL from request headers or environment variable
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 
                   (req.headers.get('origin') || 'https://xognito.com');
    console.log('[Checkout] Using base URL:', { baseUrl });

    // Create checkout session
    try {
      // Log all required data for debugging
      console.log('[Checkout] Required data check:', {
        customerId,
        plan,
        baseUrl,
        planDetails,
        stripeKeyPrefix: process.env.STRIPE_SECRET_KEY?.substring(0, 7),
        hasStripeKey: !!process.env.STRIPE_SECRET_KEY,
        hasFirebaseConfig: !!process.env.FIREBASE_ADMIN_PROJECT_ID
      });

      // Validate required data
      if (!customerId) {
        throw new Error('Missing customerId');
      }
      if (!planDetails) {
        throw new Error('Missing planDetails');
      }
      if (!baseUrl) {
        throw new Error('Missing baseUrl');
      }
      if (!process.env.STRIPE_SECRET_KEY) {
        throw new Error('Missing Stripe secret key');
      }

      // Create the session with more detailed configuration
      const sessionConfig: Stripe.Checkout.SessionCreateParams = {
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
        success_url: `${baseUrl}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/dashboard`,
        metadata: {
          userId,
          plan,
          customerId
        },
        allow_promotion_codes: true,
        billing_address_collection: 'auto' as const,
        customer_update: {
          address: 'auto',
          name: 'auto'
        }
      };

      console.log('[Checkout] Creating session with config:', {
        ...sessionConfig,
        customer: customerId, // Log customer ID separately
        line_items: sessionConfig.line_items?.map(item => ({
          ...item,
          price_data: item.price_data ? {
            ...item.price_data,
            unit_amount: item.price_data.unit_amount
          } : undefined
        }))
      });

      const session = await stripe.checkout.sessions.create(sessionConfig);

      console.log('[Checkout] Session created successfully:', { 
        sessionId: session.id,
        customerId: session.customer,
        status: session.status,
        url: session.url,
        metadata: session.metadata
      });

      // Store checkout session in Firestore
      try {
        const sessionRef = adminDb.collection('checkout_sessions').doc(session.id);
        await sessionRef.set({
          userId,
          customerId,
          plan,
          status: 'pending',
          createdAt: new Date().toISOString(),
          sessionId: session.id,
          metadata: session.metadata
        });
        console.log('[Checkout] Stored checkout session in Firestore:', { 
          sessionId: session.id,
          metadata: session.metadata
        });
      } catch (error) {
        console.error('[Checkout] Error storing checkout session in Firestore:', {
          error,
          message: (error as any).message,
          code: (error as any).code,
          sessionId: session.id
        });
        // Continue even if Firestore update fails - we can handle this in the webhook
      }

      return NextResponse.json({ 
        sessionId: session.id,
        url: session.url
      });
    } catch (error) {
      // Log detailed error information
      console.error('[Checkout] Error creating checkout session:', {
        error,
        message: (error as any).message,
        type: (error as any).type,
        code: (error as any).code,
        customerId,
        plan,
        stripeKeyPrefix: process.env.STRIPE_SECRET_KEY?.substring(0, 7),
        hasStripeKey: !!process.env.STRIPE_SECRET_KEY,
        hasFirebaseConfig: !!process.env.FIREBASE_ADMIN_PROJECT_ID
      });

      // Return more detailed error response
      return NextResponse.json(
        { 
          error: 'Error creating checkout session',
          details: (error as any).message,
          type: (error as any).type,
          code: (error as any).code,
          debug: {
            hasStripeKey: !!process.env.STRIPE_SECRET_KEY,
            hasFirebaseConfig: !!process.env.FIREBASE_ADMIN_PROJECT_ID,
            customerId: !!customerId,
            plan: !!plan
          }
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[Checkout] Error in checkout session creation:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: (error as any).message
      },
      { status: 500 }
    );
  }
} 