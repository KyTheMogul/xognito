import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { stripe } from '@/lib/stripe';

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
      console.error('Missing required fields:', { plan, userId });
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

    console.log('Creating Stripe customer for user:', userId);
    // Get or create Stripe customer
    let customerId: string;
    try {
      const customers = await stripe.customers.list({
        limit: 100,
      });
      
      const existingCustomer = customers.data.find(c => c.metadata?.userId === userId);
      
      if (existingCustomer) {
        customerId = existingCustomer.id;
        console.log('Found existing customer:', customerId);
      } else {
        const customer = await stripe.customers.create({
          metadata: { userId },
        });
        customerId = customer.id;
        console.log('Created new customer:', customerId);
      }
    } catch (error) {
      console.error('Error with Stripe customer:', error);
      throw error;
    }

    console.log('Creating checkout session for customer:', customerId);
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

      console.log('Storing checkout session in Firestore:', session.id);
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
        console.log('Successfully stored checkout session');
      } catch (error) {
        console.error('Error storing checkout session in Firestore:', error);
        throw error;
      }

      return NextResponse.json({ 
        sessionId: session.id,
        url: session.url
      });
    } catch (error) {
      console.error('Error creating Stripe checkout session:', error);
      throw error;
    }
  } catch (error) {
    console.error('Error in create-checkout-session:', error);
    return NextResponse.json(
      { 
        error: 'Error creating checkout session',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 