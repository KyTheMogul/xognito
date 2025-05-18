import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { db } from '@/app/lib/firebase';
import { doc, updateDoc, Timestamp } from 'firebase/firestore';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-04-30.basil',
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

export async function POST(req: Request) {
  try {
    const body = await req.text();
    const headersList = await headers();
    const signature = headersList.get('stripe-signature')!;

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    console.log('Processing webhook event:', event.type);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log('Checkout session completed:', {
          sessionId: session.id,
          customerId: session.customer,
          subscriptionId: session.subscription,
          metadata: session.metadata
        });
        
        // Get the user ID and plan from the session metadata
        const userId = session.metadata?.userId;
        const plan = session.metadata?.plan;

        if (!userId || !plan) {
          console.error('Missing userId or plan in session metadata');
          return NextResponse.json({ error: 'Missing metadata' }, { status: 400 });
        }

        // Get subscription details from Stripe
        const subscription = session.subscription ? 
          await stripe.subscriptions.retrieve(session.subscription as string) : null;

        if (!subscription) {
          console.error('No subscription found for session:', session.id);
          return NextResponse.json({ error: 'No subscription found' }, { status: 400 });
        }

        // Update user's subscription in Firebase
        const userRef = doc(db, 'users', userId);
        await updateDoc(userRef, {
          'subscription.plan': plan,
          'subscription.status': 'active', // Set to active immediately for successful purchases
          'subscription.startDate': Timestamp.fromDate(new Date(subscription.current_period_start * 1000)),
          'subscription.endDate': Timestamp.fromDate(new Date(subscription.current_period_end * 1000)),
          'subscription.stripeCustomerId': session.customer,
          'subscription.stripeSubscriptionId': session.subscription,
          'subscription.cancelAtPeriodEnd': subscription.cancel_at_period_end,
          'subscription.trialEnd': subscription.trial_end ? Timestamp.fromDate(new Date(subscription.trial_end * 1000)) : null,
          'subscription.isActive': true
        });

        console.log(`Updated subscription for user ${userId} to ${plan} plan with status active`);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        console.log('Subscription updated:', {
          subscriptionId: subscription.id,
          status: subscription.status,
          metadata: subscription.metadata
        });

        const userId = subscription.metadata?.userId;

        if (!userId) {
          console.error('Missing userId in subscription metadata');
          return NextResponse.json({ error: 'Missing metadata' }, { status: 400 });
        }

        // Update subscription status in Firebase
        const userRef = doc(db, 'users', userId);
        await updateDoc(userRef, {
          'subscription.status': subscription.status === 'active' ? 'active' : 'pending',
          'subscription.endDate': Timestamp.fromDate(new Date(subscription.current_period_end * 1000)),
          'subscription.cancelAtPeriodEnd': subscription.cancel_at_period_end,
          'subscription.trialEnd': subscription.trial_end ? Timestamp.fromDate(new Date(subscription.trial_end * 1000)) : null,
          'subscription.isActive': subscription.status === 'active'
        });

        console.log(`Updated subscription status for user ${userId} to ${subscription.status}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        console.log('Subscription deleted:', {
          subscriptionId: subscription.id,
          metadata: subscription.metadata
        });

        const userId = subscription.metadata?.userId;

        if (!userId) {
          console.error('Missing userId in subscription metadata');
          return NextResponse.json({ error: 'Missing metadata' }, { status: 400 });
        }

        // Update subscription status to cancelled in Firebase
        const userRef = doc(db, 'users', userId);
        await updateDoc(userRef, {
          'subscription.plan': 'free',
          'subscription.status': 'cancelled',
          'subscription.endDate': Timestamp.fromDate(new Date(subscription.current_period_end * 1000)),
          'subscription.cancelAtPeriodEnd': true,
          'subscription.isActive': false,
          'subscription.stripeCustomerId': null,
          'subscription.stripeSubscriptionId': null
        });

        console.log(`Marked subscription as cancelled for user ${userId}`);
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500 }
    );
  }
} 