import { NextResponse } from 'next/server';
import { auth } from 'firebase-admin';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

console.log("[XloudID API] API route loaded");

// Validate required environment variables
const requiredEnvVars = {
  FIREBASE_ADMIN_PROJECT_ID: process.env.FIREBASE_ADMIN_PROJECT_ID,
  FIREBASE_ADMIN_CLIENT_EMAIL: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
  FIREBASE_ADMIN_PRIVATE_KEY: process.env.FIREBASE_ADMIN_PRIVATE_KEY,
};

console.log("[XloudID API] Environment check:", {
  hasProjectId: !!requiredEnvVars.FIREBASE_ADMIN_PROJECT_ID,
  hasClientEmail: !!requiredEnvVars.FIREBASE_ADMIN_CLIENT_EMAIL,
  hasPrivateKey: !!requiredEnvVars.FIREBASE_ADMIN_PRIVATE_KEY,
  deploymentEnv: process.env.NODE_ENV,
  vercelEnv: process.env.VERCEL_ENV,
});

const missingVars = Object.entries(requiredEnvVars)
  .filter(([_, value]) => !value)
  .map(([key]) => key);

if (missingVars.length > 0) {
  console.error("[XloudID API] Missing required environment variables:", missingVars);
  throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
}

// Initialize Firebase Admin if not already initialized
if (!getApps().length) {
  try {
    console.log("[XloudID API] Initializing Firebase Admin with config:", {
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      hasPrivateKey: !!process.env.FIREBASE_ADMIN_PRIVATE_KEY,
    });

    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
    console.log("[XloudID API] Firebase Admin initialized successfully");
  } catch (error) {
    console.error("[XloudID API] Firebase Admin initialization error:", error);
    throw error;
  }
}

// Initialize Firestore
const adminDb = getFirestore();

export async function POST(request: Request) {
  console.log("[XloudID API] POST request received");
  try {
    const { token } = await request.json();
    console.log("[XloudID API] Received token request");

    if (!token) {
      console.log("[XloudID API] No token provided");
      return NextResponse.json(
        { message: 'Token is required' },
        { status: 400 }
      );
    }

    // Create user in Firebase Authentication if it doesn't exist
    try {
      const uid = `xloudid_${token}`;
      try {
        await auth().getUser(uid);
        console.log("[XloudID API] User already exists in Firebase Auth");
      } catch (error: any) {
        if (error.code === 'auth/user-not-found') {
          console.log("[XloudID API] Creating new user in Firebase Auth");
          await auth().createUser({
            uid: uid,
            email: `${uid}@xloudid.com`, // Using a placeholder email
            emailVerified: false,
            disabled: false
          });
          // Set custom claims after user creation
          await auth().setCustomUserClaims(uid, {
            provider: 'xloudid',
            originalToken: token
          });
          console.log("[XloudID API] User created in Firebase Auth successfully");
        } else {
          throw error;
        }
      }
    } catch (error) {
      console.error("[XloudID API] Error creating user in Firebase Auth:", error);
      throw error;
    }

    // Create a custom token for our Firebase project
    console.log("[XloudID API] Creating Firebase custom token");
    const firebaseToken = await auth().createCustomToken(`xloudid_${token}`, {
      provider: 'xloudid',
      originalToken: token
    });
    console.log("[XloudID API] Firebase token created successfully");

    // Create or update user document in Firestore
    const userRef = adminDb.collection('users').doc(`xloudid_${token}`);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      console.log("[XloudID API] Creating new user document");
      try {
        await userRef.set({
          provider: 'xloudid',
          xloudId: token,
          createdAt: new Date(),
          lastLogin: new Date(),
          emailVerified: false,
          settings: {
            theme: 'system',
            notifications: {
              email: true,
              push: true,
              weeklyDigest: false,
              groupRequests: true,
            },
            ai: {
              model: 'default',
              temperature: 0.7,
              maxTokens: 2000,
            },
            memory: {
              enabled: true,
              retentionDays: 30,
              autoArchive: true,
            }
          },
          subscription: {
            plan: 'free',
            status: 'active',
            startDate: new Date(),
            nextBillingDate: new Date(),
            billingHistory: [],
            usage: {
              messagesToday: 0,
              filesUploaded: 0,
              lastReset: new Date(),
            }
          }
        });
        console.log("[XloudID API] User document created successfully");
      } catch (error) {
        console.error("[XloudID API] Error creating user document:", error);
        // Continue with token exchange even if user document creation fails
      }
    } else {
      console.log("[XloudID API] Updating existing user document");
      try {
        await userRef.update({
          lastLogin: new Date(),
          xloudId: token
        });
        console.log("[XloudID API] User document updated successfully");
      } catch (error) {
        console.error("[XloudID API] Error updating user document:", error);
        // Continue with token exchange even if user document update fails
      }
    }

    return NextResponse.json({ firebaseToken });
  } catch (error: any) {
    console.error("[XloudID API] Token exchange error:", {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: error.code,
      error: error
    });
    return NextResponse.json(
      { 
        message: 'Internal server error',
        details: error.message,
        code: error.code,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    );
  }
} 