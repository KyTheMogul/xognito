'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { auth, db, storage } from '@/lib/firebase';
import { signOut, signInWithCustomToken, updateProfile, updateEmail, deleteUser } from 'firebase/auth';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useRouter } from 'next/navigation';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  addDoc, 
  serverTimestamp, 
  orderBy, 
  limit, 
  getDoc, 
  doc, 
  updateDoc, 
  arrayUnion,
  Timestamp,
  onSnapshot,
  setDoc,
  arrayRemove,
  deleteDoc,
  DocumentData
} from 'firebase/firestore';
import { loadStripe } from '@stripe/stripe-js';
import { canSendMessage, incrementMessageCount, canUploadFile, incrementFileUpload, getUsageStats } from '@/lib/usage';
import { 
  hasProPlan, 
  canInviteUsers, 
  addUserToSubscription,
  getUserSettings,
  updateUserSettings,
  isFeatureAvailable,
  PRO_PLAN_LIMITS,
  type UserSettings
} from '@/lib/subscription';
import ProFeatures from '@/components/ProFeatures';
import { 
  createConversation, 
  getConversations, 
  getMessages, 
  addMessage, 
  updateConversationTitle,
  type ConversationWithId,
  type MessageWithId,
  listenToConversations,
  listenToMessages,
  deleteConversation
} from '@/lib/firestore';
import { 
  evaluateMemoryOpportunity, 
  getRelevantMemories, 
  updateMemoryLastTriggered,
  generateMemoryContext,
  type Memory 
} from '@/lib/memory';
import MemoryNotification from '@/components/MemoryNotification';
import InviteUserModal from '@/components/InviteUserModal';
import InvitationNotification from '@/components/InvitationNotification';
import { Suspense } from 'react';
import GroupRequestNotification from '../components/GroupRequestNotification';
import Cropper from 'react-cropper';
import 'cropperjs/dist/cropper.css';
import { initializeUserSettings } from '../lib/settings';
import { onAuthStateChanged } from 'firebase/auth';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'react-toastify';
import { cn } from '@/lib/utils';
import Image from 'next/image';

const USER_PROFILE = '/ChatGPT Image May 23, 2025, 06_50_00 AM.png';
const AI_PROFILE = '/XognitoLogoFull.png';

type Message = {
  sender: 'user' | 'ai';
  text: string;
  files?: UploadedFile[];
  thinking?: boolean;
  isProgramming?: boolean;
};

type Conversation = { id: number; name: string };

type UploadedFile = {
  id: string;
  file: File;
  url: string;
  type: 'image' | 'pdf';
  name: string;
};

interface NotificationMemory {
  id: string;
  summary: string;
  type: 'short' | 'relationship' | 'deep';
}

// Add DeepSeek API integration with streaming support
async function fetchDeepSeekResponseStream(
  messages: { role: 'user' | 'system' | 'assistant'; content: string }[],
  onChunk: (chunk: string) => void
): Promise<void> {
  try {
    console.log("[DeepSeek] Starting API call with messages:", messages);
    const res = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
      body: JSON.stringify({ messages }),
    });
    if (!res.ok) {
      const errorText = await res.text();
      console.error("[DeepSeek] API error:", {
        status: res.status,
        statusText: res.statusText,
        error: errorText,
        headers: Object.fromEntries(res.headers.entries())
      });
      throw new Error(`DeepSeek API error: ${res.status} ${res.statusText} - ${errorText}`);
    }
    if (!res.body) {
      console.error("[DeepSeek] No response body");
      throw new Error('No response body from DeepSeek API');
    }
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let done = false;
  while (!done) {
    const { value, done: doneReading } = await reader.read();
    done = doneReading;
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      let lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const data = trimmed.replace(/^data:/, '');
          if (data === '[DONE]') {
            console.log("[DeepSeek] Stream complete");
            return;
          }
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              console.log("[DeepSeek] Received chunk:", delta);
              onChunk(delta);
            }
          } catch (e) {
            console.error("[DeepSeek] Error parsing chunk:", e, "Raw data:", data);
          }
      }
    }
    }
  } catch (error) {
    console.error("[DeepSeek] Error in API call:", {
      error,
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    // Send a more informative fallback response
    onChunk("I apologize, but I'm having trouble connecting to my language model. Please check your internet connection and API configuration. Error: " + (error instanceof Error ? error.message : 'Unknown error'));
    throw error;
  }
}

// Helper to parse code blocks from AI response (triple backtick or indented)
function ProgrammingMessage({ title, code }: { title: string; code: string }) {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Simulate code generation completion
    const timer = setTimeout(() => {
      setIsReady(true);
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="space-y-4">
      {/* Project Title and Status */}
      <div className="flex items-center space-x-3 bg-zinc-800/50 p-4 rounded-lg">
        <div className={`rounded-full h-5 w-5 border-t-2 border-b-2 border-white ${!isReady ? 'animate-spin' : ''}`}></div>
        <div>
          <h3 className="text-white font-medium">Building: {title}</h3>
          <p className="text-zinc-400 text-sm">
            {isReady ? 'Project ready for preview' : 'Generating complete project files...'}
          </p>
        </div>
        {/* Live Preview Button */}
        {isReady && (
          <a
            href={`/preview?code=${encodeURIComponent(code)}&title=${encodeURIComponent(title)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center space-x-2 bg-transparent border-2 border-white text-white hover:bg-white hover:text-black px-4 py-2 rounded-full transition-colors"
          >
            <span className="whitespace-nowrap">Live Preview</span>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        )}
      </div>
    </div>
  );
}

function renderAIMessage(text: string) {
  // Check if this is a programming response
  const isProgrammingResponse = text.includes('```html') || text.includes('```css') || text.includes('```js');
  
  if (isProgrammingResponse) {
    // Extract the title from the first HTML file
    const titleMatch = text.match(/<title>(.*?)<\/title>/);
    const projectTitle = titleMatch ? titleMatch[1] : 'Web Project';
    
    return <ProgrammingMessage title={projectTitle} code={text} />;
  }

  // Regular message rendering
  const parts = text.split(/(\*\*.*?\*\*|```[\s\S]*?```)/);
  return (
    <div className="space-y-4">
      {parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <div key={index} className="font-bold text-white">
              {part.slice(2, -2)}
            </div>
          );
        }
        if (part.startsWith('```')) {
          const [lang, ...codeParts] = part.slice(3, -3).split('\n');
          const code = codeParts.join('\n');
          return <CodeBlock key={index} lang={lang} code={code} />;
        }
        return <div key={index}>{part}</div>;
      })}
    </div>
  );
}

// Add styles for the expandable container
const styles = `
  .expanded svg {
    transform: rotate(180deg);
  }
`;

// Add the styles to the document
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement('style');
  styleSheet.textContent = styles;
  document.head.appendChild(styleSheet);
}

// CodeBlock component with language label and copy button
function CodeBlock({ lang, code, before }: { lang: string, code: string, before?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };
  return (
    <>
      {before && before.trim() && <span>{before}</span>}
      <div className="my-4 rounded-lg overflow-auto border border-zinc-700 bg-zinc-900 relative">
        <div className="absolute top-2 left-4 text-xs text-zinc-400 font-mono select-none bg-zinc-900/80 px-2 py-0.5 rounded">
          {lang}
        </div>
        <button
          className="absolute top-2 right-4 text-zinc-400 hover:text-white transition-colors p-1 bg-zinc-900/80 rounded"
          onClick={handleCopy}
          aria-label="Copy code"
          type="button"
        >
          {copied ? (
            <span className="text-xs font-semibold">Copied!</span>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
          )}
        </button>
        <SyntaxHighlighter
          language={lang}
          style={oneDark}
          showLineNumbers
          customStyle={{ margin: 0, padding: '32px 16px 16px 16px', fontSize: 14, background: 'transparent' }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </>
  );
}

// Add greeting detection helper
function isSimpleGreeting(text: string): boolean {
  const greetings = [
    'hi', 'hello', 'hey', 'yo', 'greetings', 'good morning', 'good afternoon', 'good evening', 'sup', 'hiya', 'howdy'
  ];
  const normalized = text.trim().toLowerCase();
  // Only match if the message is just a greeting (optionally with punctuation)
  return greetings.some(greet =>
    normalized === greet ||
    normalized === greet + '!' ||
    normalized === greet + '.' ||
    normalized === greet + ','
  );
}

// Add feeling/state detection helper
function isFeelingInquiry(text: string): boolean {
  const patterns = [
    /how are you( doing)?[\?\.! ]*$/i,
    /how do you feel[\?\.! ]*$/i,
    /what('s| is) up[\?\.! ]*$/i,
    /how's it going[\?\.! ]*$/i,
    /how are things[\?\.! ]*$/i,
    /what are you up to[\?\.! ]*$/i,
    /how have you been[\?\.! ]*$/i
  ];
  return patterns.some(re => re.test(text.trim()));
}

// Check for browser support
const SpeechRecognition = typeof window !== 'undefined' && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

// Add this type definition near the top with other types
type LinkedUser = {
  uid: string;
  email: string;
  photoURL: string;
  displayName: string;
};

// Add this helper function near the top with other utility functions
function getFirstName(displayName: string | null): string {
  if (!displayName) return 'User';
  return displayName.split(' ')[0];
}

// Force new deployment - May 15, 2024
export default function Dashboard() {
  console.log('[Dashboard] Component rendering');
  const { user, isLoading: authLoading, handleAuth } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Loading...');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadedFile[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [showCropper, setShowCropper] = useState(false);
  const [imageToCrop, setImageToCrop] = useState<string | null>(null);
  const [cropper, setCropper] = useState<any>(null);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [groupInput, setGroupInput] = useState('');
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [userGroups, setUserGroups] = useState<any[]>([]);
  const [groupMessages, setGroupMessages] = useState<any[]>([]);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showInvitationNotification, setShowInvitationNotification] = useState(false);
  const [invitationData, setInvitationData] = useState<any>(null);
  const [showGroupRequestNotification, setShowGroupRequestNotification] = useState(false);
  const [groupRequestData, setGroupRequestData] = useState<any>(null);
  const [showMemoryNotification, setShowMemoryNotification] = useState(false);
  const [memoryData, setMemoryData] = useState<NotificationMemory | null>(null);
  const [isPro, setIsPro] = useState(false);
  const [canInvite, setCanInvite] = useState(false);
  const [usageStats, setUsageStats] = useState<any>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const router = useRouter();

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get('token');
        
        if (token) {
          setLoadingMessage('Authenticating...');
          await handleAuth();
        }
      } catch (error) {
        console.error('[Dashboard] Auth initialization error:', error);
        setError('Failed to initialize authentication');
      } finally {
        setIsLoading(false);
      }
    };

    initializeAuth();
  }, [handleAuth]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/');
    }
  }, [authLoading, user, router]);

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-white text-lg">{loadingMessage}</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null; // Will be redirected by the useEffect above
  }

  // ... rest of the existing code ...
} 