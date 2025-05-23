import { useState, useEffect } from 'react';
import Image from 'next/image';

interface ImageMessageProps {
  imageUrl: string;
  prompt: string;
}

export default function ImageMessage({ imageUrl, prompt }: ImageMessageProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const img = new window.Image();
    img.src = imageUrl;
    img.onload = () => setIsLoading(false);
    img.onerror = () => setError('Failed to load image');
  }, [imageUrl]);

  return (
    <div className="relative w-full max-w-[600px] aspect-square rounded-xl overflow-hidden bg-white/5 border border-white/10">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-10">
          <div className="w-8 h-8 border-4 border-white/20 border-t-white/80 rounded-full animate-spin" />
        </div>
      )}
      {error ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <p className="text-white/60 text-sm">{error}</p>
        </div>
      ) : (
        <Image
          src={imageUrl}
          alt={prompt}
          fill
          className="object-cover"
          sizes="(max-width: 600px) 100vw, 600px"
        />
      )}
    </div>
  );
} 