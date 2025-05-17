const admin = require('firebase-admin');
const serviceAccount = require('../service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function makeAdmin(email) {
  try {
    // Get user by email
    const userRecord = await admin.auth().getUserByEmail(email);
    const userId = userRecord.uid;

    // Update user document
    await db.collection('users').doc(userId).update({
      isAdmin: true
    });

    console.log(`Successfully made ${email} an admin!`);
    process.exit(0);
  } catch (error) {
    console.error('Error making user admin:', error);
    process.exit(1);
  }
}

// Get email from command line argument
const email = process.argv[2];
if (!email) {
  console.error('Please provide an email address');
  process.exit(1);
}

makeAdmin(email); 