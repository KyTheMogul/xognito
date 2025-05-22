import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import Stripe from 'stripe';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// Initialize Firebase Admin if not already initialized
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const adminDb = getFirestore();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-04-30.basil'
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

export async function POST(req: Request) {
  const body = await req.text();
  const signature = headers().get('stripe-signature');

  if (!signature) {
    console.error('No Stripe signature found in headers');
    return NextResponse.json({ error: 'No signature found' }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Webhook signature verification failed' }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.client_reference_id;
    const customerId = session.customer as string;
    const subscriptionId = session.subscription as string;

    if (!userId || !customerId || !subscriptionId) {
      console.error('Missing required fields:', { userId, customerId, subscriptionId });
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    try {
      // Get the subscription details
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const plan = subscription.items.data[0].price.nickname || 'pro';

      // Update the user's plan in Firestore
      const userRef = adminDb.collection('users').doc(userId);
      const userDoc = await userRef.get();
      
      if (!userDoc.exists) {
        console.error('User document not found:', userId);
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      console.log('Current user data:', userDoc.data());

      // Update user document with new plan
      await userRef.update({
        plan: plan,
        subscriptionStatus: 'active',
        stripeCustomerId: customerId,
        subscriptionId: subscriptionId,
        updatedAt: new Date().toISOString()
      });

      // Create or update billing document
      const billingRef = userRef.collection('billing').doc('subscription');
      const billingData = {
        plan,
        status: 'active',
        stripeCustomerId: customerId,
        subscriptionId: subscriptionId,
        currentPeriodStart: new Date(subscription.current_period_start * 1000),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
        billingHistory: FieldValue.arrayUnion({
          date: new Date(),
          type: 'subscription_created',
          amount: subscription.items.data[0].price.unit_amount! / 100,
          currency: subscription.currency,
          status: 'succeeded'
        }),
        updatedAt: new Date().toISOString()
      };

      await billingRef.set(billingData, { merge: true });

      // Verify the updates
      const updatedUserDoc = await userRef.get();
      const updatedBillingDoc = await billingRef.get();
      
      console.log('Updated user data:', updatedUserDoc.data());
      console.log('Updated billing data:', updatedBillingDoc.data());

      return NextResponse.json({ 
        success: true,
        message: 'Subscription updated successfully',
        userData: updatedUserDoc.data(),
        billingData: updatedBillingDoc.data()
      });
    } catch (error) {
      console.error('Error updating user plan:', error);
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

      // Update the billing document
      const billingRef = adminDb.collection('users').doc(userId).collection('billing').doc('subscription');
      await billingRef.set({
        status: subscription.status,
        currentPeriodStart: new Date(subscription.current_period_start * 1000).toISOString(),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        updatedAt: new Date().toISOString()
      }, { merge: true });

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

      // Update the billing document
      const billingRef = adminDb.collection('users').doc(userId).collection('billing').doc('subscription');
      await billingRef.set({
        plan: 'free',
        status: 'canceled',
        stripeCustomerId: null,
        subscriptionId: null,
        currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
        cancelAtPeriodEnd: true,
        updatedAt: new Date().toISOString()
      }, { merge: true });

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
} 