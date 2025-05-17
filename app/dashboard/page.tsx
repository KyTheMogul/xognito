'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { auth, db } from '@/lib/firebase';
import { signOut, signInWithCustomToken } from 'firebase/auth';
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
  setDoc
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

const USER_PROFILE = 'https://randomuser.me/api/portraits/men/32.jpg';
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
  // Regex to match code blocks: ```lang\ncode\n```
  const codeBlockRegex = /```([\w-]*)\n([\s\S]*?)```/g;
  let match = codeBlockRegex.exec(text);
  if (match) {
    // Only show the first code block and any text before it
    const before = text.slice(0, match.index).trim();
    const lang = match[1] || 'plaintext';
    const code = match[2];
    return <CodeBlock lang={lang} code={code} before={before} />;
  }
  // If no triple backtick code block, look for the first indented code block (4 spaces or tab)
  const lines = text.split(/\r?\n/);
  let inCode = false;
  let codeLines: string[] = [];
  let beforeLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^(    |\t)/.test(line)) {
      if (!inCode) {
        inCode = true;
      }
      codeLines.push(line.replace(/^(    |\t)/, ''));
    } else {
      if (!inCode) {
        beforeLines.push(line);
      } else {
        // End of first code block
        break;
      }
    }
  }
  if (codeLines.length > 0) {
    return <CodeBlock lang="plaintext" code={codeLines.join('\n')} before={beforeLines.join('\n')} />;
  }
  // If no code block found, just return the text
  return <span>{text}</span>;
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

// Force new deployment - May 15, 2024
export default function Dashboard() {
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
  const profileRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'account' | 'security' | 'appearance' | 'ai' | 'billing'>('account');
  const [uploads, setUploads] = useState<UploadedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [proFeaturesExpanded, setProFeaturesExpanded] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const listenTimeoutRef = useRef<any>(null);
  const [activeMemories, setActiveMemories] = useState<NotificationMemory[]>([]);
  const [userSubscription, setUserSubscription] = useState<{
    plan: 'free' | 'pro' | 'pro_plus';
    isActive: boolean;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    startDate?: Timestamp;
    nextBillingDate?: Timestamp;
    addedBy?: string;
    sharedUsers?: string[];
    seatsUsed?: number;
    seatsAllowed?: number;
    trialEndsAt?: Timestamp;
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

  const examplePrompts = [
    "What do you remember about my work schedule?",
    "Can you help me learn more about AI?",
    "Remember that I prefer to work in the morning",
    "What are my current learning goals?"
  ];

  const handleExampleClick = (prompt: string) => {
    setInput(prompt);
    // Remove empty state by triggering a small state change
    setMessages([{ 
      id: 'temp', 
      sender: 'ai', 
      text: '', 
      timestamp: Timestamp.now() 
    }]);
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
    if (!user || !activeConversationId) return;

    const unsubscribe = listenToMessages(user.uid, activeConversationId, (msgs) => {
      setMessages(msgs);
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

  // Handle sending a message
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
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

    // If no active conversation, create one
    if (!activeConversationId) {
      console.log("[Dashboard] No active conversation, creating new one");
      try {
        const newConversationId = await createConversation(user.uid);
        console.log("[Dashboard] Created new conversation:", newConversationId);
        setActiveConversationId(newConversationId);
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
      const userMessageId = await addMessage(user.uid, activeConversationId!, userMessage);
      console.log("[Dashboard] User message added successfully");
      
      setInput('');
      setUploads([]);

      // Evaluate if message should be stored as memory
      const memoryId = await evaluateMemoryOpportunity(user.uid, input, activeConversationId!, userMessageId);
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
        console.log("[Dashboard] First message, updating conversation title");
        const title = input.length > 30 ? input.substring(0, 30) + '...' : input;
        await updateConversationTitle(user.uid, activeConversationId!, title);
        console.log("[Dashboard] Conversation title updated");
      }

      // Add AI response placeholder
      console.log("[Dashboard] Adding AI response placeholder");
      const aiMessage: Omit<Message, 'timestamp'> = {
        sender: 'ai',
        text: '...',
        thinking: true
      };
      const aiMessageId = await addMessage(user.uid, activeConversationId!, aiMessage);
      console.log("[Dashboard] AI response placeholder added");

      // Call DeepSeek API and stream the response
      const messagesForAI: { role: 'user' | 'system' | 'assistant'; content: string }[] = [
        { 
          role: 'system', 
          content: `You are Xognito — a personal AI assistant designed to think independently and respond efficiently.
Your personality is calm, focused, and sharply intelligent — like JARVIS from Iron Man.

Core principles:
- Be concise. No extra fluff. Get to the point.
- Speak with clarity and quiet confidence.
- Understand the user's patterns, goals, and emotions over time.
- Think proactively. If something seems important, recall it or ask about it.
- Avoid typical AI phrases like "As an AI…" or "Sure! Let me…" — you're not a chatbot.
- You remember what matters and adapt naturally, like a real assistant.

${memoryContext}

When responding:
1. Keep responses concise and focused
2. Use memories when relevant
3. Don't make assumptions
4. Ask for clarification if needed
5. When someone shares something with you, acknowledge it naturally
6. If they use phrases like "remember that" or "keep in mind", respond as if you're making a mental note`
        },
        { role: 'user', content: input }
      ];

      console.log("[Dashboard] Sending messages to DeepSeek:", messagesForAI);
      let aiResponse = '';
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
          updateDoc(doc(db, `users/${user.uid}/conversations/${activeConversationId}/messages`, aiMessageId), updatedAiMessage)
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
          await addMessage(user.uid, activeConversationId!, confirmationMessage);
        }

      } catch (error) {
        console.error("[Dashboard] Error in DeepSeek API call:", error);
        // Update with error message
        const errorMessage: Omit<Message, 'timestamp'> = {
          sender: 'ai',
          text: "I apologize, but I'm having trouble connecting to my language model. Please try again in a moment.",
          thinking: false
        };
        await updateDoc(doc(db, `users/${user.uid}/conversations/${activeConversationId}/messages`, aiMessageId), errorMessage)
          .catch(error => {
            console.error("[Dashboard] Error updating error message:", error);
          });
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
      if (userSubscription?.plan === 'free') {
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
    const handleAuth = async () => {
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        const token = url.searchParams.get('token');
        console.log("[XloudID] Current URL:", window.location.href);
        console.log("[XloudID] Token from URL:", token ? "Present" : "Not present");

        if (token) {
          console.log("[XloudID] Processing token:", token.substring(0, 10) + "...");
          try {
            console.log("[XloudID] Firebase config check:", {
              apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ? `${process.env.NEXT_PUBLIC_FIREBASE_API_KEY.substring(0, 5)}...` : 'missing',
              authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'missing',
              projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'missing'
            });
            
            // Log the token details (first few characters only)
            console.log("[XloudID] Token details:", {
              tokenLength: token.length,
              tokenPrefix: token.substring(0, 10) + "...",
              tokenType: typeof token
            });
            
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
              console.error("[XloudID] Firestore operation error:", {
                code: (firestoreError as any).code,
                message: (firestoreError as any).message,
                stack: (firestoreError as any).stack
              });
            }

            // Clean up URL
            url.searchParams.delete('token');
            window.history.replaceState({}, document.title, url.pathname);
            console.log("[XloudID] URL cleaned up");
          } catch (error) {
            const authError = error as any;
            console.error("[XloudID] Authentication error details:", {
              code: authError.code,
              message: authError.message,
              stack: authError.stack,
              name: authError.name,
              fullError: authError
            });
            
            // Store error in localStorage for debugging
            localStorage.setItem('xloudid_auth_error', JSON.stringify({
              timestamp: new Date().toISOString(),
              code: authError.code,
              message: authError.message,
              name: authError.name
            }));
          }
        }
      }
    };

    handleAuth();
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

    const unsubscribe = onSnapshot(doc(db, 'users', user.uid, 'subscription', 'current'), (doc) => {
      if (doc.exists()) {
        setUserSubscription(doc.data() as any);
      } else {
        // Set default free plan if no subscription exists
        setUserSubscription({
          plan: 'free',
          isActive: true
        });
      }
    });

    return () => unsubscribe();
  }, [auth.currentUser]);

  const handlePlanChange = async (newPlan: 'pro' | 'pro_plus') => {
    const user = auth.currentUser;
    if (!user) {
      console.error('[Dashboard] No user found');
      return;
    }

    try {
      console.log('[Dashboard] Initiating plan change:', {
        plan: newPlan,
        userId: user.uid
      });

      // Create Stripe Checkout Session
      const response = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          plan: newPlan,
          userId: user.uid
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('[Dashboard] Checkout session creation failed:', {
          status: response.status,
          statusText: response.statusText,
          error: errorData
        });
        throw new Error(`Failed to create checkout session: ${errorData.error || response.statusText}`);
      }

      const { sessionId } = await response.json();
      console.log('[Dashboard] Checkout session created:', { sessionId });

      // Redirect to Stripe Checkout
      const stripe = await loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);
      if (!stripe) {
        console.error('[Dashboard] Stripe failed to load');
        throw new Error('Stripe failed to load');
      }

      const { error } = await stripe.redirectToCheckout({ sessionId });
      if (error) {
        console.error('[Dashboard] Stripe redirect error:', error);
        throw error;
      }
    } catch (error) {
      console.error('[Dashboard] Error initiating plan change:', error);
      // Show error notification to user
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

${memoryContext}

When responding:
1. Keep responses concise and focused
2. Use memories when relevant
3. Don't make assumptions
4. Ask for clarification if needed
5. When someone shares something with you, acknowledge it naturally
6. If they use phrases like "remember that" or "keep in mind", respond as if you're making a mental note`
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
      {userSubscription?.plan === 'free' && (
        <div className="fixed bottom-2 left-1/2 transform -translate-x-1/2 text-zinc-400 text-xs">
          Powered by Xognito
        </div>
      )}

      {/* Profile picture and add family button in top right */}
      {!activeGroupId && (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-3" ref={profileRef}>
          {userSubscription?.plan === 'free' ? (
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
            src={USER_PROFILE}
            alt="Profile"
                className="w-12 h-12 rounded-full border-2 border-white object-cover shadow cursor-pointer hover:opacity-90 transition-opacity"
          />
        </button>
        {profileMenuOpen && (
          <div className="absolute right-0 top-full mt-3 w-60 bg-black border border-zinc-700 rounded-xl shadow-2xl py-3 px-2 flex flex-col gap-1 animate-fade-in z-50" style={{ minWidth: '15rem', background: 'rgba(20,20,20,0.98)', border: '1.5px solid #333' }}>
            <div className="px-3 py-2 text-xs text-zinc-400">Current Plan</div>
            <div className="px-3 py-1 text-sm font-semibold text-white flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-400"><circle cx="12" cy="12" r="10" /><path d="M8 12l2 2 4-4" /></svg>
                    {userSubscription?.plan === 'free' ? 'Free Plan' : 'Pro Plan'}
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
                    onClick={() => signOut(auth)}
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
        className={`fixed top-4 left-0 h-[calc(100%-2rem)] w-64 bg-black border border-white rounded-2xl shadow-lg z-40 transform transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-80'}`}
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
              <Button
                key={group.id}
                variant="ghost"
                className={`justify-start px-3 py-2 text-sm font-normal transition-colors rounded-lg w-full ${
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
        <div className="w-full max-w-3xl mx-auto flex flex-col gap-6 mt-8 relative" style={{ height: '75vh' }}>
          <div className="flex-1 overflow-y-auto pr-2 flex flex-col-reverse hide-scrollbar" style={{ height: '100%' }}>
            <div ref={chatEndRef} />
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center space-y-8">
                <h2 className="text-2xl font-bold text-white/80">Welcome to Xognito</h2>
                <p className="text-white/60 text-center max-w-md">
                  Your AI companion with memory capabilities. Try asking something or use one of these examples:
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-2xl px-4">
                  {examplePrompts.map((prompt, index) => (
                    <button
                      key={index}
                      onClick={() => handleExampleClick(prompt)}
                      className="p-4 bg-white/5 hover:bg-white/10 rounded-lg text-left transition-colors border border-white/10 hover:border-white/20"
                    >
                      <p className="text-white/80">{prompt}</p>
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
                    {/* If user message has files, show them below the bubble */}
                    {msg.sender === 'user' && Array.isArray((msg as any).files) && (msg as any).files.length > 0 && (
                      <div className="flex flex-col gap-2 mt-3">
                        {(msg as any).files.map((f: UploadedFile) => (
                          f.type === 'image' ? (
                            <img key={f.id} src={f.url} alt={f.name} className="rounded-xl max-w-xs max-h-48 border border-zinc-700" />
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
                <img src={USER_PROFILE} alt="You" className="w-10 h-10 rounded-full ml-2 border border-white object-cover" />
              )}
            </div>
              ))
            )}
            {/* Invisible tab bar for spacing at the bottom */}
            <div style={{ height: '96px', width: '100%' }} />
          </div>
        </div>
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
      {/* Chat input at bottom */}
      <form 
        className="fixed bottom-0 left-0 w-full flex justify-center pb-6 z-40 bg-transparent" 
        onSubmit={(e) => {
          console.log("[Dashboard] Form submitted");
          handleSend(e);
        }}
      >
        <div className="flex items-center w-full max-w-2xl bg-black border border-white rounded-full px-4 py-2 gap-2 shadow-lg">
          {/* Upload icon */}
          <button
            type="button"
            className="text-zinc-400 hover:text-white transition-colors focus:outline-none"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Upload file"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a5 5 0 0 1-7.07-7.07l9.19-9.19a3 3 0 0 1 4.24 4.24l-9.2 9.19a1 1 0 0 1-1.41-1.41l9.19-9.19" /></svg>
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
            placeholder="Type a message..."
            className="flex-1 bg-transparent outline-none text-white placeholder:text-zinc-400 text-base px-2"
            value={input}
            onChange={(e) => {
              console.log("[Dashboard] Input changed:", e.target.value);
              setInput(e.target.value);
            }}
          />
          {/* Send button: only show if input is not empty */}
          {input.trim() && (
            <button 
              type="submit" 
              className="ml-2 bg-white text-black font-semibold rounded-full px-5 py-2 text-sm shadow hover:bg-zinc-100 transition-colors focus:outline-none"
              onClick={() => console.log("[Dashboard] Send button clicked")}
            >
              Send
            </button>
          )}
          {/* Microphone icon button */}
          <button
            type="button"
            className={`ml-2 ${listening ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'} transition-colors p-2 rounded-full focus:outline-none flex items-center justify-center`}
            aria-label="Record voice message"
            onClick={handleMicClick}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="2" width="6" height="12" rx="3"/>
              <path d="M5 10v2a7 7 0 0 0 14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="22"/>
              <line x1="8" y1="22" x2="16" y2="22"/>
            </svg>
            {listening && <span className="ml-2 text-xs animate-pulse">Listening...</span>}
          </button>
        </div>
      </form>

      {/* Settings Modal */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-zinc-900/80 rounded-2xl shadow-2xl p-8 w-full max-w-2xl relative border-2 border-white/80 backdrop-blur-lg" style={{ boxShadow: '0 8px 40px 0 rgba(0,0,0,0.7)', height: '80vh' }}>
            <button className="absolute top-3 right-3 text-zinc-400 hover:text-white text-2xl" onClick={() => setSettingsOpen(false)}>&times;</button>
            <h2 className="text-xl font-bold mb-6 text-white text-center">Settings</h2>
            <div className="flex gap-8 h-[calc(100%-3rem)]">
              {/* Vertical Tab Headers */}
              <div className="flex flex-col gap-2 min-w-[160px] pr-4 border-r border-white/10">
                <span onClick={() => setSettingsTab('account')} className={`cursor-pointer text-base font-semibold py-2 px-3 rounded-lg transition-colors text-left flex items-center gap-2 ${settingsTab === 'account' ? 'text-white bg-white/20' : 'text-zinc-300 hover:bg-white/10 hover:text-white/80'}`}>
                  {/* User icon */}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline align-middle"><circle cx="12" cy="7" r="4" /><path d="M5.5 21a8.38 8.38 0 0 1 13 0" /></svg>
                  Account
                </span>
                <span onClick={() => setSettingsTab('security')} className={`cursor-pointer text-base font-semibold py-2 px-3 rounded-lg transition-colors text-left flex items-center gap-2 ${settingsTab === 'security' ? 'text-white bg-white/20' : 'text-zinc-300 hover:bg-white/10 hover:text-white/80'}`}>
                  {/* Lock icon */}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline align-middle"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                  Security
                </span>
                <span onClick={() => setSettingsTab('billing')} className={`cursor-pointer text-base font-semibold py-2 px-3 rounded-lg transition-colors text-left flex items-center gap-2 ${settingsTab === 'billing' ? 'text-white bg-white/20' : 'text-zinc-300 hover:bg-white/10 hover:text-white/80'}`}>
                  {/* Credit card icon */}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline align-middle"><rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" /></svg>
                  Billing
                </span>
                <span onClick={() => setSettingsTab('appearance')} className={`cursor-pointer text-base font-semibold py-2 px-3 rounded-lg transition-colors text-left flex items-center gap-2 ${settingsTab === 'appearance' ? 'text-white bg-white/20' : 'text-zinc-300 hover:bg-white/10 hover:text-white/80'}`}>
                  {/* Palette icon */}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline align-middle"><circle cx="12" cy="12" r="10" /><circle cx="7.5" cy="10.5" r="1.5" /><circle cx="16.5" cy="10.5" r="1.5" /><circle cx="12" cy="16.5" r="1.5" /><path d="M12 2a10 10 0 0 1 0 20" /></svg>
                  Appearance
                </span>
                <span onClick={() => setSettingsTab('ai')} className={`cursor-pointer text-base font-semibold py-2 px-3 rounded-lg transition-colors text-left flex items-center gap-2 ${settingsTab === 'ai' ? 'text-white bg-white/20' : 'text-zinc-300 hover:bg-white/10 hover:text-white/80'}`}>
                  {/* Brain icon */}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline align-middle"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-5 0v-15A2.5 2.5 0 0 1 9.5 2Z" /><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 5 0v-15A2.5 2.5 0 0 0 14.5 2Z" /></svg>
                  AI Customization
                </span>
              </div>
              {/* Tab Content */}
              <div className="flex-1 rounded-xl p-6 bg-transparent overflow-y-auto custom-scrollbar">
                {settingsTab === 'account' && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-bold text-white mb-2">Account Settings</h3>
                    <div className="text-zinc-300">Change your email, username, and other account details here.</div>
                  </div>
                )}
                {settingsTab === 'security' && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-bold text-white mb-2">Security Settings</h3>
                    <div className="text-zinc-300">Update your password and enable 2FA here.</div>
                  </div>
                )}
                {settingsTab === 'billing' && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-bold text-white mb-2">Billing & Subscription</h3>
                    <div className="space-y-4">
                      {/* Current Plan */}
                      <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
                        <h4 className="text-white font-semibold mb-2">Current Plan</h4>
                        <div className="flex items-center justify-between">
                  <div>
                            <p className="text-zinc-300 text-sm capitalize">{userSubscription?.plan || 'Free'} Plan</p>
                            {userSubscription?.isInvitedUser && (
                              <div className="mt-2 space-y-1">
                                <p className="text-zinc-400 text-xs">
                                  Invited by: {userSubscription.inviterEmail}
                                </p>
                                <p className="text-zinc-400 text-xs">
                                  Billing Group: {userSubscription.billingGroup}
                                </p>
                                <p className="text-zinc-400 text-xs">
                                  XloudID: {userSubscription.xloudId}
                                </p>
                              </div>
                            )}
                            {userSubscription?.nextBillingDate && (
                              <p className="text-zinc-400 text-xs mt-1">
                                Next billing date: {userSubscription.nextBillingDate.toDate().toLocaleDateString()}
                              </p>
                            )}
                          </div>
                          {!userSubscription?.isInvitedUser && (
                            <Button 
                              className="bg-white text-black hover:bg-zinc-100"
                              onClick={() => setSubscriptionOpen(true)}
                            >
                              Change Plan
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Payment Method */}
                      <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
                        <h4 className="text-white font-semibold mb-2">Payment Method</h4>
                        {userSubscription?.isInvitedUser ? (
                          <p className="text-zinc-400 text-sm">
                            Billing is managed by your inviter ({userSubscription.inviterEmail})
                          </p>
                        ) : userSubscription?.stripeCustomerId ? (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="1" y="4" width="22" height="16" rx="2" />
                                <line x1="1" y1="10" x2="23" y2="10" />
                              </svg>
                              <span className="text-zinc-300 text-sm">•••• 4242</span>
                            </div>
                            <Button 
                              variant="ghost" 
                              className="text-zinc-400 hover:text-white"
                              onClick={() => {/* TODO: Implement update payment method */}}
                            >
                              Update
                            </Button>
                          </div>
                        ) : (
                          <p className="text-zinc-400 text-sm">No payment method on file</p>
                        )}
                      </div>

                      {/* Billing History */}
                      <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
                        <h4 className="text-white font-semibold mb-2">Billing History</h4>
                        <div className="space-y-2">
                          {userSubscription?.isInvitedUser ? (
                            <p className="text-zinc-400 text-sm">
                              Billing history is managed by your inviter
                            </p>
                          ) : userSubscription?.plan !== 'free' ? (
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-zinc-300">Last payment</span>
                              <span className="text-zinc-400">$12.00</span>
                            </div>
                          ) : (
                            <p className="text-zinc-400 text-sm">No billing history available</p>
                          )}
                        </div>
                      </div>

                      {/* Usage Stats */}
                      <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700">
                        <h4 className="text-white font-semibold mb-2">Usage This Month</h4>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-zinc-300">Messages</span>
                            <span className="text-zinc-400">{usageStats.messagesToday}/25</span>
                          </div>
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-zinc-300">File Uploads</span>
                            <span className="text-zinc-400">{usageStats.filesUploaded}/3</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {settingsTab === 'appearance' && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-bold text-white mb-2">Appearance Settings</h3>
                    <div className="text-zinc-300">Customize the look and feel of your dashboard.</div>
                  </div>
                )}
                {settingsTab === 'ai' && (
                  <div className="space-y-6">
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
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Subscription Modal */}
      {subscriptionOpen && (
        <div className="fixed inset-0 z-50 bg-black/90 overflow-y-auto">
          <div className="absolute inset-0 bg-black overflow-y-auto max-h-screen">
            <button className="absolute top-6 right-8 text-zinc-400 hover:text-white text-3xl z-50" onClick={() => setSubscriptionOpen(false)}>&times;</button>
            <h2 className="text-2xl font-bold mb-8 text-white text-center mt-12">Manage Subscription</h2>
            <div className="flex flex-row gap-8 justify-center items-stretch mb-6 mt-20">
              {/* Free Plan Card */}
              <div className={`rounded-2xl border ${userSubscription?.plan === 'free' ? 'border-green-500' : 'border-white'} bg-gradient-to-b from-black to-zinc-900 p-8 flex flex-col items-center shadow-lg text-white min-w-[280px] max-w-[340px] flex-1 transition-transform duration-200 hover:scale-105 hover:shadow-2xl hover:border-zinc-300`}>
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
                  className={`${userSubscription?.plan === 'free' ? 'bg-green-500 cursor-not-allowed' : 'bg-white hover:bg-zinc-100'} text-black font-semibold px-4 py-2 rounded-lg transition-colors`}
                  disabled={userSubscription?.plan === 'free'}
                >
                  {userSubscription?.plan === 'free' ? 'Current Plan' : 'Change Plan'}
                </button>
              </div>
              {/* Pro Plan Card */}
              <div className={`relative rounded-2xl border ${userSubscription?.plan === 'pro' ? 'border-green-500' : 'border-black'} bg-gradient-to-b from-white to-zinc-100 p-12 flex flex-col items-center shadow-2xl text-black font-semibold min-w-[320px] max-w-[400px] scale-110 z-10 flex-1 transition-transform duration-200 hover:scale-115 hover:shadow-[0_8px_40px_0_rgba(0,0,0,0.18)]`}>
                {/* Most Popular Badge */}
                <div className="absolute -top-5 left-1/2 -translate-x-1/2 bg-black text-white text-xs font-bold px-4 py-1 rounded-full shadow-lg tracking-wide border border-white">Most Popular</div>
                <div className="font-bold text-2xl mb-1 tracking-wide">Pro</div>
                <div className="text-xl mb-1 font-semibold">$12/month</div>
                <div className="text-sm text-zinc-500 mb-4 italic">Unlock your assistant's full power.</div>
                {(() => {
                  const features = [
                    "Unlimited AI conversations",
                    "Assistant remembers your goals, notes, and context",
                    "Upload and analyze files, screenshots, and documents",
                    "Real-time web search built in",
                    "Create and use up to 10 custom tools (Taps)",
                    "Save, revisit, and download chat history",
                    "Join or create group chats with others",
                    "Customize your AI's name and personality",
                    "Use Xognito even offline",
                    "No branding — fully private interface",
                    "Add another user for 20% extra per month",
                  ];
                  const shown = proFeaturesExpanded ? features : features.slice(0, 3);
                  return (
                    <>
                      <ul className="text-base text-zinc-700 mb-2 space-y-2 text-left w-full max-w-[250px] font-normal">
                        {shown.map((f, i) => <li key={i}>{f}</li>)}
                      </ul>
                      <button
                        type="button"
                        className="text-xs text-blue-600 hover:underline mb-6"
                        onClick={() => setProFeaturesExpanded(v => !v)}
                      >
                        {proFeaturesExpanded ? 'Show less' : 'Show more'}
                      </button>
                    </>
                  );
                })()}
                <button 
                  className={`${userSubscription?.plan === 'pro' ? 'bg-green-500 cursor-not-allowed' : 'bg-black hover:bg-zinc-900'} text-white font-semibold px-7 py-3 rounded-lg transition-colors text-base shadow`}
                  disabled={userSubscription?.plan === 'pro'}
                  onClick={() => handlePlanChange('pro')}
                >
                  {userSubscription?.plan === 'pro' ? 'Current Plan' : 'Change Plan'}
                </button>
              </div>
              {/* Pro Plus Plan Card */}
              <div className={`rounded-2xl border ${userSubscription?.plan === 'pro_plus' ? 'border-green-500' : 'border-white'} bg-gradient-to-b from-black to-zinc-900 p-8 flex flex-col items-center shadow-lg text-white min-w-[280px] max-w-[340px] flex-1 transition-transform duration-200 hover:scale-105 hover:shadow-2xl hover:border-zinc-300`}>
                <div className="font-bold text-xl mb-1 tracking-wide">Pro Plus</div>
                <div className="text-lg mb-1 font-semibold">$25/month</div>
                <div className="text-xs text-zinc-300 mb-3 italic">Everything you need and more.</div>
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
                  className={`${userSubscription?.plan === 'pro_plus' ? 'bg-green-500 cursor-not-allowed' : 'bg-white hover:bg-zinc-100'} text-black font-semibold px-4 py-2 rounded-lg transition-colors`}
                  disabled={userSubscription?.plan === 'pro_plus'}
                  onClick={() => handlePlanChange('pro_plus')}
                >
                  {userSubscription?.plan === 'pro_plus' ? 'Current Plan' : 'Change Plan'}
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
                    src={USER_PROFILE}
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
    </div>
  );
} 