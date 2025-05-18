require('dotenv').config({ path: '.env.local' });
const admin = require('firebase-admin');
const Stripe = require('stripe');

// Debug: Check if environment variables are loaded
console.log('Environment variables loaded:', {
  hasStripeKey: !!process.env.STRIPE_SECRET_KEY,
  stripeKeyLength: process.env.STRIPE_SECRET_KEY?.length
});

// Initialize Firebase Admin
admin.initializeApp();

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-04-30.basil'
});

async function updateSubscriptionStatus(userId) {
  try {
    // Get user document from Firestore
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    const userData = userDoc.data();

    if (!userData?.subscription?.stripeSubscriptionId) {
      console.error('No Stripe subscription ID found for user');
      return;
    }

    // Get subscription from Stripe
    const subscription = await stripe.subscriptions.retrieve(
      userData.subscription.stripeSubscriptionId
    );

    console.log('Current Stripe subscription status:', subscription.status);

    // Update Firestore with current subscription status
    await admin.firestore().collection('users').doc(userId).update({
      'subscription.status': subscription.status === 'active' ? 'active' : 'pending',
      'subscription.isActive': subscription.status === 'active',
      'subscription.endDate': admin.firestore.Timestamp.fromDate(
        new Date(subscription.current_period_end * 1000)
      ),
      'subscription.cancelAtPeriodEnd': subscription.cancel_at_period_end
    });

    console.log('Successfully updated subscription status in Firestore');
  } catch (error) {
    console.error('Error updating subscription status:', error);
  } finally {
    process.exit();
  }
}

// Get userId from command line argument
const userId = process.argv[2];
if (!userId) {
  console.error('Please provide a user ID as an argument');
  process.exit(1);
}

updateSubscriptionStatus(userId); 