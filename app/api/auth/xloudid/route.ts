import { NextResponse } from 'next/server';
import { auth } from '@/lib/firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import crypto from 'crypto';

console.log("[XloudID API] API route loaded");

// Validate required environment variables
const requiredEnvVars = {
  FIREBASE_ADMIN_PROJECT_ID: process.env.FIREBASE_ADMIN_PROJECT_ID,
  FIREBASE_ADMIN_CLIENT_EMAIL: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
  FIREBASE_ADMIN_PRIVATE_KEY: process.env.FIREBASE_ADMIN_PRIVATE_KEY,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
};

console.log("[XloudID API] Environment check:", {
  hasProjectId: !!requiredEnvVars.FIREBASE_ADMIN_PROJECT_ID,
  hasClientEmail: !!requiredEnvVars.FIREBASE_ADMIN_CLIENT_EMAIL,
  hasPrivateKey: !!requiredEnvVars.FIREBASE_ADMIN_PRIVATE_KEY,
  hasStorageBucket: !!requiredEnvVars.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  deploymentEnv: process.env.NODE_ENV,
  vercelEnv: process.env.VERCEL_ENV,
});

// Only check for required auth variables, storage bucket is optional
const missingVars = Object.entries(requiredEnvVars)
  .filter(([key, value]) => !value && key !== 'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET')
  .map(([key]) => key);

if (missingVars.length > 0) {
  console.error("[XloudID API] Missing required environment variables:", missingVars);
  throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
}

// Initialize Firestore
const adminDb = getFirestore();

// Function to get or create a valid UID from XloudID
async function getOrCreateUidFromXloudId(token: string): Promise<string> {
  const usersRef = adminDb.collection('users');
  const querySnapshot = await usersRef.where('xloudId', '==', token).limit(1).get();
  
  if (!querySnapshot.empty) {
    return querySnapshot.docs[0].id;
  }
  
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return `xloudid_${hash.substring(0, 20)}`;
}

// Function to initialize user settings
async function initializeUserSettings(uid: string) {
  const settingsRef = adminDb.collection('users').doc(uid).collection('settings').doc('user');
  const billingRef = adminDb.collection('users').doc(uid).collection('settings').doc('billing');

  const defaultSettings = {
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
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const defaultBilling = {
    plan: 'free',
    status: 'active',
    startDate: new Date(),
    nextBillingDate: new Date(),
    billingHistory: [],
    usage: {
      messagesToday: 0,
      filesUploaded: 0,
      lastReset: new Date(),
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  try {
    await Promise.all([
      settingsRef.set(defaultSettings),
      billingRef.set(defaultBilling)
    ]);
    console.log("[XloudID API] User settings initialized successfully");
  } catch (error) {
    console.error("[XloudID API] Error initializing user settings:", error);
    throw error;
  }
}

export async function POST(request: Request) {
  console.log("[XloudID API] POST request received");
  try {
    const { token } = await request.json();
    console.log("[XloudID API] Request body:", { token });
    
    if (!token) {
      console.log("[XloudID API] No token provided");
      return NextResponse.json(
        { message: 'Token is required' },
        { status: 400 }
      );
    }

    const uid = await getOrCreateUidFromXloudId(token);
    console.log("[XloudID API] Using UID:", uid);

    let user;
    let isNewUser = false;
    try {
      console.log("[XloudID API] Attempting to get user:", uid);
      user = await auth.getUser(uid);
      console.log("[XloudID API] User already exists in Firebase Auth:", {
        uid: user.uid,
        email: user.email,
        emailVerified: user.emailVerified,
        customClaims: user.customClaims
      });
    } catch (error: any) {
      if (error.code === 'auth/user-not-found') {
        console.log("[XloudID API] Creating new user in Firebase Auth with data:", {
          uid,
          email: `${uid}@xloudid.com`,
          emailVerified: true
        });
        user = await auth.createUser({
          uid,
          email: `${uid}@xloudid.com`,
          emailVerified: true,
          disabled: false
        });
        isNewUser = true;
        console.log("[XloudID API] User created in Firebase Auth successfully:", {
          uid: user.uid,
          email: user.email,
          emailVerified: user.emailVerified
        });
      } else {
        console.error("[XloudID API] Error getting/creating user:", {
          code: error.code,
          message: error.message,
          stack: error.stack
        });
        throw error;
      }
    }

    // Set custom claims and create/update user document in parallel
    const [firebaseToken] = await Promise.all([
      auth.createCustomToken(uid, {
        provider: 'xloudid',
        originalToken: token,
        emailVerified: true
      }),
      auth.setCustomUserClaims(uid, {
        provider: 'xloudid',
        originalToken: token,
        emailVerified: true
      }),
      adminDb.collection('users').doc(uid).set({
        provider: 'xloudid',
        xloudId: token,
        lastLogin: new Date(),
        emailVerified: true
      }, { merge: true })
    ]);

    // Initialize settings for new users
    if (isNewUser) {
      await initializeUserSettings(uid);
    }

    const response = { 
      firebaseToken,
      user: {
        uid: user.uid,
        email: user.email,
        emailVerified: true
      }
    };
    console.log("[XloudID API] Sending successful response:", {
      uid: response.user.uid,
      email: response.user.email,
      tokenLength: response.firebaseToken.length
    });
    return NextResponse.json(response);
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