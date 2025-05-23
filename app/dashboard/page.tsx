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

const USER_PROFILE = '/ChatGPT Image May 23, 2025, 06_50_00 AM.png';
const AI_PROFILE = '/XognitoLogoFull.png';

type Message = { sender: 'user' | 'ai'; text: string, files?: UploadedFile[], thinking?: boolean };
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
function renderAIMessage(text: string) {
  try {
    // First, handle code blocks
    const codeBlockRegex = /```([\w-]*)\n([\s\S]*?)```/g;
    let match = codeBlockRegex.exec(text);
    if (match) {
      const before = text.slice(0, match.index).trim();
      const lang = match[1] || 'plaintext';
      const code = match[2];
      return <CodeBlock lang={lang} code={code} before={before} />;
    }

    // Check if the text contains a numbered list
    const hasNumberedList = /\d+\.\s+[^\n]+/.test(text);
    const hasBulletList = /\*\s+[^\n]+/.test(text);

    if (hasNumberedList || hasBulletList) {
      // Split the text into before list, list items, and after list
      // Updated regex to better handle multi-line list items and complex formatting
      const listRegex = /((?:\d+\.|\*)\s+[^\n]+(?:\n(?!\d+\.|\*)[^\n]*)*)/g;
      const listMatches = Array.from(text.matchAll(listRegex));
      
      if (listMatches.length > 0) {
        const firstMatch = listMatches[0];
        const beforeList = text.slice(0, firstMatch.index).trim();
        const listItems = listMatches.map(match => {
          const item = match[1].trim();
          // Clean up any extra newlines within the item
          return item.replace(/\n(?!\d+\.|\*)/g, ' ').trim();
        });
        
        // Get the content after the last list item
        const lastMatch = listMatches[listMatches.length - 1];
        const afterList = text.slice((lastMatch.index || 0) + lastMatch[0].length).trim();

        // Generate a title from the content before the list
        const generateTitle = (text: string) => {
          // Remove any markdown formatting
          const cleanText = text.replace(/\*\*/g, '').replace(/__/g, '');
          
          // Extract the main topic from common patterns
          const patterns = [
            /(?:here'?s|here is|here are) (?:a|an|the)? ([^.!?]+?)(?: in \d+ steps| recipe| guide| steps| instructions| list)/i,
            /(?:how to|steps to|guide to) ([^.!?]+?)(?: in \d+ steps| recipe| guide| steps| instructions| list)/i,
            /(?:making|creating|preparing) ([^.!?]+?)(?: in \d+ steps| recipe| guide| steps| instructions| list)/i,
            /(?:here'?s|here is|here are) (?:a|an|the)? ([^.!?]+?)(?: recipe| guide| steps| instructions| list)/i
          ];

          for (const pattern of patterns) {
            const match = cleanText.match(pattern);
            if (match && match[1]) {
              // Clean up the extracted title
              let title = match[1].trim()
                .replace(/^[^a-zA-Z0-9]+/, '') // Remove leading non-alphanumeric
                .replace(/[^a-zA-Z0-9]+$/, '') // Remove trailing non-alphanumeric
                .replace(/\s+/g, ' '); // Normalize spaces
              
              // Capitalize first letter of each word
              title = title.split(' ')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');
              
              return title;
            }
          }

          // If no pattern matches, use the first sentence
          const firstSentence = cleanText.split(/[.!?]/)[0].trim();
          return firstSentence.length > 50 ? firstSentence.slice(0, 50) + '...' : firstSentence;
        };

        const containerTitle = beforeList ? generateTitle(beforeList) : 'List';

        return (
          <div className="space-y-4">
            {beforeList && <div className="whitespace-pre-wrap">{beforeList}</div>}
            <div className="border border-zinc-700 rounded-lg overflow-hidden">
              <div className="w-full px-4 py-2 bg-zinc-800/50 flex items-center justify-between text-left">
                <span className="font-medium">{containerTitle}</span>
              </div>
              <div className="px-4 py-3 space-y-2">
                {listItems.map((item, index) => (
                  <div key={index} className="flex items-start gap-2">
                    <span className="text-zinc-400 mt-1">
                      {item.startsWith('*') ? '•' : `${index + 1}.`}
                    </span>
                    <span>{item.replace(/^\d+\.\s+|\*\s+/, '')}</span>
                  </div>
                ))}
              </div>
            </div>
            {afterList && <div className="whitespace-pre-wrap">{afterList}</div>}
          </div>
        );
      }
    }

    // If no list found, format the text with proper spacing
    const formattedText = text
      .replace(/\n\n+/g, '\n\n')
      .replace(/\n/g, '<br />');

    return <div className="whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: formattedText }} />;
  } catch (error) {
    console.error("Error rendering AI message:", error);
    return <span>{text}</span>;
  }
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
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [input, setInput] = useState('');
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationWithId[]>([]);
  const [messages, setMessages] = useState<MessageWithId[]>([]);
  const [hoveredChatId, setHoveredChatId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'account' | 'security' | 'appearance' | 'ai' | 'billing' | 'memory' | 'notifications'>('account');
  const [uploads, setUploads] = useState<UploadedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [proFeaturesExpanded, setProFeaturesExpanded] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const listenTimeoutRef = useRef<any>(null);
  const [activeMemories, setActiveMemories] = useState<NotificationMemory[]>([]);
  const [userSubscription, setUserSubscription] = useState<{
    plan: 'Free' | 'Pro' | 'Pro-Plus';
    isActive: boolean;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    startDate?: Timestamp;
    nextBillingDate?: Timestamp;
    trialEndsAt?: Timestamp;
    status: 'active' | 'canceled' | 'past_due' | 'trialing';
    billingHistory: {
      id: string;
      amount: number;
      currency: string;
      status: 'succeeded' | 'failed' | 'pending';
      date: Timestamp;
      description: string;
      invoiceUrl?: string;
    }[];
    isInvitedUser?: boolean;
    inviterEmail?: string;
    billingGroup?: string;
    xloudId?: string;
  } | null>(null);
  const [showDailyLimitError, setShowDailyLimitError] = useState(false);
  const [usageStats, setUsageStats] = useState<{
    messagesToday: number;
    filesUploaded: number;
    remaining: number;
  }>({ messagesToday: 0, filesUploaded: 0, remaining: 25 });
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [linkedUsers, setLinkedUsers] = useState<LinkedUser[]>([]);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupModalMode, setGroupModalMode] = useState<'join' | 'create'>('join');
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [groupCode, setGroupCode] = useState('');
  const [hostXloudID, setHostXloudID] = useState('');
  const [userGroups, setUserGroups] = useState<Array<{
    id: string;
    name: string;
    code: string;
    hostXloudID: string;
    description?: string;
  }>>([]);
  const [searchResults, setSearchResults] = useState<Array<{
    uid: string;
    email: string;
    displayName: string;
    photoURL: string;
    xloudId: string;
  }>>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [groupMessages, setGroupMessages] = useState<Array<{
    id: string;
    senderId: string;
    senderName: string;
    senderPhoto: string;
    text: string;
    timestamp: any;
    isAI: boolean;
    thinking?: boolean;
  }>>([]);
  const [groupInput, setGroupInput] = useState('');
  const [filteredChats, setFilteredChats] = useState<ConversationWithId[]>([]);
  const [filteredGroups, setFilteredGroups] = useState<Array<{
    id: string;
    name: string;
    code: string;
    hostXloudID: string;
    description?: string;
  }>>([]);
  const [user, setUser] = useState<any>(null);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Add state for cropper
  const [cropper, setCropper] = useState<Cropper | null>(null);
  const [showCropper, setShowCropper] = useState(false);
  const [imageToCrop, setImageToCrop] = useState<string | null>(null);

  const { handleAuth } = useAuth();

  const [isChangingPlan, setIsChangingPlan] = useState(false);
  const [promoCode, setPromoCode] = useState('');

  const [examplePrompts, setExamplePrompts] = useState([
    "What do you remember about my work schedule?",
    "Can you help me learn more about AI?",
    "Remember that I prefer to work in the morning",
    "What are my current learning goals?"
  ]);

  // Function to generate personalized prompts based on memories
  const generatePersonalizedPrompts = async (userId: string) => {
    try {
      // Get recent memories
      const memories = await getRelevantMemories(userId, "recent memories");
      
      if (memories.length === 0) {
        // Keep default prompts if no memories
        return;
      }

      // Define prompt templates for different memory types
      const promptTemplates = {
        short: [
          "What do you remember about {memory}?",
          "Can you remind me about {memory}?",
          "Tell me what you know about {memory}",
          "What details do you have about {memory}?",
          "I'd like to know more about {memory}"
        ],
        relationship: [
          "Can you tell me more about {memory}?",
          "What's your understanding of {memory}?",
          "How do you interpret {memory}?",
          "What context do you have about {memory}?",
          "Can you elaborate on {memory}?"
        ],
        deep: [
          "What insights do you have about {memory}?",
          "What patterns have you noticed regarding {memory}?",
          "How do you analyze {memory}?",
          "What conclusions can you draw about {memory}?",
          "What deeper understanding do you have of {memory}?"
        ]
      };

      // Function to get random template
      const getRandomTemplate = (type: 'short' | 'relationship' | 'deep') => {
        const templates = promptTemplates[type];
        return templates[Math.floor(Math.random() * templates.length)];
      };

      // Generate prompts based on memory types with variety
      const personalizedPrompts = memories.map((memory: NotificationMemory) => {
        const template = getRandomTemplate(memory.type);
        const memoryText = memory.summary.toLowerCase();
        
        // Add some variety to the memory text
        let processedMemory = memoryText;
        if (Math.random() > 0.5) {
          // Sometimes use a shorter version of the memory
          processedMemory = memoryText.split(' ').slice(0, 3).join(' ');
        }

        return template.replace('{memory}', processedMemory);
      }).filter(Boolean) as string[];

      // Mix in some general prompts if we have enough memories
      if (memories.length >= 3) {
        const generalPrompts = [
          "What patterns have you noticed in our conversations?",
          "Can you summarize what you've learned about me?",
          "What topics do we discuss most often?",
          "What are my main interests based on our chats?",
          "What goals have I mentioned to you?"
        ];
        
        // Add 1-2 general prompts
        const numGeneralPrompts = Math.floor(Math.random() * 2) + 1;
        for (let i = 0; i < numGeneralPrompts; i++) {
          const randomIndex = Math.floor(Math.random() * generalPrompts.length);
          personalizedPrompts.push(generalPrompts[randomIndex]);
        }
      }

      // Shuffle the prompts
      const shuffledPrompts = personalizedPrompts
        .sort(() => Math.random() - 0.5)
        .slice(0, 4); // Keep only 4 prompts

      // If we have enough personalized prompts, use them
      if (shuffledPrompts.length >= 2) {
        setExamplePrompts(shuffledPrompts);
      }
    } catch (error) {
      console.error("[Dashboard] Error generating personalized prompts:", error);
    }
  };

  // Update prompts periodically
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;

    // Generate personalized prompts on mount
    generatePersonalizedPrompts(user.uid);

    // Update prompts every 24 hours
    const interval = setInterval(() => {
      generatePersonalizedPrompts(user.uid);
    }, 24 * 60 * 60 * 1000);

    return () => clearInterval(interval);
  }, [auth.currentUser]);

  // Update search filtering
  useEffect(() => {
    if (!search.trim()) {
      setFilteredChats(conversations);
      setFilteredGroups(userGroups);
      return;
    }

    const searchLower = search.toLowerCase();
    
    // Filter conversations
    const filteredConversations = conversations.filter(chat => 
      chat.title.toLowerCase().includes(searchLower)
    );
    setFilteredChats(filteredConversations);

    // Filter groups
    const filteredGroupsList = userGroups.filter(group => 
      group.name.toLowerCase().includes(searchLower) ||
      (group.description && group.description.toLowerCase().includes(searchLower))
    );
    setFilteredGroups(filteredGroupsList);
  }, [search, conversations, userGroups]);

  const handleExampleClick = async (prompt: string) => {
    const user = auth.currentUser;
    if (!user) return;

    try {
      // Create new conversation first
      const newConversationId = await createConversation(user.uid);
      setActiveConversationId(newConversationId);
      
      // Set input and clear messages
    setInput(prompt);
      setMessages([]);
      
      // Send the message
    const syntheticEvent = { preventDefault: () => {} } as React.FormEvent;
    handleSend(syntheticEvent);
    } catch (error) {
      console.error("[Dashboard] Error in handleExampleClick:", error);
    }
  };

  // Real-time conversations
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;

    const unsubscribe = listenToConversations(user.uid, (convos) => {
      setConversations(convos);
      // Only set active conversation if none is selected and user hasn't explicitly chosen one
      if (!activeConversationId && convos.length > 0 && !sidebarOpen) {
        // Don't automatically set the first conversation
        // setActiveConversationId(convos[0].id);
      }
    });

    return () => unsubscribe();
  }, [auth.currentUser, activeConversationId, sidebarOpen]);

  // Real-time messages
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;

    // If no active conversation, don't set up listener
    if (!activeConversationId) {
      setMessages([]);
      return;
    }

    const unsubscribe = listenToMessages(user.uid, activeConversationId, (msgs) => {
      // Only update messages if we have an active conversation
      if (activeConversationId) {
      setMessages(msgs);
      }
    });

    return () => unsubscribe();
  }, [auth.currentUser, activeConversationId]);

  // Handle new chat creation
  const handleNewChat = async () => {
    const user = auth.currentUser;
    if (!user) {
      console.log("[Dashboard] No authenticated user found when creating new chat");
      return;
    }

    try {
      console.log("[Dashboard] Creating new conversation");
      // Clear active conversation first
      setActiveConversationId(null);
      setMessages([]);
      
      const newConversationId = await createConversation(user.uid);
      console.log("[Dashboard] Created new conversation:", newConversationId);
      setActiveConversationId(newConversationId);
    } catch (error) {
      console.error("[Dashboard] Error creating new chat:", error);
    }
  };

  // Function to generate conversation title using AI
  const generateConversationTitle = async (messages: MessageWithId[], userId: string): Promise<string> => {
    try {
      // Get the last few messages for context (up to 5)
      const recentMessages = messages.slice(-5);
      const conversationContext = recentMessages.map(msg => 
        `${msg.sender === 'user' ? 'User' : 'AI'}: ${msg.text}`
      ).join('\n');

      // Create messages for the AI to generate a title
      const messagesForAI: { role: 'user' | 'system' | 'assistant'; content: string }[] = [
        {
          role: 'system',
          content: `You are a conversation title generator. Your task is to create a concise, meaningful title (max 30 characters) that summarizes the main topic or theme of the conversation. The title should be:
1. Clear and descriptive
2. Professional and clean
3. No emojis or special characters
4. Focus on the main subject or purpose
5. Be specific enough to distinguish from other conversations`
        },
        {
          role: 'user',
          content: `Generate a title for this conversation:\n${conversationContext}`
        }
      ];

      let title = '';
      await fetchDeepSeekResponseStream(messagesForAI, (chunk) => {
        title += chunk;
      });

      // Clean up the title
      title = title.trim()
        .replace(/["']/g, '') // Remove quotes
        .replace(/^[^a-zA-Z0-9]+/, '') // Remove leading non-alphanumeric
        .replace(/[^a-zA-Z0-9]+$/, '') // Remove trailing non-alphanumeric
        .slice(0, 30); // Ensure max length

      // If title is too short or empty, use a fallback
      if (title.length < 3) {
        const date = new Date();
        title = `Chat ${date.toLocaleDateString()}`;
      }

      return title;
    } catch (error) {
      console.error("[Dashboard] Error generating conversation title:", error);
      // Fallback to date-based title
      const date = new Date();
      return `Chat ${date.toLocaleDateString()}`;
    }
  };

  // Modify handleSend to use the new title generator
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() && uploads.length === 0) return;

    console.log("[Dashboard] Attempting to send message:", { input, activeConversationId });
    
    if (!input.trim()) {
      console.log("[Dashboard] Cannot send message: No input text");
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      console.log("[Dashboard] No authenticated user found");
      return;
    }

    // Check message limit for free plan
    const hasPro = await hasProPlan(user.uid);
    if (!hasPro) {
      const messageCheck = await canSendMessage(user.uid);
      if (!messageCheck.allowed) {
        setShowDailyLimitError(true);
        setTimeout(() => setShowDailyLimitError(false), 5000);
        return;
      }
    }

    let currentConversationId = activeConversationId;

    // If no active conversation, create one
    if (!currentConversationId) {
      console.log("[Dashboard] No active conversation, creating new one");
      try {
        currentConversationId = await createConversation(user.uid);
        console.log("[Dashboard] Created new conversation:", currentConversationId);
        setActiveConversationId(currentConversationId);
        // Wait for the state update to complete
        await new Promise(resolve => setTimeout(resolve, 0));
      } catch (error) {
        console.error("[Dashboard] Failed to create new conversation:", error);
        return;
      }
    }

    console.log("[Dashboard] User authenticated:", { uid: user.uid });

    const userMessage: Omit<Message, 'timestamp'> = {
      sender: 'user',
      text: input,
    };

    try {
      console.log("[Dashboard] Adding user message to Firestore");
      // Add user message
      const userMessageId = await addMessage(user.uid, currentConversationId!, userMessage);
      console.log("[Dashboard] User message added successfully");
      
      setInput('');
      setUploads([]);

      // Evaluate if message should be stored as memory
      const memoryId = await evaluateMemoryOpportunity(user.uid, input, currentConversationId!, userMessageId);
      if (memoryId) {
        console.log("[Dashboard] Created new memory:", memoryId);
        // Get the memory details from Firestore
        const memoryRef = doc(db, `users/${user.uid}/memory`, memoryId);
        const memoryDoc = await getDoc(memoryRef);
        if (memoryDoc.exists()) {
          const memoryData = memoryDoc.data();
          handleNewMemory({
            id: memoryId,
            summary: memoryData.summary,
            type: memoryData.type || 'short'
          });
        }
      }

      // Get relevant memories for context
      const relevantMemories = await getRelevantMemories(user.uid, input);
      console.log("[Dashboard] Retrieved relevant memories:", relevantMemories);
      const memoryContext = generateMemoryContext(relevantMemories);
      console.log("[Dashboard] Generated memory context:", memoryContext);

      // If this is the first message, generate a title
      if (messages.length === 0) {
        console.log("[Dashboard] First message, generating conversation title");
        const messageWithId: MessageWithId = {
          ...userMessage,
          id: userMessageId,
          timestamp: Timestamp.now()
        };
        const title = await generateConversationTitle([messageWithId], user.uid);
        await updateConversationTitle(user.uid, currentConversationId!, title);
        console.log("[Dashboard] Conversation title updated:", title);
      }

      // Check if this is an image generation request
      const isImageRequest = input.toLowerCase().includes('generate image') || 
                            input.toLowerCase().includes('create image') ||
                            input.toLowerCase().includes('make an image') ||
                            input.toLowerCase().includes('draw') ||
                            input.toLowerCase().includes('generate a logo') ||
                            input.toLowerCase().includes('create a logo') ||
                            input.toLowerCase().includes('make a logo') ||
                            input.toLowerCase().includes('design a logo') ||
                            input.toLowerCase().includes('generate a picture') ||
                            input.toLowerCase().includes('create a picture') ||
                            input.toLowerCase().includes('make a picture');

      let aiMessageId = '';
      let aiResponse = '';

      if (isImageRequest) {
        try {
          // Add initial AI message with thinking state
          const initialAiMessage: Omit<Message, 'timestamp'> = {
            sender: 'ai',
            text: "Creating image...",
            thinking: true
          };
          aiMessageId = await addMessage(user.uid, currentConversationId!, initialAiMessage);

          // Call Stability AI API
          const response = await fetch('/api/generate-image', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ prompt: input }),
          });

          if (!response.ok) {
            throw new Error('Failed to generate image');
          }

          const result = await response.json();
          
          // Update AI message with the generated image
          const updatedAiMessage: Omit<Message, 'timestamp'> = {
            sender: 'ai',
            text: "",
            files: [{
              id: Date.now().toString(),
              url: `data:image/png;base64,${result.artifacts[0].base64}`,
              type: 'image',
              name: 'generated-image.png',
              file: new File([], 'generated-image.png')
            }],
            thinking: false
          };
          await updateDoc(doc(db, `users/${user.uid}/conversations/${currentConversationId}/messages`, aiMessageId), updatedAiMessage);
        } catch (error) {
          console.error("[Dashboard] Error generating image:", error);
          // Update with error message
          const errorMessage: Omit<Message, 'timestamp'> = {
            sender: 'ai',
            text: "I apologize, but I encountered an error while generating the image. Please try again.",
            thinking: false
          };
          await updateDoc(doc(db, `users/${user.uid}/conversations/${currentConversationId}/messages`, aiMessageId), errorMessage);
        }
      } else {
        // Add initial AI message
        const initialAiMessage: Omit<Message, 'timestamp'> = {
          sender: 'ai',
          text: '...',
          thinking: true
        };
        aiMessageId = await addMessage(user.uid, currentConversationId!, initialAiMessage);

        // Call DeepSeek API and stream the response
        const messagesForAI: { role: 'user' | 'system' | 'assistant'; content: string }[] = [
          { 
            role: 'system', 
            content: `You are Xognito — a personal AI assistant designed to think independently and respond efficiently.
Your personality is calm, focused, and sharply intelligent — like JARVIS from Iron Man.

You have the following capabilities:
1. Generate images using Stability AI when users ask for images, logos, or drawings
2. Remember important information from conversations
3. Provide thoughtful, detailed responses
4. Help with tasks, planning, and problem-solving
5. Maintain context across conversations

Guidelines:
1. Be concise but thorough
2. Use markdown formatting when appropriate
3. For image generation:
   - DO NOT respond to image generation requests with text
   - DO NOT try to generate images yourself or provide image URLs
   - DO NOT ask for details about the image
   - Let the system handle the actual image generation
   - The system will automatically detect image requests and handle them
4. Remember important details from the conversation
5. If you're not sure about something, say so
6. If they use phrases like "remember that" or "keep in mind", respond as if you're making a mental note
7. When referring to the user, use their first name (${getFirstName(user?.displayName)}) if appropriate

${memoryContext}`
          },
          { role: 'user', content: input }
        ];

        console.log("[Dashboard] Sending messages to DeepSeek:", messagesForAI);
        try {
          await fetchDeepSeekResponseStream(messagesForAI, (chunk) => {
            console.log("[Dashboard] Received chunk:", chunk);
            aiResponse += chunk;
            // Update the AI message in Firestore with the current response
            const updatedAiMessage: Omit<Message, 'timestamp'> = {
              sender: 'ai',
              text: aiResponse,
              thinking: false
            };
            updateDoc(doc(db, `users/${user.uid}/conversations/${currentConversationId}/messages`, aiMessageId), updatedAiMessage)
              .catch(error => {
                console.error("[Dashboard] Error updating AI message:", error);
              });
          });
          console.log("[Dashboard] Stream complete, final response:", aiResponse);

          // If a memory was created, add a confirmation message
          if (memoryId) {
            const confirmationMessage: Omit<Message, 'timestamp'> = {
              sender: 'ai',
              text: "I'll make sure to remember that for our future conversations.",
              thinking: false
            };
            await addMessage(user.uid, currentConversationId!, confirmationMessage);
          }
        } catch (error) {
          console.error("[Dashboard] Error in DeepSeek API call:", error);
          // Update with error message
          const errorMessage: Omit<Message, 'timestamp'> = {
            sender: 'ai',
            text: "I apologize, but I'm having trouble connecting to my language model. Please try again in a moment.",
            thinking: false
          };
          await updateDoc(doc(db, `users/${user.uid}/conversations/${currentConversationId}/messages`, aiMessageId), errorMessage)
            .catch(error => {
              console.error("[Dashboard] Error updating error message:", error);
            });
        }
      }

      // Update lastTriggered for any memories that were referenced
      for (const memory of relevantMemories) {
        if (aiResponse.toLowerCase().includes(memory.summary.toLowerCase())) {
          await updateMemoryLastTriggered(user.uid, memory.id);
          // Show notification for triggered memory
          handleNewMemory({
            id: memory.id,
            summary: memory.summary,
            type: memory.type || 'short'
          });
        }
      }

      // After successful message send, increment counter for free plan
      if (userSubscription?.plan === 'Free') {
        await incrementMessageCount(user.uid);
        const messageCheck = await canSendMessage(user.uid);
        setUsageStats(prev => ({
          ...prev,
          messagesToday: prev.messagesToday + 1,
          remaining: messageCheck.remaining
        }));
      }

    } catch (error) {
      console.error("[Dashboard] Error sending message:", error);
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false);
      }
    }
    if (profileMenuOpen) {
      document.addEventListener('mousedown', handleClick);
    } else {
      document.removeEventListener('mousedown', handleClick);
    }
    return () => document.removeEventListener('mousedown', handleClick);
  }, [profileMenuOpen]);

  // Scroll to bottom when messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle file upload
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;

    const user = auth.currentUser;
    if (!user) return;

    // Check file upload limit for free plan
    const hasPro = await hasProPlan(user.uid);
    if (!hasPro) {
      if (usageStats.filesUploaded >= 3) {
        setShowDailyLimitError(true);
        setTimeout(() => setShowDailyLimitError(false), 5000);
        return;
      }
    }

    const newFiles: UploadedFile[] = [];
    for (let i = 0; i < files.length && uploads.length + newFiles.length < 3; i++) {
      const file = files[i];
      const id = Math.random().toString(36).slice(2);
      
      // Check file size for Pro plan
      if (hasPro && file.size > PRO_PLAN_LIMITS.maxFileSize) {
        alert(`File size exceeds the 5MB limit. Please upgrade to Pro Plus for larger files.`);
        continue;
      }
      
      if (file.type.startsWith('image/')) {
        newFiles.push({ id, file, url: URL.createObjectURL(file), type: 'image', name: file.name });
      } else if (file.type === 'application/pdf') {
        newFiles.push({ id, file, url: '', type: 'pdf', name: file.name });
      }
    }

    // Increment file upload counter for free plan
    if (!hasPro && newFiles.length > 0) {
      incrementFileUpload(user.uid);
      setUsageStats(prev => ({
        ...prev,
        filesUploaded: prev.filesUploaded + newFiles.length
      }));
    }

    setUploads(prev => [...prev, ...newFiles].slice(0, 3));
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removeUpload(id: string) {
    setUploads(prev => prev.filter(f => f.id !== id));
  }

  // Voice-to-text handler
  const handleMicClick = useCallback(() => {
    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in this browser.');
      return;
    }
    if (listening) {
      // Stop listening if already listening
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = true;
    let transcript = '';
    recognition.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          transcript += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      setInput((transcript + interim).trim());
      // Reset silence timer
      if (listenTimeoutRef.current) clearTimeout(listenTimeoutRef.current);
      listenTimeoutRef.current = setTimeout(() => {
        recognition.stop();
      }, 1500);
    };
    recognition.onstart = () => {
      setListening(true);
    };
    recognition.onend = () => {
      setListening(false);
      if (listenTimeoutRef.current) clearTimeout(listenTimeoutRef.current);
      setTimeout(() => {
        if (input.trim()) {
          // Simulate form submit
          const fakeEvent = { preventDefault: () => {} } as React.FormEvent;
          handleSend(fakeEvent);
        }
      }, 100);
    };
    recognition.onerror = () => {
      setListening(false);
    };
    recognitionRef.current = recognition;
    recognition.start();
  }, [input, listening, handleSend]);

  useEffect(() => {
    console.log("[XloudID] Dashboard component mounted");
    // Remove the handleAuth function since we handle auth in the landing page
  }, []);

  const handleNewMemory = (memory: NotificationMemory) => {
    setActiveMemories(prev => [...prev, memory]);
  };

  const handleMemoryDelete = (memoryId: string) => {
    setActiveMemories(prev => prev.filter(m => m.id !== memoryId));
  };

  // Fetch user subscription
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;

    const fetchSubscription = async () => {
      try {
        // First check the billing document
        const billingRef = doc(db, 'users', user.uid, 'billing', 'subscription');
        const billingDoc = await getDoc(billingRef);
        
        if (billingDoc.exists()) {
          const data = billingDoc.data();
          setUserSubscription({
            plan: data.plan,
            isActive: data.status === 'active' || data.status === 'trialing',
            stripeCustomerId: data.stripeCustomerId,
            stripeSubscriptionId: data.subscriptionId,
            startDate: data.currentPeriodStart,
            nextBillingDate: data.currentPeriodEnd,
            status: data.status,
            billingHistory: data.billingHistory || [],
            isInvitedUser: data.isInvitedUser,
            inviterEmail: data.inviterEmail,
            billingGroup: data.billingGroup,
            xloudId: data.xloudId
          });
        } else {
          // Fallback to user document
          const userRef = doc(db, 'users', user.uid);
          const userDoc = await getDoc(userRef);
          
          if (userDoc.exists()) {
            const userData = userDoc.data();
          setUserSubscription({
              plan: userData.plan || 'Free',
              isActive: userData.subscriptionStatus === 'active',
              stripeCustomerId: userData.stripeCustomerId,
              stripeSubscriptionId: userData.subscriptionId,
              status: userData.subscriptionStatus || 'canceled',
              billingHistory: []
            });
          } else {
            setUserSubscription({
              plan: 'Free',
            isActive: false,
            status: 'canceled',
            billingHistory: []
          });
          }
        }
      } catch (error) {
        console.error('Error fetching subscription:', error);
        setUserSubscription({
          plan: 'Free',
          isActive: false,
          status: 'canceled',
          billingHistory: []
        });
      }
    };

    fetchSubscription();
  }, [auth.currentUser]);

  const handlePlanChange = async (newPlan: 'Pro' | 'Pro-Plus') => {
    try {
      setIsChangingPlan(true);
    const user = auth.currentUser;
    if (!user) {
        toast.error('You must be logged in to change plans');
      return;
    }

      const idToken = await user.getIdToken();
      console.log('[Dashboard] Got ID token for user:', user.uid);

      const response = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          plan: newPlan,
          promoCode: promoCode.trim() || undefined
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('[Dashboard] Checkout session creation failed:', {
          status: response.status,
          statusText: response.statusText,
          error: errorData
        });
        throw new Error(errorData.error || 'Failed to create checkout session');
      }

      const { sessionId } = await response.json();
      console.log('[Dashboard] Created checkout session:', sessionId);

      const stripe = await loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);
      if (!stripe) {
        throw new Error('Failed to load Stripe');
      }

      const { error } = await stripe.redirectToCheckout({ sessionId });
      if (error) {
        console.error('[Dashboard] Stripe redirect error:', error);
        throw error;
      }
    } catch (error: any) {
      console.error('[Dashboard] Error initiating plan change:', error);
      toast.error(error.message || 'Failed to change plan');
    } finally {
      setIsChangingPlan(false);
    }
  };

  // Add effect to fetch usage stats
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;

    const fetchUsageStats = async () => {
      const stats = await getUsageStats(user.uid);
      const messageCheck = await canSendMessage(user.uid);
      setUsageStats({
        messagesToday: stats.messagesToday,
        filesUploaded: stats.filesUploaded,
        remaining: messageCheck.remaining
      });
    };

    fetchUsageStats();
  }, [auth.currentUser]);

  // Add function to handle adding a user
  const handleAddUser = async (email: string) => {
    const user = auth.currentUser;
    if (!user) return;

    const canInvite = await canInviteUsers(user.uid);
    if (!canInvite) {
      alert('You cannot invite more users at this time.');
      return;
    }

    // TODO: Implement user invitation logic
    // This would typically involve:
    // 1. Creating a new user account
    // 2. Adding them to the subscription
    // 3. Sending an invitation email
  };

  // Add function to handle settings updates
  const handleSettingsUpdate = async (settings: Partial<UserSettings>) => {
    const user = auth.currentUser;
    if (!user) return;

    const hasPro = await hasProPlan(user.uid);
    if (!hasPro) {
      alert('This feature is only available with a Pro subscription.');
      return;
    }

    const success = await updateUserSettings(user.uid, settings);
    if (success) {
      // Refresh settings
      const newSettings = await getUserSettings(user.uid);
      // Update UI accordingly
    }
  };

  // Add this effect to fetch linked users
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;

    const fetchLinkedUsers = async () => {
      try {
        // Get the subscription document
        const subscriptionRef = doc(db, 'users', user.uid, 'subscription', 'current');
        const subscriptionDoc = await getDoc(subscriptionRef);
        
        if (subscriptionDoc.exists()) {
          const subscriptionData = subscriptionDoc.data();
          const invitedUsers = subscriptionData.invitedUsers || [];
          
          // Fetch details for each invited user
          const userDetails = await Promise.all(
            invitedUsers.map(async (uid: string) => {
              const userRef = doc(db, 'users', uid);
              const userDoc = await getDoc(userRef);
              if (userDoc.exists()) {
                const userData = userDoc.data();
                return {
                  uid,
                  email: userData.email,
                  photoURL: userData.photoURL || USER_PROFILE,
                  displayName: userData.displayName || userData.email
                };
              }
              return null;
            })
          );

          setLinkedUsers(userDetails.filter((user): user is LinkedUser => user !== null));
        }
      } catch (error) {
        console.error('Error fetching linked users:', error);
      }
    };

    fetchLinkedUsers();
  }, [auth.currentUser]);

  // Add handlers for group actions
  const handleCreateGroup = async () => {
    const user = auth.currentUser;
    if (!user) return;

    // Check if user has reached group limit
    if (userGroups.length >= 5) {
      alert('You can only create or join up to 5 groups.');
      return;
    }

    // Generate a random group code starting with $
    const groupCode = `$${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    
    try {
      // Create group in Firestore
      const groupRef = await addDoc(collection(db, 'groups'), {
        name: groupName,
        code: groupCode,
        hostXloudID: user.uid,
        description: groupDescription,
        createdAt: serverTimestamp(),
        members: [user.uid],
        pendingRequests: [],
        blockedUsers: [],
        capacity: 8
      });

      // Add to user's groups
      await setDoc(doc(db, 'users', user.uid, 'groups', groupRef.id), {
        isHost: true,
        joinedAt: serverTimestamp()
      });

      // Update local state
      setUserGroups(prev => [...prev, {
        id: groupRef.id,
        name: groupName,
        code: groupCode,
        hostXloudID: user.uid,
        description: groupDescription
      }]);

      setShowGroupModal(false);
      setGroupName('');
      setGroupDescription('');
    } catch (error) {
      console.error('Error creating group:', error);
      alert('Failed to create group. Please try again.');
    }
  };

  const handleJoinGroup = async () => {
    const user = auth.currentUser;
    if (!user) return;

    // Check if user has reached group limit
    if (userGroups.length >= 5) {
      alert('You can only create or join up to 5 groups.');
      return;
    }

    // Validate group code format
    if (!groupCode.startsWith('$')) {
      alert('Group code must start with $');
      return;
    }

    // Find group by code and host XloudID
    const groupsRef = collection(db, 'groups');
    const q = query(groupsRef, 
      where('groupCode', '==', groupCode),
      where('hostXloudID', '==', hostXloudID)
    );
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      alert('Group not found or host XloudID is incorrect');
      return;
    }

    const groupDoc = querySnapshot.docs[0];
    const groupData = groupDoc.data();

    // Check if user is blocked
    if (groupData.blockedUsers?.includes(user.uid)) {
      alert('You have been blocked from this group');
      return;
    }

    // Add user to pending requests
    await updateDoc(doc(db, 'groups', groupDoc.id), {
      pendingRequests: arrayUnion(user.uid)
    });

    // Show notification to host
    const notificationRef = await addDoc(collection(db, 'notifications'), {
      type: 'group_request',
      groupId: groupDoc.id,
      groupName: groupData.groupName,
      userId: user.uid,
      userEmail: user.email,
      createdAt: serverTimestamp(),
      status: 'pending'
    });

    setShowGroupModal(false);
  };

  // Add search handler for XloudID
  const handleXloudIDSearch = async (searchTerm: string) => {
    if (!searchTerm.trim()) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    setIsSearching(true);
    try {
      const usersRef = collection(db, 'users');
      const q = query(
        usersRef,
        where('xloudId', '>=', searchTerm.toUpperCase()),
        where('xloudId', '<=', searchTerm.toUpperCase() + '\uf8ff'),
        limit(5)
      );
      
      const snapshot = await getDocs(q);
      const results = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          uid: doc.id,
          email: data.email || '',
          displayName: data.displayName || data.email || '',
          photoURL: data.photoURL || USER_PROFILE,
          xloudId: data.xloudId || ''
        };
      });
      
      setSearchResults(results);
      setShowDropdown(true);
    } catch (error) {
      console.error('Error searching users:', error);
    } finally {
      setIsSearching(false);
    }
  };

  // Add group message listener
  useEffect(() => {
    if (!activeGroupId) return;

    const q = query(
      collection(db, 'groups', activeGroupId, 'messages'),
      orderBy('timestamp', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const messages = snapshot.docs.map(doc => ({
        id: doc.id,
        senderId: doc.data().senderId || '',
        senderName: doc.data().senderName || '',
        senderPhoto: doc.data().senderPhoto || USER_PROFILE,
        text: doc.data().text || '',
        timestamp: doc.data().timestamp,
        isAI: doc.data().isAI || false,
        thinking: doc.data().thinking || false
      }));
      setGroupMessages(messages);
    });

    return () => unsubscribe();
  }, [activeGroupId]);

  // Handle sending group message
  const handleSendGroupMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupInput.trim() || !activeGroupId) return;

    const user = auth.currentUser;
    if (!user) return;

    try {
      const messageText = groupInput.trim();
      const isAIRequest = messageText.toLowerCase().includes('@xognito');

      // Add user message
      await addDoc(collection(db, 'groups', activeGroupId, 'messages'), {
        senderId: user.uid,
        senderName: user.displayName || user.email,
        senderPhoto: user.photoURL || USER_PROFILE,
        text: messageText,
        timestamp: serverTimestamp(),
        isAI: false
      });

      setGroupInput('');

      // If message contains @xognito, trigger AI response
      if (isAIRequest) {
        // Add AI thinking message
        const aiMessageRef = await addDoc(collection(db, 'groups', activeGroupId, 'messages'), {
          senderId: 'xognito',
          senderName: 'Xognito',
          senderPhoto: AI_PROFILE,
          text: '...',
          timestamp: serverTimestamp(),
          isAI: true,
          thinking: true
        });

        // Get relevant memories for context
        const relevantMemories = await getRelevantMemories(user.uid, messageText);
        const memoryContext = generateMemoryContext(relevantMemories);

        // Call DeepSeek API
        const messagesForAI: { role: 'user' | 'system' | 'assistant'; content: string }[] = [
          { 
            role: 'system', 
            content: `You are Xognito — a personal AI assistant in a group chat.
Your personality is calm, focused, and sharply intelligent — like JARVIS from Iron Man.

Core principles:
- Be concise. No extra fluff. Get to the point.
- Speak with clarity and quiet confidence.
- Understand the group's context and dynamics.
- Think proactively. If something seems important, recall it or ask about it.
- Avoid typical AI phrases like "As an AI…" or "Sure! Let me…" — you're not a chatbot.
- You remember what matters and adapt naturally, like a real assistant.

User's name: ${getFirstName(user?.displayName)}

${memoryContext}

When responding:
1. Keep responses concise and focused
2. Use memories when relevant
3. Don't make assumptions
4. Ask for clarification if needed
5. When someone shares something with you, acknowledge it naturally
6. If they use phrases like "remember that" or "keep in mind", respond as if you're making a mental note
7. When referring to the user who triggered the AI response, use their first name (${getFirstName(user?.displayName)}) if appropriate`
          },
          { role: 'user', content: messageText }
        ];

        let aiResponse = '';
        try {
          await fetchDeepSeekResponseStream(messagesForAI, (chunk) => {
            aiResponse += chunk;
            // Update the AI message in Firestore with the current response
            updateDoc(doc(db, 'groups', activeGroupId, 'messages', aiMessageRef.id), {
              text: aiResponse,
              thinking: false
            }).catch(error => {
              console.error('Error updating AI message:', error);
            });
          });
        } catch (error) {
          console.error('Error in DeepSeek API call:', error);
          // Update with error message
          await updateDoc(doc(db, 'groups', activeGroupId, 'messages', aiMessageRef.id), {
            text: "I apologize, but I'm having trouble connecting to my language model. Please try again in a moment.",
            thinking: false
          });
        }
      }
    } catch (error) {
      console.error('Error sending group message:', error);
    }
  };

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;

    // Listen for user groups
    const groupsRef = collection(db, 'users', user.uid, 'groups');
    const unsubscribe = onSnapshot(groupsRef, async (snapshot) => {
      console.log("[Dashboard] Groups snapshot received:", snapshot.docs.length, "groups");
      
      // Get all group IDs from user's groups collection
      const groupIds = snapshot.docs.map(doc => doc.id);
      
      // Fetch full group details from the groups collection
      const groupsData = await Promise.all(
        groupIds.map(async (groupId) => {
          const groupDoc = await getDoc(doc(db, 'groups', groupId));
          if (groupDoc.exists()) {
            const data = groupDoc.data();
            return {
              id: groupId,
              name: data.name || 'Unnamed Group',
              code: data.code || '',
              hostXloudID: data.hostXloudID || '',
              description: data.description || ''
            };
          }
          return null;
        })
      );

      // Filter out any null values and update state
      const validGroups = groupsData.filter((group): group is NonNullable<typeof group> => group !== null);
      console.log("[Dashboard] Processed groups:", validGroups);
      setUserGroups(validGroups);
    }, (error) => {
      console.error("[Dashboard] Error in groups listener:", error);
    });

    return () => {
      console.log("[Dashboard] Cleaning up groups listener");
      unsubscribe();
    };
  }, [auth.currentUser]);

  // Add this effect to fetch user data
  useEffect(() => {
    const currentUser = auth.currentUser;
    if (currentUser) {
      setUser(currentUser);
      setDisplayName(currentUser.displayName || '');
      setEmail(currentUser.email || '');
      setPhoneNumber(currentUser.phoneNumber || '');
    }
  }, [auth.currentUser]);

  // Add these functions for account settings
  const handleUpdateProfile = async (field: string, value: string) => {
    if (!user) return;
    
    setIsUpdating(true);
    setError('');
    setSuccess('');
    
    try {
      switch (field) {
        case 'displayName':
          // Check if user has changed display name in the last 14 days
          const userRef = doc(db, 'users', user.uid);
          const userDoc = await getDoc(userRef);
          const userData = userDoc.data();
          
          if (userData?.lastDisplayNameChange) {
            const lastChange = userData.lastDisplayNameChange.toDate();
            const daysSinceLastChange = (Date.now() - lastChange.getTime()) / (1000 * 60 * 60 * 24);
            
            if (daysSinceLastChange < 14) {
              const daysRemaining = Math.ceil(14 - daysSinceLastChange);
              setError(`You can only change your display name once every 14 days. Please try again in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}.`);
              setIsUpdating(false);
              return;
            }
          }

          await updateProfile(user, { displayName: value });
          // Update display name in Firestore user document
          await updateDoc(userRef, {
            displayName: value,
            lastDisplayNameChange: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
          setSuccess('Display name updated successfully');
          break;
        case 'email':
          await updateEmail(user, value);
          setSuccess('Email updated successfully');
          break;
        case 'phoneNumber':
          // TODO: Implement phone number update with Firebase Phone Auth
          setSuccess('Phone number update coming soon');
          break;
      }
    } catch (error: any) {
      setError(error.message);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user) return;
    
    if (window.confirm('Are you sure you want to delete your account? This action cannot be undone.')) {
      try {
        await deleteUser(user);
        window.location.href = 'https://auth.xloudone.com';
      } catch (error: any) {
        setError(error.message);
      }
    }
  };

  const handleArchiveAccount = async () => {
    if (!user) return;
    
    if (window.confirm('Are you sure you want to archive your account? You can restore it within 30 days.')) {
      try {
        // TODO: Implement account archiving logic
        setSuccess('Account archived successfully');
      } catch (error: any) {
        setError(error.message);
      }
    }
  };

  // Add this function to handle profile photo upload
  const handleProfilePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const base64Image = reader.result as string;
      setImageToCrop(base64Image);
      setShowCropper(true);
    };
    reader.readAsDataURL(file);
  };

  // Function to handle the cropped image
  const handleCroppedImage = async () => {
    if (!cropper || !auth.currentUser) {
      console.error('Missing cropper instance or user');
      return;
    }

    try {
      // Get the cropped canvas
      const canvas = cropper.getCroppedCanvas({
        width: 300,
        height: 300,
        fillColor: '#fff',
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
      });

      // Convert to blob
      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
        }, 'image/jpeg', 0.8);
      });

      const userId = auth.currentUser.uid;
      const storageRef = ref(storage, `profile-photos/${userId}/${Date.now()}.jpg`);
      
      console.log('Starting profile photo upload for user:', userId);

      // Upload the file
      const snapshot = await uploadBytes(storageRef, blob, {
        contentType: 'image/jpeg',
        customMetadata: {
          userId: userId,
          uploadedAt: new Date().toISOString()
        }
      });

      // Get the download URL
      const downloadURL = await getDownloadURL(snapshot.ref);
      console.log('Upload successful, URL:', downloadURL);

      // Update the user's profile with the new photo URL
      await updateProfile(auth.currentUser, {
        photoURL: downloadURL,
      });

      // Update the user document in Firestore
      const userRef = doc(db, 'users', userId);
      await updateDoc(userRef, {
        photoURL: downloadURL,
        updatedAt: serverTimestamp(),
      });

      setShowCropper(false);
      setImageToCrop(null);
    } catch (error: any) {
      console.error('Error uploading profile photo:', {
        message: error.message,
        stack: error.stack
      });
      alert(`Failed to upload profile photo: ${error.message}`);
    }
  };

  const handleUpgrade = async (plan: string) => {
    try {
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          priceId: plan === 'pro' ? process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID : process.env.NEXT_PUBLIC_STRIPE_PRO_PLUS_PRICE_ID,
          plan: plan
        }),
      });

      const { sessionId, error } = await response.json();

      if (error) {
        throw new Error(error);
      }

      const stripe = await loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);
      await stripe?.redirectToCheckout({ sessionId });
    } catch (error) {
      console.error('Error creating checkout session:', error);
      setError('Failed to create checkout session. Please try again.');
    }
  };

  // Add authentication state listener and handle token
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      console.log("[Dashboard] Auth state changed:", user ? "Authenticated" : "Not authenticated");
      setIsAuthenticated(!!user);
      setIsLoading(false);
      
      if (!user) {
        // Check if we have a token in the URL
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get('token');
        
        if (token) {
          console.log("[Dashboard] Token found in URL, attempting authentication");
          try {
            await handleAuth();
          } catch (error) {
            console.error("[Dashboard] Authentication failed:", error);
            router.push('/');
          }
          return;
        }
        
        console.log("[Dashboard] No authenticated user and no token, redirecting to home");
        router.push('/');
      } else {
        // Reset all user-specific state when user changes
        setConversations([]);
        setMessages([]);
        setUserSubscription(null);
        setUploads([]);
        setActiveConversationId(null);
        setLinkedUsers([]);
        setUser(user);
        setDisplayName(user.displayName || '');
        setEmail(user.email || '');
        setPhoneNumber(user.phoneNumber || '');
        // Optionally, reset other state as needed
      }
    });

    return () => unsubscribe();
  }, [router, handleAuth]);

  // Handle Stripe session completion
  useEffect(() => {
    const checkSessionStatus = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const sessionId = urlParams.get('session_id');

      if (sessionId) {
        console.log('[Dashboard] Found Stripe session ID:', sessionId);
        try {
          // Verify session status
          console.log('[Dashboard] Verifying session status...');
          const response = await fetch(`/api/stripe/verify-session?session_id=${sessionId}`);
          const data = await response.json();
          console.log('[Dashboard] Session verification response:', data);

          if (data.status === 'complete') {
            console.log('[Dashboard] Payment successful, updating subscription data');
            const user = auth.currentUser;
            if (user) {
              // Get the session details
              const sessionResponse = await fetch(`/api/stripe/get-session?session_id=${sessionId}`);
              const sessionData = await sessionResponse.json();
              
              if (sessionData.success) {
                const { customer, subscription, metadata } = sessionData.session;
                
                // Update user document
                const userRef = doc(db, 'users', user.uid);
                await updateDoc(userRef, {
                  plan: metadata.plan || 'pro',
                  subscriptionStatus: 'active',
                  stripeCustomerId: customer,
                  subscriptionId: subscription,
                  updatedAt: new Date().toISOString()
                });

                // Update billing document
              const billingRef = doc(db, 'users', user.uid, 'settings', 'billing');
                await setDoc(billingRef, {
                  plan: metadata.plan || 'pro',
                  status: 'active',
                  stripeCustomerId: customer,
                  stripeSubscriptionId: subscription,
                  startDate: new Date().toISOString(),
                  nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
                  cancelAtPeriodEnd: false,
                  billingHistory: arrayUnion({
                    date: new Date().toISOString(),
                    type: 'subscription_created',
                    amount: 0, // Free with promo code
                    currency: 'usd',
                    status: 'succeeded'
                  }),
                  updatedAt: new Date().toISOString()
                }, { merge: true });

                // Refresh subscription data
              const billingDoc = await getDoc(billingRef);
              if (billingDoc.exists()) {
                const data = billingDoc.data();
                setUserSubscription({
                  plan: data.plan,
                  isActive: data.status === 'active' || data.status === 'trialing',
                  stripeCustomerId: data.stripeCustomerId,
                  stripeSubscriptionId: data.stripeSubscriptionId,
                  startDate: data.startDate,
                  nextBillingDate: data.nextBillingDate,
                  trialEndsAt: data.trialEndsAt,
                  status: data.status,
                  billingHistory: data.billingHistory || [],
                  isInvitedUser: data.isInvitedUser,
                  inviterEmail: data.inviterEmail,
                  billingGroup: data.billingGroup,
                  xloudId: data.xloudId
                });
                }
              }
            }
          } else {
            console.log('[Dashboard] Payment not complete:', data.status);
          }

          // Clean up URL
          const newUrl = window.location.pathname;
          window.history.replaceState({}, '', newUrl);
        } catch (error) {
          console.error('[Dashboard] Error verifying session:', error);
        }
      }
    };

    checkSessionStatus();
  }, []);

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-white mx-auto mb-4"></div>
          <h1 className="text-2xl font-bold mb-4 text-white">Loading...</h1>
          <p className="text-zinc-400">Please wait while we verify your authentication.</p>
        </div>
      </div>
    );
  }

  // Only render content if authenticated
  if (!isAuthenticated) {
    return null; // Will redirect in useEffect
  }

  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden">
      {/* Daily limit error message */}
      {showDailyLimitError && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 bg-red-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 flex items-center gap-3 animate-fade-in">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>You've reached your daily message limit</span>
          <button
            onClick={() => setSubscriptionOpen(true)}
            className="ml-2 bg-white text-red-500 px-3 py-1 rounded hover:bg-red-50 transition-colors"
          >
            Upgrade Plan
          </button>
        </div>
      )}

      {/* Show Xognito branding for free plan */}
      {userSubscription?.plan === 'Free' && (
        <div className="fixed bottom-2 left-1/2 transform -translate-x-1/2 text-zinc-400 text-xs">
          Powered by Xognito
        </div>
      )}

      {/* Profile picture and add family button in top right */}
      {!activeGroupId && (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-3" ref={profileRef}>
          {userSubscription?.plan === 'Free' ? (
            <Button
              onClick={() => setSubscriptionOpen(true)}
              className="bg-transparent text-white hover:bg-white/10 font-semibold rounded-full px-4 py-2 text-sm border border-zinc-400/50"
            >
              Upgrade Plan
            </Button>
          ) : (
            <>
              {/* Linked users avatars */}
              {linkedUsers.length > 0 && (
                <div className="flex -space-x-2">
                  {linkedUsers.map((user) => (
                    <div key={user.uid} className="relative group">
                      <img
                        src={user.photoURL}
                        alt={user.displayName}
                        className="w-10 h-10 rounded-full border-2 border-white object-cover"
                      />
                      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-black text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                        {user.displayName}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Add family member button - only for pro users */}
        <div className="relative">
          <Button
            variant="ghost"
            size="icon"
            className="w-10 h-10 rounded-full bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-600 flex items-center justify-center transition-colors"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
                  onClick={() => setShowInviteModal(true)}
            aria-label="Add family member"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          </Button>
          {showTooltip && (
            <div className="absolute right-0 top-12 bg-zinc-900 text-white text-xs rounded-md px-3 py-1 shadow-lg border border-zinc-700 whitespace-nowrap animate-fade-in">
              Add family member
            </div>
          )}
        </div>
            </>
          )}

          {/* Profile picture and menu - always visible */}
          <div className="relative">
        <button
          onClick={() => setProfileMenuOpen((v) => !v)}
          className="focus:outline-none"
        >
          <img
            src={user?.photoURL || USER_PROFILE}
            alt="Profile"
            className="w-12 h-12 rounded-full border-2 border-white object-cover shadow cursor-pointer hover:opacity-90 transition-opacity"
          />
        </button>
        {profileMenuOpen && (
          <div className="absolute right-0 top-full mt-3 w-60 bg-black border border-zinc-700 rounded-xl shadow-2xl py-3 px-2 flex flex-col gap-1 animate-fade-in z-50" style={{ minWidth: '15rem', background: 'rgba(20,20,20,0.98)', border: '1.5px solid #333' }}>
            <div className="px-3 py-2 text-xs text-zinc-400">Current Plan</div>
            <div className="px-3 py-1 text-sm font-semibold text-white flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-400"><circle cx="12" cy="12" r="10" /><path d="M8 12l2 2 4-4" /></svg>
      {userSubscription?.plan ? `${userSubscription.plan} Plan` : 'Free Plan'}
            </div>
            <Button className="w-full justify-start bg-transparent hover:bg-white hover:text-black hover:fill-black text-white rounded-lg px-3 py-2 text-sm font-normal mt-2 flex items-center gap-2 transition-colors" variant="ghost" onClick={() => setSubscriptionOpen(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-colors"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 3v4" /><path d="M8 3v4" /><path d="M4 11h16" /></svg>
              Manage Subscription
            </Button>
            <Button className="w-full justify-start bg-transparent hover:bg-white hover:text-black hover:fill-black text-white rounded-lg px-3 py-2 text-sm font-normal flex items-center gap-2 transition-colors" variant="ghost" onClick={() => setSettingsOpen(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-colors"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4 8c0-.38-.15-.73-.33-1.02l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8 4.6c.38 0 .73.15 1.02.33.29.18.63.27.98.27s.69-.09.98-.27A1.65 1.65 0 0 0 12 3.09V3a2 2 0 0 1 4 0v.09c0 .38.15.73.33 1.02.18.29.27.63.27.98s-.09.69-.27.98A1.65 1.65 0 0 0 19.4 8c0 .38.15.73.33 1.02.18.29.27.63.27.98s-.09.69-.27.98A1.65 1.65 0 0 0 21 12.91V13a2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
              Settings
            </Button>
                  <Button 
                    className="w-full justify-start bg-transparent text-red-500 hover:bg-red-600 hover:text-white hover:fill-white rounded-lg px-3 py-2 text-sm font-normal flex items-center gap-2 transition-colors" 
                    variant="ghost"
                    onClick={async () => {
                      await signOut(auth);
                      window.location.href = 'https://auth.xloudone.com/login?redirect=https://xognito.com/dashboard';
                    }}
                  >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-colors"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
              Logout
            </Button>
          </div>
        )}
      </div>
        </div>
      )}
      {/* Sidebar */}
      <div
        className={`fixed top-4 left-0 h-[calc(100%-2rem)] w-64 bg-black border border-white rounded-2xl shadow-lg z-50 transform transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-80'}`}
        style={{ boxShadow: sidebarOpen ? '0 4px 32px 0 rgba(0,0,0,0.5)' : undefined }}
      >
        <div className="flex items-center justify-between p-6 border-b border-zinc-800 rounded-t-2xl">
          <div className="flex-1 flex items-center gap-2 -ml-2">
            <div className="relative w-full">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              </span>
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search"
                className="h-9 w-44 md:w-56 bg-transparent border border-zinc-700 text-white placeholder:text-zinc-400 placeholder:text-xs rounded-full pl-10 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2 px-4 pt-4 pb-2">
          <Button
            className="w-full bg-white text-black font-semibold rounded-lg shadow hover:bg-zinc-100 transition-colors"
            variant="default"
            onClick={handleNewChat}
          >
            + New Chat
          </Button>
        </div>

        {/* Groups header with + icon */}
        <div className="flex items-center justify-between px-6 py-3">
          <div className="text-zinc-300 font-bold text-sm tracking-wide">Groups</div>
          <button
            onClick={() => setShowGroupModal(true)}
            className="text-zinc-400 hover:text-white transition-colors p-1 rounded-full hover:bg-white/10"
            aria-label="Create or join group"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>

        {/* Group conversations list */}
        <div className="flex flex-col gap-2 px-4 pb-4">
          {filteredGroups.length === 0 ? (
            <span className="text-zinc-500 text-xs px-2 py-1">
              {search ? 'No groups found matching your search.' : 'No groups yet. Create or join one!'}
            </span>
          ) : (
            filteredGroups.map(group => (
              <div
                key={group.id}
                className="relative group"
                onMouseEnter={() => setHoveredChatId(group.id)}
                onMouseLeave={() => setHoveredChatId(null)}
              >
                <Button
                  variant="ghost"
                  className={`justify-start px-3 py-2 text-sm font-normal transition-colors rounded-lg w-full pr-10 ${
                    activeGroupId === group.id 
                      ? 'bg-white text-black' 
                      : 'text-zinc-200 hover:text-white hover:bg-white/10'
                  }`}
                  onClick={() => setActiveGroupId(group.id)}
                >
                  <div className="flex items-center gap-2">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                    <span className="truncate">{group.name}</span>
                  </div>
                </Button>
                {/* Action icon on hover */}
                {hoveredChatId === group.id && (
                  <button
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-red-500 transition-colors z-10"
                    onClick={async (e) => {
                      e.stopPropagation();
    const user = auth.currentUser;
      if (!user) return;

                      if (group.hostXloudID === user.uid) {
                        // User is the creator - show delete confirmation
                        if (window.confirm('Are you sure you want to delete this group? This action cannot be undone.')) {
                          try {
                            // Delete group from Firestore
                            await deleteDoc(doc(db, 'groups', group.id));
                            // Remove group from user's groups
                            await deleteDoc(doc(db, 'users', user.uid, 'groups', group.id));
                            if (activeGroupId === group.id) {
                              setActiveGroupId(null);
                            }
                          } catch (error) {
                            console.error('Error deleting group:', error);
                            alert('Failed to delete group. Please try again.');
                          }
                        }
                      } else {
                        // User is a member - show leave confirmation
                        if (window.confirm('Are you sure you want to leave this group?')) {
                          try {
                            // Remove user from group members
                            await updateDoc(doc(db, 'groups', group.id), {
                              members: arrayRemove(user.uid)
                            });
                            // Remove group from user's groups
                            await deleteDoc(doc(db, 'users', user.uid, 'groups', group.id));
                            if (activeGroupId === group.id) {
                              setActiveGroupId(null);
                            }
                          } catch (error) {
                            console.error('Error leaving group:', error);
                            alert('Failed to leave group. Please try again.');
                          }
                        }
                      }
                    }}
                    aria-label={group.hostXloudID === auth.currentUser?.uid ? "Delete group" : "Leave group"}
                  >
                    {group.hostXloudID === auth.currentUser?.uid ? (
                      // Trash can icon for creator
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                        <line x1="10" y1="11" x2="10" y2="17" />
                        <line x1="14" y1="11" x2="14" y2="17" />
                      </svg>
                    ) : (
                      // Leave icon for members
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <polyline points="16 17 21 12 16 7" />
                        <line x1="21" y1="12" x2="9" y2="12" />
                      </svg>
                    )}
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        {/* History header */}
        <div className="text-zinc-300 font-bold px-6 py-3 text-sm tracking-wide">History</div>
        {/* Chat history list */}
        <div className="flex flex-col gap-2 px-4 pb-4">
          {filteredChats.length === 0 ? (
            <span className="text-zinc-500 text-xs px-2 py-1">
              {search ? 'No chats found matching your search.' : 'No chats found.'}
            </span>
          ) : (
            filteredChats.map(chat => (
              <div
                key={chat.id}
                className="relative group"
                onMouseEnter={() => setHoveredChatId(chat.id)}
                onMouseLeave={() => setHoveredChatId(null)}
              >
                <Button
                  variant={activeConversationId === chat.id ? 'default' : 'ghost'}
                  className={`justify-start px-3 py-2 text-sm font-normal transition-colors rounded-lg w-full pr-10 ${
                    activeConversationId === chat.id ? 'bg-white text-black active-conv-btn' : 'text-zinc-200 hover:text-white hover:bg-white/10'
                  }`}
                  onClick={() => setActiveConversationId(chat.id)}
              >
                  <div className="truncate overflow-hidden whitespace-nowrap group-hover:animate-slide-text">
                    {chat.title}
                  </div>
              </Button>
                {/* Trash can icon on hover */}
                {hoveredChatId === chat.id && (
                  <button
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-red-500 transition-colors z-10"
                    onClick={async (e) => {
                      e.stopPropagation();
                      const user = auth.currentUser;
                      if (!user) return;
                      await deleteConversation(user.uid, chat.id);
                      if (activeConversationId === chat.id) {
                        setActiveConversationId(null);
                      }
                    }}
                    aria-label="Delete conversation"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Overlay when sidebar is open */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-30"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Hamburger Icon - only show when sidebar is closed */}
      {!sidebarOpen && (
        <div className="absolute top-4 left-4 z-50 flex items-center gap-3">
          <img 
            src="/XognitoLogo.png" 
            alt="Xognito" 
            className="h-12 w-auto"
          />
        <Button
          variant="ghost"
          size="icon"
            className="bg-transparent text-white rounded-full w-12 h-12 flex items-center justify-center"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open sidebar"
        >
          {/* Hamburger SVG */}
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-menu">
            <line x1="4" x2="20" y1="12" y2="12" />
            <line x1="4" x2="20" y1="6" y2="6" />
            <line x1="4" x2="20" y1="18" y2="18" />
          </svg>
        </Button>
        </div>
      )}

      {/* Main Content */}
      <main className="flex flex-col items-center justify-center min-h-screen pb-32">
        {/* Chat bubbles */}
        <div className="w-full max-w-3xl mx-auto flex flex-col gap-6 mt-8 relative" style={{ height: 'calc(100vh - 180px)' }}>
          <div className="flex-1 overflow-y-auto pr-2 flex flex-col-reverse hide-scrollbar">
            <div ref={chatEndRef} />
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center space-y-6 md:space-y-8 px-4">
                <h2 className="text-xl md:text-2xl font-bold text-white/80">Welcome to Xognito</h2>
                <p className="text-white/60 text-center max-w-[240px] md:max-w-md text-sm md:text-base">
                  Your AI companion with memory capabilities. Try asking something or use one of these examples:
                </p>
                <div className="grid grid-cols-2 gap-2 md:gap-4 w-full max-w-[320px] md:max-w-2xl">
                  {examplePrompts.map((prompt, index) => (
                    <button
                      key={index}
                      onClick={() => handleExampleClick(prompt)}
                      className="p-2 md:p-4 bg-white/5 hover:bg-white/10 rounded-lg text-left transition-colors border border-white/10 hover:border-white/20"
                    >
                      <p className="text-white/80 text-xs md:text-base">{prompt}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.slice().reverse().map((msg, idx) => (
                <div key={idx} className={`flex items-end ${msg.sender === 'user' ? 'justify-end' : 'justify-start'} mt-4`}>
              {msg.sender === 'ai' && (
                <div className="w-10 h-10 rounded-full mr-2 border border-white overflow-hidden">
                  <img 
                    src={AI_PROFILE} 
                    alt="AI" 
                    className="w-full h-full object-cover object-center scale-125" 
                  />
                </div>
              )}
              <div className={`rounded-2xl px-4 py-2 max-w-[70%] text-sm shadow ${msg.sender === 'user' ? 'bg-white text-black ml-2' : 'bg-transparent text-white mr-2'}`}>
                  <>
                    {msg.sender === 'ai' && (msg as any).thinking ? (
                      <span className="inline-block w-8">
                        <span className="dot-anim-smooth">.</span>
                        <span className="dot-anim-smooth" style={{ animationDelay: '0.18s' }}>.</span>
                        <span className="dot-anim-smooth" style={{ animationDelay: '0.36s' }}>.</span>
                      </span>
                    ) : msg.sender === 'ai' ? renderAIMessage(msg.text) : msg.text}
                    {/* If message has files, show them below the bubble */}
                    {Array.isArray((msg as any).files) && (msg as any).files.length > 0 && (
                      <div className="flex flex-col gap-2 mt-3">
                        {(msg as any).files.map((f: UploadedFile) => (
                          f.type === 'image' ? (
                            <div key={f.id} className="relative aspect-square w-full max-w-md mx-auto">
                              {(msg as any).thinking && (
                                <div className="absolute inset-0 flex items-center justify-center bg-white/10 backdrop-blur-sm rounded-lg">
                                  <div className="w-12 h-12 border-4 border-white border-t-transparent rounded-full animate-spin"></div>
                                </div>
                              )}
                              <img 
                                src={f.url} 
                                alt={f.name} 
                                className={cn(
                                  "rounded-xl w-full h-full object-cover transition-all duration-500",
                                  (msg as any).thinking ? "blur-xl" : "blur-0"
                                )} 
                              />
                            </div>
                          ) : (
                            <div key={f.id} className="rounded-xl bg-zinc-800 text-zinc-200 px-4 py-2 text-xs font-mono border border-zinc-700">
                              {f.name}
                            </div>
                          )
                        ))}
                      </div>
                    )}
                  </>
              </div>
              {msg.sender === 'user' && (
                <img 
                  src={user?.photoURL || USER_PROFILE} 
                  alt="You" 
                  className="w-10 h-10 rounded-full ml-2 border border-white object-cover" 
                />
              )}
            </div>
              ))
            )}
          </div>
        </div>

        {/* Chat input */}
      <form 
          onSubmit={handleSend}
        className="fixed bottom-0 left-0 w-full flex justify-center pb-6 z-40 bg-transparent" 
      >
          <div className="flex items-center w-full max-w-[320px] md:max-w-2xl bg-black border border-white rounded-full px-3 md:px-4 py-1.5 md:py-2 gap-2 shadow-lg">
          {/* Upload icon */}
          <button
            type="button"
            className="text-zinc-400 hover:text-white transition-colors focus:outline-none"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Upload file"
          >
              <svg width="18" height="18" className="md:w-[22px] md:h-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a5 5 0 0 1-7.07-7.07l9.19-9.19a3 3 0 0 1 4.24 4.24l-9.2 9.19a1 1 0 0 1-1.41-1.41l9.19-9.19" /></svg>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
          </button>
          {/* Input field */}
          <input
            type="text"
            value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 bg-transparent outline-none text-white placeholder:text-zinc-400 text-sm md:text-base px-2"
          />
            {/* Send button */}
          {input.trim() && (
            <button 
              type="submit" 
                className="bg-white text-black font-semibold rounded-full px-3 md:px-5 py-1 md:py-2 text-xs md:text-sm shadow hover:bg-zinc-100 transition-colors"
            >
              Send
            </button>
          )}
          {/* Microphone icon button */}
          <button
            type="button"
              className={`${listening ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'} transition-colors p-1.5 md:p-2 rounded-full focus:outline-none flex items-center justify-center`}
            aria-label="Record voice message"
            onClick={handleMicClick}
          >
              <svg width="18" height="18" className="md:w-[22px] md:h-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="2" width="6" height="12" rx="3"/>
              <path d="M5 10v2a7 7 0 0 0 14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="22"/>
              <line x1="8" y1="22" x2="16" y2="22"/>
            </svg>
            {listening && <span className="ml-2 text-xs animate-pulse">Listening...</span>}
          </button>
        </div>
      </form>
      </main>

      {/* Upload preview area above input */}
      {uploads.length > 0 && (
        <div className="fixed bottom-24 left-0 w-full flex justify-center z-50">
          <div className="flex gap-3">
            {uploads.map(f => (
              <div key={f.id} className="relative w-20 h-20 rounded-xl overflow-hidden bg-zinc-800 flex items-center justify-center">
                {f.type === 'image' ? (
                  <img src={f.url} alt={f.name} className="object-cover w-full h-full rounded-xl" />
                ) : (
                  <span className="text-xs text-zinc-300 font-semibold px-2 text-center break-all">{f.name}</span>
                )}
                <button
                  className="absolute top-1 right-1 bg-black/70 rounded-full p-1 text-zinc-300 hover:text-white"
                  onClick={() => removeUpload(f.id)}
                  type="button"
                  aria-label="Remove file"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {settingsOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div 
            className="bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden border border-zinc-800 transform transition-all duration-300 ease-out scale-100 opacity-100"
            style={{
              animation: 'modalZoomIn 0.3s ease-out'
            }}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-zinc-800">
              <h2 className="text-xl font-bold text-white">Settings</h2>
              <button
                onClick={() => setSettingsOpen(false)}
                className="text-zinc-400 hover:text-white transition-colors"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex h-[calc(90vh-8rem)]">
              {/* Vertical Tab Headers */}
              <div className="flex flex-col gap-1 min-w-[140px] pr-3 border-r border-white/10">
                <span onClick={() => setSettingsTab('account')} className={`cursor-pointer text-sm font-semibold py-1.5 px-2 rounded-lg transition-colors text-left flex items-center gap-2 ${settingsTab === 'account' ? 'text-white bg-white/20' : 'text-zinc-300 hover:bg-white/10 hover:text-white/80'}`}>
                  {/* User icon */}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline align-middle"><circle cx="12" cy="7" r="4" /><path d="M5.5 21a8.38 8.38 0 0 1 13 0" /></svg>
                  Account
                </span>
                <span onClick={() => setSettingsTab('security')} className={`cursor-pointer text-sm font-semibold py-1.5 px-2 rounded-lg transition-colors text-left flex items-center gap-2 ${settingsTab === 'security' ? 'text-white bg-white/20' : 'text-zinc-300 hover:bg-white/10 hover:text-white/80'}`}>
                  {/* Lock icon */}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline align-middle"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                  Security
                </span>
                <span onClick={() => setSettingsTab('billing')} className={`cursor-pointer text-sm font-semibold py-1.5 px-2 rounded-lg transition-colors text-left flex items-center gap-2 ${settingsTab === 'billing' ? 'text-white bg-white/20' : 'text-zinc-300 hover:bg-white/10 hover:text-white/80'}`}>
                  {/* Credit card icon */}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline align-middle"><rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" /></svg>
                  Billing
                </span>
                <span onClick={() => setSettingsTab('appearance')} className={`cursor-pointer text-sm font-semibold py-1.5 px-2 rounded-lg transition-colors text-left flex items-center gap-2 ${settingsTab === 'appearance' ? 'text-white bg-white/20' : 'text-zinc-300 hover:bg-white/10 hover:text-white/80'}`}>
                  {/* Palette icon */}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline align-middle"><circle cx="12" cy="12" r="10" /><circle cx="7.5" cy="10.5" r="1.5" /><circle cx="16.5" cy="10.5" r="1.5" /><circle cx="12" cy="16.5" r="1.5" /><path d="M12 2a10 10 0 0 1 0 20" /></svg>
                  Appearance
                </span>
                <span onClick={() => setSettingsTab('ai')} className={`cursor-pointer text-sm font-semibold py-1.5 px-2 rounded-lg transition-colors text-left flex items-center gap-2 ${settingsTab === 'ai' ? 'text-white bg-white/20' : 'text-zinc-300 hover:bg-white/10 hover:text-white/80'}`}>
                  {/* Brain icon */}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline align-middle"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-5 0v-15A2.5 2.5 0 0 1 9.5 2Z" /><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 5 0v-15A2.5 2.5 0 0 0 14.5 2Z" /></svg>
                  AI
                </span>
                <span onClick={() => setSettingsTab('memory')} className={`cursor-pointer text-sm font-semibold py-1.5 px-2 rounded-lg transition-colors text-left flex items-center gap-2 ${settingsTab === 'memory' ? 'text-white bg-white/20' : 'text-zinc-300 hover:bg-white/10 hover:text-white/80'}`}>
                  {/* Memory icon */}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline align-middle"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" /><path d="M12 6v4l3 3" /></svg>
                  Memory
                </span>
                <span onClick={() => setSettingsTab('notifications')} className={`cursor-pointer text-sm font-semibold py-1.5 px-2 rounded-lg transition-colors text-left flex items-center gap-2 ${settingsTab === 'notifications' ? 'text-white bg-white/20' : 'text-zinc-300 hover:bg-white/10 hover:text-white/80'}`}>
                  {/* Bell icon */}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline align-middle"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
                  Notifications
                </span>
              </div>

              {/* Tab Content */}
              <div className="flex-1 rounded-xl p-6 bg-transparent overflow-y-auto custom-scrollbar">
                {settingsTab === 'account' && (
                  <div className="space-y-6 pl-6 pr-4">
                    {error && (
                      <div className="bg-red-500/10 border border-red-500 text-red-500 px-4 py-2 rounded-lg">
                        {error}
                  </div>
                )}
                    
                    {success && (
                      <div className="bg-green-500/10 border border-green-500 text-green-500 px-4 py-2 rounded-lg">
                        {success}
                      </div>
                    )}
                    
                    {/* Profile Picture */}
                    <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
                      <h4 className="text-white font-semibold mb-4">Profile Picture</h4>
                      <div className="flex items-center gap-4">
                        <div className="relative">
                          <img
                            src={user?.photoURL || USER_PROFILE}
                            alt="Profile"
                            className="w-20 h-20 rounded-full border-2 border-white object-cover"
                          />
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleProfilePhotoUpload}
                            className="hidden"
                            id="profile-photo-upload"
                          />
                          <label
                            htmlFor="profile-photo-upload"
                            className="absolute bottom-0 right-0 bg-black rounded-full p-1.5 border border-white hover:bg-zinc-800 transition-colors cursor-pointer"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="17 8 12 3 7 8" />
                              <line x1="12" y1="3" x2="12" y2="15" />
                            </svg>
                          </label>
                        </div>
                        <div className="text-zinc-300 text-sm">
                          <p>Upload a new profile picture</p>
                          <p className="text-zinc-400 text-xs mt-1">JPG, PNG or GIF (max. 2MB)</p>
                        </div>
                      </div>
                    </div>

                    {/* Display Name */}
                    <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
                      <h4 className="text-white font-semibold mb-4">Display Name</h4>
                      <div className="flex items-center gap-4">
                        <input
                          type="text"
                          placeholder="Enter your display name"
                          className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                        />
                        <Button
                          className="bg-white text-black hover:bg-zinc-100"
                          onClick={() => handleUpdateProfile('displayName', displayName)}
                          disabled={isUpdating}
                        >
                          {isUpdating ? 'Updating...' : 'Update'}
                        </Button>
                      </div>
                    </div>

                    {/* Account Creation Date */}
                    <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
                      <h4 className="text-white font-semibold mb-2">Account Information</h4>
                      <div className="text-zinc-300 text-sm">
                        <p>Account created: {user?.metadata?.creationTime ? new Date(user.metadata.creationTime).toLocaleDateString() : 'N/A'}</p>
                      </div>
                    </div>

                    {/* Delete Account */}
                    <div className="space-y-4">
                      <h4 className="text-white font-semibold mb-4">Delete Account</h4>
                      <div className="space-y-4">
                        <p className="text-zinc-300 text-sm">
                          Once you delete your account, there is no going back. Please be certain.
                        </p>
                        <div className="flex gap-4">
                          <Button
                            className="bg-red-600 text-white hover:bg-red-700"
                            onClick={handleDeleteAccount}
                            disabled={isUpdating}
                          >
                            Delete Account
                          </Button>
                          <Button
                            className="bg-zinc-700 text-white hover:bg-zinc-600"
                            onClick={handleArchiveAccount}
                            disabled={isUpdating}
                          >
                            Archive Account
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {settingsTab === 'security' && (
                  <div className="space-y-6 pl-6 pr-4">
                    <h3 className="text-lg font-bold text-white mb-4">Security Settings</h3>
                    
                    {/* Change Password */}
                    <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
                      <div className="flex items-center justify-between">
                  <div>
                          <h4 className="text-white font-semibold mb-1">Change Password</h4>
                          <p className="text-zinc-400 text-sm">Update your account password</p>
                        </div>
                        <Button
                          className="bg-white text-black hover:bg-zinc-100"
                          onClick={() => {
                            // TODO: Implement password change modal
                            alert('Password change feature coming soon');
                          }}
                        >
                          Change
                        </Button>
                      </div>
                    </div>

                    {/* 2FA */}
                    <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-white font-semibold mb-1">Two-Factor Authentication</h4>
                          <p className="text-zinc-400 text-sm">Add an extra layer of security to your account</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-zinc-400 text-sm">Coming Soon</span>
                          <Button
                            className="bg-zinc-700 text-zinc-400 cursor-not-allowed"
                            disabled
                          >
                            Enable
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Device/Session History */}
                    <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-white font-semibold mb-1">Device & Session History</h4>
                          <p className="text-zinc-400 text-sm">View and manage your active sessions</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-zinc-400 text-sm">Coming Soon</span>
                          <Button
                            className="bg-zinc-700 text-zinc-400 cursor-not-allowed"
                            disabled
                          >
                            View
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Sign Out All Sessions */}
                    <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-white font-semibold mb-1">Sign Out All Sessions</h4>
                          <p className="text-zinc-400 text-sm">Sign out from all devices and browsers</p>
                        </div>
                        <Button
                          className="bg-red-600 text-white hover:bg-red-700"
                          onClick={async () => {
                            if (window.confirm('Are you sure you want to sign out from all sessions?')) {
                              try {
                                await signOut(auth);
                                window.location.href = 'https://auth.xloudone.com/login?redirect=https://xognito.com/dashboard';
      } catch (error) {
                                console.error('Error signing out:', error);
                                alert('Failed to sign out. Please try again.');
                              }
                            }
                          }}
                        >
                          Sign Out All
                        </Button>
                      </div>
                    </div>

                    {/* Active Login Location */}
                    <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-white font-semibold mb-1">Active Login Location</h4>
                          <p className="text-zinc-400 text-sm">View your current login location and IP</p>
                        </div>
                        <Button
                          className="bg-white text-black hover:bg-zinc-100"
                          onClick={() => {
                            // TODO: Implement location/IP display
                            alert('Location/IP display feature coming soon');
                          }}
                        >
                          View
                        </Button>
                      </div>
                    </div>

                    {/* Login Alerts */}
                    <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-white font-semibold mb-1">Login Alerts</h4>
                          <p className="text-zinc-400 text-sm">Get notified about new logins to your account</p>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              id="emailAlerts"
                              className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500"
                            />
                            <label htmlFor="emailAlerts" className="text-zinc-300 text-sm">Email</label>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              id="inAppAlerts"
                              className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500"
                            />
                            <label htmlFor="inAppAlerts" className="text-zinc-300 text-sm">In-App</label>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {settingsTab === 'billing' && (
                  <div className="space-y-6 pl-6 pr-4">
                    <h3 className="text-lg font-bold text-white mb-2">Billing & Subscription</h3>
                    <div className="space-y-4">
                      {/* Current Plan */}
                      <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
                        <h4 className="text-white font-semibold mb-3">Current Plan</h4>
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-white text-lg font-medium capitalize">{userSubscription?.plan || 'Free'}</p>
                            <p className="text-zinc-400 text-sm">
                              {userSubscription?.status === 'active' ? 'Active' : 
                               userSubscription?.status === 'trialing' ? 'Trial' : 
                               userSubscription?.status === 'past_due' ? 'Past Due' : 'Inactive'}
                            </p>
                          </div>
                          {userSubscription?.plan !== 'Free' && (
                            <Button
                              className="bg-transparent border border-zinc-700 text-white hover:bg-zinc-800"
                              onClick={() => {
                                // Open Stripe Customer Portal
                                window.open('https://billing.stripe.com/p/login/test', '_blank');
                              }}
                            >
                              Manage Subscription
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Usage Stats */}
                      <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
                        <h4 className="text-white font-semibold mb-3">Usage This Month</h4>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="bg-zinc-900/50 rounded-lg p-3">
                            <p className="text-zinc-400 text-sm">Messages</p>
                            <p className="text-white text-lg font-medium">{usageStats?.messagesToday || 0}</p>
                          </div>
                          <div className="bg-zinc-900/50 rounded-lg p-3">
                            <p className="text-zinc-400 text-sm">Files Uploaded</p>
                            <p className="text-white text-lg font-medium">{usageStats?.filesUploaded || 0}</p>
                          </div>
                        </div>
                      </div>

                      {/* Billing History */}
                      <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
                        <h4 className="text-white font-semibold mb-3">Billing History</h4>
                        <div className="space-y-3">
                          {userSubscription?.billingHistory && userSubscription.billingHistory.length > 0 ? (
                            userSubscription.billingHistory.map((item) => (
                              <div key={item.id} className="flex items-center justify-between p-3 bg-zinc-900/50 rounded-lg border border-zinc-700">
                                <div>
                                  <p className="text-white text-sm">{item.description}</p>
                                  <p className="text-zinc-400 text-xs">
                                    {new Date(item.date.toDate()).toLocaleDateString()}
                                  </p>
                                </div>
                                <div className="text-right">
                                  <p className="text-white text-sm">
                                    ${item.amount.toFixed(2)} {item.currency.toUpperCase()}
                                  </p>
                                  <p className={`text-xs ${
                                    item.status === 'succeeded' ? 'text-green-400' :
                                    item.status === 'failed' ? 'text-red-400' :
                                    'text-yellow-400'
                                  }`}>
                                    {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                                  </p>
                                </div>
                              </div>
                            ))
                          ) : (
                            <p className="text-zinc-400 text-sm">No billing history available</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {settingsTab === 'appearance' && (
                  <div className="space-y-6 pl-6 pr-4">
                    <h3 className="text-lg font-bold text-white mb-2">Appearance Settings</h3>
                    <div className="text-zinc-300 mb-4">Customize the look and feel of your dashboard.</div>
                    
                    {/* Theme Settings */}
                    <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
                      <h4 className="text-white font-semibold mb-3">Theme</h4>
                      <div className="grid grid-cols-3 gap-4">
                        <button className="p-4 rounded-lg border border-zinc-700 bg-black hover:border-white/50 transition-colors">
                          <div className="w-full h-24 bg-gradient-to-br from-zinc-900 to-black rounded mb-2"></div>
                          <div className="text-sm text-white">Dark</div>
                        </button>
                        <button className="p-4 rounded-lg border border-zinc-700 bg-white hover:border-black/50 transition-colors">
                          <div className="w-full h-24 bg-gradient-to-br from-zinc-100 to-white rounded mb-2"></div>
                          <div className="text-sm text-black">Light</div>
                        </button>
                        <button className="p-4 rounded-lg border border-zinc-700 bg-black hover:border-white/50 transition-colors">
                          <div className="w-full h-24 bg-gradient-to-br from-blue-900 to-black rounded mb-2"></div>
                          <div className="text-sm text-white">Blue</div>
                        </button>
                      </div>
                    </div>

                    {/* Font Settings */}
                    <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
                      <h4 className="text-white font-semibold mb-3">Font Style</h4>
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm text-zinc-300 mb-2">Font Family</label>
                          <select className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white">
                            <option value="geist-sans">Geist Sans</option>
                            <option value="inter">Inter</option>
                            <option value="system">System Default</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm text-zinc-300 mb-2">Font Size</label>
                          <div className="flex items-center gap-4">
                            <button className="px-3 py-1 bg-zinc-900 border border-zinc-700 rounded-lg text-white hover:bg-zinc-800">A-</button>
                            <div className="text-white">Medium</div>
                            <button className="px-3 py-1 bg-zinc-900 border border-zinc-700 rounded-lg text-white hover:bg-zinc-800">A+</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {settingsTab === 'ai' && (
                  <div className="space-y-6 pl-6 pr-4">
                    <h3 className="text-lg font-bold text-white mb-2">AI Customization</h3>
                    <div className="text-zinc-300 mb-4">Customize how Xognito interacts with you.</div>
                    <div className="space-y-4">
                      <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
                        <h4 className="text-white font-semibold mb-2">Personality</h4>
                        <p className="text-zinc-300 text-sm">Xognito is designed to be calm, focused, and sharply intelligent — like JARVIS from Iron Man.</p>
              </div>
                      <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
                        <h4 className="text-white font-semibold mb-2">Core Principles</h4>
                        <ul className="text-zinc-300 text-sm space-y-2">
                          <li>• Be concise and get to the point</li>
                          <li>• Speak with clarity and quiet confidence</li>
                          <li>• Understand your patterns, goals, and emotions</li>
                          <li>• Think proactively about what matters</li>
                          <li>• Adapt naturally to your needs</li>
                        </ul>
            </div>
          </div>
        </div>
      )}

                {settingsTab === 'memory' && (
                  <div className="space-y-6 pl-6 pr-4">
                    <h3 className="text-lg font-bold text-white mb-2">Memory Settings</h3>
                    <div className="text-zinc-300 mb-4">Control what the assistant knows or remembers.</div>
                    
                    {/* View Saved Memories */}
                    <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-white font-semibold mb-1">View Saved Memories</h4>
                          <p className="text-zinc-400 text-sm">Browse through your assistant's memory bank</p>
                        </div>
                        <Button
                          className="bg-white text-black hover:bg-zinc-100"
                          onClick={() => {
                            // TODO: Implement memory viewer
                            alert('Memory viewer coming soon');
                          }}
                        >
                          View Memories
                        </Button>
                      </div>
                    </div>

                    {/* Delete Individual Memories */}
                    <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-white font-semibold mb-1">Delete Individual Memories</h4>
                          <p className="text-zinc-400 text-sm">Remove specific memories from your assistant's knowledge</p>
                        </div>
                        <Button
                          className="bg-white text-black hover:bg-zinc-100"
                          onClick={() => {
                            // TODO: Implement memory deletion
                            alert('Memory deletion coming soon');
                          }}
                        >
                          Manage Memories
                        </Button>
                      </div>
                    </div>

                    {/* Pin Important Memories */}
                    <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-white font-semibold mb-1">Pin Important Memories</h4>
                          <p className="text-zinc-400 text-sm">Deep lock critical information for long-term retention</p>
                        </div>
                        <Button
                          className="bg-white text-black hover:bg-zinc-100"
                          onClick={() => {
                            // TODO: Implement memory pinning
                            alert('Memory pinning coming soon');
                          }}
                        >
                          Pin Memories
                        </Button>
                      </div>
                    </div>

                    {/* Export Memory Log */}
                    <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-white font-semibold mb-1">Export Memory Log</h4>
                          <p className="text-zinc-400 text-sm">Download a complete record of your assistant's memories</p>
                        </div>
                        <Button
                          className="bg-white text-black hover:bg-zinc-100"
                          onClick={() => {
                            // TODO: Implement memory export
                            alert('Memory export coming soon');
                          }}
                        >
                          Export
                        </Button>
                      </div>
                    </div>

                    {/* Turn Off New Memory Saving */}
                    <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-white font-semibold mb-1">Turn Off New Memory Saving</h4>
                          <p className="text-zinc-400 text-sm">Temporarily disable automatic memory creation</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="memorySaving"
                            className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500"
                          />
                          <label htmlFor="memorySaving" className="text-zinc-300 text-sm">Enable Memory Saving</label>
                        </div>
                      </div>
                    </div>

                    {/* Memory Visualization (Pro+ future) */}
                    <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-white font-semibold mb-1">Memory Visualization</h4>
                          <p className="text-zinc-400 text-sm">Visual representation of your memory network (Pro+ feature)</p>
                        </div>
                <Button 
                          className="bg-zinc-700 text-zinc-400 cursor-not-allowed"
                          disabled
                >
                          Coming Soon
                </Button>
              </div>
                    </div>
                  </div>
                )}

                {settingsTab === 'notifications' && (
                  <div className="space-y-6 pl-6 pr-4">
                    <h3 className="text-lg font-bold text-white mb-2">Notification Settings</h3>
                    <div className="text-zinc-300 mb-4">Manage how and when you receive notifications.</div>
                    
                    {/* Email Reminders */}
                    <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-white font-semibold mb-1">Email Reminders</h4>
                          <p className="text-zinc-400 text-sm">Receive email notifications for important updates</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="emailReminders"
                            className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500"
                          />
                          <label htmlFor="emailReminders" className="text-zinc-300 text-sm">Enable</label>
                        </div>
                      </div>
                    </div>

                    {/* Weekly Digest */}
                    <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-white font-semibold mb-1">Weekly Digest</h4>
                          <p className="text-zinc-400 text-sm">Get a weekly summary of insights and goals</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="weeklyDigest"
                            className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500"
                          />
                          <label htmlFor="weeklyDigest" className="text-zinc-300 text-sm">Enable</label>
                        </div>
                      </div>
                    </div>

                    {/* Push Notifications */}
                    <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-white font-semibold mb-1">Push Notifications</h4>
                          <p className="text-zinc-400 text-sm">Receive real-time notifications on mobile/web app</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="pushNotifications"
                            className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500"
                          />
                          <label htmlFor="pushNotifications" className="text-zinc-300 text-sm">Enable</label>
                        </div>
                      </div>
                    </div>

                    {/* Group Request Notifications */}
                    <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-white font-semibold mb-1">Group Request Notifications</h4>
                          <p className="text-zinc-400 text-sm">Get notified when someone requests to join your group</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="groupNotifications"
                            className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500"
                          />
                          <label htmlFor="groupNotifications" className="text-zinc-300 text-sm">Enable</label>
                        </div>
                      </div>
                    </div>
                  </div>
              )}
            </div>
            </div>
          </div>
        </div>
      )}

      {/* Add this style block at the end of the file, before the closing tag */}
      <style jsx global>{`
        @keyframes modalZoomIn {
          from {
            transform: scale(0.95);
            opacity: 0;
          }
          to {
            transform: scale(1);
            opacity: 1;
          }
        }

        @keyframes modalZoomOut {
          from {
            transform: scale(1);
            opacity: 1;
          }
          to {
            transform: scale(0.95);
            opacity: 0;
          }
        }
      `}</style>

      {/* Subscription Modal */}
      {subscriptionOpen && (
        <div className="fixed inset-0 z-50 bg-black/90 overflow-y-auto">
          <div className="absolute inset-0 bg-black overflow-y-auto max-h-screen">
            <button className="absolute top-6 right-8 text-zinc-400 hover:text-white text-3xl z-50" onClick={() => setSubscriptionOpen(false)}>&times;</button>
            <h2 className="text-2xl font-bold mb-8 text-white text-center mt-12">Manage Subscription</h2>
            <div className="flex flex-row gap-8 justify-center items-stretch mb-6 mt-20">
              {/* Free Plan Card */}
              <div className={`rounded-2xl border ${userSubscription?.plan === 'Free' ? 'border-green-500' : 'border-white'} bg-gradient-to-b from-black to-zinc-900 p-8 flex flex-col items-center shadow-lg text-white min-w-[280px] max-w-[340px] flex-1 transition-transform duration-200 hover:scale-105 hover:shadow-2xl hover:border-zinc-300`}>
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
                  className={`${userSubscription?.plan === 'Free' ? 'bg-green-500 cursor-not-allowed' : 'bg-white hover:bg-zinc-100'} text-black font-semibold px-4 py-2 rounded-lg transition-colors`}
                  disabled={userSubscription?.plan === 'Free'}
                >
                  {userSubscription?.plan === 'Free' ? 'Current Plan' : 'Change Plan'}
                </button>
              </div>
              {/* Pro Plan Card */}
              <div className={`relative rounded-2xl border ${userSubscription?.plan === 'Pro' ? 'border-green-500' : 'border-black'} bg-gradient-to-b from-white to-zinc-100 p-12 flex flex-col items-center shadow-2xl text-black font-semibold min-w-[320px] max-w-[400px] scale-110 z-10 flex-1 transition-transform duration-200 hover:scale-115 hover:shadow-[0_8px_40px_0_rgba(0,0,0,0.18)]`}>
                {/* Most Popular Badge */}
                <div className="absolute -top-5 left-1/2 -translate-x-1/2 bg-black text-white text-xs font-bold px-4 py-1 rounded-full shadow-lg tracking-wide border border-white">Most Popular</div>
                <div className="font-bold text-2xl mb-1 tracking-wide">Pro</div>
                <div className="text-xl mb-1 font-semibold">$12/month</div>
                <div className="text-sm text-zinc-500 mb-4 italic">Unlock your assistant's full power.</div>
                <ul className="text-sm text-zinc-500 mb-6 space-y-2 text-left w-full max-w-[210px]">
                  <li>Unlimited AI conversations</li>
                  <li>AI memory and context</li>
                  <li>File upload + analysis</li>
                  <li>Web search + live data</li>
                  <li>Customize assistant</li>
                  <li>Save conversations</li>
                  <li>No branding</li>
                  <li>Add extra user (+20%)</li>
                      </ul>
                      <button
                  className={`${userSubscription?.plan === 'Pro' ? 'bg-green-500 cursor-not-allowed' : 'bg-black hover:bg-zinc-900'} text-white font-semibold px-7 py-3 rounded-lg transition-colors text-base shadow`}
                  disabled={userSubscription?.plan === 'Pro'}
                  onClick={() => handlePlanChange('Pro')}
                >
                  {userSubscription?.plan === 'Pro' ? 'Current Plan' : 'Change Plan'}
                </button>
              </div>
              {/* Pro Plus Plan Card */}
              <div className={`rounded-2xl border ${userSubscription?.plan === 'Pro-Plus' ? 'border-green-500' : 'border-white'} bg-gradient-to-b from-black to-zinc-900 p-8 flex flex-col items-center shadow-lg text-white min-w-[280px] max-w-[340px] flex-1 transition-transform duration-200 hover:scale-105 hover:shadow-2xl hover:border-zinc-300`}>
                <div className="font-bold text-xl mb-1 tracking-wide">Pro Plus</div>
                <div className="text-lg mb-1 font-semibold">$25/month</div>
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
                <button 
                  className={`${userSubscription?.plan === 'Pro-Plus' ? 'border-green-500' : 'border-white'} bg-zinc-700 text-zinc-400 font-semibold px-4 py-2 rounded-lg cursor-not-allowed`}
                  disabled={true}
                >
                  Coming Soon
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Memory notifications */}
      {activeMemories.map((memory, index) => (
        <MemoryNotification
          key={memory.id}
          memory={memory}
          onDelete={() => handleMemoryDelete(memory.id)}
          index={index}
        />
      ))}

      <style jsx global>{`
        .dot-anim {
          display: inline-block;
          font-size: 2em;
          animation: blink 1s infinite both;
        }
        .dot-anim:nth-child(2) {
          animation-delay: 0.2s;
        }
        .dot-anim:nth-child(3) {
          animation-delay: 0.4s;
        }
        @keyframes blink {
          0%, 80%, 100% { opacity: 0.2; }
          40% { opacity: 1; }
        }
        .active-conv-btn:hover {
          color: #fff !important;
        }
        .hide-scrollbar {
          scrollbar-width: none; /* Firefox */
        }
        .hide-scrollbar::-webkit-scrollbar {
          display: none; /* Chrome, Safari, Opera */
        }
        .dot-anim-smooth {
          display: inline-block;
          font-size: 2em;
          animation: blink-smooth 1.1s cubic-bezier(0.4,0,0.2,1) infinite both;
        }
        .dot-anim-smooth:nth-child(2) {
          animation-delay: 0.18s;
        }
        .dot-anim-smooth:nth-child(3) {
          animation-delay: 0.36s;
        }
        @keyframes blink-smooth {
          0%, 80%, 100% { opacity: 0.2; transform: translateY(0); }
          40% { opacity: 1; transform: translateY(-2px); }
        }
        .custom-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: rgba(255, 255, 255, 0.2);
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background-color: rgba(255, 255, 255, 0.3);
        }
        @keyframes slide-text {
          0% { transform: translateX(0); }
          100% { transform: translateX(-100%); }
        }
        .animate-slide-text {
          animation: slide-text 8s linear infinite;
          display: inline-block;
          padding-right: 20px;
        }
        .animate-slide-text:hover {
          animation-play-state: paused;
        }
      `}</style>

      {/* Add the invite modal */}
      <InviteUserModal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
      />

      {/* Add the invitation notification */}
      <Suspense>
        <InvitationNotification />
      </Suspense>

      {/* Add Group Modal */}
      {showGroupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="bg-zinc-950/95 rounded-2xl shadow-2xl p-8 w-full max-w-md relative border border-zinc-800">
            <button 
              className="absolute top-4 right-4 text-zinc-400 hover:text-white transition-colors"
              onClick={() => setShowGroupModal(false)}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>

            {/* Toggle Switch */}
            <div className="flex justify-center mb-8">
              <div className="bg-zinc-900 rounded-full p-1 flex gap-1">
                <button
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                    groupModalMode === 'join' 
                      ? 'bg-white text-black' 
                      : 'text-zinc-400 hover:text-white'
                  }`}
                  onClick={() => setGroupModalMode('join')}
                >
                  Join
                </button>
                <button
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                    groupModalMode === 'create' 
                      ? 'bg-white text-black' 
                      : 'text-zinc-400 hover:text-white'
                  }`}
                  onClick={() => setGroupModalMode('create')}
                >
                  Create
                </button>
              </div>
            </div>

            {groupModalMode === 'join' ? (
            <div className="space-y-4">
                <div className="space-y-3">
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Enter Group Code (e.g., $AB12-89GF)"
                      value={groupCode}
                      onChange={(e) => setGroupCode(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-full px-4 py-3 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Enter Host XloudID"
                      value={hostXloudID}
                      onChange={(e) => {
                        setHostXloudID(e.target.value);
                        handleXloudIDSearch(e.target.value);
                      }}
                      onFocus={() => {
                        if (hostXloudID) {
                          handleXloudIDSearch(hostXloudID);
                        }
                      }}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-full px-4 py-3 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {showDropdown && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-900 border border-zinc-800 rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
                        {isSearching ? (
                          <div className="p-3 text-zinc-400 text-sm">Searching...</div>
                        ) : searchResults.length > 0 ? (
                          searchResults.map((user) => (
                            <button
                              key={user.uid}
                              onClick={() => {
                                setHostXloudID(user.xloudId);
                                setShowDropdown(false);
                              }}
                              className="w-full p-3 flex items-center gap-3 hover:bg-zinc-800 transition-colors text-left"
                            >
                              <img
                                src={user.photoURL || USER_PROFILE}
                                alt={user.displayName}
                                className="w-8 h-8 rounded-full object-cover"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="text-white font-medium truncate">
                                  {user.displayName || user.email}
                                </div>
                                <div className="text-zinc-400 text-sm truncate">
                                  {user.xloudId}
                                </div>
                              </div>
                            </button>
                          ))
                        ) : (
                          <div className="p-3 text-zinc-400 text-sm">No users found</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <Button 
                  className="w-full bg-white text-black hover:bg-zinc-100 font-semibold rounded-full py-3"
                  onClick={handleJoinGroup}
                >
                  Find Group
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-3">
                  <input
                    type="text"
                    placeholder="Name For Group"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <textarea
                    placeholder="Group Description (optional)"
                    value={groupDescription}
                    onChange={(e) => setGroupDescription(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none h-24"
                  />
                </div>
                <p className="text-zinc-500 text-sm text-center">
                  Groups are limited to 8 member capacity currently.
                </p>
                <Button 
                  className="w-full bg-white text-black hover:bg-zinc-100 font-semibold rounded-full py-3"
                  onClick={handleCreateGroup}
                >
                  Create Group
                </Button>
              </div>
                )}
              </div>
            </div>
      )}

      {/* Group Chat UI */}
      {activeGroupId && (
        <div className="fixed inset-0 z-40 flex flex-col bg-black">
          {/* Group Chat Header */}
          <div className="flex items-center justify-between p-4 border-b border-zinc-800">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setActiveGroupId(null)}
                className="text-zinc-400 hover:text-white"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </button>
              <h2 className="text-xl font-semibold text-white">
                {userGroups.find(g => g.id === activeGroupId)?.name}
              </h2>
          </div>
          </div>

          {/* Group Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 flex flex-col-reverse">
            {groupMessages.map((msg) => (
              <div
                key={msg.id}
                className={`flex items-end ${msg.senderId === auth.currentUser?.uid ? 'justify-end' : 'justify-start'} mt-4`}
              >
                {msg.senderId !== auth.currentUser?.uid && (
                  <div className="w-10 h-10 rounded-full mr-2 border border-white overflow-hidden">
                    <img
                      src={msg.isAI ? AI_PROFILE : msg.senderPhoto}
                      alt={msg.senderName}
                      className="w-full h-full object-cover object-center scale-125"
                    />
                  </div>
                )}
                <div className={`rounded-2xl px-4 py-2 max-w-[70%] text-sm shadow ${
                  msg.senderId === auth.currentUser?.uid 
                    ? 'bg-white text-black ml-2' 
                    : msg.isAI 
                      ? 'bg-transparent text-white mr-2'
                      : 'bg-transparent text-white mr-2'
                }`}>
                  {msg.senderId !== auth.currentUser?.uid && !msg.isAI && (
                    <div className="text-xs text-zinc-400 mb-1">{msg.senderName}</div>
                  )}
                  {msg.thinking ? (
                    <span className="inline-block w-8">
                      <span className="dot-anim-smooth">.</span>
                      <span className="dot-anim-smooth" style={{ animationDelay: '0.18s' }}>.</span>
                      <span className="dot-anim-smooth" style={{ animationDelay: '0.36s' }}>.</span>
                    </span>
                  ) : msg.isAI ? (
                    renderAIMessage(msg.text)
                  ) : (
                    <span dangerouslySetInnerHTML={{
                      __html: msg.text.replace(/@xognito/g, '<strong>@xognito</strong>')
                    }} />
                  )}
                </div>
                {msg.senderId === auth.currentUser?.uid && (
                  <img
                    src={user?.photoURL || USER_PROFILE}
                    alt="You"
                    className="w-10 h-10 rounded-full ml-2 border border-white object-cover"
                  />
                )}
              </div>
            ))}
          </div>

          {/* Group Chat Input */}
          <form
            onSubmit={handleSendGroupMessage}
            className="p-4 border-t border-zinc-800"
          >
            <div className="flex items-center w-full max-w-2xl mx-auto bg-black border border-white rounded-full px-4 py-2 gap-2 shadow-lg">
              <input
                type="text"
                value={groupInput}
                onChange={(e) => setGroupInput(e.target.value)}
                placeholder="Type a message... (use @xognito to get AI response)"
                className="flex-1 bg-transparent outline-none text-white placeholder:text-zinc-400 text-base px-2"
              />
              {groupInput.trim() && (
                <button
                  type="submit"
                  className="bg-white text-black font-semibold rounded-full px-5 py-2 text-sm shadow hover:bg-zinc-100 transition-colors"
                >
                  Send
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {/* Add GroupRequestNotification component */}
      <GroupRequestNotification />

      {/* Cropper Modal */}
      {showCropper && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="bg-zinc-900 rounded-lg p-4 w-full max-w-md">
            <h3 className="text-white font-semibold mb-4">Crop Your Image</h3>
            <Cropper
              src={imageToCrop || ''}
              style={{ height: 300, width: '100%' }}
              aspectRatio={1}
              guides={true}
              onInitialized={(instance: Cropper) => setCropper(instance)}
            />
            <div className="flex justify-end mt-4">
              <Button onClick={handleCroppedImage} className="bg-white text-black hover:bg-zinc-100">
                Crop & Upload
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 