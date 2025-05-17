import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();
    const apiKey = process.env.NEXT_PUBLIC_DEEPSEEK_API_KEY;

    if (!apiKey) {
      console.error('[DeepSeek API] No API key found in environment variables');
      return NextResponse.json(
        { error: 'API key not configured' },
        { status: 500 }
      );
    }

    console.log('[DeepSeek API] Making request with API key:', apiKey.substring(0, 5) + '...');
    console.log('[DeepSeek API] Request payload:', JSON.stringify({
      model: 'deepseek-chat-2.0',
      messages,
      stream: true,
      temperature: 0.7,
      max_tokens: 1000
    }, null, 2));

    try {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
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
        const errorText = await response.text();
        console.error('[DeepSeek API] Error response:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
          headers: Object.fromEntries(response.headers.entries())
        });
        return NextResponse.json(
          { error: `DeepSeek API error: ${response.status} ${response.statusText} - ${errorText}` },
          { status: response.status }
        );
      }

      // Forward the stream
      const stream = response.body;
      if (!stream) {
        console.error('[DeepSeek API] No response stream received');
        return NextResponse.json(
          { error: 'No response stream from DeepSeek API' },
          { status: 500 }
        );
      }

      return new NextResponse(stream);
    } catch (fetchError) {
      console.error('[DeepSeek API] Fetch error:', {
        error: fetchError,
        message: fetchError instanceof Error ? fetchError.message : 'Unknown error',
        stack: fetchError instanceof Error ? fetchError.stack : undefined
      });
      return NextResponse.json(
        { error: `Network error: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}` },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[DeepSeek API] Request processing error:', {
      error,
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 