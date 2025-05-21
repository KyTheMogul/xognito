import { db } from './firebase';
import { doc, getDoc, updateDoc, arrayUnion, Timestamp } from 'firebase/firestore';

export type SubscriptionPlan = 'free' | 'pro' | 'pro_plus';

export interface Subscription {
  plan: SubscriptionPlan;
  isActive: boolean;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  startDate?: Timestamp;
  nextBillingDate?: Timestamp;
  addedBy?: string;
  sharedUsers?: string[];
  seatsUsed?: number;
  seatsAllowed?: number;
  trialEndsAt?: Timestamp;
}

export interface UserSettings {
  assistantName?: string;
  assistantTone?: 'professional' | 'friendly' | 'casual';
  assistantAvatar?: string;
  memoryEnabled?: boolean;
  webSearchEnabled?: boolean;
  fileUploadEnabled?: boolean;
  exportEnabled?: boolean;
}

// Check if user has Pro plan
export async function hasProPlan(userId: string): Promise<boolean> {
  const subscriptionRef = doc(db, 'users', userId, 'subscription', 'current');
  const subscriptionDoc = await getDoc(subscriptionRef);
  
  if (!subscriptionDoc.exists()) return false;
  
  const subscription = subscriptionDoc.data() as Subscription;
  return subscription.plan === 'pro' && subscription.isActive;
}

// Check if user can invite others
export async function canInviteUsers(userId: string): Promise<boolean> {
  const subscriptionRef = doc(db, 'users', userId, 'subscription', 'current');
  const subscriptionDoc = await getDoc(subscriptionRef);
  
  if (!subscriptionDoc.exists()) return false;
  
  const subscription = subscriptionDoc.data() as Subscription;
  return subscription.plan === 'pro' && 
         subscription.isActive && 
         !subscription.addedBy && // Not an invited user
         (!subscription.seatsUsed || subscription.seatsUsed < (subscription.seatsAllowed || 2));
}

// Add a user to subscription
export async function addUserToSubscription(
  primaryUserId: string,
  invitedUserId: string
): Promise<boolean> {
  try {
    const subscriptionRef = doc(db, 'users', primaryUserId, 'subscription', 'current');
    const subscriptionDoc = await getDoc(subscriptionRef);
    
    if (!subscriptionDoc.exists()) return false;
    
    const subscription = subscriptionDoc.data() as Subscription;
    
    // Check if primary user can invite
    if (subscription.plan !== 'pro' || 
        !subscription.isActive || 
        subscription.addedBy || 
        (subscription.seatsUsed && subscription.seatsUsed >= (subscription.seatsAllowed || 2))) {
      return false;
    }
    
    // Update primary user's subscription
    await updateDoc(subscriptionRef, {
      sharedUsers: arrayUnion(invitedUserId),
      seatsUsed: (subscription.seatsUsed || 0) + 1
    });
    
    // Set up invited user's subscription
    const invitedUserRef = doc(db, 'users', invitedUserId, 'subscription', 'current');
    await updateDoc(invitedUserRef, {
      plan: 'pro',
      isActive: true,
      addedBy: primaryUserId,
      sharedUsers: [],
      seatsUsed: 1,
      seatsAllowed: 1
    });
    
    return true;
  } catch (error) {
    console.error('[Subscription] Error adding user:', error);
    return false;
  }
}

// Get user settings
export async function getUserSettings(userId: string): Promise<UserSettings> {
  const settingsRef = doc(db, 'users', userId, 'settings', 'current');
  const settingsDoc = await getDoc(settingsRef);
  
  if (!settingsDoc.exists()) {
    // Return default settings
    return {
      assistantName: 'Xognito',
      assistantTone: 'professional',
      assistantAvatar: 'https://randomuser.me/api/portraits/lego/1.jpg',
      memoryEnabled: true,
      webSearchEnabled: true,
      fileUploadEnabled: true,
      exportEnabled: true
    };
  }
  
  return settingsDoc.data() as UserSettings;
}

// Update user settings
export async function updateUserSettings(
  userId: string,
  settings: Partial<UserSettings>
): Promise<boolean> {
  try {
    const settingsRef = doc(db, 'users', userId, 'settings', 'current');
    await updateDoc(settingsRef, settings);
    return true;
  } catch (error) {
    console.error('[Subscription] Error updating settings:', error);
    return false;
  }
}

// Check if feature is available for user
export async function isFeatureAvailable(
  userId: string,
  feature: keyof UserSettings
): Promise<boolean> {
  const hasPro = await hasProPlan(userId);
  if (!hasPro) return false;
  
  const settings = await getUserSettings(userId);
  return settings[feature] === true;
}

// Constants for Pro plan limits
export const PRO_PLAN_LIMITS = {
  maxFileSize: 5 * 1024 * 1024, // 5MB
  maxMemoryEntries: 10,
  maxMemoryAge: 30 * 24 * 60 * 60 * 1000, // 30 days in milliseconds
  maxSeats: 2
}; 