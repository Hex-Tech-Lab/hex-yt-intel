'use client';

import { useEffect, useState } from 'react';
import HomeContent from '@/components/organisms/HomeContent';
import { LandingHero } from '@/app/components/LandingHero';
import { useAuth } from '@/hooks/useAuth';

export default function Home() {
  const { user, isLoading } = useAuth();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || isLoading) {
    return null;
  }

  return user ? <HomeContent /> : <LandingHero />;
}
