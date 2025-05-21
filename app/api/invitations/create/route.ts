import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { nanoid } from 'nanoid';

export async function POST(request: Request) {
  try {
    const { inviterId, email } = await request.json();

    if (!inviterId || !email) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Check if inviter exists and has a Pro plan
    const inviterRef = doc(db, 'users', inviterId, 'subscription', 'current');
    const inviterDoc = await getDoc(inviterRef);

    if (!inviterDoc.exists()) {
      return NextResponse.json(
        { error: 'Inviter not found' },
        { status: 404 }
      );
    }

    const inviterData = inviterDoc.data();
    if (inviterData.plan !== 'pro' || !inviterData.isActive) {
      return NextResponse.json(
        { error: 'Inviter must have an active Pro plan' },
        { status: 403 }
      );
    }

    // Check if inviter has reached their user limit
    if (inviterData.seatsUsed >= (inviterData.seatsAllowed || 2)) {
      return NextResponse.json(
        { error: 'Inviter has reached their user limit' },
        { status: 403 }
      );
    }

    // Generate a unique invitation token
    const inviteToken = nanoid(32);

    // Store the invitation in Firestore
    const inviteRef = doc(db, 'invitations', inviteToken);
    await setDoc(inviteRef, {
      inviterId,
      email,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      status: 'pending'
    });

    return NextResponse.json({ inviteToken });
  } catch (error) {
    console.error('[Invitations] Error creating invitation:', error);
    return NextResponse.json(
      { error: 'Failed to create invitation' },
      { status: 500 }
    );
  }
} 