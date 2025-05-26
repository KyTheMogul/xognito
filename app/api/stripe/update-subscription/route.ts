import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin if not already initialized
let adminDb: FirebaseFirestore.Firestore;

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

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-04-30.basil'
});

export async function POST(request: Request) {
  try {
    const { session_id } = await request.json();

    if (!session_id) {
      return NextResponse.json(
        { success: false, error: 'Session ID is required' },
        { status: 400 }
      );
    }

    // Retrieve the session from Stripe
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (!session || session.payment_status !== 'paid') {
      return NextResponse.json(
        { success: false, error: 'Invalid or unpaid session' },
        { status: 400 }
      );
    }

    // Get the user ID from the session metadata
    const userId = session.metadata?.userId;
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'No user ID found in session' },
        { status: 400 }
      );
    }

    // Get the subscription details
    const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
    const plan = subscription.items.data[0].price.nickname || 'Pro';
    const status = subscription.status;
    const currentPeriodStart = new Date(subscription.current_period_start * 1000);
    const currentPeriodEnd = new Date(subscription.current_period_end * 1000);

    // Update the user's subscription in Firestore
    const userRef = adminDb.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    await userRef.update({
      'subscription.plan': plan,
      'subscription.status': status,
      'subscription.stripeCustomerId': session.customer,
      'subscription.stripeSubscriptionId': session.subscription,
      'subscription.currentPeriodStart': currentPeriodStart,
      'subscription.currentPeriodEnd': currentPeriodEnd,
      'subscription.billingHistory': [
        ...(userDoc.data()?.subscription?.billingHistory || []),
        {
          date: new Date(),
          amount: (session.amount_total || 0) / 100,
          currency: session.currency,
          status: 'succeeded'
        }
      ]
    });

    return NextResponse.json({
      success: true,
      subscription: {
        plan,
        status,
        currentPeriodStart,
        currentPeriodEnd
      }
    });
  } catch (error) {
    console.error('Error updating subscription:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update subscription' },
      { status: 500 }
    );
  }
} 