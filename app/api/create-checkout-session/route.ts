import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { auth } from '@/app/lib/firebase';

// Initialize Firebase Admin if not already initialized
let adminDb: Firestore;
try {
  if (!getApps().length) {
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
    console.log('[Checkout] Firebase Admin initialized successfully');
  }
  adminDb = getFirestore();
} catch (error) {
  console.error('[Checkout] Firebase Admin initialization failed:', {
    error,
    message: (error as any).message,
    code: (error as any).code,
    stack: (error as any).stack
  });
  throw new Error('Firebase Admin initialization failed');
}

// Initialize Stripe
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('Missing Stripe secret key');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-04-30.basil',
});

// Log Stripe configuration (without exposing the full key)
const stripeKeyPrefix = process.env.STRIPE_SECRET_KEY.substring(0, 7);
console.log('[Checkout] Stripe configuration:', {
  keyPrefix: stripeKeyPrefix,
  apiVersion: '2025-04-30.basil'
});

const PLANS = {
  pro: {
    price: 1200, // $12.00
    name: 'Pro Plan',
    features: [
      'Unlimited AI conversations',
      'AI memory and context',
      'File upload + analysis',
      'Web search + live data',
      'Customize assistant',
      'Save conversations',
      'No branding',
      'Add extra user (+20%)',
    ],
  },
  pro_plus: {
    price: 2500, // $25.00
    name: 'Pro Plus Plan',
    features: [
      'Everything in Pro, plus:',
      'Full offline access',
      'Higher file limits',
      'Longer memory depth',
      'Early beta access',
      'Priority features',
      '2 users included',
      'Add users (+30%)',
    ],
  },
};

export async function POST(req: Request) {
  try {
    const { priceId, plan } = await req.json();
    const user = auth.currentUser;

    if (!user) {
      return NextResponse.json(
        { error: 'User not authenticated' },
        { status: 401 }
      );
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/dashboard?success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/dashboard?canceled=true`,
      metadata: {
        userId: user.uid,
        plan: plan
      }
    });

    return NextResponse.json({ sessionId: session.id });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    );
  }
} 