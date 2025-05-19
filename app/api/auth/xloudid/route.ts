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
  XLOUDID_API_KEY: process.env.XLOUDID_API_KEY,
};

console.log("[XloudID API] Environment check:", {
  hasProjectId: !!requiredEnvVars.FIREBASE_ADMIN_PROJECT_ID,
  hasClientEmail: !!requiredEnvVars.FIREBASE_ADMIN_CLIENT_EMAIL,
  hasPrivateKey: !!requiredEnvVars.FIREBASE_ADMIN_PRIVATE_KEY,
  hasXloudidApiKey: !!requiredEnvVars.XLOUDID_API_KEY,
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

// Initialize Firebase Admin for Xognito
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

    // Verify token with XloudID API
    console.log("[XloudID API] Verifying token with XloudID API");
    const verifyResponse = await fetch('https://api.xloudone.com/v1/auth/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.XLOUDID_API_KEY}`,
      },
      body: JSON.stringify({ token }),
    });

    if (!verifyResponse.ok) {
      const errorData = await verifyResponse.json();
      console.error("[XloudID API] Token verification failed:", errorData);
      throw new Error(errorData.message || 'Failed to verify token');
    }

    const { user: xloudidUser } = await verifyResponse.json();
    console.log("[XloudID API] Token verified, got user:", {
      uid: xloudidUser.uid,
      email: xloudidUser.email
    });

    // Create or get Firebase user in Xognito
    let firebaseUser;
    try {
      firebaseUser = await auth().getUser(xloudidUser.uid);
      console.log("[XloudID API] Existing Firebase user found");
    } catch (error) {
      console.log("[XloudID API] Creating new Firebase user");
      firebaseUser = await auth().createUser({
        uid: xloudidUser.uid,
        email: xloudidUser.email,
        emailVerified: xloudidUser.emailVerified,
        displayName: xloudidUser.displayName,
        photoURL: xloudidUser.photoURL
      });

      // Create user profile in Firestore
      console.log("[XloudID API] Creating user profile in Firestore");
      await adminDb.collection('users').doc(firebaseUser.uid).set({
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        displayName: firebaseUser.displayName,
        photoURL: firebaseUser.photoURL,
        emailVerified: firebaseUser.emailVerified,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        xloudidUid: xloudidUser.uid,
        settings: {
          theme: 'dark',
          notifications: true,
          language: 'en'
        }
      });
      console.log("[XloudID API] User profile created successfully");
    }

    // Create a custom token for our Firebase project
    console.log("[XloudID API] Creating Firebase custom token");
    const firebaseToken = await auth().createCustomToken(firebaseUser.uid, {
      provider: 'xloudid',
      xloudidUid: xloudidUser.uid
    });
    console.log("[XloudID API] Firebase token created successfully");

    return NextResponse.json({ 
      firebaseToken,
      user: {
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        displayName: firebaseUser.displayName,
        photoURL: firebaseUser.photoURL,
        emailVerified: firebaseUser.emailVerified
      }
    });
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