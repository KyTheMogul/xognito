'use client';

import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { handleAuth } = useAuth();

  useEffect(() => {
    handleAuth();
  }, [handleAuth]);

  return (
    <div className="min-h-screen bg-black">
      {children}
    </div>
  );
} 