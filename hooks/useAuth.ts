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
        const errorData = await response.json();
        console.error("[XloudID] Token exchange failed:", errorData);
        throw new Error(errorData.message || 'Failed to exchange token');
      }

      const { firebaseToken, user: userData } = await response.json();
      console.log("[XloudID] Token exchange successful:", {
        uid: userData.uid,
        email: userData.email
      });

      // Sign in with Firebase token
      const userCredential = await signInWithCustomToken(auth, firebaseToken);
      const firebaseUser = userCredential.user;
      console.log("[XloudID] Firebase sign in successful:", {
        uid: firebaseUser.uid,
        email: firebaseUser.email
      });

      // Get the ID token
      const idToken = await firebaseUser.getIdToken();
      console.log("[XloudID] Got ID token");

      // Store auth logs
      localStorage.setItem('xloudid_logs', JSON.stringify({
        timestamp: new Date().toISOString(),
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        emailVerified: firebaseUser.emailVerified,
        idToken: idToken
      }));
      
      // Wait for auth state to be properly set
      await new Promise((resolve) => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
          if (user) {
            console.log("[XloudID] Auth state confirmed:", {
              uid: user.uid,
              email: user.email,
              emailVerified: user.emailVerified
            });
            setIsAuthenticated(true);
            unsubscribe();
            resolve(true);
          }
        });
      });
      
      // Final verification before redirect
      if (!auth.currentUser) {
        throw new Error("User not authenticated after token exchange");
      }

      // Verify user document exists
      const userRef = doc(db, 'users', auth.currentUser.uid);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) {
        throw new Error("User document not found after initialization");
      }

      console.log("[XloudID] All verifications passed, redirecting to dashboard");
      // Use Next.js router for navigation
      router.push('/dashboard');
    } catch (error) {
      const authError = error as Error;
      console.error("[XloudID] Authentication error:", {
        code: authError.name,
        message: authError.message,
        stack: authError.stack
      });
      setError(authError);
      
      // Store error logs
      localStorage.setItem('xloudid_error', JSON.stringify({
        code: authError.name,
        message: authError.message,
        stack: authError.stack,
        timestamp: new Date().toISOString()
      }));
      
      // Use Next.js router for error redirect
      router.push('/');
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