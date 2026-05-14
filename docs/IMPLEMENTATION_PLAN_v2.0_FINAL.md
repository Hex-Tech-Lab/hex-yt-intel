# HEX-YT-INTEL: IMPLEMENTATION PLAN v2.0
## 48-Hour Sprint | 12 Fully-Specified Chunks | Verification Gates | Ready for Production

**Date:** May 13, 2026  
**Status:** FINAL (locked, ready for implementation)  
**Total Timeline:** 48 hours (May 13-15, 18 hrs/day)  
**Chunks:** 12 (Chunks 1-6 detailed, Chunks 7-12 specified with steering prompts)  

---

## OVERVIEW: How to Use This Document

**For Founder (You):**
- Reference time estimates before starting each chunk
- Track elapsed time (CCW will clock you in/out)
- Text CCW when ready for gate verification
- Don't skip gates—they prevent technical debt

**For CC (Claude Code):**
- Receive full steering prompt BEFORE each chunk (10x style)
- Execute implementation
- Run gate verification
- Text CCW when complete
- Don't proceed to next chunk until gate passes

---

## TIMELINE (48 HOURS TOTAL)

```
Day 1 (May 13): 18 hours
├─ Chunk 1: Monorepo setup (2h) ✅ DONE (per CC)
├─ Chunk 2: Next.js + TypeScript (2h)
├─ Chunk 3: Database migrations (2h)
├─ Chunk 4: Auth (NextAuth.js) (3h)
├─ Chunk 5: Metadata API (2h)
└─ Chunk 6: UCIS synthesis (4h)
   Day 1 Total: 18h → By May 14, ~08:45 UTC

Day 2 (May 14): 18 hours
├─ Chunk 7: Vector search (3h)
├─ Chunk 8: Frontend pages (6h)
├─ Chunk 9: PDF export + sharing (3h)
└─ Chunk 10: Stripe integration (6h)
   Day 2 Total: 18h → By May 15, ~02:45 UTC

Day 3 (May 15): 12 hours (catch-up + buffer)
├─ Chunk 11: Rate limiting + Sentry (3h)
├─ Chunk 12: Deploy to Vercel (6h)
└─ Buffer: Bug fixes, final checks (3h)
   Day 3 Total: 12h → By May 15, ~14:45 UTC

GRAND TOTAL: 48 hours → MVP shipped May 15
```

---

## CHUNK 1: Monorepo Setup (2 hours)
**Status:** ✅ COMPLETE (per CC's feedback)

**Deliverables:**
- ✅ pnpm-workspace.yaml
- ✅ Root package.json, tsconfig.json, turbo.json
- ✅ Supabase migrations (4 tables, RLS, indexes)
- ✅ docs/SUPABASE_SETUP.md
- ✅ Git commits pushed

**Gate Verification (already passed):**
- ✅ Type-checking clean
- ✅ SQL syntax valid
- ✅ Working tree clean

**Manual Setup Required Before Chunk 2:**
```bash
# 1. Create Supabase project (if not done)
supabase projects create --name hex-yt-intel --region us-east-1

# 2. Link project
supabase link --project-ref [PROJECT_ID]

# 3. Push migrations
supabase db push

# 4. Set credentials in web/.env.local
cp web/.env.local.example web/.env.local
# Edit with: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
```

**Proceeding to Chunk 2 when Supabase is accessible.**

---

## CHUNK 2: Next.js + TypeScript Setup (2 hours)

**Steering Prompt (10x style):**
> "You're building the skeletal Next.js app. Goal: (1) App router works, (2) TypeScript strict mode compiles, (3) Tailwind renders, (4) root layout renders 'hello world' styled. Don't add features. Don't add pages. Skeletal only. Test: `pnpm run dev` → browser shows 'Hex-YT-Intel' with Tailwind styling. Gate: type-check clean + build clean."

**Implementation Steps:**

1. **Initialize Next.js**
```bash
cd /home/kellyb_dev/projects/hex-yt-intel/apps/web
pnpm create next-app@latest . --typescript --tailwind --app --eslint
# Choose: TypeScript yes, Tailwind yes, App Router yes, ESLint yes, pnpm yes, no src/ directory
```

2. **Create root layout** (`web/app/layout.tsx`)
```tsx
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Hex-YT-Intel',
  description: 'YouTube synthesis engine',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-white text-gray-900">
        {children}
      </body>
    </html>
  )
}
```

3. **Create root page** (`web/app/page.tsx`)
```tsx
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold">Hex-YT-Intel</h1>
      <p className="text-gray-600 mt-4">YouTube synthesis engine</p>
    </main>
  )
}
```

4. **Update tsconfig.json (strict mode)**
```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "moduleResolution": "node",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"]
    }
  }
}
```

5. **Install dependencies**
```bash
pnpm install
```

6. **Verify build**
```bash
pnpm run build
pnpm run dev  # http://localhost:3000 should render "Hex-YT-Intel"
```

**Gate Verification:**
```bash
pnpm run type-check      # ✅ No errors
pnpm run build            # ✅ Builds successfully
pnpm run dev              # ✅ Renders "Hex-YT-Intel"
git add . && git commit -m "Chunk 2: Next.js + TypeScript setup"
git status                # ✅ Working tree clean
```

**Time Estimate:** 2 hours

**Next:** Chunk 3 (Database verification)

---

## CHUNK 3: Database Migrations (2 hours)

**Steering Prompt:**
> "Verify all 4 tables exist in Supabase with correct columns, indexes, RLS policies. Don't touch code. Just verify the schema that was pushed. Test: can you query each table? Can you see 6+ indexes? Can you see 9+ RLS policies?"

**Implementation:**

1. **Verify tables exist**
```bash
supabase db execute "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;"
# Expected: analyses, stripe_events, usage_logs, users
```

2. **Verify indexes**
```bash
supabase db execute "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname;"
# Expected: 6+ indexes (ivfflat for pgvector, etc.)
```

3. **Verify RLS policies**
```bash
supabase db execute "SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public';"
# Expected: 9+ policies
```

4. **Test RLS in Supabase Studio**
- Insert test user into `users` table
- Verify user can read own record
- Verify user cannot read others' records

5. **Verify triggers**
```bash
supabase db execute "SELECT trigger_name FROM information_schema.triggers WHERE trigger_schema = 'public';"
# Expected: auto-delete (30-day cleanup), auto-update (timestamps)
```

**Gate Verification:**
```bash
# Count tables
supabase db execute "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';"
# ✅ Should return 4

# Count indexes
supabase db execute "SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public';"
# ✅ Should return 6+

# Count RLS policies
supabase db execute "SELECT COUNT(*) FROM pg_policies;"
# ✅ Should return 9+

git add supabase/ && git commit -m "Chunk 3: Database schema verified"
```

**Time Estimate:** 2 hours

**Next:** Chunk 4 (Auth)

---

## CHUNK 4: Authentication (NextAuth.js v5 + Google OAuth) (3 hours)

**Steering Prompt:**
> "Auth is the gate. You need: (1) NextAuth.js configured, (2) Google OAuth working, (3) user created in Supabase on first signin, (4) JWT in session. Test: sign in with Google, see user in Supabase `users` table, JWT in cookies. Gate: sign in works end-to-end, user persists in DB."

**Implementation:**

1. **Install NextAuth.js**
```bash
pnpm add next-auth@beta @auth/supabase-adapter
```

2. **Create auth config** (`web/auth.ts`)
```ts
import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import { SupabaseAdapter } from "@auth/supabase-adapter"

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: SupabaseAdapter({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    secret: process.env.SUPABASE_JWT_SECRET!,
  }),
  providers: [
    Google({
      clientId: process.env.GOOGLE_ID!,
      clientSecret: process.env.GOOGLE_SECRET!,
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token
      }
      return token
    },
    async session({ session, token }) {
      session.user.id = token.sub!
      return session
    },
  },
  pages: {
    signIn: '/auth/signin',
  },
})
```

3. **Create sign-in page** (`web/app/auth/signin/page.tsx`)
```tsx
import { signIn } from "@/auth"

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">Hex-YT-Intel</h1>
        <form
          action={async () => {
            "use server"
            await signIn("google", { redirectTo: "/" })
          }}
        >
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 text-white rounded"
          >
            Sign in with Google
          </button>
        </form>
      </div>
    </div>
  )
}
```

4. **Create API route** (`web/app/api/auth/[...nextauth]/route.ts`)
```ts
import { handlers } from "@/auth"
export const { GET, POST } = handlers
```

5. **Protect root page** (`web/app/page.tsx`)
```tsx
import { auth, signOut } from "@/auth"
import { redirect } from "next/navigation"

export default async function Home() {
  const session = await auth()
  
  if (!session) {
    redirect("/auth/signin")
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold">Hex-YT-Intel</h1>
      <p className="text-gray-600 mt-4">Welcome, {session.user?.email}</p>
      
      <form action={async () => {
        "use server"
        await signOut({ redirectTo: "/auth/signin" })
      }}>
        <button type="submit" className="mt-4 px-4 py-2 bg-red-600 text-white rounded">
          Sign Out
        </button>
      </form>
    </main>
  )
}
```

6. **Set env vars** (`web/.env.local`)
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
GOOGLE_ID=... (from Google Cloud Console)
GOOGLE_SECRET=...
NEXTAUTH_SECRET=$(openssl rand -hex 32)
NEXTAUTH_URL=http://localhost:3000
```

**Gate Verification:**
```bash
pnpm run type-check          # ✅ No errors
pnpm run build                # ✅ Builds
pnpm run dev                  # ✅ Dev server runs
# Navigate to http://localhost:3000
# ✅ Redirects to /auth/signin
# ✅ Click "Sign in with Google"
# ✅ After signin, redirected to home, email displayed
# ✅ Check Supabase: new user in `users` table
# ✅ Check cookies: JWT present

git add . && git commit -m "Chunk 4: NextAuth.js + Google OAuth"
```

**Time Estimate:** 3 hours

**Next:** Chunk 5 (Metadata API)

---

## CHUNK 5: Metadata API (2 hours)

**Steering Prompt:**
> "Wire the existing Cloudflare Worker. Next.js → calls Worker → returns metadata. Keep it simple. One endpoint. No caching yet. Test: POST /api/metadata with YouTube URL, get title + description back."

**Implementation:**

1. **Create API route** (`web/app/api/metadata/route.ts`)
```ts
import { auth } from "@/auth"

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { url } = await req.json()

  if (!url || !url.includes("youtube.com")) {
    return Response.json({ error: "Invalid YouTube URL" }, { status: 400 })
  }

  try {
    const response = await fetch(
      `${process.env.CLOUDFLARE_WORKER_URL}/fetch-metadata?url=${encodeURIComponent(url)}`,
      {
        headers: {
          "x-api-key": process.env.CLOUDFLARE_API_KEY!,
        },
      }
    )

    if (!response.ok) {
      throw new Error(`Worker returned ${response.status}`)
    }

    const data = await response.json()
    return Response.json(data)
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to fetch metadata" },
      { status: 500 }
    )
  }
}
```

2. **Update .env.local**
```
CLOUDFLARE_WORKER_URL=https://yt-intel.hex-tech-lab.workers.dev
CLOUDFLARE_API_KEY=...
```

3. **Create test component** (`web/app/components/URLInput.tsx`)
```tsx
"use client"

import { useState } from "react"

export function URLInput() {
  const [url, setUrl] = useState("")
  const [metadata, setMetadata] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    try {
      const res = await fetch("/api/metadata", {
        method: "POST",
        body: JSON.stringify({ url }),
      })

      if (!res.ok) throw new Error("Failed to fetch metadata")
      const data = await res.json()
      setMetadata(data)
    } catch (error) {
      alert(error instanceof Error ? error.message : "Error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste YouTube URL"
          className="w-full px-3 py-2 border rounded"
        />
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded disabled:bg-gray-400"
        >
          {loading ? "Loading..." : "Fetch Metadata"}
        </button>
      </form>

      {metadata && (
        <div className="mt-4 p-4 bg-gray-100 rounded">
          <h3 className="font-bold">{metadata.title}</h3>
          <p className="text-sm text-gray-600">{metadata.channelTitle}</p>
        </div>
      )}
    </div>
  )
}
```

4. **Update home page to include URLInput**
```tsx
import { URLInput } from "./components/URLInput"
// ... in JSX: <URLInput />
```

**Gate Verification:**
```bash
pnpm run type-check
pnpm run dev
# Navigate to http://localhost:3000
# ✅ Sign in
# ✅ Paste YouTube URL
# ✅ Click "Fetch Metadata"
# ✅ See title, channel, etc. rendered

git add . && git commit -m "Chunk 5: Metadata API endpoint"
```

**Time Estimate:** 2 hours

**Next:** Chunk 6 (Synthesis)

---

## CHUNK 6: UCIS Synthesis Endpoint (4 hours)

**Steering Prompt:**
> "Core value: URL → transcript → Claude (UCIS prompt) → Supabase → API response. Free tier gate: user.analyses_used < 3? If not, 402. Test: create 1 synthesis as free user, see it in Supabase, see it returned. Increment counter. Log usage. Gate: free tier enforcement works."

**Implementation:**

1. **Create Supabase client** (`web/lib/supabase.ts`)
```ts
import { createClient } from "@supabase/supabase-js"

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
```

2. **Create analysis API** (`web/app/api/analyses/route.ts`)
```ts
import { auth } from "@/auth"
import { supabase } from "@/lib/supabase"
import Anthropic from "@anthropic-ai/sdk"

const client = new Anthropic()

const UCIS_PROMPT = `You are an expert analysis engine. Generate a comprehensive 16-section analysis:

1. Header Intelligence
2. Strategic Context
3. Executive Overview
4. Sentiment & Psychological Architecture
5. Comprehensive Content Map
6. Priority Insights Matrix
7. Comparative Analysis Tables
8. Q&A Intelligence Extraction
9. Implementation Systems
10. Structured Intelligence Database
11. Power Quotes Library
12. Semantic Intelligence Layer
13. Discovery Pathways
14. Scenario Analysis & Stress Testing
15. Forward Intelligence & Strategic Foresight
16. Domain-Specific Risk Disclosures

Format as markdown. Be thorough but scannable.`

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.email) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { videoId, videoTitle, channelName, transcript } = await req.json()

  // Check free tier limit
  const { data: user } = await supabase
    .from("users")
    .select("tier, analyses_used")
    .eq("email", session.user.email)
    .single()

  if (user?.tier === "free" && user.analyses_used >= 3) {
    return Response.json({ error: "Free tier limit exceeded" }, { status: 402 })
  }

  try {
    // Call Claude
    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      system: UCIS_PROMPT,
      messages: [
        {
          role: "user",
          content: `Analyze this video transcript from "${videoTitle}" by ${channelName}:\n\n${transcript}`,
        },
      ],
    })

    const synthesis = message.content[0].type === "text" ? message.content[0].text : ""

    // Save to Supabase
    const { data: analysis, error } = await supabase
      .from("analyses")
      .insert({
        user_id: session.user.id,
        video_id: videoId,
        video_title: videoTitle,
        channel_name: channelName,
        transcript,
        synthesis,
        repo_type: "personal",
      })
      .select()
      .single()

    if (error) throw error

    // Increment counter
    await supabase
      .from("users")
      .update({ analyses_used: (user?.analyses_used || 0) + 1 })
      .eq("email", session.user.email)

    // Log usage
    await supabase.from("usage_logs").insert({
      user_id: session.user.id,
      action: "synthesis_created",
      metadata: { video_id: videoId },
    })

    return Response.json(analysis)
  } catch (error) {
    console.error("Synthesis failed:", error)
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to create analysis" },
      { status: 500 }
    )
  }
}

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.email) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { data: analyses } = await supabase
    .from("analyses")
    .select("*")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false })

  return Response.json(analyses || [])
}
```

3. **Install Anthropic SDK**
```bash
pnpm add @anthropic-ai/sdk
```

4. **Update .env.local**
```
ANTHROPIC_API_KEY=...
```

5. **Create analysis form component** (integrate with URLInput)
```tsx
// In URLInput or new component:
// After fetching metadata, show "Create Analysis" button
// POST /api/analyses with metadata + transcript
// Display synthesis result
```

**Gate Verification:**
```bash
pnpm run type-check
pnpm run dev
# ✅ Sign in
# ✅ Paste YouTube URL, fetch metadata
# ✅ Click "Create Analysis"
# ✅ Wait for Claude synthesis (~10-15 seconds)
# ✅ See synthesis displayed
# ✅ Check Supabase: analysis saved
# ✅ Create 2 more analyses (should work)
# ✅ Try 4th analysis (should return 402 - limit exceeded)
# ✅ Check `users.analyses_used` incremented to 3

git add . && git commit -m "Chunk 6: UCIS synthesis endpoint + free tier gate"
```

**Time Estimate:** 4 hours

**END OF DAY 1 (18 hours spent, 6 chunks complete)**
**MVP core value working:** Users can sign in, create syntheses (with free tier limit), see them saved.

---

## CHUNKS 7-12: Abbreviated Specs (High-Level Steering)

### CHUNK 7: Vector Search (3 hours)
**Goal:** Semantic search across user's syntheses  
**Steering:** Embed queries + analyses, pgvector cosine similarity, top 5 results  
**Test:** Search "pricing strategy" → find relevant syntheses  
**Gate:** Search endpoint works, results ranked

### CHUNK 8: Frontend Pages (6 hours)
**Goal:** Build dashboard, detail page, settings  
**Steering:** Dashboard lists analyses, detail page shows synthesis, settings shows usage  
**Test:** Can navigate all pages without errors  
**Gate:** All pages render, TypeScript clean, mobile responsive

### CHUNK 9: PDF Export + Sharing (3 hours)
**Goal:** Download synthesis as PDF, generate shareable links  
**Steering:** PDF includes metadata + timestamp, shareable link is read-only  
**Test:** Download PDF, open shareable link  
**Gate:** PDF renders correctly, link works

### CHUNK 10: Stripe Integration (6 hours)
**Goal:** Subscription checkout, webhook handler, tier enforcement  
**Steering:** Stripe Checkout session, webhook processes events, update `users.tier`  
**Test:** Create subscription in sandbox, see user tier update, webhook re-delivery works  
**Gate:** Stripe webhook verified, tier enforcement in API routes

### CHUNK 11: Rate Limiting + Sentry (3 hours)
**Goal:** Prevent abuse, track errors  
**Steering:** Upstash Redis enforces 10 req/min, Sentry captures errors  
**Test:** Trigger rate limit (11th request blocked), trigger error (Sentry logs)  
**Gate:** Rate limit working, Sentry integration live

### CHUNK 12: Deploy to Vercel (6 hours)
**Goal:** Ship to production  
**Steering:** Set env vars in Vercel, domain DNS, SSL, database linked  
**Test:** Live URL works, all features functional, no errors in Sentry  
**Gate:** Live at hex-yt-intel.vercel.app, uptime >99%

---

## GATE SIGN-OFF (After All 12 Chunks)

**Before Launch:**
- [ ] TypeScript strict mode passes
- [ ] All 11 features working
- [ ] Zero critical bugs in Sentry
- [ ] 99%+ uptime in production (24h test)
- [ ] Stripe webhook delivery verified
- [ ] Free tier limit enforced
- [ ] Rate limiting working
- [ ] All APIs respond <2s (except synthesis <30s)
- [ ] RLS policies verified
- [ ] Git history clean

---

## TIME TRACKING TABLE

| Chunk | Est. | Start | End | Actual | Status |
|-------|------|-------|-----|--------|--------|
| 1 | 2h | — | — | ✅ DONE | PASSED |
| 2 | 2h | — | — | | Pending |
| 3 | 2h | — | — | | Pending |
| 4 | 3h | — | — | | Pending |
| 5 | 2h | — | — | | Pending |
| 6 | 4h | — | — | | Pending |
| 7 | 3h | — | — | | Pending |
| 8 | 6h | — | — | | Pending |
| 9 | 3h | — | — | | Pending |
| 10 | 6h | — | — | | Pending |
| 11 | 3h | — | — | | Pending |
| 12 | 6h | — | — | | Pending |
| **TOTAL** | **42h** | | | **—** | **In Progress** |

---

**IMPLEMENTATION PLAN v2.0 — READY FOR EXECUTION**

*Next: Clock in for Chunk 2. CCW provides steering prompt. CC executes. Report when gate passes.*
