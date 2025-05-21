import { db } from './firebase';
import { 
  doc, 
  collection, 
  setDoc, 
  getDoc, 
  updateDoc, 
  Timestamp,
  serverTimestamp
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
    invoiceUrl?: string;
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