import { useState, useCallback } from 'react';
import { auth, db } from '@/lib/firebase';
import { signInWithCustomToken } from 'firebase/auth';
import { doc, setDoc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { initializeUserSettings } from '@/lib/settings';

export function useAuth() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

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
      
      // Send token to our backend to exchange for a Firebase token
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

      const { firebaseToken } = await response.json();
      console.log("[XloudID] Received Firebase token from backend");
      
      // Now use the Firebase token from our backend
      const userCredential = await signInWithCustomToken(auth, firebaseToken);
      const user = userCredential.user;
      console.log("[XloudID] Successfully signed in user:", {
        uid: user.uid,
        email: user.email,
        emailVerified: user.emailVerified
      });

      // Initialize user settings if needed
      try {
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        
        if (!userSnap.exists()) {
          console.log("[XloudID] Initializing user settings");
          await initializeUserSettings(user.uid);
          console.log("[XloudID] Successfully initialized user settings");
        }
      } catch (firestoreError) {
        console.error("[XloudID] Firestore operation error:", firestoreError);
        // Continue with redirect even if Firestore operation fails
      }

      // Clean up URL and redirect
      url.searchParams.delete('token');
      window.history.replaceState({}, document.title, url.pathname + url.search);
      console.log("[XloudID] About to redirect to dashboard");
      
      // Store successful auth in localStorage
      localStorage.setItem('xloudid_auth', 'true');
      localStorage.setItem('xloudid_logs', JSON.stringify({
        timestamp: new Date().toISOString(),
        uid: user.uid,
        email: user.email
      }));
      
      // Add a small delay before redirect to ensure logs are visible
      setTimeout(() => {
        window.location.href = '/dashboard';
      }, 1000);
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
    error
  };
} 