// Test script for XloudID authentication flow
import fetch from 'node-fetch';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken } from 'firebase/auth';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from both .env.local and .env files
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '.env') });

// Validate required environment variables
const requiredEnvVars = {
  NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};

console.log("Environment check:", {
  hasApiKey: !!requiredEnvVars.NEXT_PUBLIC_FIREBASE_API_KEY,
  hasAuthDomain: !!requiredEnvVars.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  hasProjectId: !!requiredEnvVars.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  envFiles: {
    envLocal: path.resolve(__dirname, '../.env.local'),
    env: path.resolve(__dirname, '.env')
  }
});

const missingVars = Object.entries(requiredEnvVars)
  .filter(([_, value]) => !value)
  .map(([key]) => key);

if (missingVars.length > 0) {
  console.error("Missing required environment variables:", missingVars);
  console.log("\nPlease create a .env file in the scripts directory with the following variables:");
  console.log("NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key");
  console.log("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_auth_domain");
  console.log("NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id");
  process.exit(1);
}

// Initialize Firebase
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

async function testAuth() {
  console.log("\nStarting authentication test...\n");

  // Step 1: Exchange token for Firebase token
  console.log("Step 1: Exchanging token for Firebase token");
  const testToken = `test_token_${Date.now()}`;
  const apiUrl = "http://localhost:3000/api/auth/xloudid";

  try {
    console.log("Attempting to connect to:", apiUrl);
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token: testToken }),
    });

    console.log("Response status:", response.status);
    console.log("Response headers:", response.headers.raw());
    
    const responseText = await response.text();
    console.log("Response body:", responseText);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}\nResponse: ${responseText}`);
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      throw new Error(`Failed to parse JSON response: ${e.message}\nResponse: ${responseText}`);
    }

    if (!data.firebaseToken) {
      throw new Error("No Firebase token in response");
    }

    console.log("Token exchange successful:", {
      uid: data.user.uid,
      email: data.user.email,
      emailVerified: data.user.emailVerified,
      tokenLength: data.firebaseToken.length
    });

    // Step 2: Verify Firebase token
    console.log("\nStep 2: Verifying Firebase token");
    try {
      const userCredential = await signInWithCustomToken(auth, data.firebaseToken);
      console.log("Firebase token verification successful:", {
        uid: userCredential.user.uid,
        email: userCredential.user.email,
        emailVerified: userCredential.user.emailVerified,
        isAnonymous: userCredential.user.isAnonymous,
        metadata: userCredential.user.metadata
      });

      // Step 3: Get user info
      console.log("\nStep 3: Getting user info");
      const idToken = await userCredential.user.getIdToken();
      console.log("User ID token:", {
        tokenLength: idToken.length,
        tokenPrefix: idToken.substring(0, 20) + "..."
      });

      console.log("\nTest completed successfully! ✅");
    } catch (error) {
      console.error("\nTest failed:", error);
      console.log("\nTroubleshooting tips:");
      console.log("1. Make sure the development server is running (npm run dev)");
      console.log("2. Check that the API route is accessible at http://localhost:3000/api/auth/xloudid");
      console.log("3. Verify that all required environment variables are set");
      console.log("4. Check the server logs for any errors");
    }
  } catch (error) {
    console.error("\nTest failed:", error);
    console.log("\nTroubleshooting tips:");
    console.log("1. Make sure the development server is running (npm run dev)");
    console.log("2. Check that the API route is accessible at http://localhost:3000/api/auth/xloudid");
    console.log("3. Verify that all required environment variables are set");
    console.log("4. Check the server logs for any errors");
  }
}

testAuth(); 