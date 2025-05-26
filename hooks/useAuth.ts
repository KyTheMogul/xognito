import { useState, useCallback, useEffect } from 'react';
import { auth, db } from '@/lib/firebase';
import { signInWithCustomToken, onAuthStateChanged, User } from 'firebase/auth';
import { useRouter } from 'next/navigation';

export function useAuth() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      console.log('[Auth] Auth state changed:', { 
        isAuthenticated: !!user,
        uid: user?.uid,
        email: user?.email
      });
      setUser(user);
      setIsAuthenticated(!!user);
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleAuth = useCallback(async () => {
    console.log('[Auth] Starting authentication process');
    setIsLoading(true);
    setError(null);

    try {
      const urlParams = new URLSearchParams(window.location.search);
      const token = urlParams.get('token');
      
      if (!token) {
        console.log('[Auth] No token found in URL');
        return;
      }

      console.log('[Auth] Token found, exchanging for Firebase token');
      
      // Clean up URL immediately
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      window.history.replaceState({}, document.title, url.pathname);
      
      // Exchange token for Firebase token
      const response = await fetch('/api/auth/xloudid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('[Auth] Token exchange failed:', errorData);
        throw new Error(`Authentication failed: ${response.status} - ${errorData.message || 'Unknown error'}`);
      }

      const { firebaseToken } = await response.json();
      
      if (!firebaseToken) {
        console.error('[Auth] No Firebase token received');
        throw new Error("No Firebase token received");
      }

      console.log('[Auth] Firebase token received, signing in');
      
      // Sign in with Firebase token
      const userCredential = await signInWithCustomToken(auth, firebaseToken);
      console.log('[Auth] Sign in successful:', {
        uid: userCredential.user.uid,
        email: userCredential.user.email
      });

      // Only redirect if we're not already on the dashboard
      if (window.location.pathname !== '/dashboard') {
        console.log('[Auth] Redirecting to dashboard');
        router.replace('/dashboard');
      }
    } catch (error) {
      console.error('[Auth] Authentication error:', error);
      setError(error as Error);
      // Only redirect to home if we're not already there
      if (window.location.pathname !== '/') {
        console.log('[Auth] Redirecting to home due to error');
        router.replace('/');
      }
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  return {
    handleAuth,
    isLoading,
    error,
    isAuthenticated,
    user
  };
} 