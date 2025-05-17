import { NextRequest, NextResponse } from 'next/server';
import { storage } from '@/lib/firebase-admin';

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    console.log('Received payload:', { 
      hasImage: !!payload.image, 
      imageLength: payload.image?.length,
      userId: payload.userId 
    });

    const { image, userId } = payload;
    
    if (!image || !userId) {
      console.error('Missing required fields:', { hasImage: !!image, hasUserId: !!userId });
      return NextResponse.json(
        { error: 'Missing image or userId' }, 
        { status: 400 }
      );
    }

    // Validate base64 image format
    if (!image.startsWith('data:image/')) {
      console.error('Invalid image format:', image.substring(0, 50) + '...');
      return NextResponse.json(
        { error: 'Invalid image format. Must be a base64 data URL.' }, 
        { status: 400 }
      );
    }

    // Create a reference to the storage location
    const bucket = storage.bucket();
    const file = bucket.file(`profile-photos/${userId}/${Date.now()}.jpg`);
    
    try {
      // Upload the base64 image to Firebase Storage
      console.log('Attempting to upload image...');
      const buffer = Buffer.from(image.split(',')[1], 'base64');
      
      await file.save(buffer, {
        metadata: {
          contentType: 'image/jpeg',
        },
        resumable: false
      });
      
      console.log('Image uploaded successfully');

      // Get the download URL
      console.log('Getting download URL...');
      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: '03-01-2500', // Far future expiration
      });
      
      console.log('Got download URL:', url);
      return NextResponse.json({ downloadURL: url });
      
    } catch (uploadError: any) {
      console.error('Error during upload:', {
        code: uploadError.code,
        message: uploadError.message,
        stack: uploadError.stack
      });
      return NextResponse.json(
        { error: `Failed to upload image to storage: ${uploadError.message}` }, 
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('Error in profile photo upload:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    return NextResponse.json(
      { error: `Internal server error: ${error.message}` }, 
      { status: 500 }
    );
  }
} 