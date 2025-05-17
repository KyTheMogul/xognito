import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();
    const apiKey = process.env.DEEPSEEK_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key not configured' },
        { status: 500 }
      );
    }

    const response = await fetch('https://api.deepseek.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat-2.0',
        messages,
        stream: true,
        temperature: 0.7,
        max_tokens: 1000
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[DeepSeek API] Error:', error);
      return NextResponse.json(
        { error: 'Failed to get response from DeepSeek' },
        { status: response.status }
      );
    }

    // Forward the stream
    const stream = response.body;
    return new NextResponse(stream);
  } catch (error) {
    console.error('[DeepSeek API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 