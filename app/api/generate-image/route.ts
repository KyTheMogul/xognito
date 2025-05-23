import { NextResponse } from 'next/server';
import Replicate from 'replicate';
import { auth } from '@/lib/firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

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

// Add aspect ratio detection function
function detectAspectRatio(prompt: string): { width: number; height: number } {
  const promptLower = prompt.toLowerCase();
  
  // Common aspect ratios
  if (promptLower.includes('16:9') || promptLower.includes('16x9')) {
    return { width: 1920, height: 1080 };
  }
  if (promptLower.includes('4:3') || promptLower.includes('4x3')) {
    return { width: 1600, height: 1200 };
  }
  if (promptLower.includes('3:4') || promptLower.includes('3x4')) {
    return { width: 1200, height: 1600 };
  }
  if (promptLower.includes('9:16') || promptLower.includes('9x16')) {
    return { width: 1080, height: 1920 };
  }
  if (promptLower.includes('1:1') || promptLower.includes('square')) {
    return { width: 1024, height: 1024 };
  }
  
  // Default to square if no aspect ratio specified
  return { width: 1024, height: 1024 };
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
      'usage.imagesGenerated': adminDb.FieldValue.increment(1)
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