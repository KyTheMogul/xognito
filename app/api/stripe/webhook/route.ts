import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import Stripe from 'stripe';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin if not already initialized
let adminDb: FirebaseFirestore.Firestore;

if (!getApps().length) {
  console.log('[Webhook] Initializing Firebase Admin');
  try {
    const app = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
    adminDb = getFirestore(app);
    console.log('[Webhook] Firebase Admin initialized successfully');
  } catch (error) {
    console.error('[Webhook] Firebase Admin initialization error:', error);
    throw error;
  }
} else {
  adminDb = getFirestore();
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-04-30.basil'
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

export async function POST(request: Request) {
  try {
    const body = await request.text();
    const headersList = new Headers(request.headers);
    const signature = headersList.get('stripe-signature');

    if (!signature) {
      console.error('[Webhook] No Stripe signature found in headers');
      return NextResponse.json({ error: 'No signature found' }, { status: 400 });
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err: any) {
      console.error('[Webhook] Error verifying webhook signature:', err.message);
      return NextResponse.json({ error: 'Webhook signature verification failed' }, { status: 400 });
    }

    console.log('[Webhook] Received event:', event.type);

    // Handle the checkout.session.completed event
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      
      console.log('[Webhook] Processing completed checkout session:', {
        sessionId: session.id,
        customerId: session.customer,
        metadata: session.metadata
      });

      // Get the user ID and plan from the session metadata
      const userId = session.metadata?.userId;
      const plan = session.metadata?.plan;

      if (!userId || !plan) {
        console.error('[Webhook] Missing userId or plan in session metadata:', session.metadata);
        return NextResponse.json({ error: 'Missing metadata' }, { status: 400 });
      }

      try {
        // Update the user's plan in Firestore
        await adminDb.collection('users').doc(userId).update({
          plan: plan,
          stripeCustomerId: session.customer,
          subscriptionId: session.subscription,
          updatedAt: new Date().toISOString()
        });

        console.log('[Webhook] Successfully updated user plan:', {
          userId,
          plan,
          customerId: session.customer,
          subscriptionId: session.subscription
        });

        return NextResponse.json({ received: true });
      } catch (error) {
        console.error('[Webhook] Error updating user plan:', error);
        return NextResponse.json({ error: 'Failed to update user plan' }, { status: 500 });
      }
    }

    // Handle subscription updates
    if (event.type === 'customer.subscription.updated') {
      const subscription = event.data.object as Stripe.Subscription;
      
      console.log('[Webhook] Processing subscription update:', {
        subscriptionId: subscription.id,
        customerId: subscription.customer,
        status: subscription.status
      });

      // Find the user by their Stripe customer ID
      const usersRef = adminDb.collection('users');
      const querySnapshot = await usersRef.where('stripeCustomerId', '==', subscription.customer).get();

      if (querySnapshot.empty) {
        console.error('[Webhook] No user found for customer:', subscription.customer);
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      const userDoc = querySnapshot.docs[0];
      const userId = userDoc.id;

      try {
        // Update the user's subscription status
        await userDoc.ref.update({
          subscriptionStatus: subscription.status,
          updatedAt: new Date().toISOString()
        });

        console.log('[Webhook] Successfully updated subscription status:', {
          userId,
          status: subscription.status
        });

        return NextResponse.json({ received: true });
      } catch (error) {
        console.error('[Webhook] Error updating subscription status:', error);
        return NextResponse.json({ error: 'Failed to update subscription status' }, { status: 500 });
      }
    }

    // Handle subscription cancellations
    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object as Stripe.Subscription;
      
      console.log('[Webhook] Processing subscription cancellation:', {
        subscriptionId: subscription.id,
        customerId: subscription.customer
      });

      // Find the user by their Stripe customer ID
      const usersRef = adminDb.collection('users');
      const querySnapshot = await usersRef.where('stripeCustomerId', '==', subscription.customer).get();

      if (querySnapshot.empty) {
        console.error('[Webhook] No user found for customer:', subscription.customer);
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      const userDoc = querySnapshot.docs[0];
      const userId = userDoc.id;

      try {
        // Update the user's plan to free and clear subscription data
        await userDoc.ref.update({
          plan: 'free',
          subscriptionStatus: 'canceled',
          stripeCustomerId: null,
          subscriptionId: null,
          updatedAt: new Date().toISOString()
        });

        console.log('[Webhook] Successfully processed subscription cancellation:', {
          userId
        });

        return NextResponse.json({ received: true });
      } catch (error) {
        console.error('[Webhook] Error processing subscription cancellation:', error);
        return NextResponse.json({ error: 'Failed to process subscription cancellation' }, { status: 500 });
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[Webhook] Error processing webhook:', error);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }
} 