import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { stripe } from '@/lib/stripe';
import type Stripe from 'stripe';

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

export async function POST(req: Request) {
  try {
    const body = await req.text();
    const signature = req.headers.get('stripe-signature')!;

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err);
      return NextResponse.json(
        { error: 'Webhook signature verification failed' },
        { status: 400 }
      );
    }

    const session = event.data.object as Stripe.Checkout.Session;

    switch (event.type) {
      case 'checkout.session.completed': {
        const { userId, plan } = session.metadata!;
        const subscription = await stripe.subscriptions.retrieve(session.subscription as string);

        // Update user's subscription in Firestore
        await setDoc(doc(db, 'users', userId, 'subscription', 'current'), {
          plan,
          isActive: true,
          stripeCustomerId: session.customer,
          stripeSubscriptionId: session.subscription,
          startDate: new Date(subscription.start_date * 1000),
          nextBillingDate: new Date(subscription.current_period_end * 1000),
          seatsUsed: 1,
          seatsAllowed: plan === 'pro_plus' ? 2 : 1,
        });

        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customer = await stripe.customers.retrieve(subscription.customer as string) as Stripe.Customer;
        const userId = customer.metadata.userId;

        if (userId) {
          // Update subscription status in Firestore
          await setDoc(doc(db, 'users', userId, 'subscription', 'current'), {
            isActive: subscription.status === 'active',
            nextBillingDate: new Date(subscription.current_period_end * 1000),
          }, { merge: true });
        }

        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customer = await stripe.customers.retrieve(subscription.customer as string) as Stripe.Customer;
        const userId = customer.metadata.userId;

        if (userId) {
          // Downgrade to free plan
          await setDoc(doc(db, 'users', userId, 'subscription', 'current'), {
            plan: 'free',
            isActive: true,
            stripeCustomerId: null,
            stripeSubscriptionId: null,
            startDate: null,
            nextBillingDate: null,
            seatsUsed: 1,
            seatsAllowed: 1,
          });
        }

        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 