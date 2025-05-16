import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import Stripe from 'stripe';

// Initialize Firebase Admin
admin.initializeApp();

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-04-30.basil',
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

export const createCheckoutSession = functions.https.onCall(async (data, context) => {
  try {
    const { plan, userId } = data;

    // Validate input
    if (!plan || !userId) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Missing required fields: plan and userId'
      );
    }

    const planDetails = PLANS[plan as keyof typeof PLANS];
    if (!planDetails) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Invalid plan selected'
      );
    }

    // Get user from Firestore
    const userRef = admin.firestore().collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      throw new functions.https.HttpsError(
        'not-found',
        'User not found'
      );
    }

    // Update user's subscription status
    await userRef.update({
      subscriptionStatus: 'pending',
      selectedPlan: plan,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    });

    // Create or get Stripe customer
    let customerId: string;
    const customers = await stripe.customers.list({
      limit: 100,
    });
    
    const existingCustomer = customers.data.find(c => c.metadata?.userId === userId);
    
    if (existingCustomer) {
      customerId = existingCustomer.id;
    } else {
      const customer = await stripe.customers.create({
        metadata: {
          userId,
        },
      });
      customerId = customer.id;
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: planDetails.name,
              description: planDetails.features.join('\n'),
              metadata: {
                plan,
                userId
              }
            },
            unit_amount: planDetails.price,
            recurring: {
              interval: 'month',
            },
          },
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
      metadata: {
        userId,
        plan,
        customerId
      },
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      customer_update: {
        address: 'auto',
        name: 'auto'
      }
    });

    // Store checkout session in Firestore
    await admin.firestore()
      .collection('checkout_sessions')
      .doc(session.id)
      .set({
        userId,
        customerId,
        plan,
        status: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        sessionId: session.id,
        metadata: session.metadata
      });

    return {
      sessionId: session.id,
      url: session.url
    };
  } catch (error) {
    console.error('Error creating checkout session:', error);
    throw new functions.https.HttpsError(
      'internal',
      'Error creating checkout session',
      error
    );
  }
}); 