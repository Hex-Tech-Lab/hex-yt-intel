# Hex-Diva Project Specification

## Product Overview

**Hex-Diva** is a luxury cosmetics and beauty products e-commerce platform targeting beauty enthusiasts, professionals, and wholesalers. The platform combines a curated product catalog (via Shopify), personalized AI recommendations, community features, and a sophisticated B2B wholesale tier.

**Target Market**:
- B2C: Individual consumers (beauty enthusiasts, professionals)
- B2B: Salons, beauty shops, influencers (wholesale accounts)

**Key Value Propositions**:
1. Curated luxury cosmetics catalog
2. AI-powered product recommendations
3. Referral and affiliate program
4. B2B wholesale pricing and account management
5. Beauty community features (reviews, tutorials, trends)
6. Mobile-first, responsive experience

---

## Phase 1: MVP (Weeks 1-8)

### Phase 1.1: Foundation & Auth (Weeks 1-2)

#### User Authentication
- Email/password signup & login via Supabase Auth
- OAuth: Google, Apple sign-in
- Email verification (optional for demo)
- Password reset flow
- Session management (24h JWT + refresh token)
- "Remember me" checkbox (30-day cookie)

#### User Profiles
- Profile setup: name, email, phone, avatar
- Address management (shipping/billing)
- Preferences: notifications, newsletter opt-in
- B2C by default, B2B upgrade option (button in settings)

#### Dashboard Basics
- User welcome screen
- Navigation to shop, orders, settings
- Profile edit
- Logout

---

### Phase 1.2: Product Catalog & Shop (Weeks 2-4)

#### Product Catalog (Shopify Integration)
- Sync products from Shopify Admin API
- Fields: name, description, images, price, SKU, category, tags, rating
- Webhook sync: products update in Shopify → auto-sync to Supabase
- ~500-1000 initial products

#### Shop Page
- Product grid with images, name, price, rating (stars)
- Pagination: 12/24/36 products per page
- Filters:
  - Category (makeup, skincare, haircare, etc.)
  - Brand
  - Price range slider ($10-$500)
  - Rating (4+, 3+, etc.)
  - Availability (in stock only toggle)
- Sort: Relevance, Newest, Price (low-to-high), Price (high-to-low), Best sellers, Top rated

#### Product Detail Page
- Large image carousel (zoom on hover)
- Thumbnails for other images
- Name, brand, price, in-stock status
- Rating & review count (placeholder for Phase 2)
- Description, ingredients, usage instructions (rich text from Shopify)
- Variants (size, shade, etc. if available)
- Stock indicator ("Only 2 left", "In stock")
- "Add to cart" button
- "Add to wishlist" button (saves to user profile)
- Related products (AI-recommended)
- Share buttons (copy link, email, social)

#### Search
- Full-text search on product name, brand, category
- Instant search suggestions (typeahead)
- Search results ranked by relevance

---

### Phase 1.3: Shopping Cart & Checkout (Weeks 3-5)

#### Shopping Cart
- Session-based cart (persisted to user profile on login)
- Add/remove/quantity updates
- Cart summary: subtotal, tax estimate, shipping estimate
- Promo code input (validation backend)
- "Continue shopping" / "Checkout" buttons
- Abandoned cart notice (save for 30 days)

#### Checkout Flow (Stripe)
1. **Cart Review**: Review items, quantities, totals
2. **Shipping Info**: Address form with auto-complete (Google Places API)
3. **Shipping Method**: Options with costs (flat $10, free over $100, express $20)
4. **Payment Info**: Stripe payment form (card, Apple Pay, Google Pay)
5. **Order Review**: Final confirmation
6. **Success Page**: Order number, tracking, next steps

#### Order Confirmation
- Immediate email receipt (SendGrid)
- Order page shows:
  - Order number, date, status
  - Items, quantities, prices
  - Shipping & billing addresses
  - Total, tax, shipping
  - Tracking info (when available)

---

### Phase 1.4: Orders & Account (Weeks 4-6)

#### Order History
- List of user's orders (date, status, total, items preview)
- Filter by status: All, Pending, Processing, Shipped, Delivered, Cancelled
- Order detail page: full invoice, tracking, return option (Phase 2)

#### Account Management
- Profile edit (name, email, phone, avatar)
- Address book (multiple addresses for shipping/billing)
- Payment methods (saved cards via Stripe)
- Email preferences (notifications, newsletter)
- Account security (change password)

#### Notifications
- Order status updates (email + in-app badge)
- Welcome email after signup
- Abandoned cart reminder (24h after add to cart)

---

### Phase 1.5: Admin Panel (Weeks 5-7)

#### Admin Access Control
- Gated route: `/admin` requires admin role in Supabase
- Admin authentication via Google Workspace or email whitelist
- Session required, auto-logout after 1h inactivity

#### Product Management
- List products with name, SKU, price, stock, status (active/draft)
- Create product (form or bulk upload CSV)
- Edit product: name, description, images, price, categories, tags, SEO
- Soft delete (hide from shop, keep in orders)
- Bulk actions: activate, deactivate, delete

#### Shopify Sync Control
- Manual "Sync Now" button (fetches from Shopify Admin API)
- Last sync timestamp
- Sync status log (recent syncs, errors)
- Auto-sync on Shopify webhook (configured)

#### Order Management
- List orders: ID, customer, date, status, total
- Order detail: items, addresses, payment, notes
- Actions: mark as shipped, add tracking, cancel (if pending)
- Order notes (internal, not visible to customer)

#### Basic Analytics Dashboard
- Card stats: Total orders (today, this month), Total revenue, Active users
- Chart: Daily orders (last 30 days)
- Chart: Revenue trend (last 30 days)
- Top products (by revenue)

#### User Management (Basic)
- List users: email, created date, tier (B2C/B2B), total orders
- Search by email
- View user profile
- Manual tier assignment (upgrade/downgrade)

---

### Phase 1.6: Referral System (Weeks 6-8)

#### Referral Codes
- Each user gets unique referral code (e.g., `HEX_ALICE123`)
- Display on dashboard with share buttons
- Copy to clipboard
- QR code generation (optional)

#### Referral Tracking
- Link tracking: `?ref=HEX_ALICE123` in URL
- First-time visitor tracking (cookies)
- Record referral in database when referred user signs up
- Give referrer a discount code or credit after first purchase by referred user

#### Referral Dashboard
- "My Referrals" widget showing:
  - Referral code & share buttons
  - Total clicks (from tracking)
  - Total conversions (signups + first purchase)
  - Pending commissions (unpaid)
  - Lifetime commissions paid
  - Basic chart: conversions over time (30 days)

#### Commission Structure (Basic)
- Base rate: 5% of referred user's first order
- Earn on referred user's future orders too (lifetime)
- Manual payout via bank transfer (handled via admin)

---

## Phase 2: Features & Polish (Weeks 9-14)

### Product Reviews & Ratings
- User reviews after purchase (email prompt)
- 5-star rating system
- Text review (optional)
- Review moderation (admin approval)
- Display ratings on product page
- Filter products by rating

### Advanced Search
- Semantic search using AI embeddings
- Query examples: "best hydrating moisturizer for dry skin"
- Vector search via pgvector + Claude embeddings
- Fuzzy matching for typos

### B2B Tier Enhancements
- Wholesale pricing tiers based on volume (1-5, 6-25, 26+ units)
- Bulk order cart (multiple SKUs, quantities)
- Account manager assignment (admin creates relationship)
- Order history showing bulk orders
- Commission structure for B2B (higher %, e.g., 10-15%)
- Minimum order value ($100 for wholesale)

### Wishlist & Collections
- Save items to wishlist
- Price drop notifications (if item price < saved price)
- Share wishlist (public link)
- Collections (e.g., "Skincare Routine", "Travel Favorites")
- Email reminder if wishlisted item goes on sale

### Product Returns & Exchanges
- Return request form (30-day window)
- Reason selection (damaged, wrong shade, changed mind, etc.)
- Return shipping label (Shopify integration)
- Return status tracking
- Refund to original payment method

### Community Features
- User-generated tutorials/content (photos + captions)
- Trending products (most viewed, most liked)
- "Inspired by" feature (link related products)
- Influencer marketplace (apply, get unique discount codes)

### Email Marketing Integration
- Newsletter signup (separate from account creation)
- Scheduled campaigns (Resend + SendGrid)
- Abandoned cart sequences
- Post-purchase product recommendations
- Birthday/anniversary offers

---

## Phase 3: Scaling & Monetization (Weeks 15+)

### Advanced AI Features
- Personalized homepage (trending, recommended for you)
- Smart reordering (subscription service, 10% discount)
- Beauty profile quiz (skin type, concerns, preferences)
- Shade finder (AR or upload photo)
- Virtual try-on (if device has camera)

### B2B Enhancements
- Tiered user roles (owner, manager, buyer)
- Team account features (multiple users per account)
- Credit lines (net-30, net-60 payment terms)
- Order templates (repeat orders)
- Custom invoicing

### Marketplace
- Third-party vendor support (other brands/sellers)
- Commission splits between Hex-Diva and vendors
- Vendor dashboard (upload products, track sales)
- Vendor ratings & reviews

### Subscription / Loyalty
- Beauty Box subscription (monthly curated box, $35-50)
- VIP membership (free shipping, early access, exclusive products)
- Points system (earn on purchases, redeem for discounts)
- Referral tier rewards (unlock higher commission at milestones)

### Analytics & Reporting
- User cohort analysis (retention, LTV)
- Product performance (drill-down by category, brand)
- Funnel analysis (browse → add to cart → purchase)
- Affiliate/referrer performance

---

## Technical Requirements

### Frontend (Next.js 16.2.6)
- Server Components by default, Client Components only when needed
- TypeScript strict mode
- Tailwind CSS 4.0 + shadcn/ui components
- Responsive design (mobile-first)
- Accessible (WCAG 2.1 AA)
- SEO optimization (next/head, structured data)

### Backend (API Routes)
- CORS configured for storefront domain
- Authentication middleware (JWT from Supabase)
- Rate limiting (Redis)
- Error handling & logging (Sentry)
- Webhook handlers (Shopify, Stripe)

### Database (Supabase PostgreSQL)
- Row-level security (RLS) policies
- Indexes on frequently queried columns
- Foreign key constraints
- Migrations versioned in Git
- Backup strategy (Supabase auto-backups)

### Performance
- Image optimization (Next.js Image, Cloudflare)
- Page load time < 2s (Lighthouse 90+)
- SEO: Sitemap, robots.txt, meta tags
- Analytics: Web Vitals tracking
- Caching strategy (browser, CDN, Redis)

### Security
- HTTPS everywhere (enforced)
- CSRF tokens on forms
- XSS protection (React sanitization)
- Rate limiting (API + form submissions)
- SQL injection prevention (parameterized queries)
- PII encryption at rest (user data)
- GDPR compliance (consent, export, deletion)

---

## Design & UX

### Visual Identity
- Modern, clean, luxury aesthetic
- Color palette: Deep purples, golds, whites, soft neutrals
- Typography: Modern sans-serif (e.g., Inter, Poppins)
- Imagery: High-quality product photos, lifestyle images

### Mobile Experience
- Touch-friendly buttons (48x48px minimum)
- Swipe gestures for image galleries
- Sticky header with quick access (cart, search)
- Bottom navigation for main sections

### Accessibility
- ARIA labels on interactive elements
- Keyboard navigation (Tab, Enter, Escape)
- Color contrast ratios (4.5:1 for text)
- Alt text on all images
- Form validation messages

### User Flows
1. **Browse & Purchase**
   - Land → Browse → Search/Filter → Product Detail → Add to Cart → Checkout → Confirmation
   
2. **Referral**
   - Copy referral code → Share (social, email, link) → Referred friend signs up → First purchase → Commission earned
   
3. **B2B Signup**
   - User in B2C tier → Settings → "Upgrade to B2B" → Form (business details, tax ID) → Admin approval → Wholesale prices available

---

## Success Metrics (MVP)

| Metric | Target |
|--------|--------|
| Daily Active Users | 100+ |
| Conversion Rate (browse → purchase) | 2-3% |
| Average Order Value | $45-60 |
| Cart Abandonment Rate | < 65% |
| Referral Signups | 10% of new users |
| Admin Load Time | < 1s |
| API Response Time | < 200ms (p95) |
| Search Relevance | 80%+ users find what they search |

---

## Deployment Strategy

### Development
- Local: `pnpm dev` on Node 24.16.0
- Database: Supabase local stack (optional, or remote dev project)
- Shopify: Development store credentials

### Staging
- Branch: `develop`
- Vercel Preview Deployment
- Supabase staging project
- Stripe test API keys

### Production
- Branch: `main`
- Vercel Production Deployment
- Supabase production project
- Stripe live API keys
- Custom domain: `hexdiva.com` (or `shop.hexdiva.com`)

### CI/CD
- GitHub Actions: Lint, type-check, build on PR
- Auto-deploy `develop` → Vercel Preview
- Auto-deploy `main` → Vercel Production
- Supabase migrations run on deploy

---

## Timeline & Milestones

| Phase | Week | Deliverable |
|-------|------|-------------|
| Auth & Setup | 1-2 | User accounts, profiles, session |
| Catalog | 2-4 | Products, shop page, search |
| Cart & Checkout | 3-5 | Shopping cart, Stripe integration, orders |
| Admin Panel | 5-7 | Product mgmt, order mgmt, basic analytics |
| Referrals | 6-8 | Referral codes, tracking, commissions |
| **MVP Launch** | **8** | **Public beta, 100 users** |
| Refinements | 9-14 | Reviews, B2B, advanced features |
| Scaling | 15+ | Marketplace, subscriptions, analytics |

---

## Open Questions / Future Decisions

- Subscription service model (beauty box, VIP)
- Third-party marketplace (multi-vendor)
- International shipping and currencies
- Mobile app (React Native or PWA)
- AR features (shade finder, try-on)
- Customer support chat (Intercom, custom)
