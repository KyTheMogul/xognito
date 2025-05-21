import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

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

    // Generate a unique invitation ID
    const inviteId = nanoid(32);

    // Store the invitation in Firestore
    const inviteRef = doc(db, 'invitations', inviteId);
    await setDoc(inviteRef, {
      inviterId,
      email,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      status: 'pending'
    });

    // Send invitation email using Resend SDK
    const { data, error } = await resend.emails.send({
      from: 'Xognito <noreply@xognito.com>',
      to: email,
      subject: 'You\'ve been invited to join Xognito Pro',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #000000; font-size: 24px; margin-bottom: 16px;">You've been invited to join Xognito Pro</h1>
            <p style="color: #4B5563; font-size: 16px; line-height: 1.5;">Someone has invited you to join their Xognito Pro subscription.</p>
          </div>
          
          <div style="background-color: #F3F4F6; padding: 20px; border-radius: 6px; margin-bottom: 30px;">
            <h2 style="color: #111827; font-size: 18px; margin-bottom: 12px;">What you'll get:</h2>
            <ul style="color: #4B5563; font-size: 14px; line-height: 1.6; list-style-type: none; padding: 0; margin: 0;">
              <li style="margin-bottom: 8px;">✓ Unlimited AI conversations</li>
              <li style="margin-bottom: 8px;">✓ AI memory and context</li>
              <li style="margin-bottom: 8px;">✓ File upload & analysis</li>
              <li style="margin-bottom: 8px;">✓ Real-time web search</li>
              <li style="margin-bottom: 8px;">✓ Custom tools and settings</li>
            </ul>
          </div>

          <div style="text-align: center;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL}/login?invite=${inviteId}" 
               style="display: inline-block; background-color: #000000; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px; transition: background-color 0.2s;">
              Accept Invitation
            </a>
          </div>

          <p style="color: #6B7280; font-size: 14px; text-align: center; margin-top: 30px;">
            This invitation will expire in 7 days.
          </p>
        </div>
      `,
    });

    if (error) {
      console.error('[Invitations] Resend API error:', error);
      throw new Error(`Failed to send invitation email: ${error.message}`);
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('[Invitations] Error sending invitation:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send invitation' },
      { status: 500 }
    );
  }
} 