import { NextResponse } from 'next/server';
import Replicate from 'replicate';
import { auth } from '@/lib/firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const db = getFirestore();

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();
    const authHeader = req.headers.get('authorization');
    
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(token);
    const userId = decodedToken.uid;

    // Get user's subscription status and image generation limits
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    const userData = userDoc.data();

    if (!userData) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Check rate limiting (5 requests per 15 minutes)
    const recentImages = await db
      .collection('imageGenerations')
      .where('userId', '==', userId)
      .where('createdAt', '>', new Date(Date.now() - 15 * 60 * 1000))
      .get();

    if (recentImages.size >= 5) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please wait 15 minutes before generating more images.' },
        { status: 429 }
      );
    }

    // Check monthly limits based on subscription
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const monthlyImages = await db
      .collection('imageGenerations')
      .where('userId', '==', userId)
      .where('createdAt', '>=', monthStart)
      .get();

    const monthlyCount = monthlyImages.size;
    const limit = userData.subscription === 'pro' ? 100 : 
                 userData.subscription === 'proplus' ? Infinity : 2;

    if (monthlyCount >= limit) {
      return NextResponse.json(
        { error: 'Monthly image generation limit reached.' },
        { status: 429 }
      );
    }

    // Generate image
    const output = await replicate.run(
      "recraft-ai/recraft-v3",
      {
        input: {
          size: "1365x1024",
          prompt: prompt
        }
      }
    );

    // Record the generation
    await db.collection('imageGenerations').add({
      userId,
      prompt,
      createdAt: new Date(),
      imageUrl: output
    });

    return NextResponse.json({ imageUrl: output });
  } catch (error) {
    console.error('Image generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate image' },
      { status: 500 }
    );
  }
} 