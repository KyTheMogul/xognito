import { db } from './firebase';
import { doc, getDoc, updateDoc, setDoc, Timestamp, increment } from 'firebase/firestore';

export interface UsageStats {
  messagesToday: number;
  filesUploaded: number;
  lastReset: Timestamp;
}

export interface MessageCheck {
  allowed: boolean;
  remaining: number;
}

export async function canSendMessage(uid: string): Promise<MessageCheck> {
  const usageRef = doc(db, 'users', uid, 'usageStats', 'current');
  const usageDoc = await getDoc(usageRef);
  
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  if (!usageDoc.exists()) {
    // Initialize usage stats with setDoc
    await setDoc(usageRef, {
      messagesToday: 0,
      filesUploaded: 0,
      lastReset: Timestamp.fromDate(today)
    });
    return { allowed: true, remaining: 25 };
  }

  const usageData = usageDoc.data() as UsageStats;
  const lastReset = usageData.lastReset.toDate();
  const lastResetDay = new Date(lastReset.getFullYear(), lastReset.getMonth(), lastReset.getDate());

  // Reset if it's a new day
  if (lastResetDay < today) {
    await setDoc(usageRef, {
      messagesToday: 0,
      filesUploaded: usageData.filesUploaded,
      lastReset: Timestamp.fromDate(today)
    });
    return { allowed: true, remaining: 25 };
  }

  const remaining = 25 - usageData.messagesToday;
  return {
    allowed: usageData.messagesToday < 25,
    remaining
  };
}

export async function incrementMessageCount(uid: string): Promise<void> {
  try {
    const usageRef = doc(db, 'users', uid, 'usageStats', 'current');
    const usageDoc = await getDoc(usageRef);
    
    if (!usageDoc.exists()) {
      // Create new document with initial count of 1
      await setDoc(usageRef, {
        messagesToday: 1,
        filesUploaded: 0,
        lastReset: Timestamp.fromDate(new Date())
      });
      return;
    }

    // Update existing document
    await updateDoc(usageRef, {
      messagesToday: increment(1)
    });
  } catch (error) {
    console.error('Error incrementing message count:', error);
    throw error;
  }
}

export async function canUploadFile(uid: string): Promise<boolean> {
  const usageRef = doc(db, 'users', uid, 'usageStats', 'current');
  const usageDoc = await getDoc(usageRef);
  
  if (!usageDoc.exists()) {
    await setDoc(usageRef, {
      messagesToday: 0,
      filesUploaded: 0,
      lastReset: Timestamp.fromDate(new Date())
    });
    return true;
  }

  const usageData = usageDoc.data() as UsageStats;
  return usageData.filesUploaded < 3;
}

export async function incrementFileUpload(uid: string): Promise<void> {
  const usageRef = doc(db, 'users', uid, 'usageStats', 'current');
  const usageDoc = await getDoc(usageRef);
  
  if (!usageDoc.exists()) {
    await setDoc(usageRef, {
      messagesToday: 0,
      filesUploaded: 1,
      lastReset: Timestamp.fromDate(new Date())
    });
    return;
  }

  await updateDoc(usageRef, {
    filesUploaded: increment(1)
  });
}

export async function getUsageStats(uid: string): Promise<UsageStats> {
  const usageRef = doc(db, 'users', uid, 'usageStats', 'current');
  const usageDoc = await getDoc(usageRef);
  
  if (!usageDoc.exists()) {
    const stats = {
      messagesToday: 0,
      filesUploaded: 0,
      lastReset: Timestamp.fromDate(new Date())
    };
    await setDoc(usageRef, stats);
    return stats as UsageStats;
  }

  return usageDoc.data() as UsageStats;
} 