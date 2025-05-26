'use client';

import { useState, useRef } from 'react';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { auth, db, storage } from '@/lib/firebase';
import { doc, setDoc, serverTimestamp, collection, query, where, getDocs } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';

export default function SignUp() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1); // 1: initial signup, 2: username selection
  const [userCredential, setUserCredential] = useState<any>(null);
  const [profileImage, setProfileImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const generateXognitoID = () => {
    const randomNum = Math.floor(Math.random() * 1000000);
    return `XognitoID_${randomNum}`;
  };

  const checkUsernameAvailability = async (username: string) => {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('username', '==', username));
    const querySnapshot = await getDocs(q);
    return querySnapshot.empty;
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) { // 5MB limit
        setError('Image size should be less than 5MB');
        return;
      }
      setProfileImage(file);
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    }
  };

  const uploadProfileImage = async (userId: string) => {
    if (!profileImage) return null;
    
    const storageRef = ref(storage, `profileImages/${userId}`);
    await uploadBytes(storageRef, profileImage);
    return getDownloadURL(storageRef);
  };

  const handleInitialSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Create user with email and password
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      setUserCredential(credential);
      setStep(2);
    } catch (error: any) {
      console.error('Signup error:', error);
      setError(error.message || 'Failed to create account');
    } finally {
      setLoading(false);
    }
  };

  const handleUsernameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const isAvailable = await checkUsernameAvailability(username);
      if (!isAvailable) {
        setError('Username is already taken');
        setLoading(false);
        return;
      }

      const user = userCredential.user;
      const xognitoID = generateXognitoID();

      // Upload profile image if selected
      let photoURL = null;
      if (profileImage) {
        photoURL = await uploadProfileImage(user.uid);
      }

      // Update profile with display name and photo URL
      await updateProfile(user, {
        displayName: displayName || email.split('@')[0],
        photoURL: photoURL || undefined
      });

      // Create user document in Firestore with XognitoID
      const userRef = doc(db, 'users', user.uid); // Use Firebase Auth UID as document ID
      await setDoc(userRef, {
        email: user.email,
        displayName: displayName || email.split('@')[0],
        username: username,
        xognitoID: xognitoID,
        photoURL: photoURL,
        createdAt: serverTimestamp(),
        lastLogin: serverTimestamp(),
        emailVerified: user.emailVerified,
        provider: 'email',
        settings: {
          theme: 'system',
          notifications: {
            email: true,
            push: true,
            weeklyDigest: false,
            groupRequests: true,
          },
          ai: {
            model: 'default',
            temperature: 0.7,
            maxTokens: 2000,
          },
          memory: {
            enabled: true,
            retentionDays: 30,
            autoArchive: true,
          }
        },
        subscription: {
          plan: 'free',
          status: 'active',
          startDate: serverTimestamp(),
          nextBillingDate: serverTimestamp(),
          billingHistory: [],
          usage: {
            messagesToday: 0,
            filesUploaded: 0,
            lastReset: serverTimestamp(),
          }
        }
      });

      // Use replace instead of push to prevent back navigation
      console.log('[Signup] Redirecting to dashboard after successful signup');
      router.replace('/dashboard');
    } catch (error: any) {
      console.error('Username setup error:', error);
      setError(error.message || 'Failed to set up username');
    } finally {
      setLoading(false);
    }
  };

  if (step === 2) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div className="flex flex-col items-center">
            <div 
              className="w-24 h-24 rounded-full bg-gray-800 mb-6 flex items-center justify-center cursor-pointer relative overflow-hidden"
              onClick={() => fileInputRef.current?.click()}
            >
              {previewUrl ? (
                <Image
                  src={previewUrl}
                  alt="Profile preview"
                  fill
                  className="object-cover"
                />
              ) : (
                <span className="text-3xl text-white">👤</span>
              )}
              <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                <span className="text-white text-sm">Change photo</span>
              </div>
            </div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImageChange}
              accept="image/*"
              className="hidden"
            />
            <h2 className="text-center text-3xl font-extrabold text-white">
              Choose your username
            </h2>
            <p className="mt-2 text-center text-sm text-gray-400">
              This will be your unique identifier on Xognito
            </p>
          </div>
          <form className="mt-8 space-y-6" onSubmit={handleUsernameSubmit}>
            <div>
              <label htmlFor="username" className="sr-only">
                Username
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-400">
                  @
                </span>
                <input
                  id="username"
                  name="username"
                  type="text"
                  required
                  className="appearance-none relative block w-full pl-8 pr-4 py-3 border border-gray-700 placeholder-gray-500 text-white bg-black rounded-lg focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent sm:text-sm"
                  placeholder="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            </div>

            {error && (
              <div className="text-red-500 text-sm text-center">{error}</div>
            )}

            <div>
              <button
                type="submit"
                disabled={loading}
                className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-black bg-white hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-white disabled:opacity-50 transition-colors duration-200"
              >
                {loading ? 'Setting up...' : 'Continue'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-black py-4 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-4">
        <div>
          <div className="flex flex-col items-center justify-center mb-2">
            <div className="w-24 h-24 rounded-full overflow-hidden flex items-center justify-center shadow-lg mb-2">
              <Image src="/XognitoLogo.png" alt="Xognito Logo" width={96} height={96} className="object-contain w-24 h-24" />
            </div>
            <h2 className="text-center text-3xl font-extrabold text-white">
              Create your account
            </h2>
          </div>
          <p className="mt-2 text-center text-sm text-gray-400">
            Or{' '}
            <Link href="/login" className="font-medium text-white hover:text-gray-300">
              sign in to your account
            </Link>
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleInitialSignup}>
          <div className="space-y-4">
            <div>
              <label htmlFor="display-name" className="sr-only">
                Display Name
              </label>
              <input
                id="display-name"
                name="displayName"
                type="text"
                required
                className="appearance-none relative block w-full px-4 py-3 border border-gray-700 placeholder-gray-500 text-white bg-black rounded-lg focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent sm:text-sm"
                placeholder="Display Name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="email-address" className="sr-only">
                Email address
              </label>
              <input
                id="email-address"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="appearance-none relative block w-full px-4 py-3 border border-gray-700 placeholder-gray-500 text-white bg-black rounded-lg focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent sm:text-sm"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
                autoComplete="new-password"
                required
                className="appearance-none relative block w-full px-4 py-3 border border-gray-700 placeholder-gray-500 text-white bg-black rounded-lg focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent sm:text-sm"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <div className="text-red-500 text-sm text-center">{error}</div>
          )}

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-black bg-white hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-white disabled:opacity-50 transition-colors duration-200"
            >
              {loading ? 'Creating account...' : 'Sign up'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
} 