import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import Stripe from 'stripe';
import { db } from '@/lib/firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-04-30.basil'
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

export async function POST(request: Request) {
  try {
    console.log('[Webhook] Processing webhook request');
    
    const headersList = await headers();
    const signature = headersList.get('stripe-signature');

    if (!signature) {
      console.error('[Webhook] No signature found in request');
      return NextResponse.json(
        { error: 'No signature found' },
        { status: 400 }
      );
    }

    const body = await request.text();
    console.log('[Webhook] Request body:', body);

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err) {
      console.error('[Webhook] Error verifying webhook signature:', err);
      return NextResponse.json(
        { error: 'Webhook signature verification failed' },
        { status: 400 }
      );
    }

    console.log('[Webhook] Processing event:', event.type);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log('[Webhook] Processing checkout.session.completed:', session.id);

        if (!session.metadata?.userId) {
          console.error('[Webhook] No userId in session metadata');
          return NextResponse.json(
            { error: 'No userId in session metadata' },
            { status: 400 }
          );
        }

        const userId = session.metadata.userId;
        const plan = session.metadata.plan || 'free';

        // Get the subscription details
        const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
        console.log('[Webhook] Retrieved subscription:', subscription.id);

        // Update user's subscription in Firestore
        const billingRef = doc(db, 'users', userId, 'settings', 'billing');
        await setDoc(billingRef, {
          plan,
          status: subscription.status,
          stripeCustomerId: session.customer,
          stripeSubscriptionId: subscription.id,
          startDate: new Date(subscription.current_period_start * 1000).toISOString(),
          nextBillingDate: new Date(subscription.current_period_end * 1000).toISOString(),
          trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
          updatedAt: new Date().toISOString()
        }, { merge: true });

        console.log('[Webhook] Updated user subscription in Firestore');
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        console.log('[Webhook] Processing customer.subscription.updated:', subscription.id);

        // Get the customer to find the user
        const customer = await stripe.customers.retrieve(subscription.customer as string) as Stripe.Customer;
        if (!customer.metadata?.userId) {
          console.error('[Webhook] No userId in customer metadata');
          return NextResponse.json(
            { error: 'No userId in customer metadata' },
            { status: 400 }
          );
        }

        const userId = customer.metadata.userId;

        // Update subscription status in Firestore
        const billingRef = doc(db, 'users', userId, 'settings', 'billing');
        await setDoc(billingRef, {
          status: subscription.status,
          startDate: new Date(subscription.current_period_start * 1000).toISOString(),
          nextBillingDate: new Date(subscription.current_period_end * 1000).toISOString(),
          trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
          updatedAt: new Date().toISOString()
        }, { merge: true });

        console.log('[Webhook] Updated subscription status in Firestore');
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        console.log('[Webhook] Processing customer.subscription.deleted:', subscription.id);

        // Get the customer to find the user
        const customer = await stripe.customers.retrieve(subscription.customer as string) as Stripe.Customer;
        if (!customer.metadata?.userId) {
          console.error('[Webhook] No userId in customer metadata');
          return NextResponse.json(
            { error: 'No userId in customer metadata' },
            { status: 400 }
          );
        }

        const userId = customer.metadata.userId;

        // Update subscription status in Firestore
        const billingRef = doc(db, 'users', userId, 'settings', 'billing');
        await setDoc(billingRef, {
          status: 'canceled',
          plan: 'free',
          updatedAt: new Date().toISOString()
        }, { merge: true });

        console.log('[Webhook] Updated subscription status to canceled in Firestore');
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[Webhook] Error processing webhook:', error);
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500 }
    );
  }
} 