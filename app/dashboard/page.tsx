'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { auth, db } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import { useRouter, useSearchParams } from 'next/navigation';
import { doc, getDoc, collection, onSnapshot } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { getUsageStats } from '@/lib/usage';
import { listenToConversations, ConversationWithId } from '@/lib/firestore';
import { useAuth } from '@/hooks/useAuth';

interface UserSubscription {
    plan: 'Free' | 'Pro' | 'Pro-Plus';
    isActive: boolean;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    startDate?: any;
    nextBillingDate?: any;
    status: 'active' | 'canceled' | 'past_due' | 'trialing';
    billingHistory: any[];
    isInvitedUser?: boolean;
    inviterEmail?: string;
    billingGroup?: string;
    xloudId?: string;
}

interface UsageStats {
    messagesToday: number;
    filesUploaded: number;
    remaining: number;
}

export default function Dashboard() {
  const { isAuthenticated, user } = useAuth();
  const [userSubscription, setUserSubscription] = useState<UserSubscription | null>(null);
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null);
  const [conversations, setConversations] = useState<ConversationWithId[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();

  const fetchSubscription = useCallback(async () => {
    if (!user) return;
    
    try {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        setUserSubscription(data.subscription || null);
        setUsageStats(data.usageStats || null);
      }
    } catch (err) {
      console.error('Error fetching subscription:', err);
      setError('Failed to load subscription data');
    }
  }, [user]);

  useEffect(() => {
    if (isAuthenticated && user) {
      const sessionId = searchParams.get('session_id');
      if (sessionId) {
        // Verify the session and update subscription
        fetch(`/api/stripe/update-subscription`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId }),
        })
        .then(response => response.json())
        .then(data => {
          if (data.success) {
            fetchSubscription();
            // Remove session_id from URL
            const url = new URL(window.location.href);
            url.searchParams.delete('session_id');
            window.history.replaceState({}, document.title, url.pathname);
          }
        })
        .catch(err => {
          console.error('Error updating subscription:', err);
          setError('Failed to update subscription');
        });
      } else {
        fetchSubscription();
      }

      // Set up real-time listener for conversations
      const conversationsRef = collection(db, 'users', user.uid, 'conversations');
      const unsubscribe = onSnapshot(conversationsRef, (snapshot) => {
        const conversationsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as ConversationWithId[];
        setConversations(conversationsData);
      });

      return () => unsubscribe();
    }
  }, [isAuthenticated, user, searchParams, fetchSubscription]);

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/');
    }
  }, [isAuthenticated, router]);

  // Update logout handler
  const handleLogout = async () => {
    try {
      await signOut(auth);
      router.replace('/');
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!isAuthenticated || !user) {
    return null;
  }

  // ... rest of the component code ...
} 