import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { db } from '@/lib/firebase';
import { doc, setDoc } from 'firebase/firestore';

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
    const { plan, userId, email } = await req.json();

    if (!plan || !userId || !email) {
      console.error('Missing required fields:', { plan, userId, email });
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const planDetails = PLANS[plan as keyof typeof PLANS];
    if (!planDetails) {
      console.error('Invalid plan selected:', plan);
      return NextResponse.json(
        { error: 'Invalid plan selected' },
        { status: 400 }
      );
    }

    // Create or get Stripe customer
    let customerId: string;
    try {
      const customerSnapshot = await stripe.customers.list({
        email,
        limit: 1,
      });

      if (customerSnapshot.data.length > 0) {
        customerId = customerSnapshot.data[0].id;
      } else {
        const customer = await stripe.customers.create({
          email,
          metadata: {
            userId,
          },
        });
        customerId = customer.id;
      }
    } catch (error) {
      console.error('Error with Stripe customer:', error);
      return NextResponse.json(
        { error: 'Error creating/retrieving customer' },
        { status: 500 }
      );
    }

    // Create checkout session
    try {
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
        success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
        metadata: {
          userId,
          plan,
        },
      });

      return NextResponse.json({ sessionId: session.id });
    } catch (error) {
      console.error('Error creating checkout session:', error);
      return NextResponse.json(
        { error: 'Error creating checkout session' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error in checkout session creation:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 