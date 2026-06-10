# Sub-processor Ledger
**Status**: ACTIVE
**Last Updated**: 2026-06-10

To provide high-fidelity intelligence and global billing, HEX-YT-INTEL engages the following sub-processors. These entities have been vetted for security and data protection compliance (GDPR/SOC2).

## Core Infrastructure

| Entity | Purpose | Location |
| :--- | :--- | :--- |
| **Vercel** | Frontend hosting & Edge compute | Global |
| **Supabase** | Database & Authentication | US (AWS) |
| **Upstash** | Vector Index & Caching | Global |
| **Cloudflare** | DNS & WAF Protection | Global |

## Artificial Intelligence

| Entity | Purpose | Location |
| :--- | :--- | :--- |
| **Anthropic** | Claude 3.5 Sonnet (Synthesis) | US |
| **OpenRouter** | LLM Gateway & Fallback | US |

## Payment & Billing

| Entity | Purpose | Data Touched |
| :--- | :--- | :--- |
| **Stripe** | Payment Processing (US/EU) | Customer Email, Credit Card Info, Billing Address |
| **Paddle** | Merchant of Record (Global/ME) | Customer Email, Billing Address, VAT/Tax IDs |

## Monitoring & Analytics

| Entity | Purpose | Location |
| :--- | :--- | :--- |
| **Sentry** | Error Tracking & Observability | US |
