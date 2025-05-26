import { useState, useCallback, useEffect } from 'react';
import { auth, db } from '@/lib/firebase';
import { signInWithCustomToken, onAuthStateChanged, User } from 'firebase/auth';
import { useRouter, usePathname } from 'next/navigation';

export function useAuth() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    console.log('[useAuth] Setting up auth state listener');
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      console.log('[useAuth] Auth state changed:', { 
        hasUser: !!user,
        uid: user?.uid,
        pathname 
      });
      
      setUser(user);
      setIsAuthenticated(!!user);
      setIsLoading(false);

      if (user) {
        // Only redirect to dashboard if we're on the landing page and have a token
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get('token');
        if (pathname === '/' && token) {
          console.log('[useAuth] Redirecting to dashboard with token');
          router.replace('/dashboard');
        }
      } else if (pathname === '/dashboard') {
        // If user is not authenticated and trying to access dashboard, redirect to landing
        console.log('[useAuth] User not authenticated, redirecting to landing');
        router.replace('/');
      }
    });

    return () => {
      console.log('[useAuth] Cleaning up auth state listener');
      unsubscribe();
    };
  }, [router, pathname]);

  const handleAuth = useCallback(async () => {
    console.log('[useAuth] Starting authentication');
    setIsLoading(true);
    setError(null);

    try {
      const urlParams = new URLSearchParams(window.location.search);
      const token = urlParams.get('token');
      
      if (!token) {
        console.log('[useAuth] No token found');
        return;
      }

      // Clean up URL immediately
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      window.history.replaceState({}, document.title, url.pathname);
      
      console.log('[useAuth] Exchanging token for Firebase token');
      // Exchange token for Firebase token
      const response = await fetch('/api/auth/xloudid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      if (!response.ok) {
        throw new Error(`Authentication failed: ${response.status}`);
      }

      const { firebaseToken } = await response.json();
      
      if (!firebaseToken) {
        throw new Error("No Firebase token received");
      }

      console.log('[useAuth] Signing in with Firebase token');
      // Sign in with Firebase token
      await signInWithCustomToken(auth, firebaseToken);
      // The onAuthStateChanged listener will handle the redirection
    } catch (error) {
      console.error('[useAuth] Authentication error:', error);
      setError(error as Error);
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