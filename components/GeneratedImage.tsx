import { useState, useEffect } from 'react';
import Image from 'next/image';

interface GeneratedImageProps {
  imageUrl: string;
  prompt: string;
}

export default function GeneratedImage({ imageUrl, prompt }: GeneratedImageProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    setError(null);

    // Create a temporary image element to check if the image loads
    const img = document.createElement('img');
    img.src = imageUrl;
    
    img.onload = () => {
      setIsLoading(false);
    };

    img.onerror = () => {
      setError('Failed to load image');
      setIsLoading(false);
    };
  }, [imageUrl]);

  return (
    <div className="relative w-full max-w-2xl mx-auto my-4">
      <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-zinc-900/50 border border-zinc-800">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-10">
            <div className="flex flex-col items-center gap-2">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-white"></div>
              <p className="text-white/80 text-sm">Generating your image...</p>
            </div>
          </div>
        )}
        
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center bg-red-900/20">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        ) : (
          <Image
            src={imageUrl}
            alt={prompt}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          />
        )}
      </div>
      <p className="mt-2 text-sm text-zinc-400 text-center">{prompt}</p>
    </div>
  );
} 