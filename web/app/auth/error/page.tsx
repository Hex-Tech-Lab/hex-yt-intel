'use client';

import { Suspense } from 'react';
import AuthErrorForm from './form';

export default function AuthError() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center">Loading...</div>}>
      <AuthErrorForm />
    </Suspense>
  );
}
