import { db } from './firebase';
import {
  collection,
  doc,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  Timestamp,
  serverTimestamp,
  updateDoc,
  arrayUnion,
} from 'firebase/firestore';

export type MemoryType = 'deep' | 'short' | 'relationship';

export interface Memory {
  id: string;
  type: MemoryType;
  title?: string;
  summary: string;
  topics: string[];
  importanceScore: number;
  triggerWords: string[];
  createdAt: Timestamp;
  lastTriggered: Timestamp;
  originChatId: string;
  originMessageId: string;
  deleted: boolean;
}

interface MemorySummary {
  summary: string;
  topics: string[];
  importanceScore: number;
}

// Generate AI summary for memory
async function generateMemorySummary(message: string): Promise<MemorySummary> {
  const apiKey = process.env.NEXT_PUBLIC_DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DeepSeek API key not set');

  const prompt = `Analyze this message and create a concise memory summary:
Message: "${message}"

Provide a JSON response with:
1. summary: A brief, reusable summary (max 100 chars)
2. topics: Array of 2-4 relevant topics
3. importanceScore: Number between 0-1

Example response:
{
  "summary": "User is building a health tracking app",
  "topics": ["health", "app development", "tracking"],
  "importanceScore": 0.8
}`;

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    }),
  });

  if (!res.ok) throw new Error('Failed to generate memory summary');
  
  const data = await res.json();
  const content = data.choices[0].message.content;
  
  try {
    return JSON.parse(content) as MemorySummary;
  } catch (e) {
    console.error('Failed to parse memory summary:', e);
    // Fallback to basic summary
    return {
      summary: message.substring(0, 100),
      topics: extractTriggerWords(message),
      importanceScore: 0.5,
    };
  }
}

// Update evaluateMemoryOpportunity to use AI summarization
export async function evaluateMemoryOpportunity(
  userId: string,
  message: string,
  chatId: string,
  messageId: string
): Promise<string | null> {
  console.log("[Memory] Evaluating message for memory:", { message });
  
  // Skip if message is too short or likely not meaningful
  if (message.length < 10) {
    console.log("[Memory] Message too short, skipping");
    return null;
  }

  // Check for memory triggers
  const memoryTriggers = [
    'remember',
    'goal',
    'want to',
    'plan to',
    'important',
    'never forget',
    'keep in mind',
    'note to self',
    'created',
    'founded',
    'started',
    'built',
    'developed',
    'launched',
    'company',
    'business',
    'project'
  ];

  const hasMemoryTrigger = memoryTriggers.some(trigger => 
    message.toLowerCase().includes(trigger)
  );

  console.log("[Memory] Memory trigger check:", { hasMemoryTrigger, triggers: memoryTriggers.filter(t => message.toLowerCase().includes(t)) });

  if (!hasMemoryTrigger) {
    console.log("[Memory] No memory triggers found");
    return null;
  }

  try {
    // Generate AI summary
    console.log("[Memory] Generating AI summary");
    const { summary, topics, importanceScore } = await generateMemorySummary(message);
    console.log("[Memory] Generated summary:", { summary, topics, importanceScore });

    // Create memory document
    const memoryData = {
      type: 'short' as const, // Default to short-term memory
      summary,
      topics,
      importanceScore,
      triggerWords: topics, // Use AI-generated topics as trigger words
      originChatId: chatId,
      originMessageId: messageId,
      deleted: false,
    };

    // Save to Firestore
    console.log("[Memory] Saving to Firestore:", { path: `users/${userId}/memory`, data: memoryData });
    const memoryRef = await addDoc(collection(db, `users/${userId}/memory`), {
      ...memoryData,
      createdAt: serverTimestamp(),
      lastTriggered: serverTimestamp(),
    });
    console.log("[Memory] Memory saved successfully:", memoryRef.id);

    return memoryRef.id;
  } catch (error) {
    console.error("[Memory] Failed to create memory:", error);
    return null;
  }
}

// Helper to extract potential trigger words from message
function extractTriggerWords(message: string): string[] {
  const words = message.toLowerCase().split(/\s+/);
  return words.filter(word => 
    word.length > 3 && // Skip short words
    !['the', 'and', 'that', 'this', 'with', 'for', 'are', 'was', 'were'].includes(word)
  );
}

// Get relevant memories for a message
export async function getRelevantMemories(
  userId: string,
  message: string
): Promise<Memory[]> {
  const words = message.toLowerCase().split(/\s+/);
  
  const memoriesRef = collection(db, `users/${userId}/memory`);
  const q = query(
    memoriesRef,
    where('deleted', '==', false),
    where('triggerWords', 'array-contains-any', words),
    orderBy('lastTriggered', 'desc'),
    limit(3)
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  } as Memory));
}

// Update memory last triggered timestamp
export async function updateMemoryLastTriggered(
  userId: string,
  memoryId: string
): Promise<void> {
  const memoryRef = doc(db, `users/${userId}/memory`, memoryId);
  await updateDoc(memoryRef, {
    lastTriggered: serverTimestamp(),
  });
}

// Generate memory context for AI prompt
export function generateMemoryContext(memories: Memory[]): string {
  if (memories.length === 0) return '';

  const context = memories.map(memory => 
    `Memory: ${memory.summary}\nTopics: ${memory.topics.join(', ')}\n`
  ).join('\n');

  return `\nRelevant memories:\n${context}\n`;
} 