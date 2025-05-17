import { NextRequest, NextResponse } from 'next/server';
import { storage } from '@/lib/firebase';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';

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
      return NextResponse.json(
        { error: 'Missing image or userId' }, 
        { status: 400 }
      );
    }

    // Validate base64 image format
    if (!image.startsWith('data:image/')) {
      return NextResponse.json(
        { error: 'Invalid image format. Must be a base64 data URL.' }, 
        { status: 400 }
      );
    }

    // Create a reference to the storage location
    const storageRef = ref(storage, `profile-photos/${userId}/${Date.now()}.jpg`);

    try {
      // Upload the base64 image to Firebase Storage
      await uploadString(storageRef, image, 'data_url');
      console.log('Image uploaded successfully');

      // Get the download URL
      const downloadURL = await getDownloadURL(storageRef);
      console.log('Got download URL:', downloadURL);

      return NextResponse.json({ downloadURL });
    } catch (uploadError) {
      console.error('Error during upload:', uploadError);
      return NextResponse.json(
        { error: 'Failed to upload image to storage' }, 
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error in profile photo upload:', error);
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    );
  }
} 