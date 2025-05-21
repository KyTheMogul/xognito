import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import Stripe from 'stripe';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-04-30.basil'
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

// Initialize Firebase Admin if not already initialized
let adminDb: Firestore;
if (!getApps().length) {
  const app = initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
  adminDb = getFirestore(app);
} else {
  adminDb = getFirestore();
}

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

export async function POST(request: Request) {
  try {
    console.log('[Webhook] ====== New Webhook Request ======');
    console.log('[Webhook] Environment:', process.env.NODE_ENV);
    console.log('[Webhook] Webhook Secret:', webhookSecret ? 'Present' : 'Missing');
    
    const headersList = await headers();
    const signature = headersList.get('stripe-signature');
    console.log('[Webhook] Stripe Signature:', signature ? 'Present' : 'Missing');

    if (!signature) {
      console.error('[Webhook] No signature found in request');
      return NextResponse.json(
        { error: 'No signature found' },
        { status: 400, headers: corsHeaders() }
      );
    }

    const body = await request.text();
    console.log('[Webhook] Request body:', body);

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
      console.log('[Webhook] Event constructed successfully:', {
        type: event.type,
        id: event.id
      });
    } catch (err) {
      console.error('[Webhook] Error verifying webhook signature:', err);
      return NextResponse.json(
        { error: 'Webhook signature verification failed' },
        { status: 400, headers: corsHeaders() }
      );
    }

    console.log('[Webhook] Processing event:', event.type);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log('[Webhook] Processing checkout.session.completed:', {
          sessionId: session.id,
          customerId: session.customer,
          subscriptionId: session.subscription,
          metadata: session.metadata
        });

        if (!session.metadata?.userId) {
          console.error('[Webhook] No userId in session metadata');
          return NextResponse.json(
            { error: 'No userId in session metadata' },
            { status: 400, headers: corsHeaders() }
          );
        }

        const userId = session.metadata.userId;
        const plan = session.metadata.plan || 'free';
        
        // Format plan name with proper capitalization
        const formattedPlan = plan === 'pro' ? 'Pro' : 
                            plan === 'pro_plus' ? 'Pro Plus' : 
                            'Free';

        console.log('[Webhook] Formatted plan name:', formattedPlan);

        // Get the subscription details
        const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
        console.log('[Webhook] Retrieved subscription:', {
          id: subscription.id,
          status: subscription.status,
          currentPeriodStart: new Date(subscription.current_period_start * 1000).toISOString(),
          currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString()
        });

        // Update user's subscription in Firestore using Admin SDK
        const billingRef = adminDb.collection('users').doc(userId).collection('settings').doc('billing');
        const billingData = {
          plan: formattedPlan,
          status: subscription.status,
          stripeCustomerId: session.customer,
          stripeSubscriptionId: subscription.id,
          startDate: new Date(subscription.current_period_start * 1000).toISOString(),
          nextBillingDate: new Date(subscription.current_period_end * 1000).toISOString(),
          trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
          updatedAt: new Date().toISOString(),
          billingHistory: [],
          usage: {
            messagesToday: 0,
            filesUploaded: 0,
            lastReset: new Date().toISOString()
          },
          createdAt: new Date().toISOString()
        };

        console.log('[Webhook] Updating Firestore with data:', billingData);
        try {
          await billingRef.set(billingData, { merge: true });
          console.log('[Webhook] Firestore update successful');

          // Verify the update
          const updatedDoc = await billingRef.get();
          console.log('[Webhook] Firestore update verified:', updatedDoc.data());
        } catch (error) {
          console.error('[Webhook] Error updating Firestore:', error);
          throw error;
        }

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
            { status: 400, headers: corsHeaders() }
          );
        }

        const userId = customer.metadata.userId;

        // Update subscription status in Firestore using Admin SDK
        const billingRef = adminDb.collection('users').doc(userId).collection('settings').doc('billing');
        const billingData = {
          status: subscription.status,
          startDate: new Date(subscription.current_period_start * 1000).toISOString(),
          nextBillingDate: new Date(subscription.current_period_end * 1000).toISOString(),
          trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
          updatedAt: new Date().toISOString()
        };

        console.log('[Webhook] Updating subscription status in Firestore:', billingData);
        await billingRef.set(billingData, { merge: true });

        // Verify the update
        const updatedDoc = await billingRef.get();
        console.log('[Webhook] Firestore update verified:', updatedDoc.data());

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
            { status: 400, headers: corsHeaders() }
          );
        }

        const userId = customer.metadata.userId;

        // Update subscription status in Firestore using Admin SDK
        const billingRef = adminDb.collection('users').doc(userId).collection('settings').doc('billing');
        const billingData = {
          status: 'canceled',
          plan: 'Free',
          updatedAt: new Date().toISOString()
        };

        console.log('[Webhook] Updating subscription status to canceled in Firestore:', billingData);
        await billingRef.set(billingData, { merge: true });

        // Verify the update
        const updatedDoc = await billingRef.get();
        console.log('[Webhook] Firestore update verified:', updatedDoc.data());

        console.log('[Webhook] Updated subscription status to canceled in Firestore');
        break;
      }
    }

    console.log('[Webhook] ====== Webhook Processing Complete ======');
    return NextResponse.json({ received: true }, { headers: corsHeaders() });
  } catch (error) {
    console.error('[Webhook] Error processing webhook:', error);
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500, headers: corsHeaders() }
    );
  }
} 