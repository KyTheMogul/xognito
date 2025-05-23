import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { auth } from '@/lib/firebase';
import ImageMessage from './ImageMessage';
import Image from 'next/image';

const USER_PROFILE = 'https://randomuser.me/api/portraits/men/32.jpg';
const AI_PROFILE = '/XognitoLogoFull.png';

// Add to your Message interface
interface Message {
  role: 'user' | 'assistant';
  content: string;
  imageUrl?: string;
}

export default function Chat() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { isAuthenticated } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !isAuthenticated) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    try {
      // Check if the message is requesting an image generation
      const isImageRequest = /generate|create|make|design|draw|logo|image|picture|photo/i.test(userMessage.toLowerCase());

      if (isImageRequest) {
        const idToken = await auth.currentUser?.getIdToken();
        if (!idToken) {
          throw new Error('Not authenticated');
        }

        const response = await fetch('/api/generate-image', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({ prompt: userMessage })
        });

        const data = await response.json();

        if (!response.ok) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: data.error || 'Failed to generate image. Please try again.'
          }]);
          return;
        }

        setMessages(prev => [...prev, {
          role: 'assistant',
          content: 'Here\'s the image you requested:',
          imageUrl: data.imageUrl
        }]);
        return;
      }

      // Regular chat message handling
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        throw new Error('Not authenticated');
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          messages: [...messages, { role: 'user', content: userMessage }]
        })
      });

      const data = await response.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.message }]);
    } catch (error) {
      console.error('Error:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, something went wrong. Please try again.'
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex items-start space-x-4 ${
              message.role === 'user' ? 'flex-row-reverse space-x-reverse' : ''
            }`}
          >
            <div className="flex-shrink-0">
              <Image
                src={message.role === 'user' ? USER_PROFILE : AI_PROFILE}
                alt={message.role === 'user' ? 'User' : 'AI'}
                width={40}
                height={40}
                className="rounded-full"
              />
            </div>
            <div
              className={`flex-1 max-w-[80%] rounded-lg p-4 ${
                message.role === 'user'
                  ? 'bg-white/5 text-white/80'
                  : 'bg-white/5 text-white/80'
              }`}
            >
              <p className="whitespace-pre-wrap">{message.content}</p>
              {message.imageUrl && (
                <div className="mt-4">
                  <ImageMessage imageUrl={message.imageUrl} prompt={message.content} />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={handleSubmit} className="p-4 border-t border-white/10">
        <div className="flex space-x-4">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white/80 focus:outline-none focus:border-white/20"
            disabled={isLoading || !isAuthenticated}
          />
          <button
            type="submit"
            disabled={isLoading || !isAuthenticated}
            className="bg-white/5 text-white/80 px-6 py-2 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Sending...' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
} 