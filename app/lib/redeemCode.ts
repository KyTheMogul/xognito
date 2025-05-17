import { db } from './firebase';
import { doc, getDoc, updateDoc, Timestamp, collection, setDoc, writeBatch } from 'firebase/firestore';

export interface RedeemCode {
  code: string;
  plan: 'pro' | 'pro_plus';
  used: boolean;
  usedBy?: string;
  usedAt?: Timestamp;
  expiresAt?: Timestamp;
  createdAt: Timestamp;
}

export async function validateRedeemCode(code: string): Promise<{ valid: boolean; plan: 'pro' | 'pro_plus' | null; message: string }> {
  try {
    const codeRef = doc(db, 'redeemCodes', code);
    const codeDoc = await getDoc(codeRef);
    
    if (!codeDoc.exists()) {
      return { valid: false, plan: null, message: 'Invalid redeem code.' };
    }

    const codeData = codeDoc.data() as RedeemCode;
    if (codeData.used) {
      return { valid: false, plan: null, message: 'This code has already been used.' };
    }

    if (codeData.expiresAt && codeData.expiresAt.toDate() < new Date()) {
      return { valid: false, plan: null, message: 'This code has expired.' };
    }

    return { 
      valid: true, 
      plan: codeData.plan,
      message: `Code valid for ${codeData.plan} plan.`
    };
  } catch (error) {
    console.error('Error validating redeem code:', error);
    return { valid: false, plan: null, message: 'Error validating code.' };
  }
}

export async function applyRedeemCode(userId: string, code: string): Promise<{ success: boolean; message: string }> {
  try {
    const validation = await validateRedeemCode(code);
    if (!validation.valid) {
      return { success: false, message: validation.message };
    }

    // Update user's subscription
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, {
      subscription: {
        plan: validation.plan,
        status: 'active',
        startDate: Timestamp.now(),
        endDate: Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)), // 30 days
        redeemCode: code
      }
    });

    // Mark code as used
    const codeRef = doc(db, 'redeemCodes', code);
    await updateDoc(codeRef, {
      used: true,
      usedBy: userId,
      usedAt: Timestamp.now()
    });

    return { 
      success: true, 
      message: `Successfully activated ${validation.plan} plan!` 
    };
  } catch (error) {
    console.error('Error applying redeem code:', error);
    return { success: false, message: 'Error applying code.' };
  }
}

export async function generateRedeemCodes(
  count: number,
  plan: 'pro' | 'pro_plus',
  expiresInDays: number = 30
): Promise<string[]> {
  const codes: string[] = [];
  const batch = writeBatch(db);

  for (let i = 0; i < count; i++) {
    const code = generateUniqueCode();
    codes.push(code);
    
    const codeRef = doc(collection(db, 'redeemCodes'));
    batch.set(codeRef, {
      code,
      plan,
      used: false,
      usedBy: null,
      usedAt: null,
      expiresAt: Timestamp.fromDate(new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)),
      createdAt: Timestamp.now()
    });
  }

  await batch.commit();
  return codes;
}

function generateUniqueCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const codeLength = 8;
  let code = '';
  
  for (let i = 0; i < codeLength; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return code;
} 