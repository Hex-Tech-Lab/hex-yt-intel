# Code Simplification Report: Modular Auth System
**Date:** 2026-05-15  
**Scope:** Recently added auth provider code  
**Status:** ✅ 5 simplifications identified | No functionality changes

---

## Simplification Opportunities

### 1. Remove Dead Code: Unused `providers.enabled` Flags
**File:** [web/lib/auth/config.ts:25-32](web/lib/auth/config.ts#L25-L32)  
**Impact:** Clarity, maintainability

**Current:**
```typescript
providers: {
  supabase: {
    enabled: process.env.AUTH_PROVIDER !== 'nextauth',
  },
  nextauth: {
    enabled: process.env.AUTH_PROVIDER === 'nextauth',
  },
},
```

**Why remove:**
- These flags are never read anywhere in the codebase
- Provider selection uses direct string comparison: `if (provider === 'supabase')`
- They add cognitive load without providing value
- Dead code increases maintenance burden

**Simplified:**
```typescript
export const AUTH_CONFIG = {
  provider: (process.env.AUTH_PROVIDER || 'supabase') as 'supabase' | 'nextauth',
  
  supabase: {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },

  nextauth: {
    secret: process.env.AUTH_SECRET || '',
  },

  google: {
    clientId: process.env.AUTH_GOOGLE_ID || '',
    clientSecret: process.env.AUTH_GOOGLE_SECRET || '',
  },
};
```

**Lines saved:** 7 | **Clarity improvement:** ⬆️⬆️

---

### 2. Replace Dynamic Imports with Static Imports
**File:** [web/lib/auth/provider-factory.ts:25-26, 41-42](web/lib/auth/provider-factory.ts)  
**Impact:** Performance, readability, debuggability

**Current:**
```typescript
if (provider === 'supabase') {
  const { getSupabaseSession } = await import('./providers/supabase');
  const session = await getSupabaseSession();
  // ...
}

if (provider === 'nextauth') {
  const { getServerSession } = await import('next-auth');
  const { authConfig } = await import('./nextauth-config');
  const session = (await getServerSession(authConfig)) as Session | null;
  // ...
}
```

**Why simplify:**
- Dynamic imports add unnecessary async overhead on every auth check
- Makes debugging harder (need to trace async module resolution)
- Modules are always available at build time, no need to defer
- Static imports allow TypeScript to better analyze types
- Provider choice is determined at runtime, not loadtime, so early loading is fine

**Simplified:**
```typescript
import { getSupabaseSession } from './providers/supabase';
import { getServerSession } from 'next-auth';
import { authConfig } from './nextauth-config';

export async function getAuthSession(): Promise<AuthSession | null> {
  const provider = AUTH_CONFIG.provider;

  if (provider === 'supabase') {
    const session = await getSupabaseSession();
    if (session?.user) {
      return {
        user: {
          id: session.user.id,
          email: session.user.email || '',
          name: session.user.user_metadata?.name || session.user.user_metadata?.full_name,
          image: session.user.user_metadata?.avatar_url,
        },
      };
    }
    return null;
  }

  if (provider === 'nextauth') {
    const session = (await getServerSession(authConfig)) as Session | null;
    if (session?.user) {
      return {
        user: {
          id: (session.user as any).id || '',
          email: session.user.email || '',
          name: session.user.name || undefined,
          image: session.user.image || undefined,
        },
      };
    }
    return null;
  }

  return null;
}
```

**Lines saved:** ~5 | **Performance improvement:** ⬆️⬆️

---

### 3. Eliminate Redundant Null Checks
**File:** [web/lib/auth/providers/supabase.ts:16-19](web/lib/auth/providers/supabase.ts#L16-L19)  
**Impact:** Clarity, DRY principle

**Current:**
```typescript
export async function getSupabaseSession() {
  const user = await getSupabaseUser();
  return user ? { user } : null;
}
```

**Why simplify:**
- This function wraps `getSupabaseUser()` to convert it into a session object
- The wrapping adds an extra layer with minimal value
- Callers can directly use `getSupabaseUser()` and handle null themselves
- Or consolidate into provider-factory

**Option A - Inline into provider-factory (recommended):**
```typescript
// In provider-factory.ts
if (provider === 'supabase') {
  const user = await getSupabaseUser();
  if (user) {
    return {
      user: {
        id: user.id,
        email: user.email || '',
        name: user.user_metadata?.name || user.user_metadata?.full_name,
        image: user.user_metadata?.avatar_url,
      },
    };
  }
  return null;
}

// Remove getSupabaseSession entirely from providers/supabase.ts
// Keep only:
// - getSupabaseUser()
// - signOutSupabase()
```

**Lines saved:** 4 | **Complexity reduction:** ⬆️

---

### 4. Simplify Supabase Provider Functions
**File:** [web/lib/auth/providers/supabase.ts](web/lib/auth/providers/supabase.ts)  
**Impact:** DRY principle, maintainability

**Current:**
```typescript
export async function getSupabaseUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function getSupabaseSession() {
  const user = await getSupabaseUser();
  return user ? { user } : null;
}

export async function signOutSupabase() {
  const supabase = await createClient();
  await supabase.auth.signOut();
}
```

**Why simplify:**
- Duplicate `createClient()` calls in `getSupabaseUser()` and `signOutSupabase()`
- If auth methods change, multiple places need updates
- Could consolidate into single factory pattern

**Simplified (if provider-factory handles session mapping):**
```typescript
import { createClient } from '@/utils/supabase/server';

export async function getSupabaseUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function signOutSupabase(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
}
```

**Lines saved:** 4 | **DRY improvement:** ⬆️

---

### 5. Replace Type Assertions with Proper Typing
**File:** [web/lib/auth/provider-factory.ts:47](web/lib/auth/provider-factory.ts#L47)  
**Impact:** Type safety, maintainability

**Current:**
```typescript
id: (session.user as any).id || '',
```

**Why improve:**
- `as any` bypasses TypeScript's type safety
- Makes code harder to refactor (IDE can't track usages)
- Hides potential bugs (undefined becomes empty string instead of failing)
- NextAuth provides proper type definitions

**Better approach:**
```typescript
// Declare proper NextAuth session type
import { Session } from 'next-auth';

// At top of function
const session = (await getServerSession(authConfig)) as Session | null;

// Now TypeScript knows session.user structure
if (session?.user?.id && typeof session.user.id === 'string') {
  return {
    user: {
      id: session.user.id,  // ← No type assertion needed
      email: session.user.email || '',
      name: session.user.name || undefined,
      image: session.user.image || undefined,
    },
  };
}
return null;
```

**Type safety improvement:** ⬆️⬆️

---

### 6. Consolidate Duplicate Config Structure (Code Quality)
**File:** [web/lib/auth/config.ts:6-24](web/lib/auth/config.ts#L6-L24)  
**Impact:** Consistency, maintainability

**Current structure mixes concerns:**
- `provider` is active choice
- `supabase`, `nextauth`, `google` are config objects
- Config values are duplicated from `.env.example`

**Improved approach (optional):**
```typescript
export const AUTH_CONFIG = {
  // Active provider selection
  provider: (process.env.AUTH_PROVIDER || 'supabase') as 'supabase' | 'nextauth',

  // Supabase-specific config
  supabase: {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },

  // NextAuth-specific config
  nextauth: {
    secret: process.env.AUTH_SECRET || '',
  },

  // Shared OAuth provider config
  oauth: {
    google: {
      clientId: process.env.AUTH_GOOGLE_ID || '',
      clientSecret: process.env.AUTH_GOOGLE_SECRET || '',
    },
  },
} as const;
```

**Why change:**
- `oauth.google` makes it clearer that Google is an OAuth provider
- `as const` enables better type inference
- Structure scales better if adding other OAuth providers later

**This is optional** — current structure is acceptable if not planning multi-OAuth support.

---

## Summary Table

| Improvement | File | Impact | Complexity | Type Safety |
|---|---|---|---|---|
| 1. Remove dead code | config.ts | ⬆️⬆️ Clarity | -7 LOC | ✓ |
| 2. Static imports | provider-factory.ts | ⬆️⬆️ Performance | -5 LOC | ✓ |
| 3. Remove redundant checks | providers/supabase.ts | ⬆️ DRY | -4 LOC | ✓ |
| 4. Simplify Supabase provider | providers/supabase.ts | ⬆️ DRY | -4 LOC | ✓ |
| 5. Replace `as any` | provider-factory.ts | ⬆️⬆️ Type safety | 0 LOC | ⬆️⬆️ |
| 6. Consolidate config | config.ts | ⬆️ Scalability | 0 LOC | ✓ |

---

## Implementation Priority

**High priority (quick wins):**
1. Remove dead code (#1) — 2 minutes, no risk
2. Replace dynamic imports with static (#2) — 5 minutes, improves performance
3. Simplify Supabase provider (#4) — 3 minutes, reduces duplication

**Medium priority (improve quality):**
4. Replace `as any` with proper typing (#5) — 10 minutes, improves type safety
5. Remove redundant wrapper (#3) — 5 minutes, consolidates logic

**Low priority (optional):**
6. Reorganize config structure (#6) — 5 minutes, improves scalability if needed later

---

## Verification Checklist

After applying simplifications:
- [ ] Build passes: `pnpm build`
- [ ] No TypeScript errors: `pnpm type-check`
- [ ] All auth flows still work (Supabase + NextAuth)
- [ ] No behavior changes, only code clarity improvements

