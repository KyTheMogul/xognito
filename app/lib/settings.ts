import { db } from './firebase';
import { 
  doc, 
  collection, 
  setDoc, 
  getDoc, 
  updateDoc, 
  Timestamp,
  serverTimestamp,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  arrayUnion
} from 'firebase/firestore';

// Types for user settings
export interface UserSettings {
  theme: 'dark' | 'light' | 'system';
  notifications: {
    email: boolean;
    push: boolean;
    weeklyDigest: boolean;
    groupRequests: boolean;
  };
  ai: {
    model: 'default' | 'pro' | 'custom';
    temperature: number;
    maxTokens: number;
  };
  memory: {
    enabled: boolean;
    retentionDays: number;
    autoArchive: boolean;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// Types for billing settings
export interface BillingSettings {
  plan: 'free' | 'pro' | 'pro_plus';
  status: 'active' | 'canceled' | 'past_due' | 'trialing';
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  startDate: Timestamp;
  nextBillingDate: Timestamp;
  trialEndsAt?: Timestamp;
  billingHistory: {
    id: string;
    amount: number;
    currency: string;
    status: 'succeeded' | 'failed' | 'pending';
    date: Timestamp;
    description: string;
    invoiceUrl?: string;  // Added for Stripe invoice link
  }[];
  usage: {
    messagesToday: number;
    filesUploaded: number;
    lastReset: Timestamp;
  };
  group?: {
    id: string;
    name: string;
    owner: string;
    members: string[];
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// Initialize user settings
export async function initializeUserSettings(userId: string): Promise<void> {
  const settingsRef = doc(db, 'users', userId, 'settings', 'user');
  const billingRef = doc(db, 'users', userId, 'settings', 'billing');

  const defaultSettings: UserSettings = {
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
    createdAt: serverTimestamp() as Timestamp,
    updatedAt: serverTimestamp() as Timestamp,
  };

  const defaultBilling: BillingSettings = {
    plan: 'free',
    status: 'active',
    startDate: serverTimestamp() as Timestamp,
    nextBillingDate: serverTimestamp() as Timestamp,
    billingHistory: [],
    usage: {
      messagesToday: 0,
      filesUploaded: 0,
      lastReset: serverTimestamp() as Timestamp,
    },
    createdAt: serverTimestamp() as Timestamp,
    updatedAt: serverTimestamp() as Timestamp,
  };

  try {
    await setDoc(settingsRef, defaultSettings);
    await setDoc(billingRef, defaultBilling);
  } catch (error) {
    console.error('Error initializing user settings:', error);
    throw error;
  }
}

// Get user settings
export async function getUserSettings(userId: string): Promise<UserSettings | null> {
  const settingsRef = doc(db, 'users', userId, 'settings', 'user');
  try {
    const docSnap = await getDoc(settingsRef);
    return docSnap.exists() ? (docSnap.data() as UserSettings) : null;
  } catch (error) {
    console.error('Error getting user settings:', error);
    throw error;
  }
}

// Get billing settings
export async function getBillingSettings(userId: string): Promise<BillingSettings | null> {
  const billingRef = doc(db, 'users', userId, 'settings', 'billing');
  try {
    const docSnap = await getDoc(billingRef);
    return docSnap.exists() ? (docSnap.data() as BillingSettings) : null;
  } catch (error) {
    console.error('Error getting billing settings:', error);
    throw error;
  }
}

// Update user settings
export async function updateUserSettings(
  userId: string, 
  settings: Partial<UserSettings>
): Promise<void> {
  const settingsRef = doc(db, 'users', userId, 'settings', 'user');
  try {
    await updateDoc(settingsRef, {
      ...settings,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    console.error('Error updating user settings:', error);
    throw error;
  }
}

// Update billing settings
export async function updateBillingSettings(
  userId: string,
  billing: Partial<BillingSettings>
): Promise<void> {
  const billingRef = doc(db, 'users', userId, 'settings', 'billing');
  try {
    await updateDoc(billingRef, {
      ...billing,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    console.error('Error updating billing settings:', error);
    throw error;
  }
}

// Add billing history entry
export async function addBillingHistoryEntry(
  userId: string,
  entry: Omit<BillingSettings['billingHistory'][0], 'id'>
): Promise<void> {
  const billingRef = doc(db, 'users', userId, 'settings', 'billing');
  try {
    await updateDoc(billingRef, {
      billingHistory: arrayUnion({
        ...entry,
        id: crypto.randomUUID(),
      }),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    console.error('Error adding billing history entry:', error);
    throw error;
  }
}

// Update usage stats
export async function updateUsageStats(
  userId: string,
  stats: Partial<BillingSettings['usage']>
): Promise<void> {
  const billingRef = doc(db, 'users', userId, 'settings', 'billing');
  try {
    await updateDoc(billingRef, {
      'usage': {
        ...stats,
      },
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    console.error('Error updating usage stats:', error);
    throw error;
  }
}

// Subscribe to settings changes
export function subscribeToSettings(
  userId: string,
  callback: (settings: UserSettings) => void
): () => void {
  const settingsRef = doc(db, 'users', userId, 'settings', 'user');
  return onSnapshot(settingsRef, (doc) => {
    if (doc.exists()) {
      callback(doc.data() as UserSettings);
    }
  });
}

// Subscribe to billing changes
export function subscribeToBilling(
  userId: string,
  callback: (billing: BillingSettings) => void
): () => void {
  const billingRef = doc(db, 'users', userId, 'settings', 'billing');
  return onSnapshot(billingRef, (doc) => {
    if (doc.exists()) {
      callback(doc.data() as BillingSettings);
    }
  });
} 