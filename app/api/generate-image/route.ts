import { NextResponse } from 'next/server';
import Replicate from 'replicate';
import { auth } from '@/lib/firebase-admin';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const adminDb = getFirestore();

// Helper function to check user's image generation limits
async function checkImageLimits(uid: string) {
  const userRef = adminDb.collection('users').doc(uid);
  const userDoc = await userRef.get();
  const userData = userDoc.data();

  if (!userData) {
    throw new Error('User not found');
  }

  const subscription = userData.subscription || { plan: 'free' };
  const usage = userData.usage || { imagesGenerated: 0, lastImageReset: new Date() };

  // Check if we need to reset the monthly count
  const now = new Date();
  const lastReset = usage.lastImageReset?.toDate() || new Date(0);
  const needsReset = now.getMonth() !== lastReset.getMonth() || now.getFullYear() !== lastReset.getFullYear();

  if (needsReset) {
    await userRef.update({
      'usage.imagesGenerated': 0,
      'usage.lastImageReset': now
    });
    return { canGenerate: true, remaining: subscription.plan === 'free' ? 2 : 100 };
  }

  // Check limits based on subscription
  const limit = subscription.plan === 'free' ? 2 : 
                subscription.plan === 'Pro' ? 100 : 
                Infinity; // ProPlus gets unlimited

  const remaining = limit - (usage.imagesGenerated || 0);
  return { canGenerate: remaining > 0, remaining };
}

// Helper function to check rate limiting
async function checkRateLimit(uid: string) {
  const userRef = adminDb.collection('users').doc(uid);
  const userDoc = await userRef.get();
  const userData = userDoc.data();

  if (!userData) {
    throw new Error('User not found');
  }

  const usage = userData.usage || { lastImageRequests: [] };
  const now = new Date();
  const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);

  // Filter out old requests
  const recentRequests = (usage.lastImageRequests || [])
    .filter((timestamp: any) => timestamp.toDate() > fifteenMinutesAgo);

  if (recentRequests.length >= 5) {
    return false;
  }

  // Add current request
  recentRequests.push(now);
  await userRef.update({
    'usage.lastImageRequests': recentRequests
  });

  return true;
}

// Trigger words that indicate image generation
const IMAGE_TRIGGERS = [
  'generate image',
  'create image',
  'make image',
  'generate a picture',
  'create a picture',
  'make a picture',
  'generate a photo',
  'create a photo',
  'make a photo',
  'generate a logo',
  'create a logo',
  'make a logo',
  'generate an illustration',
  'create an illustration',
  'make an illustration'
];

// Aspect ratio patterns
const ASPECT_RATIOS = {
  '1:1': { width: 1024, height: 1024 },
  'square': { width: 1024, height: 1024 },
  '16:9': { width: 1024, height: 576 },
  'widescreen': { width: 1024, height: 576 },
  '9:16': { width: 576, height: 1024 },
  'portrait': { width: 576, height: 1024 },
  '4:3': { width: 1024, height: 768 },
  'standard': { width: 1024, height: 768 },
  '3:4': { width: 768, height: 1024 },
  'vertical': { width: 768, height: 1024 }
};

function detectAspectRatio(prompt: string): { width: number; height: number } {
  const lowerPrompt = prompt.toLowerCase();
  
  // Check for explicit aspect ratio mentions
  for (const [key, dimensions] of Object.entries(ASPECT_RATIOS)) {
    if (lowerPrompt.includes(key)) {
      return dimensions;
    }
  }

  // Check for dimension patterns (e.g., "16x9", "9x16")
  const dimensionMatch = prompt.match(/(\d+)[x:×](\d+)/i);
  if (dimensionMatch) {
    const [_, width, height] = dimensionMatch;
    return {
      width: Math.min(parseInt(width), 1024),
      height: Math.min(parseInt(height), 1024)
    };
  }

  // Default to 4:3 if no aspect ratio is specified
  return ASPECT_RATIOS['4:3'];
}

function isImageGenerationRequest(prompt: string): boolean {
  const lowerPrompt = prompt.toLowerCase();
  return IMAGE_TRIGGERS.some(trigger => lowerPrompt.includes(trigger));
}

export async function POST(request: Request) {
  try {
    // Get the authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify the token
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(token);
    const uid = decodedToken.uid;

    // Check rate limiting
    const canRequest = await checkRateLimit(uid);
    if (!canRequest) {
      return NextResponse.json({
        error: 'Rate limit exceeded',
        message: 'Have fun creating images! You reached a peak request. Give 15 minutes to request again. In the meantime, I can help you describe the image you would like to create.'
      }, { status: 429 });
    }

    // Check image generation limits
    const { canGenerate, remaining } = await checkImageLimits(uid);
    if (!canGenerate) {
      return NextResponse.json({
        error: 'Monthly limit exceeded',
        message: `You've reached your monthly limit of ${remaining} images. Please upgrade your plan for more generations.`
      }, { status: 403 });
    }

    // Get the prompt from the request body
    const { prompt } = await request.json();
    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    // Check if this is an image generation request
    if (!isImageGenerationRequest(prompt)) {
      return NextResponse.json(
        { error: 'Not an image generation request' },
        { status: 400 }
      );
    }

    // Detect aspect ratio from prompt
    const { width, height } = detectAspectRatio(prompt);

    // Generate the image
    const output = await replicate.run(
      "recraft-ai/recraft-v3",
      {
        input: {
          size: `${width}x${height}`,
          prompt: prompt
        }
      }
    );

    // Update user's image generation count
    const userRef = adminDb.collection('users').doc(uid);
    await userRef.update({
      'usage.imagesGenerated': FieldValue.increment(1)
    });

    return NextResponse.json({ imageUrl: output });
  } catch (error: any) {
    console.error('Image generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate image', details: error.message },
      { status: 500 }
    );
  }
} 