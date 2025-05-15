"use client";

import React, { useState, useEffect } from 'react';
import Image from "next/image";
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { auth, db } from '@/lib/firebase';
import { signInWithCustomToken } from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';

export default function LandingPage() {
  const [pricingOpen, setPricingOpen] = useState(false);
  const [proFeaturesExpanded, setProFeaturesExpanded] = useState(false);
  const [proPlusFeaturesExpanded, setProPlusFeaturesExpanded] = useState(false);
  const [activePlanTab, setActivePlanTab] = useState<'free' | 'pro'>('free');
  const freeRef = React.useRef<HTMLDivElement>(null);
  const proRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      const token = url.searchParams.get('token');
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
        signInWithCustomToken(auth, token)
          .then(async (userCredential) => {
            const user = userCredential.user;
            console.log("[XloudID] Successfully signed in user:", user.uid);
            // Create user doc in Firestore if not exists
            const userRef = doc(db, 'users', user.uid);
            const userSnap = await getDoc(userRef);
            console.log("[XloudID] Checking if user document exists:", userSnap.exists());
            if (!userSnap.exists()) {
              console.log("[XloudID] Creating new user document");
              try {
                await setDoc(userRef, {
                  email: user.email,
                  createdAt: new Date(),
                  // Add any other default fields here
                });
                console.log("[XloudID] Successfully created user document");
              } catch (error) {
                console.error("[XloudID] Error creating user document:", error);
              }
            }
            // Optionally, clean up the URL
            url.searchParams.delete('token');
            window.history.replaceState({}, document.title, url.pathname + url.search);
            console.log("[XloudID] Redirecting to:", validatedRedirectUrl);
            window.location.href = validatedRedirectUrl;
          })
          .catch((err) => {
            // Handle error (invalid/expired token, etc.)
            console.error('[XloudID] Firebase sign-in error:', err);
          });
      } else {
        console.log("[XloudID] No token found in URL");
      }
    }
  }, []);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col" style={{ fontFamily: 'Poppins, sans-serif' }}>
      {/* Header */}
      <header className="w-full flex items-center justify-between px-8 py-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center shadow-lg bg-white border-2 border-white">
            <Image src="/a7ff0c3b-f089-42c4-8e2e-ea1bb831abbe.png" alt="Xognito Logo" width={32} height={32} className="object-contain w-8 h-8" />
          </div>
          <span className="text-lg font-bold tracking-tight">Xognito</span>
        </div>
        <nav className="hidden md:flex gap-7 text-sm font-medium">
          <a href="#features" className="hover:text-zinc-300 transition-colors">Features</a>
          <a href="#compare" className="hover:text-zinc-300 transition-colors">Compare</a>
          <a href="#why" className="hover:text-zinc-300 transition-colors">Why Xognito?</a>
        </nav>
        <div className="flex items-center gap-3">
          <a href="https://auth.xloudone.com/signup?redirect=https://xognito.com/dashboard" target="_blank" rel="noopener noreferrer"><Button variant="ghost" className="text-white border border-white/20 bg-transparent hover:bg-white/10 rounded-full px-4 py-1.5 text-sm">Try Free</Button></a>
          <a href="https://auth.xloudone.com/login?redirect=https://xognito.com/dashboard" target="_blank" rel="noopener noreferrer" className="text-white/80 hover:text-white cursor-pointer text-sm font-medium">Log In</a>
        </div>
      </header>

      {/* Hero Section */}
      <section className="flex flex-col items-center justify-center text-center py-20 px-4">
        <h1 className="text-4xl md:text-6xl font-extrabold mb-6 tracking-tight">Your Private AI, Reinvented.</h1>
        <p className="text-lg md:text-2xl text-zinc-300 max-w-2xl mb-10">Xognito helps you think, plan, write, and grow — in your own space, on your own terms.</p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <a href="https://auth.xloudone.com/signup?redirect=https://xognito.com/dashboard" target="_blank" rel="noopener noreferrer"><Button size="lg" variant="outline" className="rounded-full px-8 py-3 text-lg font-semibold bg-transparent border border-zinc-300 text-white hover:bg-white hover:text-black">Try Free</Button></a>
          <a href="#compare"><Button size="lg" variant="outline" className="rounded-full px-8 py-3 text-lg font-semibold bg-transparent border border-zinc-300 text-white hover:bg-white hover:text-black">View Pricing</Button></a>
        </div>
      </section>

      {/* What It Can Do */}
      <section id="features" className="max-w-5xl mx-auto w-full py-16 px-4">
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
      </section>

      {/* Compare Free vs Pro */}
      <section id="compare" className="max-w-5xl mx-auto w-full py-16 px-4">
        <h2 className="text-2xl md:text-3xl font-bold mb-10 text-center">Compare Plans</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <Card className="bg-zinc-900 border-zinc-800 text-white p-8">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-lg font-bold">Free</span>
              <Separator className="flex-1 mx-2 bg-zinc-700" />
              <span className="text-zinc-400 text-sm">$0/month</span>
            </div>
            <ul className="text-zinc-300 text-sm space-y-2 mb-4">
              <li>Chat with your assistant (25 messages/day)</li>
              <li>Internet access included (live web info)</li>
              <li>No memory — assistant resets each session</li>
              <li>Try up to 3 personal tools (Taps)</li>
              <li>No file uploads or image analysis</li>
              <li>Group chat not available</li>
              <li>Xognito branding shown</li>
            </ul>
            <Button variant="outline" className="w-full rounded-full border-white/20 text-white hover:bg-white/10">Start Free</Button>
          </Card>
          <Card className="bg-zinc-900 border-zinc-800 text-white p-8">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-lg font-bold">Pro</span>
              <Separator className="flex-1 mx-2 bg-zinc-700" />
              <span className="text-zinc-400 text-sm">$12/month</span>
            </div>
            <ul className="text-zinc-300 text-sm space-y-2 mb-4">
              <li>Unlimited AI conversations</li>
              <li>AI memory (remembers your goals, tasks, notes)</li>
              <li>Real-time web search</li>
              <li>Upload & analyze files, screenshots</li>
              <li>Use up to 10 personal tools (Taps)</li>
              <li>Save and export chat history</li>
              <li>Customize assistant's name and personality</li>
              <li>Remove Xognito branding</li>
              <li>Add another user for 20% extra/month</li>
              <li className="text-zinc-500">Offline access & advanced features are reserved for Pro Plus</li>
            </ul>
            <Button className="w-full rounded-full bg-transparent border border-zinc-300 text-white hover:bg-white hover:text-black" variant="outline">Upgrade to Pro</Button>
          </Card>
        </div>
      </section>

      {/* Why Xognito? */}
      <section id="why" className="max-w-3xl mx-auto w-full py-16 px-4">
        <h2 className="text-2xl md:text-3xl font-bold mb-8 text-center">Why Xognito?</h2>
        <div className="flex flex-col gap-6 text-lg text-zinc-200 text-center">
          <div>No tracking, no noise — just you and your assistant.</div>
          <div>Start simple. Grow smarter.</div>
          <div>Built for your privacy, not your data.</div>
        </div>
      </section>

      {/* Join Now CTA */}
      <section className="flex flex-col items-center justify-center text-center py-16 px-4">
        <h3 className="text-2xl md:text-3xl font-bold mb-4">Start using your own AI today — no credit card required.</h3>
        <a href="https://auth.xloudone.com/signup?redirect=https://xognito.com/dashboard" target="_blank" rel="noopener noreferrer"><Button size="lg" variant="outline" className="rounded-full px-8 py-3 text-lg font-semibold bg-transparent border border-zinc-300 text-white hover:bg-white hover:text-black">Try Free</Button></a>
      </section>

      {/* Footer */}
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
