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

    // For now, we'll use the token directly as the user ID
    // This is temporary until we have proper XloudID API integration
    const userId = `xloudid_${token.substring(0, 20)}`;
    console.log("[XloudID API] Using temporary user ID:", userId);

    // Create a custom token for our Firebase project
    console.log("[XloudID API] Creating Firebase custom token");
    const firebaseToken = await auth().createCustomToken(userId, {
      provider: 'xloudid',
      originalToken: token
    });
    console.log("[XloudID API] Firebase token created successfully");

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