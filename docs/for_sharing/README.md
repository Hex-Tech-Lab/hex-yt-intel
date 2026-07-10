# Hex-Diva

Luxury cosmetics and beauty products e-commerce platform with B2B/B2C tiers, AI-powered recommendations, and referral system.

## Quick Start

### Prerequisites
- Node.js 24.16.0
- pnpm 11.9.0
- Supabase account
- Shopify store
- Stripe account

### Installation

1. Clone the repository:
```bash
git clone https://github.com/hex-tech-lab/hex-diva.git
cd hex-diva
```

2. Install dependencies:
```bash
pnpm install
```

3. Set up environment variables:
```bash
cp .env.example .env.local
# Edit .env.local with your credentials
```

4. Start development server:
```bash
pnpm dev
```

Visit `http://localhost:3000` to see the app.

## Documentation

- **[CLAUDE.md](./CLAUDE.md)** - Architecture, stack, and development guide
- **[PROJECT_SPEC.md](./PROJECT_SPEC.md)** - Detailed feature requirements and user flows

## Project Structure

```
src/
├── app/              # Next.js App Router pages and API routes
├── components/       # Reusable React components
├── lib/             # Utilities, services, and helpers
├── types/           # TypeScript type definitions
├── styles/          # Global styles and Tailwind config
└── middleware.ts    # Next.js middleware
```

## Development Commands

```bash
# Development server
pnpm dev

# Production build
pnpm build

# Run production server
pnpm start

# Linting
pnpm lint

# Type checking
pnpm type-check

# Database migrations
pnpm db:migrate

# Seed database (development)
pnpm db:seed

# Code formatting
pnpm format
```

## Tech Stack

### Frontend
- Next.js 16.2.6 (App Router)
- React 19
- TypeScript 5.6.2
- Tailwind CSS 4.0
- shadcn/ui components

### Backend & Data
- Supabase (PostgreSQL, Auth, Realtime, Storage)
- Next.js Route Handlers & Server Actions
- PostgreSQL with pgvector

### E-Commerce & Payments
- Shopify Admin API (product catalog, inventory)
- Stripe (payments)
- Shopify Payments (fallback)

### Infrastructure
- Vercel Edge Network
- Cloudflare CDN
- Redis (Upstash) for caching
- SendGrid + Resend for email

### AI & Analytics
- Claude API for recommendations
- PostHog for analytics
- Sentry for error tracking

## Environment Variables

See `.env.example` for all required environment variables. Key ones:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
STRIPE_SECRET_KEY
SHOPIFY_ADMIN_API_TOKEN
SHOPIFY_STOREFRONT_ACCESS_TOKEN
REDIS_URL
ANTHROPIC_API_KEY
```

## Deployment

### Staging
- Branch: `develop`
- Vercel Preview Deployment
- Supabase staging project

### Production
- Branch: `main`
- Vercel Production Deployment
- Supabase production project

## API Documentation

See [CLAUDE.md](./CLAUDE.md#api-endpoints-overview) for API endpoint documentation.

## Contributing

1. Create a feature branch from `develop`
2. Make your changes and commit with clear messages
3. Push to your branch
4. Create a pull request

## Performance Targets

- Page load time: < 2s
- Lighthouse score: 90+
- API response time: < 200ms (p95)
- Conversion rate: 2-3%

## Security

- HTTPS enforced
- CSRF protection
- XSS prevention
- SQL injection prevention (parameterized queries)
- Rate limiting
- GDPR compliant

## Support

For issues and feature requests, please open a GitHub issue.

## License

Proprietary - Hex-Tech-Lab © 2024