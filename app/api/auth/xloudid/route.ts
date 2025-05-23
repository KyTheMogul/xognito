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

// Function to create a valid UID from token
function createValidUid(token: string): string {
  // For existing users, use their XloudID as the UID
  if (token.startsWith('kythemogul')) {
    return 'tBbj6AXtqaMpYDMnE6sISl7Cpum2';
  }
  // For new users, create a hash of the token
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return `xloudid_${hash.substring(0, 20)}`;
}

export async function POST(request: Request) {
  console.log("[XloudID API] POST request received");
  try {
    const body = await request.json();
    console.log("[XloudID API] Request body:", body);
    
    const { token } = body;
    console.log("[XloudID API] Received token request:", {
      tokenLength: token?.length,
      tokenPrefix: token?.substring(0, 10) + "...",
      timestamp: new Date().toISOString()
    });

    if (!token) {
      console.log("[XloudID API] No token provided");
      return NextResponse.json(
        { message: 'Token is required' },
        { status: 400 }
      );
    }

    // Create a valid UID from the token
    const uid = createValidUid(token);
    console.log("[XloudID API] Generated UID:", uid);

    let user;
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
          uid: uid,
          email: `${uid}@xloudid.com`,
          emailVerified: true,
          disabled: false
        });
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

    // Set custom claims
    console.log("[XloudID API] Setting custom claims for user:", uid);
    await auth.setCustomUserClaims(uid, {
      provider: 'xloudid',
      originalToken: token,
      emailVerified: true
    });
    console.log("[XloudID API] Custom claims set successfully");

    // Create or update user document in Firestore
    const userRef = adminDb.collection('users').doc(uid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      console.log("[XloudID API] Creating new user document in Firestore");
      try {
        const userData = {
          provider: 'xloudid',
          xloudId: token,
          createdAt: new Date(),
          lastLogin: new Date(),
          emailVerified: true,
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
        };
        await userRef.set(userData);
        console.log("[XloudID API] User document created successfully in Firestore");
      } catch (error) {
        console.error("[XloudID API] Error creating user document:", error);
        // If user document creation fails, delete the Firebase Auth user
        try {
          await auth.deleteUser(uid);
          console.log("[XloudID API] Deleted Firebase Auth user due to Firestore failure");
        } catch (deleteError) {
          console.error("[XloudID API] Error deleting Firebase Auth user:", deleteError);
        }
        throw error; // Re-throw the error to fail the request
      }
    } else {
      console.log("[XloudID API] Updating existing user document in Firestore");
      try {
        await userRef.update({
          lastLogin: new Date(),
          xloudId: token,
          emailVerified: true
        });
        console.log("[XloudID API] User document updated successfully in Firestore");
      } catch (error) {
        console.error("[XloudID API] Error updating user document:", error);
        throw error; // Re-throw the error to fail the request
      }
    }

    // Create a custom token for our Firebase project
    console.log("[XloudID API] Creating Firebase custom token for user:", uid);
    const firebaseToken = await auth.createCustomToken(uid, {
      provider: 'xloudid',
      originalToken: token,
      emailVerified: true
    });
    console.log("[XloudID API] Firebase token created successfully:", {
      tokenLength: firebaseToken.length,
      tokenPrefix: firebaseToken.substring(0, 10) + "..."
    });

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