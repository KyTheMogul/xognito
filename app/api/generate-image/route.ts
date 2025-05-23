import { NextResponse } from 'next/server';
import axios from 'axios';
import FormData from 'form-data';

export async function POST(request: Request) {
  try {
    const { prompt } = await request.json();
    console.log('Received prompt:', prompt);

    if (!prompt) {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      );
    }

    if (!process.env.STABILITY_API_KEY) {
      throw new Error('STABILITY_API_KEY is not configured');
    }

    const payload = {
      prompt,
      output_format: 'webp',
      aspect_ratio: '1:1',
      style_preset: 'photographic',
    };

    console.log('Sending request to Stability AI...');
    const response = await axios.postForm(
      'https://api.stability.ai/v2beta/stable-image/generate/ultra',
      axios.toFormData(payload, new FormData()),
      {
        validateStatus: undefined,
        responseType: 'arraybuffer',
        headers: { 
          Authorization: `Bearer ${process.env.STABILITY_API_KEY}`,
          Accept: 'image/*',
          'stability-client-id': 'xognito-app',
        },
      },
    );

    if (response.status !== 200) {
      const errorMessage = Buffer.from(response.data).toString();
      console.error('Stability AI error:', errorMessage);
      throw new Error(`Stability AI error: ${errorMessage}`);
    }

    // Convert the image buffer to base64
    const base64Image = Buffer.from(response.data).toString('base64');
    const imageUrl = `data:image/webp;base64,${base64Image}`;

    return NextResponse.json({
      imageUrl,
    });
  } catch (error) {
    console.error('Error generating image:', error);
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Failed to generate image',
        details: error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    );
  }
} 