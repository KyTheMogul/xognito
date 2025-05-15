import { NextResponse } from 'next/server';
import { auth } from 'firebase-admin';
import { initializeApp, getApps, cert } from 'firebase-admin/app';

// Initialize Firebase Admin if not already initialized
if (!getApps().length) {
  try {
    console.log("[XloudID API] Initializing Firebase Admin with config:", {
      hasProjectId: !!process.env.FIREBASE_ADMIN_PROJECT_ID,
      hasClientEmail: !!process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
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

export async function POST(request: Request) {
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

    // Verify the XloudID token
    console.log("[XloudID API] Verifying token with XloudID");
    const xloudidResponse = await fetch('https://api.xloudid.com/verify-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.XLOUDID_API_KEY}`,
      },
      body: JSON.stringify({ token }),
    });

    if (!xloudidResponse.ok) {
      console.log("[XloudID API] XloudID verification failed:", {
        status: xloudidResponse.status,
        statusText: xloudidResponse.statusText
      });
      return NextResponse.json(
        { message: 'Invalid XloudID token' },
        { status: 401 }
      );
    }

    const xloudidUser = await xloudidResponse.json();
    console.log("[XloudID API] Token verified, user:", {
      uid: xloudidUser.uid,
      hasEmail: !!xloudidUser.email
    });

    // Create a custom token for our Firebase project
    console.log("[XloudID API] Creating Firebase custom token");
    const firebaseToken = await auth().createCustomToken(xloudidUser.uid, {
      xloudidUserId: xloudidUser.uid,
      email: xloudidUser.email,
    });
    console.log("[XloudID API] Firebase token created successfully");

    return NextResponse.json({ firebaseToken });
  } catch (error: any) {
    console.error("[XloudID API] Token exchange error:", {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: error.code
    });
    return NextResponse.json(
      { 
        message: 'Internal server error',
        details: error.message,
        code: error.code
      },
      { status: 500 }
    );
  }
} 