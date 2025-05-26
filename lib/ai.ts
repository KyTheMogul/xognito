export async function fetchDeepSeekResponseStream(
  messages: { role: 'user' | 'system' | 'assistant'; content: string }[],
  onChunk: (chunk: string) => void
): Promise<void> {
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messages }),
    });

    if (!response.ok) {
      throw new Error('Failed to fetch AI response');
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      onChunk(chunk);
    }
  } catch (error) {
    console.error('Error in fetchDeepSeekResponseStream:', error);
    throw error;
  }
} 