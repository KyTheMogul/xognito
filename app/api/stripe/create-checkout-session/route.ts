import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import Stripe from 'stripe';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin if not already initialized
let adminDb: FirebaseFirestore.Firestore;
let adminAuth: any;

if (!getApps().length) {
  console.log('[Checkout] Initializing Firebase Admin');
  try {
    const app = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
    adminDb = getFirestore(app);
    adminAuth = getAuth(app);
    console.log('[Checkout] Firebase Admin initialized successfully');
  } catch (error) {
    console.error('[Checkout] Firebase Admin initialization error:', error);
    throw error;
  }
} else {
  adminDb = getFirestore();
  adminAuth = getAuth();
}

const stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-04-30.basil'
});

export async function POST(request: Request) {
  try {
    console.log('[Checkout] Creating checkout session');
    
    // Get the authorization header
    const headersList = await headers();
    const authHeader = headersList.get('authorization');
    
    if (!authHeader?.startsWith('Bearer ')) {
      console.error('[Checkout] No valid authorization header found');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get the token
    const token = authHeader.split('Bearer ')[1];
    
    // Verify the token
    let decodedToken;
    try {
      decodedToken = await adminAuth.verifyIdToken(token);
      console.log('[Checkout] Token verified for user:', decodedToken.uid);
    } catch (error) {
      console.error('[Checkout] Token verification failed:', error);
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    const { plan } = await request.json();
    const userId = decodedToken.uid;

    console.log('[Checkout] User details:', {
      uid: userId,
      email: decodedToken.email,
      plan: plan
    });

    // Log environment variables (without exposing sensitive data)
    console.log('[Checkout] Environment check:', {
      hasStripeKey: !!process.env.STRIPE_SECRET_KEY,
      hasProPriceId: !!process.env.STRIPE_PRO_PRICE_ID,
      hasProPlusPriceId: !!process.env.STRIPE_PRO_PLUS_PRICE_ID,
      hasAppUrl: !!process.env.NEXT_PUBLIC_APP_URL,
      appUrl: process.env.NEXT_PUBLIC_APP_URL,
      proPriceId: process.env.STRIPE_PRO_PRICE_ID,
      proPlusPriceId: process.env.STRIPE_PRO_PLUS_PRICE_ID
    });

    // Validate price IDs
    const priceId = plan === 'pro' ? process.env.STRIPE_PRO_PRICE_ID : process.env.STRIPE_PRO_PLUS_PRICE_ID;
    if (!priceId) {
      console.error('[Checkout] Missing price ID for plan:', plan);
      return NextResponse.json(
        { error: 'Invalid plan configuration' },
        { status: 500 }
      );
    }

    // Create a checkout session
    try {
      const session = await stripeInstance.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        mode: 'subscription',
        success_url: `https://${process.env.NEXT_PUBLIC_APP_URL}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `https://${process.env.NEXT_PUBLIC_APP_URL}/pricing`,
        metadata: {
          userId: userId,
          plan: plan
        },
        customer_email: decodedToken.email || undefined,
      });

      console.log('[Checkout] Session created:', {
        sessionId: session.id,
        customerId: session.customer,
        metadata: session.metadata,
        successUrl: `https://${process.env.NEXT_PUBLIC_APP_URL}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `https://${process.env.NEXT_PUBLIC_APP_URL}/pricing`,
        priceId: priceId
      });

      return NextResponse.json({ sessionId: session.id });
    } catch (stripeError: any) {
      console.error('[Checkout] Stripe session creation failed:', {
        error: stripeError,
        message: stripeError.message,
        type: stripeError.type,
        code: stripeError.code,
        stack: stripeError.stack
      });
      return NextResponse.json(
        { error: `Stripe error: ${stripeError.message}` },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('[Checkout] Error creating session:', {
      error,
      message: error.message,
      stack: error.stack
    });
    return NextResponse.json(
      { error: `Server error: ${error.message}` },
      { status: 500 }
    );
  }
} 