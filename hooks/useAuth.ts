import { useState, useCallback, useEffect } from 'react';
import { auth, db } from '@/lib/firebase';
import { signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { initializeUserSettings } from '@/lib/settings';

export function useAuth() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsAuthenticated(!!user);
      console.log("[XloudID] Auth state changed:", user ? "Authenticated" : "Not authenticated");
    });

    return () => unsubscribe();
  }, []);

  const handleAuth = useCallback(async () => {
    console.log("[XloudID] handleAuth started");
    if (typeof window === 'undefined') return;

    setIsLoading(true);
    setError(null);

    try {
      const url = new URL(window.location.href);
      const token = url.searchParams.get('token');
      console.log("[XloudID] Current URL:", window.location.href);
      console.log("[XloudID] Token from URL:", token ? "Present" : "Not present");
      
      if (!token) {
        console.log("[XloudID] No token found in URL");
        // Check if we're on the dashboard page
        if (window.location.pathname === '/dashboard') {
          console.log("[XloudID] On dashboard page, checking for stored logs");
          const storedLogs = localStorage.getItem('xloudid_logs');
          const storedError = localStorage.getItem('xloudid_error');
          if (storedLogs) {
            console.log("[XloudID] Previous logs:", JSON.parse(storedLogs));
            localStorage.removeItem('xloudid_logs');
          }
          if (storedError) {
            console.error("[XloudID] Previous error:", JSON.parse(storedError));
            localStorage.removeItem('xloudid_error');
          }
        }
        return;
      }

      console.log("[XloudID] Processing token:", token.substring(0, 10) + "...");
      
      // Step 1: Exchange token for Firebase token
      console.log("[XloudID] Step 1: Exchanging token for Firebase token");
      const response = await fetch('/api/auth/xloudid', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("[XloudID] API Error Response:", errorData);
        throw new Error(errorData.details || errorData.message || 'Failed to exchange token');
      }

      const { firebaseToken, user } = await response.json();
      console.log("[XloudID] Token exchange successful:", {
        uid: user.uid,
        email: user.email,
        emailVerified: user.emailVerified,
        tokenLength: firebaseToken.length
      });
      
      // Step 2: Verify Firebase token
      console.log("[XloudID] Step 2: Verifying Firebase token");
      const userCredential = await signInWithCustomToken(auth, firebaseToken);
      const firebaseUser = userCredential.user;
      console.log("[XloudID] Firebase token verification successful:", {
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        emailVerified: firebaseUser.emailVerified,
        isAnonymous: firebaseUser.isAnonymous,
        metadata: firebaseUser.metadata
      });

      // Step 3: Initialize user settings
      console.log("[XloudID] Step 3: Initializing user settings");
      try {
        const userRef = doc(db, 'users', firebaseUser.uid);
        const userSnap = await getDoc(userRef);
        
        if (!userSnap.exists()) {
          console.log("[XloudID] Creating new user document");
          await initializeUserSettings(firebaseUser.uid);
          console.log("[XloudID] User document created successfully");
        } else {
          console.log("[XloudID] User document already exists");
        }
      } catch (firestoreError) {
        console.error("[XloudID] Firestore operation error:", firestoreError);
        throw firestoreError; // Don't continue if Firestore operation fails
      }

      // Step 4: Get user ID token
      console.log("[XloudID] Step 4: Getting user ID token");
      const idToken = await firebaseUser.getIdToken();
      console.log("[XloudID] User ID token obtained:", {
        tokenLength: idToken.length,
        tokenPrefix: idToken.substring(0, 20) + "..."
      });

      // Clean up URL
      url.searchParams.delete('token');
      window.history.replaceState({}, document.title, url.pathname + url.search);
      
      // Store successful auth in localStorage
      localStorage.setItem('xloudid_auth', 'true');
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
      window.location.href = '/dashboard';
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
      
      // Redirect to landing page on error
      window.location.href = '/';
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    handleAuth,
    isLoading,
    error,
    isAuthenticated
  };
} 