import { NextRequest, NextResponse } from 'next/server';
import { storage } from '@/lib/firebase-admin';

// Add CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://www.xognito.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Handle OPTIONS request for CORS preflight
export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

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
        { status: 400, headers: corsHeaders }
      );
    }

    // Validate base64 image format
    if (!image.startsWith('data:image/')) {
      console.error('Invalid image format:', image.substring(0, 50) + '...');
      return NextResponse.json(
        { error: 'Invalid image format. Must be a base64 data URL.' }, 
        { status: 400, headers: corsHeaders }
      );
    }

    // Get the storage bucket
    const bucket = storage.bucket();
    if (!bucket) {
      throw new Error('Storage bucket is not initialized');
    }

    // Create a unique filename
    const filename = `profile-photos/${userId}/${Date.now()}.jpg`;
    const file = bucket.file(filename);
    
    try {
      // Convert base64 to buffer
      const base64Data = image.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      
      // Upload the file
      console.log('Uploading image to:', filename);
      await file.save(buffer, {
        metadata: {
          contentType: 'image/jpeg',
          metadata: {
            userId: userId,
            uploadedAt: new Date().toISOString()
          }
        },
        resumable: false
      });
      
      console.log('Image uploaded successfully');

      // Make the file publicly accessible
      await file.makePublic();
      
      // Get the public URL
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filename}`;
      console.log('Generated public URL:', publicUrl);

      return NextResponse.json({ 
        downloadURL: publicUrl,
        filename: filename
      }, { headers: corsHeaders });
      
    } catch (uploadError: any) {
      console.error('Error during upload:', {
        code: uploadError.code,
        message: uploadError.message,
        stack: uploadError.stack
      });
      return NextResponse.json(
        { error: `Failed to upload image to storage: ${uploadError.message}` }, 
        { status: 500, headers: corsHeaders }
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
      { status: 500, headers: corsHeaders }
    );
  }
} 