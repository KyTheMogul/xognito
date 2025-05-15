import { NextResponse } from 'next/server';
import { auth } from 'firebase-admin';
import { initializeApp, getApps, cert } from 'firebase-admin/app';

// Initialize Firebase Admin if not already initialized
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

export async function POST(request: Request) {
  try {
    const { token } = await request.json();

    if (!token) {
      return NextResponse.json(
        { message: 'Token is required' },
        { status: 400 }
      );
    }

    // Verify the XloudID token
    const xloudidResponse = await fetch('https://api.xloudid.com/verify-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.XLOUDID_API_KEY}`,
      },
      body: JSON.stringify({ token }),
    });

    if (!xloudidResponse.ok) {
      return NextResponse.json(
        { message: 'Invalid XloudID token' },
        { status: 401 }
      );
    }

    const xloudidUser = await xloudidResponse.json();

    // Create a custom token for our Firebase project
    const firebaseToken = await auth().createCustomToken(xloudidUser.uid, {
      xloudidUserId: xloudidUser.uid,
      email: xloudidUser.email,
    });

    return NextResponse.json({ firebaseToken });
  } catch (error) {
    console.error('Token exchange error:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
} 