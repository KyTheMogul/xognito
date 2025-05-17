import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';

// Initialize Firebase Admin
const apps = getApps();

if (!apps.length) {
  try {
    const app = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });

    // Initialize storage with the app
    const storage = getStorage(app);
    
    // Verify storage bucket is configured
    if (!process.env.FIREBASE_STORAGE_BUCKET) {
      throw new Error('FIREBASE_STORAGE_BUCKET environment variable is not set');
    }

    console.log('Firebase Admin initialized successfully');
  } catch (error) {
    console.error('Error initializing Firebase Admin:', error);
    throw error;
  }
}

export const storage = getStorage(); 