import { useState, useCallback, useEffect } from 'react';
import { auth, db } from '@/lib/firebase';
import { signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'next/navigation';

export function useAuth() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsAuthenticated(!!user);
    });
    return () => unsubscribe();
  }, []);

  const handleAuth = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const urlParams = new URLSearchParams(window.location.search);
      const token = urlParams.get('token');
      
      if (!token) return;

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
        throw new Error(`Authentication failed: ${response.status}`);
      }

      const { firebaseToken } = await response.json();
      
      if (!firebaseToken) {
        throw new Error("No Firebase token received");
      }

      // Sign in with Firebase token
      await signInWithCustomToken(auth, firebaseToken);
      router.replace('/dashboard');
    } catch (error) {
      setError(error as Error);
      if (window.location.pathname !== '/') {
        router.push('/');
      }
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  return {
    handleAuth,
    isLoading,
    error,
    isAuthenticated
  };
} 