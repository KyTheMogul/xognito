import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import Stripe from 'stripe';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

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

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-04-30.basil'
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

// Initialize Firebase Admin if not already initialized
let adminDb: Firestore;
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
    console.log('[Webhook] ====== Starting Webhook Processing ======');
    
    // Get the signature from the headers
    const headersList = await headers();
    const signature = headersList.get('stripe-signature');
    
    if (!signature) {
      console.error('[Webhook] No Stripe signature found in headers');
      return NextResponse.json(
        { error: 'No Stripe signature found' },
        { status: 400, headers: corsHeaders() }
      );
    }

    // Get the raw body
    const body = await request.text();
    console.log('[Webhook] Received webhook body:', body);

    // Verify the webhook signature
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
      console.log('[Webhook] Successfully verified webhook signature');
    } catch (err) {
      console.error('[Webhook] Webhook signature verification failed:', err);
      return NextResponse.json(
        { error: 'Webhook signature verification failed' },
        { status: 400, headers: corsHeaders() }
      );
    }

    console.log('[Webhook] Processing event:', {
      type: event.type,
      id: event.id
    });

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
        
        // Format plan name consistently
        const formattedPlan = plan.toLowerCase() === 'pro' ? 'pro' : 
                              plan.toLowerCase() === 'pro_plus' ? 'pro_plus' : 
                              'free';

        console.log('[Webhook] Formatted plan name:', formattedPlan);

        try {
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

          console.log('[Webhook] Attempting to update Firestore with data:', billingData);
          try {
            await billingRef.set(billingData, { merge: true });
            console.log('[Webhook] Firestore update successful');

            // Also update the main user document to ensure consistency
            const userRef = adminDb.collection('users').doc(userId);
            await userRef.update({
              'subscription.plan': formattedPlan,
              'subscription.status': subscription.status,
              'subscription.stripeCustomerId': session.customer,
              'subscription.stripeSubscriptionId': subscription.id,
              'subscription.startDate': new Date(subscription.current_period_start * 1000).toISOString(),
              'subscription.nextBillingDate': new Date(subscription.current_period_end * 1000).toISOString(),
              'subscription.trialEndsAt': subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
              'subscription.updatedAt': new Date().toISOString()
            });
            console.log('[Webhook] Main user document update successful');

            // Verify the updates
            const [updatedBillingDoc, updatedUserDoc] = await Promise.all([
              billingRef.get(),
              userRef.get()
            ]);
            console.log('[Webhook] Firestore updates verified:', {
              billing: updatedBillingDoc.data(),
              user: updatedUserDoc.data()
            });
          } catch (firestoreError) {
            console.error('[Webhook] Error updating Firestore:', {
              error: firestoreError,
              message: (firestoreError as any).message,
              code: (firestoreError as any).code,
              stack: (firestoreError as any).stack
            });
            throw firestoreError;
          }
        } catch (error) {
          console.error('[Webhook] Error processing subscription:', {
            error,
            message: (error as any).message,
            code: (error as any).code,
            stack: (error as any).stack
          });
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
    console.error('[Webhook] Error processing webhook:', {
      error,
      message: (error as any).message,
      code: (error as any).code,
      stack: (error as any).stack
    });
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500, headers: corsHeaders() }
    );
  }
} 