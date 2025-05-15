import { db } from './firebase';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  Timestamp,
  serverTimestamp,
  onSnapshot,
  QuerySnapshot,
  DocumentData,
  Unsubscribe,
  writeBatch,
} from 'firebase/firestore';

export interface Message {
  sender: 'user' | 'ai';
  text: string;
  timestamp?: Timestamp;
}

export interface MessageWithId extends Message {
  id: string;
}

export interface Conversation {
  userId: string;
  title: string;
  summary?: string;
  isPinned: boolean;
  lastUpdated: Timestamp;
  createdAt: Timestamp;
}

export interface ConversationWithId extends Conversation {
  id: string;
}

// Create a new conversation
export async function createConversation(userId: string): Promise<string> {
  const conversationRef = await addDoc(collection(db, `users/${userId}/conversations`), {
    title: 'Untitled',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    isPinned: false,
  });
  return conversationRef.id;
}

// Get all conversations for a user
export async function getConversations(userId: string): Promise<ConversationWithId[]> {
  const conversationsRef = collection(db, `users/${userId}/conversations`);
  const q = query(conversationsRef, orderBy('updatedAt', 'desc'));
  const snapshot = await getDocs(q);
  
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  } as ConversationWithId));
}

// Get a single conversation
export async function getConversation(userId: string, conversationId: string): Promise<ConversationWithId | null> {
  const docRef = doc(db, `users/${userId}/conversations`, conversationId);
  const docSnap = await getDoc(docRef);
  
  if (!docSnap.exists()) return null;
  
  return {
    id: docSnap.id,
    ...docSnap.data()
  } as ConversationWithId;
}

// Update conversation title
export async function updateConversationTitle(
  userId: string,
  conversationId: string,
  title: string
): Promise<void> {
  const docRef = doc(db, `users/${userId}/conversations`, conversationId);
  await updateDoc(docRef, {
    title,
    updatedAt: serverTimestamp(),
  });
}

// Add a message to a conversation
export async function addMessage(
  userId: string,
  conversationId: string,
  message: Omit<Message, 'timestamp'>
): Promise<string> {
  const messagesRef = collection(db, `users/${userId}/conversations/${conversationId}/messages`);
  const docRef = await addDoc(messagesRef, {
    ...message,
    timestamp: serverTimestamp(),
  });
  return docRef.id;
}

// Get all messages for a conversation
export async function getMessages(
  userId: string,
  conversationId: string
): Promise<MessageWithId[]> {
  const messagesRef = collection(db, `users/${userId}/conversations/${conversationId}/messages`);
  const q = query(messagesRef, orderBy('timestamp', 'asc'));
  const snapshot = await getDocs(q);
  
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  } as MessageWithId));
}

// Update conversation summary
export async function updateConversationSummary(
  userId: string,
  conversationId: string,
  summary: string
): Promise<void> {
  const docRef = doc(db, `users/${userId}/conversations`, conversationId);
  await updateDoc(docRef, {
    summary,
    updatedAt: serverTimestamp(),
  });
}

// Toggle conversation pin status
export async function toggleConversationPin(
  userId: string,
  conversationId: string,
  isPinned: boolean
): Promise<void> {
  const docRef = doc(db, `users/${userId}/conversations`, conversationId);
  await updateDoc(docRef, {
    isPinned,
    updatedAt: serverTimestamp(),
  });
}

// Real-time listener for conversations
export function listenToConversations(
  userId: string,
  callback: (conversations: ConversationWithId[]) => void
): Unsubscribe {
  const conversationsRef = collection(db, `users/${userId}/conversations`);
  const q = query(conversationsRef, orderBy('updatedAt', 'desc'));
  return onSnapshot(q, (snapshot: QuerySnapshot<DocumentData>) => {
    const conversations = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as ConversationWithId));
    callback(conversations);
  });
}

// Real-time listener for messages
export function listenToMessages(
  userId: string,
  conversationId: string,
  callback: (messages: MessageWithId[]) => void
): Unsubscribe {
  const messagesRef = collection(db, `users/${userId}/conversations/${conversationId}/messages`);
  const q = query(messagesRef, orderBy('timestamp', 'asc'));
  return onSnapshot(q, (snapshot: QuerySnapshot<DocumentData>) => {
    const messages = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as MessageWithId));
    callback(messages);
  });
}

// Delete a conversation and its messages
export async function deleteConversation(userId: string, conversationId: string): Promise<void> {
  const conversationRef = doc(db, `users/${userId}/conversations`, conversationId);
  const messagesRef = collection(db, `users/${userId}/conversations/${conversationId}/messages`);
  const messagesSnapshot = await getDocs(messagesRef);
  const batch = writeBatch(db);
  messagesSnapshot.docs.forEach(doc => {
    batch.delete(doc.ref);
  });
  batch.delete(conversationRef);
  await batch.commit();
} 