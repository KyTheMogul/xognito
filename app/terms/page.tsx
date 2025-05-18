"use client";

import React from 'react';
import Image from "next/image";
import { Button } from "@/components/ui/button";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-black to-zinc-900 text-white flex flex-col">
      {/* Header */}
      <header className="w-full flex items-center justify-between px-8 py-6">
        <a href="/" className="flex items-center gap-1">
          <div className="w-16 h-16 rounded-full overflow-hidden flex items-center justify-center shadow-lg">
            <Image src="/XognitoLogo.png" alt="Xognito Logo" width={64} height={64} className="object-contain w-16 h-16" />
          </div>
          <span className="text-lg font-bold tracking-tight">Xognito</span>
        </a>
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

      {/* Terms Content */}
      <div className="flex flex-col items-center justify-center p-8 flex-grow">
        <h1 className="text-3xl font-bold mb-6">Xognito Terms of Service</h1>
        <div className="text-lg text-zinc-300 max-w-2xl text-center">
          <p className="mb-4"><strong>Effective Date:</strong> May 20, 2025</p>
          <p className="mb-4"><strong>Last Updated:</strong> May 20, 2025</p>
          <h2 className="text-2xl font-bold mt-6 mb-4">1. Acceptance of Terms</h2>
          <p className="mb-4">By creating an account or using Xognito ("the Service"), you agree to be bound by these Terms of Service ("Terms") and our Privacy Policy. If you do not agree, you may not use the Service.</p>
          <h2 className="text-2xl font-bold mt-6 mb-4">2. Description of the Service</h2>
          <p className="mb-4">Xognito is a private AI platform developed by XloudOne Inc. It allows users to interact with AI assistants, store personal data, analyze content, and (in applicable tiers) participate in collaborative group environments.</p>
          <h2 className="text-2xl font-bold mt-6 mb-4">3. Eligibility</h2>
          <p className="mb-4">You must be at least 13 years old to use the Service. If you are under the age of majority in your jurisdiction, you must have permission from a parent or guardian.</p>
          <h2 className="text-2xl font-bold mt-6 mb-4">4. Account Registration</h2>
          <p className="mb-4">You must register for a XloudID account to use the Service. You agree to provide accurate information and keep it up to date. You are responsible for all activity under your account.</p>
          <h2 className="text-2xl font-bold mt-6 mb-4">5. Subscription & Billing</h2>
          <p className="mb-4">Certain features are only available via a paid subscription. By subscribing:</p>
          <p className="mb-2">You authorize XloudOne Inc. to charge your payment method on a recurring basis.</p>
          <p className="mb-2">Your plan will renew automatically unless canceled.</p>
          <p className="mb-2">Prices may change with notice. Continued use after changes constitutes acceptance.</p>
          <p className="mb-4">You may cancel your subscription at any time. Refunds are subject to our discretion or where required by law.</p>
          <h2 className="text-2xl font-bold mt-6 mb-4">6. User Content & AI Interactions</h2>
          <p className="mb-4">You retain ownership of any content (messages, uploads, assistant settings) you create or provide.</p>
          <p className="mb-2">By using the Service:</p>
          <p className="mb-2">You grant XloudOne Inc. a license to store and process your content for the purpose of delivering the Service.</p>
          <p className="mb-2">You understand that generated AI responses are for informational or productivity purposes only and should not be treated as professional advice.</p>
          <p className="mb-4">We do not use your data to train public AI models.</p>
          <h2 className="text-2xl font-bold mt-6 mb-4">7. Groups & Shared Spaces</h2>
          <p className="mb-2">Group features allow you to collaborate with others and optionally share your assistant.</p>
          <p className="mb-2">Group owners control group access and content moderation.</p>
          <p className="mb-2">We are not responsible for user-generated content in groups.</p>
          <p className="mb-4">You agree not to abuse or harass other users.</p>
          <h2 className="text-2xl font-bold mt-6 mb-4">8. Prohibited Use</h2>
          <p className="mb-4">You agree not to:</p>
          <p className="mb-2">Use the Service to violate any laws</p>
          <p className="mb-2">Attempt to reverse-engineer or exploit the AI models</p>
          <p className="mb-2">Upload malicious, abusive, or harmful content</p>
          <p className="mb-4">Circumvent usage limits or security features</p>
          <p className="mb-4">Violation may result in suspension or termination of your account.</p>
          <h2 className="text-2xl font-bold mt-6 mb-4">9. Intellectual Property</h2>
          <p className="mb-4">All technology, software, and branding of Xognito are the intellectual property of XloudOne Inc. You may not use, copy, or modify any part of the platform without written permission.</p>
          <h2 className="text-2xl font-bold mt-6 mb-4">10. Disclaimers</h2>
          <p className="mb-4">The Service is provided "as is" without warranties.</p>
          <p className="mb-2">We do not guarantee the accuracy of AI-generated content.</p>
          <p className="mb-2">We are not liable for damages arising from use of the Service.</p>
          <p className="mb-4">Use of the Service is at your own risk.</p>
          <h2 className="text-2xl font-bold mt-6 mb-4">11. Termination</h2>
          <p className="mb-4">You may stop using Xognito at any time. We reserve the right to suspend or terminate accounts that violate these Terms, abuse the Service, or present security or legal risks.</p>
          <h2 className="text-2xl font-bold mt-6 mb-4">12. Governing Law</h2>
          <p className="mb-4">These Terms are governed by the laws of the state or country where XloudOne Inc. is registered. Legal disputes will be resolved in those courts unless otherwise required by law.</p>
          <h2 className="text-2xl font-bold mt-6 mb-4">13. Changes to the Terms</h2>
          <p className="mb-4">We may modify these Terms from time to time. Significant changes will be communicated via email or in-app notification. Continued use of the Service after changes constitutes acceptance.</p>
          <h2 className="text-2xl font-bold mt-6 mb-4">14. Contact Us</h2>
          <p className="mb-2">For questions or legal inquiries:</p>
          <p className="mb-2">Email: legal@xognito.com</p>
          <p className="mb-4">Company: XloudOne Inc.</p>
          <p className="mb-4">Address: [Insert Address]</p>
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