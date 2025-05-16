'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function InviteClient({ params }: { params: { token: string } }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteData, setInviteData] = useState<any>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isNewUser, setIsNewUser] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const checkInvite = async () => {
      try {
        const inviteRef = doc(db, 'invitations', params.token);
        const inviteDoc = await getDoc(inviteRef);

        if (!inviteDoc.exists()) {
          setError('Invalid or expired invitation');
          setLoading(false);
          return;
        }

        const data = inviteDoc.data();
        if (data.status !== 'pending' || new Date(data.expiresAt.toDate()) < new Date()) {
          setError('Invitation has expired or been used');
          setLoading(false);
          return;
        }

        setInviteData(data);
        setEmail(data.email);
        setLoading(false);
      } catch (err) {
        setError('Failed to verify invitation');
        setLoading(false);
      }
    };

    checkInvite();
  }, [params.token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      let user;
      
      if (isNewUser) {
        // Create new account
        user = await createUserWithEmailAndPassword(auth, email, password);
      } else {
        // Sign in existing account
        user = await signInWithEmailAndPassword(auth, email, password);
      }

      // Update invitation status
      const inviteRef = doc(db, 'invitations', params.token);
      await updateDoc(inviteRef, {
        status: 'accepted',
        acceptedAt: new Date().toISOString(),
        acceptedBy: user.user.uid
      });

      // Add user to inviter's subscription
      const inviterRef = doc(db, 'users', inviteData.inviterId, 'subscription', 'current');
      const inviterDoc = await getDoc(inviterRef);
      
      if (inviterDoc.exists()) {
        const inviterData = inviterDoc.data();
        await updateDoc(inviterRef, {
          seatsUsed: (inviterData.seatsUsed || 0) + 1,
          invitedUsers: [...(inviterData.invitedUsers || []), user.user.uid]
        });

        // Create user's subscription with inviter's XloudID
        const userSubscriptionRef = doc(db, 'users', user.user.uid, 'subscription', 'current');
        await updateDoc(userSubscriptionRef, {
          plan: 'pro',
          isActive: true,
          invitedBy: inviteData.inviterId,
          joinedAt: new Date(),
          xloudId: inviterData.xloudId,
          billingGroup: inviterData.billingGroup || inviterData.xloudId,
          isInvitedUser: true,
          inviterEmail: inviterData.email
        });

        // Update user's profile with billing information
        const userProfileRef = doc(db, 'users', user.user.uid);
        await updateDoc(userProfileRef, {
          billingGroup: inviterData.billingGroup || inviterData.xloudId,
          invitedBy: inviteData.inviterId,
          invitedAt: new Date()
        });
      }

      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-900">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-900">
        <div className="bg-zinc-800 p-8 rounded-lg max-w-md w-full">
          <h1 className="text-2xl font-bold text-white mb-4">Invalid Invitation</h1>
          <p className="text-zinc-300 mb-4">{error}</p>
          <Button
            onClick={() => router.push('/')}
            className="w-full bg-white text-black hover:bg-zinc-100"
          >
            Return Home
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-900">
      <div className="bg-zinc-800 p-8 rounded-lg max-w-md w-full">
        <h1 className="text-2xl font-bold text-white mb-4">Accept Invitation</h1>
        <p className="text-zinc-300 mb-6">
          {isNewUser ? 'Create your account' : 'Sign in to your account'} to accept the Pro plan invitation
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              Email
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-zinc-700 border-zinc-600 text-white"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              Password
            </label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-zinc-700 border-zinc-600 text-white"
              required
            />
          </div>

          {error && (
            <div className="text-red-500 text-sm">{error}</div>
          )}

          <Button
            type="submit"
            className="w-full bg-white text-black hover:bg-zinc-100"
            disabled={loading}
          >
            {loading ? 'Processing...' : (isNewUser ? 'Create Account' : 'Sign In')}
          </Button>

          <button
            type="button"
            onClick={() => setIsNewUser(!isNewUser)}
            className="w-full text-zinc-400 hover:text-white text-sm"
          >
            {isNewUser ? 'Already have an account? Sign in' : 'New user? Create an account'}
          </button>
        </form>
      </div>
    </div>
  );
} 