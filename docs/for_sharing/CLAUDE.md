# Hex-Diva Architecture & Development Guide

Luxury cosmetics/beauty brand e-commerce platform with B2B/B2C tiers, referral system, and AI-powered features.

## Stack (Frozen Protocol)

### Runtime & Package Management
- **Node.js**: 24.16.0
- **Package Manager**: pnpm 11.9.0
- **Frontend**: Next.js 16.2.6 (App Router)
- **TypeScript**: 5.6.2
- **UI Components**: shadcn/ui + Tailwind CSS 4.0

### Backend & Data
- **Database**: Supabase PostgreSQL
- **Auth**: Supabase Auth + OAuth (Google, Apple)
- **Real-time**: Supabase Realtime
- **Storage**: Supabase Storage (product images, user uploads)
- **API**: Next.js App Router (Route Handlers + Server Actions)

### E-Commerce & Payments
- **Storefront**: Shopify Hydrogen (product catalog via GraphQL)
- **Payments**: Shopify Payments + Stripe fallback
- **Product Sync**: Shopify Admin API webhooks → Supabase
- **Inventory**: Shopify stock → Redis cache (TTL: 5m)

### Infrastructure & Deployment
- **Hosting**: Vercel Edge Network
- **CDN**: Cloudflare (image optimization, DDoS)
- **Caching**: Redis (Upstash) for sessions, inventory, rate limits
- **Monitoring**: Sentry + PostHog
- **Email**: SendGrid (transactional) + Resend (marketing)

### AI & Analytics
- **LLM**: Claude API (product recommendations, support)
- **Vector Search**: pgvector in Supabase
- **Analytics**: PostHog (product events) + Shopify Analytics

## Directory Structure

```
hex-diva/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── (auth)/            # Auth flow: login, signup, reset
│   │   ├── (dashboard)/       # User dashboard, orders, referrals
│   │   ├── (shop)/            # Product catalog, collections, cart
│   │   ├── (admin)/           # Admin panel (gated)
│   │   └── api/               # API routes & webhooks
│   ├── components/            # Reusable React components
│   │   ├── ui/               # shadcn/ui components
│   │   └── features/         # Feature-specific components
│   ├── lib/                  # Utilities & services
│   │   ├── db.ts            # Supabase client
│   │   ├── shopify.ts        # Shopify API client
│   │   ├── auth.ts           # Auth helpers
│   │   ├── cache.ts          # Redis wrapper
│   │   └── stripe.ts         # Stripe integration
│   ├── types/                # TypeScript types & interfaces
│   ├── styles/               # Global styles & Tailwind config
│   └── middleware.ts         # Next.js middleware (auth, redirects)
├── public/                   # Static assets
├── migrations/               # Supabase SQL migrations
├── .env.example             # Environment variables template
├── package.json             # Dependencies & scripts
├── tsconfig.json            # TypeScript config
├── next.config.js           # Next.js config
└── tailwind.config.ts        # Tailwind CSS config
```

## Key Features

### Core E-Commerce
- Product catalog with filters (brand, category, price, rating)
- Shopping cart with session persistence
- Checkout with Shopify + Stripe
- Order tracking & history
- Wishlist & saved items

### User Tiers
- **B2C**: Individual buyers, standard pricing, loyalty program
- **B2B**: Wholesale accounts, bulk discounts, net-30 terms, account manager
- Tier upgrade workflow (verification, credit check)

### Referral & Commission System
- Unique referral codes per user
- Commission tracking (tiers: 5%, 10%, 15% based on volume)
- Payout dashboard (monthly via Stripe Connect)
- Referral analytics (clicks, conversions, revenue)

### Admin Panel
- Product management (create, update, sync with Shopify)
- Order management & fulfillment
- User management & tier assignments
- Commission tracking & payouts
- Analytics dashboard (sales, revenue, user growth)

### AI Features
- Product recommendation engine
- Smart search (semantic + full-text)
- Customer support chatbot
- Content generation (product descriptions)

## Development

### Commands
```bash
pnpm install              # Install dependencies
pnpm dev                  # Start dev server (localhost:3000)
pnpm build                # Production build
pnpm start                # Run production server
pnpm lint                 # ESLint + Prettier
pnpm type-check           # TypeScript check
pnpm db:migrate           # Run Supabase migrations
pnpm db:seed              # Seed database (dev only)
```

### Environment Setup
1. Create `.env.local` from `.env.example`
2. Set Shopify API keys (Admin + Storefront)
3. Set Supabase connection string & keys
4. Set Stripe API keys
5. Set Redis URL (Upstash)
6. Run `pnpm db:migrate` to set up schema

### Database Schema Outline
- `users` - Core user data (auth via Supabase)
- `user_profiles` - Extended profile (B2B status, referral code)
- `products` - Product catalog (synced from Shopify)
- `orders` - Order records
- `order_items` - Line items per order
- `referrals` - Referral tracking
- `commissions` - Commission calculations & payouts

## Deployment

### Staging
- Branch: `develop`
- Auto-deploy via Vercel Preview
- Supabase staging project

### Production
- Branch: `main`
- Auto-deploy via Vercel Production
- Supabase production project
- CDN cache invalidation on deploy

## Security & Compliance

- PCI DSS: Stripe/Shopify handle card data
- GDPR: User consent flows, data export, right to deletion
- Rate Limiting: Redis-backed, 100 req/min per IP
- CSRF: Next.js built-in middleware
- XSS: React sanitization + CSP headers
- SQL Injection: Parameterized queries via Supabase client

## Monitoring & Observability

- **Errors**: Sentry (real-time alerts)
- **Performance**: Web Vitals (Vercel Analytics)
- **Analytics**: PostHog (funnels, cohorts, session replay)
- **Infrastructure**: Vercel Dashboard + Cloudflare Analytics
- **Logs**: Vercel Edge Functions, Supabase Realtime logs

## Coding Standards

- **Type Safety**: Strict TypeScript, no `any`
- **Naming**: camelCase for JS/TS, PascalCase for components/classes
- **File Organization**: Logical grouping by feature, not type
- **Imports**: Absolute paths via `@/` alias
- **Components**: Functional, hooks-based, server components by default
- **Styling**: Tailwind utility classes, no inline CSS
- **Testing**: Vitest + React Testing Library (integration tests)
- **Comments**: Minimal, only for WHY not WHAT

## API Endpoints Overview

### Auth
- `POST /api/auth/signup` - Register new user
- `POST /api/auth/login` - Email + password login
- `POST /api/auth/logout` - Clear session
- `POST /api/auth/refresh` - Refresh token

### Products & Catalog
- `GET /api/products` - List products with filters
- `GET /api/products/[id]` - Product detail
- `POST /api/products/search` - Semantic search (AI)

### Cart & Orders
- `POST /api/cart/add` - Add to cart
- `POST /api/checkout` - Create Stripe session
- `GET /api/orders` - User's orders
- `GET /api/orders/[id]` - Order detail

### Referrals & Commissions
- `GET /api/referrals` - My referral stats
- `POST /api/referrals/claim` - Claim referral code
- `GET /api/commissions` - Commission history

### Admin
- `POST /api/admin/products` - Create/update product
- `POST /api/admin/sync-shopify` - Sync product catalog
- `GET /api/admin/analytics` - Dashboard metrics

## Related Documents

- `PROJECT_SPEC.md` - Detailed feature requirements & user flows
- `BRAND_GUIDELINES.md` - Design system, colors, typography
- `.env.example` - Environment variables guide
