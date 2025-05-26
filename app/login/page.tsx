'use client';

import { useState } from 'react';
import { signInWithEmailAndPassword, sendPasswordResetEmail, confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { doc, updateDoc, serverTimestamp, collection, query, where, getDocs } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';

export default function Login() {
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetStep, setResetStep] = useState<'initial' | 'code' | 'new-password'>('initial');
  const [verificationCode, setVerificationCode] = useState(['', '', '', '', '']);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const router = useRouter();

  const handleVerificationCodeChange = (index: number, value: string) => {
    if (value.length > 1) return; // Only allow single character
    if (!/^\d*$/.test(value)) return; // Only allow numbers

    const newCode = [...verificationCode];
    newCode[index] = value;
    setVerificationCode(newCode);

    // Auto-focus next input
    if (value && index < 4) {
      const nextInput = document.getElementById(`code-${index + 1}`);
      nextInput?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !verificationCode[index] && index > 0) {
      const prevInput = document.getElementById(`code-${index - 1}`);
      prevInput?.focus();
    }
  };

  const handleForgotPassword = async () => {
    if (!emailOrUsername) {
      setError('Please enter your email or username');
      return;
    }

    setError('');
    setSuccess('');
    setLoading(true);

    try {
      let email = emailOrUsername;

      // If username is provided, get the email
      if (!emailOrUsername.includes('@')) {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('username', '==', emailOrUsername));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
          throw new Error('Username not found');
        }
        
        email = querySnapshot.docs[0].data().email;
      }

      await sendPasswordResetEmail(auth, email);
      setResetEmail(email);
      setResetStep('code');
      setSuccess('Verification code sent. Please check your email.');
    } catch (error: any) {
      console.error('Password reset error:', error);
      setError(error.message || 'Failed to send verification code');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    const code = verificationCode.join('');
    if (code.length !== 5) {
      setError('Please enter the complete verification code');
      return;
    }

    setError('');
    setLoading(true);

    try {
      await verifyPasswordResetCode(auth, code);
      setResetStep('new-password');
      setSuccess('Code verified. Please enter your new password.');
    } catch (error: any) {
      console.error('Verification error:', error);
      setError('Invalid verification code');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (newPassword !== confirmNewPassword) {
      setError('Passwords do not match');
      return;
    }

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters long');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const code = verificationCode.join('');
      await confirmPasswordReset(auth, code, newPassword);
      setSuccess('Password reset successful. You can now login with your new password.');
      setResetStep('initial');
      setVerificationCode(['', '', '', '', '']);
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (error: any) {
      console.error('Password reset error:', error);
      setError(error.message || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      let email = emailOrUsername;

      // Check if input is a username (doesn't contain @)
      if (!emailOrUsername.includes('@')) {
        // Query Firestore to find user by username
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('username', '==', emailOrUsername));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
          throw new Error('Username not found');
        }
        
        // Get the email from the first matching user document
        const userData = querySnapshot.docs[0].data();
        if (!userData.email) {
          throw new Error('User account has no email associated');
        }
        email = userData.email;
      }

      // Sign in with email and password
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // Update last login time
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        lastLogin: serverTimestamp(),
        emailVerified: user.emailVerified
      });

      // Use replace instead of push to prevent back navigation
      console.log('[Login] Redirecting to dashboard after successful login');
      router.replace('/dashboard');
    } catch (error: any) {
      console.error('Login error:', error);
      if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
        setError('Invalid email/username or password');
      } else if (error.message === 'Username not found') {
        setError('Username not found');
      } else if (error.message === 'User account has no email associated') {
        setError('This account has no email associated');
      } else {
        setError(error.message || 'Failed to sign in');
      }
    } finally {
      setLoading(false);
    }
  };

  const renderResetPasswordForm = () => {
    switch (resetStep) {
      case 'code':
        return (
          <div className="space-y-4">
            <p className="text-sm text-gray-400 text-center">
              Enter the 5-digit verification code sent to {resetEmail}
            </p>
            <div className="flex justify-center space-x-2">
              {verificationCode.map((digit, index) => (
                <input
                  key={index}
                  id={`code-${index}`}
                  type="text"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleVerificationCodeChange(index, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(index, e)}
                  className="w-12 h-12 text-center text-lg rounded-full border border-gray-700 bg-black text-white focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent"
                />
              ))}
            </div>
            <button
              type="button"
              onClick={handleVerifyCode}
              disabled={loading || verificationCode.join('').length !== 5}
              className="w-full py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-black bg-white hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-white disabled:opacity-50 transition-colors duration-200"
            >
              {loading ? 'Verifying...' : 'Verify Code'}
            </button>
          </div>
        );

      case 'new-password':
        return (
          <div className="space-y-4">
            <div>
              <label htmlFor="new-password" className="sr-only">
                New Password
              </label>
              <input
                id="new-password"
                type="password"
                required
                className="appearance-none relative block w-full px-4 py-3 border border-gray-700 placeholder-gray-500 text-white bg-black rounded-lg focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent sm:text-sm"
                placeholder="New Password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="confirm-password" className="sr-only">
                Confirm New Password
              </label>
              <input
                id="confirm-password"
                type="password"
                required
                className="appearance-none relative block w-full px-4 py-3 border border-gray-700 placeholder-gray-500 text-white bg-black rounded-lg focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent sm:text-sm"
                placeholder="Confirm New Password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={handleResetPassword}
              disabled={loading}
              className="w-full py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-black bg-white hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-white disabled:opacity-50 transition-colors duration-200"
            >
              {loading ? 'Resetting...' : 'Reset Password'}
            </button>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-black py-4 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-4">
        <div>
          <div className="flex flex-col items-center justify-center mb-2">
            <div className="w-24 h-24 rounded-full overflow-hidden flex items-center justify-center shadow-lg mb-2">
              <Image src="/XognitoLogo.png" alt="Xognito Logo" width={96} height={96} className="object-contain w-24 h-24" />
            </div>
            <h2 className="text-center text-3xl font-extrabold text-white">
              {resetStep === 'initial' ? 'Sign in to your account' : 'Reset your password'}
            </h2>
          </div>
          {resetStep === 'initial' && (
            <p className="mt-2 text-center text-sm text-gray-400">
              Or{' '}
              <Link href="/signup" className="font-medium text-white hover:text-gray-300">
                create a new account
              </Link>
            </p>
          )}
        </div>

        {resetStep === 'initial' ? (
          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            <div className="space-y-4">
              <div>
                <label htmlFor="email-or-username" className="sr-only">
                  Email or Username
                </label>
                <input
                  id="email-or-username"
                  name="emailOrUsername"
                  type="text"
                  autoComplete="username"
                  required
                  className="appearance-none relative block w-full px-4 py-3 border border-gray-700 placeholder-gray-500 text-white bg-black rounded-lg focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent sm:text-sm"
                  placeholder="Email or Username"
                  value={emailOrUsername}
                  onChange={(e) => setEmailOrUsername(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="password" className="sr-only">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="appearance-none relative block w-full px-4 py-3 border border-gray-700 placeholder-gray-500 text-white bg-black rounded-lg focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent sm:text-sm"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={loading}
                className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-black bg-white hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-white disabled:opacity-50 transition-colors duration-200"
              >
                {loading ? 'Signing in...' : 'Sign in'}
              </button>
            </div>

            <div className="text-center">
              <button
                type="button"
                onClick={handleForgotPassword}
                disabled={loading}
                className="text-sm text-white hover:text-gray-300 focus:outline-none"
              >
                Forgot your password?
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-8 space-y-6">
            {renderResetPasswordForm()}
            <div className="text-center">
              <button
                type="button"
                onClick={() => setResetStep('initial')}
                className="text-sm text-white hover:text-gray-300 focus:outline-none"
              >
                Back to login
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="text-red-500 text-sm text-center">{error}</div>
        )}
        
        {success && (
          <div className="text-green-500 text-sm text-center">{success}</div>
        )}
      </div>
    </div>
  );
} 