import { NextResponse } from 'next/server';
import { VertexAI } from '@google-cloud/vertexai';

export async function GET() {
  try {
    const projectId = process.env.GOOGLE_CLOUD_PROJECT;
    const credentialsBase64 = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64;

    // Check if environment variables are set
    if (!projectId) {
      return NextResponse.json({ error: 'GOOGLE_CLOUD_PROJECT is not set' }, { status: 500 });
    }

    if (!credentialsBase64) {
      return NextResponse.json({ error: 'GOOGLE_APPLICATION_CREDENTIALS_BASE64 is not set' }, { status: 500 });
    }

    // Try to decode and parse credentials
    let parsedCredentials;
    try {
      const credentialsJson = Buffer.from(credentialsBase64, 'base64').toString('utf-8');
      parsedCredentials = JSON.parse(credentialsJson);
    } catch (e) {
      return NextResponse.json({ 
        error: 'Failed to decode or parse credentials',
        details: e instanceof Error ? e.message : 'Unknown error'
      }, { status: 500 });
    }

    // Try to initialize Vertex AI
    try {
      const vertex = new VertexAI({
        project: projectId,
        location: 'us-central1',
        googleAuthOptions: {
          credentials: parsedCredentials,
        },
      });

      // Test if we can get the model
      const model = vertex.preview.getGenerativeModel({
        model: 'imagegeneration@002',
      });

      return NextResponse.json({
        status: 'success',
        projectId,
        credentialsAvailable: true,
        credentialsValid: true,
        modelAvailable: true,
      });
    } catch (e) {
      return NextResponse.json({
        error: 'Failed to initialize Vertex AI',
        details: e instanceof Error ? e.message : 'Unknown error',
      }, { status: 500 });
    }
  } catch (error) {
    return NextResponse.json({
      error: 'Unexpected error',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
} 