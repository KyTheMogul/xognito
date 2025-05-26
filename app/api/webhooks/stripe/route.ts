import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import Stripe from 'stripe';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// Validate required environment variables
const requiredEnvVars = {
  FIREBASE_ADMIN_PROJECT_ID: process.env.FIREBASE_ADMIN_PROJECT_ID,
  FIREBASE_ADMIN_CLIENT_EMAIL: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
  FIREBASE_ADMIN_PRIVATE_KEY: process.env.FIREBASE_ADMIN_PRIVATE_KEY,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
};

console.log('[Webhook] Checking environment variables:', {
  hasProjectId: !!requiredEnvVars.FIREBASE_ADMIN_PROJECT_ID,
  hasClientEmail: !!requiredEnvVars.FIREBASE_ADMIN_CLIENT_EMAIL,
  hasPrivateKey: !!requiredEnvVars.FIREBASE_ADMIN_PRIVATE_KEY,
  hasStripeKey: !!requiredEnvVars.STRIPE_SECRET_KEY,
  hasWebhookSecret: !!requiredEnvVars.STRIPE_WEBHOOK_SECRET,
});

// Initialize Firebase Admin if not already initialized
let adminDb: FirebaseFirestore.Firestore;
try {
  if (!getApps().length) {
    console.log('[Webhook] Initializing Firebase Admin');
    if (!process.env.FIREBASE_ADMIN_PROJECT_ID || !process.env.FIREBASE_ADMIN_CLIENT_EMAIL || !process.env.FIREBASE_ADMIN_PRIVATE_KEY) {
      throw new Error('Missing Firebase Admin credentials');
    }
    const app = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
    adminDb = getFirestore(app);
    console.log('[Webhook] Firebase Admin initialized successfully');
  } else {
    console.log('[Webhook] Using existing Firebase Admin instance');
    adminDb = getFirestore();
  }
} catch (error) {
  console.error('[Webhook] Firebase Admin initialization failed:', {
    error,
    message: (error as any).message,
    code: (error as any).code,
    stack: (error as any).stack
  });
  throw new Error('Firebase Admin initialization failed');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-04-30.basil'
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

// Add CORS headers to the response
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, stripe-signature',
  };
}

// Handle OPTIONS request for CORS
export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders() });
}

// Add a GET handler to test the endpoint
export async function GET() {
  return NextResponse.json({ 
    status: 'ok',
    message: 'Stripe webhook endpoint is accessible',
    timestamp: new Date().toISOString()
  }, { headers: corsHeaders() });
}

export async function POST(req: Request) {
  const body = await req.text();
  const headersList = await headers();
  const signature = headersList.get('stripe-signature');

  if (!signature) {
    console.error('No Stripe signature found in headers');
    return NextResponse.json({ error: 'No signature found' }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Webhook signature verification failed' }, { status: 400 });
  }

  console.log('Processing webhook event:', event.type);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.userId;
    const customerId = session.customer as string;
    const subscriptionId = session.subscription as string;

    if (!userId || !customerId || !subscriptionId) {
      console.error('Missing required fields:', { userId, customerId, subscriptionId });
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    try {
      // Get the subscription details
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const plan = session.metadata?.plan || 'pro';

      // Format plan name consistently
      const formattedPlan = plan.toLowerCase() === 'pro' ? 'Pro' : 
                           plan.toLowerCase() === 'pro_plus' ? 'Pro-Plus' : 
                           'Free';

      console.log('Updating user plan:', { userId, plan: formattedPlan });

      // Update the user's plan in Firestore
      const userRef = adminDb.collection('users').doc(userId);
      
      // First, get the current user data
      const userDoc = await userRef.get();
      if (!userDoc.exists) {
        console.error('User document not found:', userId);
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      // Update user document with new plan
      await userRef.update({
        plan: formattedPlan,
        subscriptionStatus: 'active',
        stripeCustomerId: customerId,
        subscriptionId: subscriptionId,
        updatedAt: new Date().toISOString()
      });

      // Create or update billing document
      const billingRef = userRef.collection('settings').doc('billing');
      const billingData = {
        plan: formattedPlan,
        status: 'active',
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        startDate: new Date(subscription.current_period_start * 1000).toISOString(),
        nextBillingDate: new Date(subscription.current_period_end * 1000).toISOString(),
        trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
        billingHistory: FieldValue.arrayUnion({
          date: new Date().toISOString(),
          type: 'subscription_created',
          amount: subscription.items.data[0].price.unit_amount! / 100,
          currency: subscription.currency,
          status: 'succeeded'
        }),
        updatedAt: new Date().toISOString()
      };

      await billingRef.set(billingData, { merge: true });

      // Verify the updates
      const [updatedUserDoc, updatedBillingDoc] = await Promise.all([
        userRef.get(),
        billingRef.get()
      ]);

      console.log('Successfully updated user plan:', {
        user: updatedUserDoc.data(),
        billing: updatedBillingDoc.data()
      });

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
    
    try {
      // Find the user by their Stripe customer ID
      const usersRef = adminDb.collection('users');
      const querySnapshot = await usersRef.where('stripeCustomerId', '==', subscription.customer).get();

      if (querySnapshot.empty) {
        console.error('No user found for customer:', subscription.customer);
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      const userDoc = querySnapshot.docs[0];
      const userId = userDoc.id;

      // Update the user's subscription status
      await userDoc.ref.update({
        subscriptionStatus: subscription.status,
        updatedAt: new Date().toISOString()
      });

      // Update the billing document
      const billingRef = adminDb.collection('users').doc(userId).collection('settings').doc('billing');
      await billingRef.set({
        status: subscription.status,
        currentPeriodStart: new Date(subscription.current_period_start * 1000).toISOString(),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      return NextResponse.json({ received: true });
    } catch (error) {
      console.error('Error updating subscription status:', error);
      return NextResponse.json({ error: 'Failed to update subscription status' }, { status: 500 });
    }
  }

  // Handle subscription cancellations
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as Stripe.Subscription;
    
    try {
      // Find the user by their Stripe customer ID
      const usersRef = adminDb.collection('users');
      const querySnapshot = await usersRef.where('stripeCustomerId', '==', subscription.customer).get();

      if (querySnapshot.empty) {
        console.error('No user found for customer:', subscription.customer);
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      const userDoc = querySnapshot.docs[0];
      const userId = userDoc.id;

      // Update the user's plan to free and clear subscription data
      await userDoc.ref.update({
        plan: 'Free',
        subscriptionStatus: 'canceled',
        stripeCustomerId: null,
        subscriptionId: null,
        updatedAt: new Date().toISOString()
      });

      // Update the billing document
      const billingRef = adminDb.collection('users').doc(userId).collection('settings').doc('billing');
      await billingRef.set({
        plan: 'Free',
        status: 'canceled',
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
        cancelAtPeriodEnd: true,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      return NextResponse.json({ received: true });
    } catch (error) {
      console.error('Error processing subscription cancellation:', error);
      return NextResponse.json({ error: 'Failed to process subscription cancellation' }, { status: 500 });
    }
  }

  return NextResponse.json({ received: true });
} 