import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

// Initialize Stripe
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
    const body = await req.json();
    const { plan, userId } = body;

    if (!plan || !userId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const planDetails = PLANS[plan as keyof typeof PLANS];
    if (!planDetails) {
      return NextResponse.json(
        { error: 'Invalid plan selected' },
        { status: 400 }
      );
    }

    // Get or create Stripe customer
    let customerId: string;
    const customers = await stripe.customers.list({
      limit: 100,
    });
    
    const existingCustomer = customers.data.find(c => c.metadata?.userId === userId);
    
    if (existingCustomer) {
      customerId = existingCustomer.id;
    } else {
      const customer = await stripe.customers.create({
        metadata: { userId },
      });
      customerId = customer.id;
    }

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
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
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

    // Store checkout session in Firestore
    await setDoc(doc(db, 'checkout_sessions', session.id), {
      userId,
      customerId,
      plan,
      status: 'pending',
      createdAt: new Date().toISOString(),
      sessionId: session.id,
      metadata: session.metadata
    });

    return NextResponse.json({ 
      sessionId: session.id,
      url: session.url
    });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return NextResponse.json(
      { 
        error: 'Error creating checkout session',
        details: (error as any).message
      },
      { status: 500 }
    );
  }
} 