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
  try {
    const apiKey = process.env.NEXT_PUBLIC_DEEPSEEK_API_KEY;
    if (!apiKey) {
      console.log("[Memory] No DeepSeek API key, using fallback summary");
      return generateFallbackSummary(message);
    }

    const prompt = `Analyze this message and create a concise memory summary. Return ONLY a JSON object with no markdown formatting or backticks:
Message: "${message}"

Required JSON format:
{
  "summary": "A brief, reusable summary (max 100 chars)",
  "topics": ["topic1", "topic2", "topic3"],
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

    if (!res.ok) {
      console.error("[Memory] DeepSeek API error:", await res.text());
      return generateFallbackSummary(message);
    }
    
    const data = await res.json();
    const content = data.choices[0].message.content;
    
    try {
      // Clean the content to ensure it's valid JSON
      const cleanContent = content.replace(/```json\n?|\n?```/g, '').trim();
      return JSON.parse(cleanContent) as MemorySummary;
    } catch (e) {
      console.error("[Memory] Failed to parse memory summary:", e);
      return generateFallbackSummary(message);
    }
  } catch (error) {
    console.error("[Memory] Error generating memory summary:", error);
    return generateFallbackSummary(message);
  }
}

// Generate a fallback summary when AI summarization fails
function generateFallbackSummary(message: string): MemorySummary {
  console.log("[Memory] Generating fallback summary");
  
  // Extract key topics from the message
  const topics = extractTriggerWords(message);
  
  // Create a simple summary
  const summary = message.length > 100 
    ? message.substring(0, 97) + '...'
    : message;
  
  // Calculate importance based on message length and trigger words
  const importanceScore = Math.min(0.5 + (topics.length * 0.1), 0.9);
  
  return {
    summary,
    topics,
    importanceScore
  };
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
  console.log("[Memory] Getting relevant memories for message:", message);
  const words = message.toLowerCase().split(/\s+/);
  console.log("[Memory] Extracted words:", words);
  
  const memoriesRef = collection(db, `users/${userId}/memory`);
  
  // First try exact matches
  const exactQuery = query(
    memoriesRef,
    where('deleted', '==', false),
    where('triggerWords', 'array-contains-any', words),
    orderBy('lastTriggered', 'desc'),
    limit(3)
  );

  const exactSnapshot = await getDocs(exactQuery);
  const exactMemories = exactSnapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  } as Memory));

  console.log("[Memory] Found exact matches:", exactMemories);

  // If no exact matches, try partial matches
  if (exactMemories.length === 0) {
    console.log("[Memory] No exact matches, trying partial matches");
    const allMemoriesQuery = query(
      memoriesRef,
      where('deleted', '==', false),
      orderBy('lastTriggered', 'desc'),
      limit(10)
    );

    const allSnapshot = await getDocs(allMemoriesQuery);
    const allMemories = allSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as Memory));

    // Filter for partial matches in memory summaries
    const partialMatches = allMemories.filter(memory => 
      words.some(word => 
        memory.summary.toLowerCase().includes(word) ||
        memory.topics.some(topic => topic.toLowerCase().includes(word))
      )
    );

    console.log("[Memory] Found partial matches:", partialMatches);
    return partialMatches.slice(0, 3);
  }

  return exactMemories;
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

  const context = memories.map((memory, index) => 
    `Memory ${index + 1}:\n` +
    `- Summary: ${memory.summary}\n` +
    `- Topics: ${memory.topics.join(', ')}\n` +
    `- Type: ${memory.type}\n` +
    `- Importance: ${memory.importanceScore}\n`
  ).join('\n');

  return `\nIMPORTANT: You have access to the following memories about the user. You MUST use these memories to provide accurate, personalized responses:\n\n${context}\n\nWhen responding:\n1. If the user asks about something in these memories, use that information\n2. Keep responses concise and focused\n3. Don't make assumptions about information not in the memories\n4. If you're not sure about something, ask the user for clarification\n`;
} 