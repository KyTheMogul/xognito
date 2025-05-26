'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
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

// Helper function for structured error logging
const logError = (context: string, error: any, additionalInfo?: any) => {
  console.error(`[${new Date().toISOString()}] ${context}:`, {
    error: error instanceof Error ? {
      message: error.message,
      stack: error.stack,
      name: error.name
    } : error,
    ...additionalInfo
  });
};

// Loading component
const LoadingFallback = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-gray-900"></div>
  </div>
);

// Main dashboard content
const DashboardContent = () => {
  const { isAuthenticated, user } = useAuth();
  const [userSubscription, setUserSubscription] = useState<UserSubscription | null>(null);
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null);
  const [conversations, setConversations] = useState<ConversationWithId[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();

  const fetchSubscription = useCallback(async () => {
    if (!user?.uid) {
      logError('Fetch subscription failed', new Error('No user found'), { userId: user?.uid });
      return;
    }

    try {
      console.log(`[${new Date().toISOString()}] Fetching subscription for user: ${user.uid}`);
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        console.log(`[${new Date().toISOString()}] Subscription data:`, {
          subscription: data.subscription,
          usageStats: data.usageStats
        });
        setUserSubscription(data.subscription || null);
        setUsageStats(data.usageStats || null);
      } else {
        logError('User document not found', new Error('User document does not exist'), { userId: user.uid });
      }
    } catch (err) {
      logError('Error fetching subscription', err, { userId: user.uid });
      setError('Failed to load subscription data');
    }
  }, [user]);

  useEffect(() => {
    if (isAuthenticated && user) {
      const sessionId = searchParams.get('session_id');
      if (sessionId) {
        console.log(`[${new Date().toISOString()}] Processing session: ${sessionId}`);
        // Verify the session and update subscription
        fetch(`/api/stripe/update-subscription`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId }),
        })
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          return response.json();
        })
        .then(data => {
          console.log(`[${new Date().toISOString()}] Subscription update response:`, data);
          if (data.success) {
            fetchSubscription();
            // Remove session_id from URL
            const url = new URL(window.location.href);
            url.searchParams.delete('session_id');
            window.history.replaceState({}, document.title, url.pathname);
          } else {
            throw new Error(data.error || 'Failed to update subscription');
          }
        })
        .catch(err => {
          logError('Error updating subscription', err, {
            sessionId,
            userId: user.uid
          });
          setError('Failed to update subscription');
        });
      } else {
        fetchSubscription();
      }

      // Set up real-time listener for conversations
      console.log(`[${new Date().toISOString()}] Setting up conversations listener for user: ${user.uid}`);
      const conversationsRef = collection(db, 'users', user.uid, 'conversations');
      const unsubscribe = onSnapshot(conversationsRef, 
        (snapshot) => {
          const conversationsData = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          })) as ConversationWithId[];
          console.log(`[${new Date().toISOString()}] Conversations updated:`, conversationsData);
          setConversations(conversationsData);
        },
        (error) => {
          logError('Error in conversations listener', error, { userId: user.uid });
        }
      );

      return () => {
        console.log(`[${new Date().toISOString()}] Cleaning up conversations listener for user: ${user.uid}`);
        unsubscribe();
      };
    }
  }, [isAuthenticated, user, searchParams, fetchSubscription]);

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      console.log(`[${new Date().toISOString()}] User not authenticated, redirecting to home`);
      router.replace('/');
    }
  }, [isAuthenticated, router]);

  // Update logout handler
  const handleLogout = async () => {
    try {
      console.log(`[${new Date().toISOString()}] Logging out user: ${user?.uid}`);
      await signOut(auth);
      router.replace('/');
    } catch (error) {
      logError('Error signing out', error, { userId: user?.uid });
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

// Main dashboard component with Suspense
export default function Dashboard() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <DashboardContent />
    </Suspense>
  );
} 