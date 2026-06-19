import { Suspense } from 'react';
import SignInForm from './form';

export default function SignIn() {
  return (
    <Suspense fallback={<div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: "var(--void)", color: "var(--ink-muted)", fontFamily: "var(--font-mono)", fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase" as const }}>Loading...</div>}>
      <SignInForm />
    </Suspense>
  );
}
