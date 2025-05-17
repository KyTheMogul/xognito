import { NextRequest, NextResponse } from 'next/server';
import { storage } from '@/lib/firebase';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    console.log('Received payload:', payload);
    const { image, userId } = payload;
    if (!image || !userId) {
      return NextResponse.json({ error: 'Missing image or userId' }, { status: 400 });
    }

    // Create a reference to the storage location
    const storageRef = ref(storage, `profile-photos/${userId}/${Date.now()}.jpg`);

    // Upload the base64 image to Firebase Storage
    await uploadString(storageRef, image, 'data_url');

    // Get the download URL
    const downloadURL = await getDownloadURL(storageRef);

    return NextResponse.json({ downloadURL });
  } catch (error) {
    console.error('Error uploading profile photo:', error);
    return NextResponse.json({ error: 'Failed to upload profile photo' }, { status: 500 });
  }
} 