import { useState, useCallback, useEffect } from 'react';
import { auth, db } from '@/lib/firebase';
import { signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { initializeUserSettings } from '@/lib/settings';

export function useAuth() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsAuthenticated(!!user);
      console.log("[XloudID] Auth state changed:", user ? "Authenticated" : "Not authenticated");
    });

    return () => unsubscribe();
  }, []);

  const handleAuth = useCallback(async () => {
    console.log("[XloudID] handleAuth started");
    setIsLoading(true);
    setError(null);

    try {
      // Get token from URL
      const urlParams = new URLSearchParams(window.location.search);
      const token = urlParams.get('token');
      
      if (!token) {
        console.log("[XloudID] No token found in URL");
        return;
      }

      console.log("[XloudID] Token found, exchanging for Firebase token");
      
      // Exchange token for Firebase token
      const response = await fetch('/api/auth/xloudid', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to exchange token: ${response.status} ${response.statusText}\n${errorText}`);
      }

      const { firebaseToken, user: userData } = await response.json();
      
      if (!firebaseToken) {
        throw new Error("No Firebase token received from server");
      }

      // Sign in with Firebase token
      console.log("[XloudID] Attempting to sign in with Firebase token");
      const userCredential = await signInWithCustomToken(auth, firebaseToken);
      
      // Wait for auth state to be properly set
      await new Promise((resolve) => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
          if (user) {
            setIsAuthenticated(true);
            unsubscribe();
            resolve(true);
          }
        });
      });

      // Clean up URL by removing the token
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      window.history.replaceState({}, document.title, url.pathname);

      console.log("[XloudID] Authentication successful, redirecting to dashboard");
      router.replace('/dashboard');
    } catch (error) {
      const authError = error as Error;
      console.error("[XloudID] Authentication error:", {
        code: authError.name,
        message: authError.message,
        stack: authError.stack
      });
      setError(authError);
      
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