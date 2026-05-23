import { Suspense } from 'react';
import SignInForm from './form';

export default function SignIn() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center">Loading...</div>}>
      <SignInForm />
    </Suspense>
  );
}
