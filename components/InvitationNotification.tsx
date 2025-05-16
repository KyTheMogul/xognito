import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { addUserToSubscription } from '@/lib/subscription';

export default function InvitationNotification() {
  const [showNotification, setShowNotification] = useState(false);
  const [invitation, setInvitation] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteId = searchParams.get('invite');

  useEffect(() => {
    const checkInvitation = async () => {
      if (!inviteId || !auth.currentUser) return;

      try {
        const inviteRef = doc(db, 'invitations', inviteId);
        const inviteDoc = await getDoc(inviteRef);

        if (!inviteDoc.exists()) {
          console.error('Invitation not found');
          return;
        }

        const inviteData = inviteDoc.data();
        if (inviteData.status !== 'pending' || inviteData.email !== auth.currentUser.email) {
          console.error('Invalid invitation');
          return;
        }

        setInvitation(inviteData);
        setShowNotification(true);
      } catch (error) {
        console.error('Error checking invitation:', error);
      }
    };

    checkInvitation();
  }, [inviteId]);

  const handleAccept = async () => {
    if (!invitation || !auth.currentUser) return;
    setLoading(true);

    try {
      // Add user to subscription
      const success = await addUserToSubscription(invitation.inviterId, auth.currentUser.uid);
      
      if (success) {
        // Update invitation status
        const inviteRef = doc(db, 'invitations', inviteId!);
        await updateDoc(inviteRef, {
          status: 'accepted',
          acceptedAt: new Date()
        });

        // Remove invite parameter from URL
        router.replace('/dashboard');
        setShowNotification(false);
      }
    } catch (error) {
      console.error('Error accepting invitation:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDecline = async () => {
    if (!inviteId) return;
    setLoading(true);

    try {
      const inviteRef = doc(db, 'invitations', inviteId);
      await updateDoc(inviteRef, {
        status: 'declined',
        declinedAt: new Date()
      });

      router.replace('/dashboard');
      setShowNotification(false);
    } catch (error) {
      console.error('Error declining invitation:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!showNotification) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-zinc-900 rounded-2xl p-8 w-full max-w-md relative border border-zinc-700">
        <h2 className="text-xl font-bold mb-4 text-white">Pro Plan Invitation</h2>
        <p className="text-zinc-300 mb-6">
          You've been invited to join a Pro subscription. This will give you access to:
        </p>
        <ul className="text-zinc-300 space-y-2 mb-6">
          <li>• Unlimited AI conversations</li>
          <li>• AI memory and context</li>
          <li>• File upload & analysis</li>
          <li>• Real-time web search</li>
          <li>• Custom tools and settings</li>
        </ul>
        <div className="flex gap-4">
          <button
            onClick={handleAccept}
            disabled={loading}
            className="flex-1 bg-white text-black py-2 px-4 rounded-lg hover:bg-zinc-100 disabled:opacity-50"
          >
            {loading ? 'Accepting...' : 'Accept'}
          </button>
          <button
            onClick={handleDecline}
            disabled={loading}
            className="flex-1 bg-zinc-800 text-white py-2 px-4 rounded-lg hover:bg-zinc-700 disabled:opacity-50"
          >
            {loading ? 'Declining...' : 'Decline'}
          </button>
        </div>
      </div>
    </div>
  );
} 