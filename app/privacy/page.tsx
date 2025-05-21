"use client";

import React from 'react';
import Image from "next/image";
import { Button } from "@/components/ui/button";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-black to-zinc-900 text-white flex flex-col">
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

      {/* Privacy Content */}
      <div className="flex flex-col items-center justify-center p-8 flex-grow">
        <h1 className="text-3xl font-bold mb-6">Privacy Policy</h1>
        <div className="text-lg text-zinc-300 max-w-2xl text-center">
          <p className="mb-4"><strong>Effective Date:</strong> May 20, 2025</p>
          <p className="mb-4"><strong>Last Updated:</strong> May 20, 2025</p>
          <h2 className="text-2xl font-bold mt-6 mb-4">1. Overview</h2>
          <p className="mb-4">Xognito ("we," "our," or "us") provides a private AI assistant platform designed to help individuals think, plan, reflect, and grow through secure, AI-powered conversations and tools.</p>
          <p className="mb-4">We respect your privacy. This Privacy Policy describes what information we collect, how we use it, how we protect it, and the choices you have.</p>
          <h2 className="text-2xl font-bold mt-6 mb-4">2. Information We Collect</h2>
          <p className="mb-4">We collect the minimum necessary data to provide our service.</p>
          <h3 className="text-xl font-bold mt-4 mb-2">a. Account Information</h3>
          <p className="mb-2">Email address and/or phone number</p>
          <p className="mb-2">Display name and chosen XloudID</p>
          <p className="mb-4">Profile picture (optional)</p>
          <h3 className="text-xl font-bold mt-4 mb-2">b. AI Usage Data</h3>
          <p className="mb-2">Messages you send and receive with your AI assistant</p>
          <p className="mb-2">Files you upload for analysis (e.g., PDFs, images)</p>
          <p className="mb-4">AI-generated summaries, memory entries, and assistant settings</p>
          <h3 className="text-xl font-bold mt-4 mb-2">c. Usage Statistics (Free Plan)</h3>
          <p className="mb-2">Message count per day</p>
          <p className="mb-2">File upload count</p>
          <p className="mb-4">Last usage timestamps</p>
          <h3 className="text-xl font-bold mt-4 mb-2">d. Subscription & Billing</h3>
          <p className="mb-2">Stripe Customer ID</p>
          <p className="mb-2">Stripe Subscription ID</p>
          <p className="mb-4">Plan type and billing history (we do not store full card info)</p>
          <h2 className="text-2xl font-bold mt-6 mb-4">3. How We Use Your Information</h2>
          <p className="mb-4">We use your data solely to provide and improve Xognito's private AI experience.</p>
          <p className="mb-2">Deliver AI responses and memory</p>
          <p className="mb-2">Analyze uploaded files (only at your request)</p>
          <p className="mb-2">Manage subscriptions and billing</p>
          <p className="mb-2">Customize your assistant's behavior and memory</p>
          <p className="mb-4">Respond to support requests</p>
          <p className="mb-2">We do not:</p>
          <p className="mb-2">Sell or share your data with advertisers</p>
          <p className="mb-2">Use your data to train third-party AI models</p>
          <p className="mb-4">Track you across the web or use invasive analytics</p>
          <h2 className="text-2xl font-bold mt-6 mb-4">4. Memory & AI Data Handling</h2>
          <h3 className="text-xl font-bold mt-4 mb-2">a. Your Conversations</h3>
          <p className="mb-2">Messages are stored securely and encrypted at rest.</p>
          <p className="mb-4">Only you can access your conversation history.</p>
          <h3 className="text-xl font-bold mt-4 mb-2">b. Memory System</h3>
          <p className="mb-2">Xognito saves memories only when meaningful and based on your interaction.</p>
          <p className="mb-2">You can view, edit, or delete memories at any time.</p>
          <p className="mb-4">Sensitive data (e.g., names, goals, emotions) is categorized and decay logic is applied over time unless marked "deep."</p>
          <h3 className="text-xl font-bold mt-4 mb-2">c. Files</h3>
          <p className="mb-4">Uploaded files are stored in your account's encrypted cloud storage and can be deleted at will.</p>
          <h2 className="text-2xl font-bold mt-6 mb-4">5. Group Features & Shared Bots</h2>
          <p className="mb-2">Group memory is shared only within the group and only visible to members.</p>
          <p className="mb-2">Each group is private, invite-only, and encrypted.</p>
          <p className="mb-4">Group hosts control access and can delete content.</p>
          <h2 className="text-2xl font-bold mt-6 mb-4">6. Security Measures</h2>
          <p className="mb-2">All data is encrypted in transit (TLS) and at rest (AES-256).</p>
          <p className="mb-2">Firebase Authentication handles secure login and user identity.</p>
          <p className="mb-4">Admin access to user data is restricted and audited.</p>
          <h2 className="text-2xl font-bold mt-6 mb-4">7. Your Rights</h2>
          <p className="mb-2">You can:</p>
          <p className="mb-2">Request a copy of your stored data</p>
          <p className="mb-2">Delete your account and all associated data at any time</p>
          <p className="mb-2">Manage assistant memory, subscriptions, and file uploads directly from your dashboard</p>
          <p className="mb-4">To make a request, contact: privacy@xognito.com</p>
          <h2 className="text-2xl font-bold mt-6 mb-4">8. Data Retention</h2>
          <p className="mb-2">We retain your data as long as your account is active.</p>
          <p className="mb-4">Deleted users' data is removed from our systems within 30 days (unless required for legal reasons).</p>
          <h2 className="text-2xl font-bold mt-6 mb-4">9. Children's Privacy</h2>
          <p className="mb-4">Xognito is not intended for children under 13. We do not knowingly collect data from children. If we discover such data, we will delete it immediately.</p>
          <h2 className="text-2xl font-bold mt-6 mb-4">10. Policy Updates</h2>
          <p className="mb-4">We may update this Privacy Policy from time to time. If we make significant changes, we will notify you via the app or by email.</p>
          <h2 className="text-2xl font-bold mt-6 mb-4">11. Contact Us</h2>
          <p className="mb-2">For any questions about this policy or your data:</p>
          <p className="mb-2">Email: privacy@xognito.com</p>
          <p className="mb-4">Address: XloudOne Inc. – [Insert Company Address]</p>
        </div>
      </div>

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