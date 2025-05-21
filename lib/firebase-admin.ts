import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { getAuth } from 'firebase-admin/auth';

// Initialize Firebase Admin
const apps = getApps();

if (!apps.length) {
  try {
    const app = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
      // Use the correct environment variable name
      ...(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET && {
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
      })
    });

    // Initialize storage only if bucket is configured
    if (process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET) {
      const storage = getStorage(app);
      console.log('[Firebase Admin] Storage initialized with bucket:', process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
    }

    console.log('[Firebase Admin] Initialized successfully');
  } catch (error) {
    console.error('[Firebase Admin] Error initializing:', error);
    throw error;
  }
}

// Only export storage if bucket is configured
export const storage = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ? getStorage() : null;
export const auth = getAuth(); 