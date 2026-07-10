
Execution Roadmap: 50-Hour Timeline to MVP
Project: A7la Diva — Luxury Cosmetics E-Commerce
Timeline: 50 hours total (2 weeks aggressive execution)
Approach: 6 parallel tracks (A–F) with hourly breakdown and checkpoints

OVERVIEW: 6 PARALLEL TRACKS
Track A: Product Research          (Hours 0–8)
Track B: Design System             (Hours 0–16)
Track C: Backend Setup             (Hours 8–24)
Track D: Product Import            (Hours 16–30)
Track E: Frontend Development      (Hours 24–50)
Track F: Referral System           (Hours 30–46)
TRACK A: PRODUCT RESEARCH (Hours 0–8)
Owner: Research Agent
Deliverable: 100 SKUs CSV ready for Shopify bulk import

Hour 0–2: Boutique Site Research
Identify top 5 Egyptian e-commerce boutiques
Scrape top 30–40 bestselling products per store
Document: product name, image URL, price, variants, collection
Hour 2–5: Variant Normalization
Extract variant data (shade, length, size, quantity)
Standardize product titles
Normalize pricing
Group products by category
Hour 5–8: CSV Preparation & Validation
Generate Shopify bulk import format CSV
Calculate B2C base pricing
Add B2B pricing notes
Final QA (100 unique products, all variants complete)
Success Metrics:

✅ 100 unique SKUs identified
✅ All variants captured
✅ Pricing validated
✅ CSV format correct (Shopify-compatible)
✅ Images all present
TRACK B: DESIGN SYSTEM (Hours 0–16)
Owner: Claude Design
Deliverable: Figma mockups, design tokens, component specifications

Hour 0–4: Brand Aesthetic & Hero Video
Finalize color palette
Confirm typography
Create hero video storyboard
Define motion principles
Hour 4–10: Figma Mockups (5 Pages)
Landing page
E-commerce dashboard
Product detail page
B2B portal
Mobile responsive views
Hour 10–14: Design Tokens & Component Library
Tailwind config
Component specs (buttons, inputs, cards, modals)
Motion presets
Hour 14–16: Accessibility & Handoff
WCAG AAA checklist
Keyboard navigation testing
Responsive design verification
Design system documentation
Success Metrics:

✅ 5 page mockups complete
✅ Design tokens finalized
✅ Component library documented
✅ Accessibility verified (WCAG AAA)
TRACK C: BACKEND SETUP (Hours 8–24)
Owner: Backend Agent
Deliverable: Live Shopify store, Supabase DB, Auth system, Cloudflare Worker

Hour 8–12: Shopify Store Creation
Create Shopify development store
Generate API credentials
Configure CDN
Set up webhooks
Hour 12–16: Supabase Database Schema
Deploy 6 core tables
Create indexes
Set up RLS policies
Verify schema
Hour 16–20: Authentication Setup
Supabase email/password sign-up
JWT token generation
Session management
Email verification
Hour 20–24: Cloudflare Worker + Webhook Relay
Create Worker project
Implement pricing engine
Implement webhook relay
Deploy to Cloudflare
Success Metrics:

✅ Shopify store live
✅ Supabase DB deployed
✅ Auth working
✅ Cloudflare Worker deployed
✅ Webhook chain tested
TRACK D: PRODUCT IMPORT (Hours 16–30)
Owner: Data Agent
Deliverable: 100 SKUs live in Shopify

Hour 16–20: CSV → Shopify JSON Transform
Parse Track A CSV
Generate Shopify bulk import JSON
Validate JSON schema
Hour 20–25: Product Images → CDN
Download and optimize images
Upload to Shopify CDN
Generate CDN URLs
Hour 25–30: Shopify Bulk Import
Submit bulk import
Monitor status
Verify results
Test Storefront API queries
Success Metrics:

✅ 100 SKUs in Shopify admin
✅ All variants mapped
✅ Images on CDN
✅ Inventory tracked
✅ Storefront API queries working
TRACK E: FRONTEND DEVELOPMENT (Hours 24–50)
Owner: Frontend Agent
Deliverable: Responsive Next.js web app

Hour 24–30: Next.js Boilerplate + Auth
Initialize Next.js 16.2.6
Configure Tailwind + shadcn/ui
Set up API routes
Implement Auth middleware
Hour 30–36: Landing Page
Hero section
Featured collections
Brand story
Testimonials
CTAs
Hour 36–42: E-Commerce Dashboard
Product grid
Filters sidebar
Search
Product detail modal
Hour 42–46: B2B Portal
Dashboard KPIs
Referral code management
Commission ledger
Bulk order form
Hour 46–50: Performance, Accessibility, Polish
Lighthouse audit (>90)
Cross-browser testing
Mobile responsiveness
Deploy to Vercel
Success Metrics:

✅ Landing page rendering
✅ E-commerce dashboard functional
✅ B2B portal complete
✅ Responsive design
✅ Lighthouse >90
TRACK F: REFERRAL SYSTEM (Hours 30–46)
Owner: Backend Agent
Deliverable: Commission system end-to-end

Hour 30–35: Referral Code Generation
Generate unique codes on sign-up
Display in B2B portal
Deep link handling
Hour 35–40: Commission Calculation Engine
Tier-aware pricing
Per-order calculation
Glam Diva bonus
Hour 40–44: Commission Ledger & Payout Tracking
Ledger table
B2B portal display
Payout tracking
Tier upgrade tracking
Hour 44–46: Testing & Edge Cases
Referral link flow
Glam Diva bonus trigger
Tier upgrade logic
Concurrent orders
Success Metrics:

✅ Referral codes generate
✅ Commission calculation atomic
✅ Glam Diva bonus triggers
✅ Commission ledger accurate
✅ Payout tracking working
HOURLY CHECKPOINT SCHEDULE
Hour	Checkpoint	Status
0	Tracks A + B kickoff	Starting
8	Track A CSV done + Track B mockups	REVIEW
16	Track B complete + Track C schema	REVIEW
24	Track C complete + Track D begun	REVIEW
30	Track D products live + Track F code generation	REVIEW
40	Track E landing page + dashboard done	REVIEW
46	All tracks 90%+ complete	FINAL REVIEW
50	MVP live on Vercel	🚀 LAUNCH
Document Version: 1.0
Status: Ready for execution
Next Step: When user says "launch tracks", begin Tracks A–F in parallel
