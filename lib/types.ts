import { Timestamp } from 'firebase/firestore';

export type Message = {
  sender: 'user' | 'ai';
  text: string;
  timestamp: Timestamp;
  toolUsed?: string;
  isFromTap?: boolean;
};

export type Conversation = {
  title: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  isPinned: boolean;
  summary?: string;
};

export type ConversationWithId = Conversation & {
  id: string;
};

export type MessageWithId = Message & {
  id: string;
}; 