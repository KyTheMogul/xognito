"use client";

import React, { useState, useEffect, useRef } from 'react';
import Image from "next/image";
import { AnimatePresence, motion, useInView } from 'framer-motion';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { auth, db } from '@/lib/firebase';
import { signInWithCustomToken } from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';

export default function LandingPage() {
  console.log("[XloudID] Landing page component mounted");
  const [pricingOpen, setPricingOpen] = useState(false);
  const [proFeaturesExpanded, setProFeaturesExpanded] = useState(false);
  const [proPlusFeaturesExpanded, setProPlusFeaturesExpanded] = useState(false);
  const [activePlanTab, setActivePlanTab] = useState<'free' | 'pro'>('free');
  const freeRef = useRef(null);
  const proRef = useRef(null);
  const proPlusRef = useRef(null);
  const freeInView = useInView(freeRef, { once: true });
  const proInView = useInView(proRef, { once: true });
  const proPlusInView = useInView(proPlusRef, { once: true });
  const [countdown, setCountdown] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [placeholderText, setPlaceholderText] = useState('');
  const phrases = [
    'Hey there!',
    'Let\'s chat about anything...',
    'Express your thoughts freely...',
    'We can talk, code, or just chill...',
    'Your ideas are safe with me...',
    'Ready to explore together?',
    'Let\'s make something amazing...',
    'Your AI companion is here...',
    'What\'s on your mind today?',
    'What needs to be done today?',
    'Let\'s tackle your tasks together...',
    'Ready to get things done?',
    'Just a click away from signing up...'
  ];
  let currentIndex = 0;
  let currentPhraseIndex = 0;
  let isDeleting = false;
  let typingSpeed = 100;
  const heroRef = useRef(null);
  const featuresRef = useRef(null);
  const pricingRef = useRef(null);
  const whyRef = useRef(null);
  const joinNowRef = useRef(null);
  const heroInView = useInView(heroRef, { once: true });
  const featuresInView = useInView(featuresRef, { once: true });
  const pricingInView = useInView(pricingRef, { once: true });
  const whyInView = useInView(whyRef, { once: true });
  const joinNowInView = useInView(joinNowRef, { once: true });

  useEffect(() => {
    console.log("[XloudID] useEffect triggered");
    const handleAuth = async () => {
      console.log("[XloudID] handleAuth started");
      if (typeof window !== 'undefined') {
        console.log("[XloudID] Window is defined");
        const url = new URL(window.location.href);
        const token = url.searchParams.get('token');
        console.log("[XloudID] Current URL:", window.location.href);
        console.log("[XloudID] Token from URL:", token ? "Present" : "Not present");
        const redirect = url.searchParams.get('redirect');
        const ALLOWED_REDIRECT_DOMAINS = [
          "https://xognito.com",
          "https://www.xognito.com",
          "https://xognito.vercel.app"
        ];
        let validatedRedirectUrl = "https://xognito.com/dashboard";
        if (redirect) {
          try {
            const redirectUrl = new URL(redirect);
            if (ALLOWED_REDIRECT_DOMAINS.includes(redirectUrl.origin)) {
              validatedRedirectUrl = redirect;
            }
          } catch (e) {
            // Allow relative paths (e.g., /dashboard)
            if (redirect.startsWith("/")) {
              validatedRedirectUrl = redirect;
            }
          }
        }
        if (token) {
          console.log("[XloudID] Received token:", token.substring(0, 10) + "...");
          try {
            const userCredential = await signInWithCustomToken(auth, token);
            const user = userCredential.user;
            console.log("[XloudID] Successfully signed in user:", {
              uid: user.uid,
              email: user.email,
              emailVerified: user.emailVerified
            });

            // Create user doc in Firestore if not exists
            const userRef = doc(db, 'users', user.uid);
            try {
              const userSnap = await getDoc(userRef);
              console.log("[XloudID] Checking if user document exists:", userSnap.exists());
              
              if (!userSnap.exists()) {
                console.log("[XloudID] Creating new user document");
                const userData = {
                  email: user.email,
                  createdAt: new Date(),
                  lastLogin: new Date(),
                  emailVerified: user.emailVerified,
                  displayName: user.displayName || null,
                  photoURL: user.photoURL || null
                };
                console.log("[XloudID] User data to be saved:", userData);
                
                await setDoc(userRef, userData);
                console.log("[XloudID] Successfully created user document");
              } else {
                // Update last login time
                await setDoc(userRef, { lastLogin: new Date() }, { merge: true });
                console.log("[XloudID] Updated existing user document");
              }
            } catch (firestoreError) {
              console.error("[XloudID] Firestore operation error:", firestoreError);
              // Continue with redirect even if Firestore operation fails
            }

            // Clean up URL and redirect
            url.searchParams.delete('token');
            window.history.replaceState({}, document.title, url.pathname + url.search);
            console.log("[XloudID] About to redirect to:", validatedRedirectUrl);
            
            // Store current URL and token info in localStorage
            localStorage.setItem('xloudid_auth_info', JSON.stringify({
              timestamp: new Date().toISOString(),
              token: token.substring(0, 10) + "...",
              redirectUrl: validatedRedirectUrl
            }));
            
            // Add a small delay before redirect to ensure logs are visible
            setTimeout(() => {
              window.location.href = validatedRedirectUrl;
            }, 1000);
          } catch (error) {
            const authError = error as Error;
            console.error("[XloudID] Authentication error:", {
              code: authError.name,
              message: authError.message,
              stack: authError.stack
            });
            // Store error logs
            localStorage.setItem('xloudid_error', JSON.stringify({
              code: authError.name,
              message: authError.message,
              stack: authError.stack
            }));
          }
        } else {
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
        }
      }
    };

    handleAuth();

    const eventDate = new Date();
    eventDate.setDate(eventDate.getDate() + 14);
    eventDate.setHours(17, 0, 0, 0); // 5:00 PM

    const interval = setInterval(() => {
      const now = new Date();
      const difference = eventDate.getTime() - now.getTime();

      const days = Math.floor(difference / (1000 * 60 * 60 * 24));
      const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((difference % (1000 * 60)) / 1000);

      setCountdown(`${days}d ${hours}h ${minutes}m ${seconds}s`);

      if (difference < 0) {
        clearInterval(interval);
        setCountdown('Event has started!');
      }
    }, 1000);

    const typeEffect = () => {
      const currentPhrase = phrases[currentPhraseIndex];
      if (isDeleting) {
        setPlaceholderText(currentPhrase.substring(0, currentIndex - 1));
        currentIndex--;
        typingSpeed = 50;
      } else {
        setPlaceholderText(currentPhrase.substring(0, currentIndex + 1));
        currentIndex++;
        typingSpeed = 100;
      }

      if (!isDeleting && currentIndex === currentPhrase.length) {
        isDeleting = true;
        typingSpeed = 2000; // Pause before deleting
      } else if (isDeleting && currentIndex === 0) {
        isDeleting = false;
        currentPhraseIndex = (currentPhraseIndex + 1) % phrases.length;
        typingSpeed = 1000; // Pause before typing next phrase
      }

      setTimeout(typeEffect, typingSpeed);
    };

    typeEffect();

    return () => {
      clearInterval(interval);
    };
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    if (e.target.value.length > 0) {
      window.location.href = 'https://auth.xloudone.com/signup?redirect=https://xognito.com/dashboard';
    }
  };

  const handleInputClick = () => {
    window.location.href = 'https://auth.xloudone.com/signup?redirect=https://xognito.com/dashboard';
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col" style={{ fontFamily: 'Poppins, sans-serif' }}>
      {/* Header */}
      <header className="w-full flex items-center justify-between px-8 py-6">
        <div className="flex items-center gap-1">
          <div className="w-16 h-16 rounded-full overflow-hidden flex items-center justify-center shadow-lg">
            <Image src="/XognitoLogo.png" alt="Xognito Logo" width={64} height={64} className="object-contain w-16 h-16" />
          </div>
          <span className="text-lg font-bold tracking-tight">Xognito</span>
        </div>
        <nav className="hidden md:flex gap-7 text-sm font-medium">
          <a href="#features" className="hover:text-zinc-300 transition-colors">Features</a>
          <a href="#compare" className="hover:text-zinc-300 transition-colors">Compare</a>
          <a href="#why" className="hover:text-zinc-300 transition-colors">Why Xognito?</a>
        </nav>
        <div className="flex items-center gap-3">
          <a href="https://auth.xloudone.com/signup?redirect=https://xognito.com/dashboard" target="_blank" rel="noopener noreferrer"><Button variant="ghost" className="text-white border border-white/20 bg-transparent hover:bg-white/10 hover:text-white rounded-full px-4 py-1.5 text-sm">Try Free</Button></a>
          <a href="https://auth.xloudone.com/login?redirect=https://xognito.com/dashboard" target="_blank" rel="noopener noreferrer" className="text-white/80 hover:text-white cursor-pointer text-sm font-medium">Log In</a>
        </div>
      </header>

      {/* Hero Section (always visible, no animation) */}
      <section className="flex flex-col items-center justify-center text-center py-20 px-4">
        <h1 className="text-4xl md:text-6xl font-extrabold mb-6 tracking-tight">Your Private AI, Reinvented.</h1>
        <p className="text-lg md:text-2xl text-zinc-300 max-w-2xl mb-10">Xognito helps you think, write, create, and grow — in your own space.</p>
        <div className="relative w-full max-w-md mb-10">
          <input type="text" placeholder={placeholderText} className="w-full px-4 py-2 rounded-full border border-zinc-300 bg-transparent text-white focus:outline-none focus:border-white transition-all duration-300" value={inputValue} onChange={handleInputChange} onClick={handleInputClick} />
          <div className="absolute inset-0 rounded-full border border-white opacity-100 animate-pulse pointer-events-none" style={{ boxShadow: '0 0 20px rgba(255, 255, 255, 0.8)' }}></div>
          <button className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white active:text-white transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </button>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <a href="https://auth.xloudone.com/signup?redirect=https://xognito.com/dashboard" target="_blank" rel="noopener noreferrer"><Button size="lg" variant="outline" className="rounded-full px-8 py-3 text-lg font-semibold bg-transparent border border-zinc-300 text-white hover:bg-white hover:text-black">Try Free</Button></a>
          <a href="https://youtube.com/live/qwxIoPfOSr8?feature=share" target="_blank" rel="noopener noreferrer"><Button size="lg" variant="outline" className="rounded-full px-8 py-3 text-lg font-semibold bg-transparent border border-zinc-300 text-white hover:bg-white hover:text-black">View Live</Button></a>
        </div>
        <p className="mt-4 text-lg text-zinc-300">Event starts in: {countdown}</p>
      </section>

      {/* What It Can Do */}
      <motion.section
        ref={featuresRef}
        initial={{ opacity: 0, y: 50 }}
        animate={featuresInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 50 }}
        transition={{ duration: 0.6, delay: 0.15 }}
        id="features"
        className="max-w-5xl mx-auto w-full py-16 px-4"
      >
        <h2 className="text-2xl md:text-3xl font-bold mb-10 text-center">What Xognito Can Do</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <Card className="bg-zinc-900 border-zinc-800 text-white flex flex-col items-center p-6">
            <div className="mb-4"><span className="inline-block w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-2xl">📝</span></div>
            <div className="font-semibold mb-2 text-center">Remembers what matters</div>
            <div className="text-zinc-400 text-sm text-center">Your goals, notes, and habits are always at hand.</div>
          </Card>
          <Card className="bg-zinc-900 border-zinc-800 text-white flex flex-col items-center p-6">
            <div className="mb-4"><span className="inline-block w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-2xl">📄</span></div>
            <div className="font-semibold mb-2 text-center">Understands documents</div>
            <div className="text-zinc-400 text-sm text-center">Reads and explains PDFs, screenshots, and images.</div>
          </Card>
          <Card className="bg-zinc-900 border-zinc-800 text-white flex flex-col items-center p-6">
            <div className="mb-4"><span className="inline-block w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-2xl">🌐</span></div>
            <div className="font-semibold mb-2 text-center">Searches the web</div>
            <div className="text-zinc-400 text-sm text-center">Finds real-time answers and up-to-date info.</div>
          </Card>
          <Card className="bg-zinc-900 border-zinc-800 text-white flex flex-col items-center p-6">
            <div className="mb-4"><span className="inline-block w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-2xl">⚡</span></div>
            <div className="font-semibold mb-2 text-center">Works even offline</div>
            <div className="text-zinc-400 text-sm text-center">Go Pro to use your assistant anywhere, anytime.</div>
          </Card>
        </div>
      </motion.section>

      {/* Compare Free vs Pro */}
      <motion.section
        ref={pricingRef}
        initial={{ opacity: 0, y: 50 }}
        animate={pricingInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 50 }}
        transition={{ duration: 0.6, delay: 0.3 }}
        id="compare"
        className="max-w-5xl mx-auto w-full py-16 px-4"
      >
        <h2 className="text-2xl md:text-3xl font-bold mb-10 text-center">Compare Plans</h2>
        <div className="flex flex-row gap-8 justify-center items-stretch mb-6 mt-20">
          {/* Free Plan Card */}
          <motion.div
            ref={freeRef}
            initial={{ opacity: 0, y: 50 }}
            animate={freeInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 50 }}
            transition={{ duration: 0.5 }}
            className="rounded-2xl border border-white bg-gradient-to-b from-black to-zinc-900 p-8 flex flex-col items-center shadow-lg text-white min-w-[280px] max-w-[340px] flex-1 transition-transform duration-200 hover:scale-105 hover:shadow-2xl hover:border-zinc-300"
          >
            <div className="font-bold text-xl mb-1 tracking-wide">Free</div>
            <div className="text-lg mb-1 font-semibold">$0/month</div>
            <div className="text-xs text-zinc-300 mb-3 italic">Try it out with no pressure.</div>
            <ul className="text-sm text-zinc-300 mb-6 space-y-2 text-left w-full max-w-[210px]">
              <li>Chat with your assistant (25 messages/day)</li>
              <li>Internet access included (live web info)</li>
              <li>No memory — assistant resets each session</li>
              <li>Try up to 3 personal tools (Taps)</li>
              <li>No file uploads or image analysis</li>
              <li>Group chat not available</li>
              <li>Xognito branding shown</li>
            </ul>
            <button
              className="bg-white text-black font-semibold px-4 py-2 rounded-lg transition-colors w-full"
              onClick={() => window.location.href = 'https://auth.xloudone.com/signup?redirect=https://xognito.com/dashboard'}
            >
              Start Free
            </button>
          </motion.div>
          {/* Pro Plan Card */}
          <motion.div
            ref={proRef}
            initial={{ opacity: 0, y: 50 }}
            animate={proInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 50 }}
            transition={{ duration: 0.5 }}
            className="relative rounded-2xl border border-black bg-gradient-to-b from-white to-zinc-100 p-12 flex flex-col items-center shadow-2xl text-black font-semibold min-w-[320px] max-w-[400px] scale-110 z-10 flex-1 transition-transform duration-200 hover:scale-115 hover:shadow-[0_8px_40px_0_rgba(0,0,0,0.18)]"
          >
            {/* Most Popular Badge */}
            <div className="absolute -top-5 left-1/2 -translate-x-1/2 bg-black text-white text-xs font-bold px-4 py-1 rounded-full shadow-lg tracking-wide border border-white">Most Popular</div>
            <div className="font-bold text-2xl mb-1 tracking-wide">Pro</div>
            <div className="text-xl mb-1 font-semibold">$12/month</div>
            <div className="text-sm text-zinc-500 mb-4 italic">Unlock your assistant's full power.</div>
            <ul className="text-sm text-zinc-700 mb-6 space-y-2 text-left w-full max-w-[240px]">
              <li>Unlimited AI conversations</li>
              <li>AI memory (remembers your goals, tasks, notes)</li>
              <li>Real-time web search</li>
              <li>Upload & analyze files, screenshots</li>
              <li>Use up to 10 personal tools (Taps)</li>
              <li>Save and export chat history</li>
              <li>Customize assistant's name and personality</li>
              <li>Remove Xognito branding</li>
              <li>Add another user for 20% extra/month</li>
            </ul>
            <button
              className="bg-black text-white font-semibold px-7 py-3 rounded-lg transition-colors text-base shadow w-full"
              onClick={() => window.location.href = 'https://auth.xloudone.com/signup?redirect=https://xognito.com/dashboard'}
            >
              Upgrade to Pro
            </button>
          </motion.div>
          {/* Pro Plus Plan Card */}
          <motion.div
            ref={proPlusRef}
            initial={{ opacity: 0, y: 50 }}
            animate={proPlusInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 50 }}
            transition={{ duration: 0.5 }}
            className="rounded-2xl border border-white bg-gradient-to-b from-black to-zinc-900 p-8 flex flex-col items-center shadow-lg text-white min-w-[280px] max-w-[340px] flex-1 transition-transform duration-200 hover:scale-105 hover:shadow-2xl hover:border-zinc-300"
          >
            <div className="font-bold text-xl mb-1 tracking-wide">Pro Plus</div>
            <div className="text-lg mb-1 font-semibold">$24/month</div>
            <div className="text-xs text-zinc-300 mb-3 italic">Coming Soon</div>
            <ul className="text-sm text-zinc-300 mb-6 space-y-2 text-left w-full max-w-[210px]">
              <li>Everything in Pro, plus:</li>
              <li>Full offline access</li>
              <li>Higher file size limits</li>
              <li>Longer memory depth</li>
              <li>Early access to beta tools</li>
              <li>Priority group features</li>
              <li>Includes up to 2 users</li>
              <li>Additional users: +30%/user</li>
            </ul>
            <button className="bg-zinc-700 text-zinc-400 font-semibold px-4 py-2 rounded-lg cursor-not-allowed w-full" disabled>Coming Soon</button>
          </motion.div>
        </div>
      </motion.section>

      {/* Why Xognito? */}
      <motion.section
        ref={whyRef}
        initial={{ opacity: 0, y: 50 }}
        animate={whyInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 50 }}
        transition={{ duration: 0.6, delay: 0.45 }}
        id="why"
        className="max-w-3xl mx-auto w-full py-16 px-4"
      >
        <h2 className="text-2xl md:text-3xl font-bold mb-8 text-center">Why Xognito?</h2>
        <div className="flex flex-col gap-6 text-lg text-zinc-200 text-center">
          <div>No tracking, no noise — just you and your assistant.</div>
          <div>Start simple. Grow smarter.</div>
          <div>Built for your privacy, not your data.</div>
        </div>
      </motion.section>

      {/* Join Now CTA */}
      <motion.section
        ref={joinNowRef}
        initial={{ opacity: 0, y: 50 }}
        animate={joinNowInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 50 }}
        transition={{ duration: 0.6, delay: 0.6 }}
        className="flex flex-col items-center justify-center text-center py-16 px-4"
      >
        <h3 className="text-2xl md:text-3xl font-bold mb-4">Start using your own AI today — no credit card required.</h3>
        <a href="https://auth.xloudone.com/signup?redirect=https://xognito.com/dashboard" target="_blank" rel="noopener noreferrer"><Button size="lg" variant="outline" className="rounded-full px-8 py-3 text-lg font-semibold bg-transparent border border-zinc-300 text-white hover:bg-white hover:text-black">Try Free</Button></a>
      </motion.section>

      {/* Footer (no animation) */}
      <footer className="w-full border-t border-zinc-800 bg-black py-8 mt-8">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 px-4">
          <div className="text-zinc-400 text-sm text-center md:text-left">
            &copy; {new Date().getFullYear()} Xognito. All rights reserved.
          </div>
          <div className="flex items-center gap-6 text-zinc-400 text-sm">
            <a href="https://XloudOne.com" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">XloudOne</a>
            <a href="/privacy" className="hover:text-white transition-colors">Privacy</a>
            <a href="/terms" className="hover:text-white transition-colors">Terms</a>
            <a href="/contact" className="hover:text-white transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
