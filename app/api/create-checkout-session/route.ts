import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { db } from '@/lib/firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';

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
      const userRef = doc(db, 'users', userId);
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists()) {
        console.error('[Checkout] User not found in Firestore:', { userId });
        return NextResponse.json(
          { error: 'User not found' },
          { status: 404 }
        );
      }

      // Update user's subscription status
      await setDoc(userRef, {
        subscriptionStatus: 'pending',
        selectedPlan: plan,
        lastUpdated: new Date().toISOString()
      }, { merge: true });

      console.log('[Checkout] Updated user subscription status:', { userId, plan });
    } catch (error) {
      console.error('[Checkout] Error updating Firestore:', error);
      return NextResponse.json(
        { error: 'Error updating user subscription', details: (error as any).message },
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
      
      const existingCustomer = customers.data.find(c => c.metadata?.userId === userId);
      
      if (existingCustomer) {
        customerId = existingCustomer.id;
        console.log('[Checkout] Found existing customer:', { customerId });
      } else {
        console.log('[Checkout] Creating new customer:', { userId });
        const customer = await stripe.customers.create({
          metadata: {
            userId,
          },
        });
        customerId = customer.id;
        console.log('[Checkout] Created new customer:', { customerId });
      }
    } catch (error) {
      console.error('[Checkout] Error with Stripe customer:', error);
      return NextResponse.json(
        { error: 'Error creating/retrieving customer', details: (error as any).message },
        { status: 500 }
      );
    }

    // Get base URL from request headers or environment variable
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 
                   (req.headers.get('origin') || 'https://xognito.com');
    console.log('[Checkout] Using base URL:', { baseUrl });

    // Create checkout session
    try {
      console.log('[Checkout] Creating checkout session:', {
        customerId,
        plan,
        baseUrl
      });

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
        },
      });

      // Store checkout session in Firestore
      try {
        const sessionRef = doc(db, 'checkout_sessions', session.id);
        await setDoc(sessionRef, {
          userId,
          customerId,
          plan,
          status: 'pending',
          createdAt: new Date().toISOString(),
          sessionId: session.id
        });
        console.log('[Checkout] Stored checkout session in Firestore:', { sessionId: session.id });
      } catch (error) {
        console.error('[Checkout] Error storing checkout session in Firestore:', error);
        // Continue even if Firestore update fails - we can handle this in the webhook
      }

      console.log('[Checkout] Session created successfully:', { sessionId: session.id });
      return NextResponse.json({ sessionId: session.id });
    } catch (error) {
      console.error('[Checkout] Error creating checkout session:', {
        error: error,
        message: (error as any).message,
        type: (error as any).type,
        code: (error as any).code
      });
      return NextResponse.json(
        { 
          error: 'Error creating checkout session',
          details: (error as any).message,
          type: (error as any).type,
          code: (error as any).code
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