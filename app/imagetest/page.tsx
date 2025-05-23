'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export default function ImageTest() {
  const [prompt, setPrompt] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [isImageLoaded, setIsImageLoaded] = useState(false);

  const generateImage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setIsLoading(true);
    setError(null);
    setImageUrl(null);
    setDebugInfo(null);

    try {
      console.log('Sending request with prompt:', prompt);
      
      const response = await fetch('/api/generate-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt }),
      });

      console.log('Response status:', response.status);
      const data = await response.json();
      console.log('Received response:', data);

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate image');
      }

      if (!data.imageUrl) {
        console.error('No imageUrl in response:', data);
        throw new Error('No image URL received from the server');
      }

      // Verify the URL is valid
      try {
        new URL(data.imageUrl);
      } catch (e) {
        console.error('Invalid image URL:', data.imageUrl);
        throw new Error('Invalid image URL received from the server');
      }

      setImageUrl(data.imageUrl);
      setDebugInfo(data);
    } catch (err) {
      console.error('Error:', err);
      setError(err instanceof Error ? err.message : 'An error occurred');
      setDebugInfo(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-2xl mx-auto space-y-8">
        <h1 className="text-3xl font-bold">Image Generation Test</h1>
        
        <form onSubmit={generateImage} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="prompt" className="text-sm font-medium">
              Enter your prompt
            </label>
            <Input
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the image you want to generate..."
              className="bg-zinc-900 border-zinc-700 text-white"
            />
          </div>
          
          <Button 
            type="submit" 
            disabled={isLoading || !prompt.trim()}
            className="w-full bg-white text-black hover:bg-zinc-100"
          >
            {isLoading ? 'Generating...' : 'Generate Image'}
          </Button>
        </form>

        {error && (
          <div className="p-4 bg-red-500/10 border border-red-500 rounded-lg text-red-500">
            <p className="font-medium">Error:</p>
            <p>{error}</p>
            {debugInfo && (
              <div className="mt-2 p-2 bg-black/50 rounded text-xs font-mono overflow-auto">
                <pre>{JSON.stringify(debugInfo, null, 2)}</pre>
              </div>
            )}
          </div>
        )}

        {(imageUrl || isLoading) && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Generated Image</h2>
            <div className="relative aspect-square w-full max-w-md mx-auto">
              {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/10 backdrop-blur-sm rounded-lg">
                  <div className="w-12 h-12 border-4 border-white border-t-transparent rounded-full animate-spin"></div>
                </div>
              )}
              {imageUrl && (
                <div className={cn(
                  "relative transition-all duration-500",
                  isLoading ? "blur-xl" : isImageLoaded ? "blur-0" : "blur-xl"
                )}>
                  <img
                    src={imageUrl}
                    alt="Generated image"
                    className="rounded-lg object-cover w-full h-full"
                    onLoad={() => setIsImageLoaded(true)}
                    onError={(e) => {
                      console.error('Image failed to load:', imageUrl);
                      setError('Failed to load the generated image');
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
} 