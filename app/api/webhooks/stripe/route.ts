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

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        
        // Get the user ID and plan from the session metadata
        const userId = session.metadata?.userId;
        const plan = session.metadata?.plan;

        if (!userId || !plan) {
          console.error('Missing userId or plan in session metadata');
          return NextResponse.json({ error: 'Missing metadata' }, { status: 400 });
        }

        // Update user's subscription in Firebase
        const userRef = doc(db, 'users', userId);
        await updateDoc(userRef, {
          subscription: {
            plan: plan,
            status: 'active',
            startDate: Timestamp.now(),
            endDate: Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)), // 30 days
            stripeCustomerId: session.customer,
            stripeSubscriptionId: session.subscription
          }
        });

        console.log(`Updated subscription for user ${userId} to ${plan} plan`);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = subscription.metadata?.userId;

        if (!userId) {
          console.error('Missing userId in subscription metadata');
          return NextResponse.json({ error: 'Missing metadata' }, { status: 400 });
        }

        // Update subscription status in Firebase
        const userRef = doc(db, 'users', userId);
        await updateDoc(userRef, {
          'subscription.status': subscription.status,
          'subscription.endDate': Timestamp.fromDate(new Date(subscription.current_period_end * 1000))
        });

        console.log(`Updated subscription status for user ${userId} to ${subscription.status}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = subscription.metadata?.userId;

        if (!userId) {
          console.error('Missing userId in subscription metadata');
          return NextResponse.json({ error: 'Missing metadata' }, { status: 400 });
        }

        // Update subscription status to cancelled in Firebase
        const userRef = doc(db, 'users', userId);
        await updateDoc(userRef, {
          'subscription.status': 'cancelled',
          'subscription.endDate': Timestamp.fromDate(new Date(subscription.current_period_end * 1000))
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