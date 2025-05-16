import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { auth } from '@/lib/firebase';
import { canInviteUsers } from '@/lib/subscription';

interface InviteUserModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function InviteUserModal({ isOpen, onClose }: InviteUserModalProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    const user = auth.currentUser;
    if (!user) {
      setError('You must be logged in to invite users');
      setLoading(false);
      return;
    }

    try {
      // Check if user can invite
      const canInvite = await canInviteUsers(user.uid);
      if (!canInvite) {
        setError('You cannot invite more users at this time');
        setLoading(false);
        return;
      }

      // Send invitation email
      const response = await fetch('/api/invitations/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inviterId: user.uid,
          email: email,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to send invitation');
      }

      setSuccess(true);
      setEmail('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invitation');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-zinc-900 rounded-2xl p-8 w-full max-w-md relative border border-zinc-700">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-400 hover:text-white"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        <h2 className="text-xl font-bold mb-6 text-white">Invite User</h2>

        {!success ? (
          <form onSubmit={handleInvite} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">
                Email Address
              </label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter email address"
                className="w-full bg-zinc-800 border-zinc-700 text-white"
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
              {loading ? 'Sending Invitation...' : 'Send Invitation'}
            </Button>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="bg-zinc-800 rounded-lg p-4">
              <p className="text-zinc-300">
                Invitation sent successfully! The user will receive an email with instructions to join.
              </p>
            </div>
            <Button
              onClick={onClose}
              className="w-full bg-zinc-800 text-white hover:bg-zinc-700"
            >
              Close
            </Button>
          </div>
        )}
      </div>
    </div>
  );
} 