---
name: hex-yt-intel-design
description: Premium dark-themed AI synthesis console design system. Stateless React 19 components, frozen color palette (cyan accent only), JetBrains Mono metadata voice, and the signature rotating scope-ring motion. For production or throwaway prototypes.
user-invocable: true
---

# HEX-YT-INTEL Design System

Read `README.md` in this folder for the full design context, color tokens, typography system, motion language, and content voice.

## What's here

- **`README.md`** — High-level context, all design rules, sources, caveats.
- **`colors_and_type.css`** — The token layer (CSS vars + semantic type classes). Drop into any HTML.
- **`preview/`** — 21 specimen cards showing colors, type, spacing, motion, and components.
- **`assets/logo.html`** — The brand lockup (HEX·YT·INTEL variants).
- **`ui_kits/console/`** — The Synthesis Console app (stateless TSX components + interactive index.html).
- **`ui_kits/marketing/`** — The public marketing site (landing, features, pricing).

## Design rules (abbreviated)

**Color:** Deep obsidian `#1A1F2B` primary surface. Cyan `#06B6D4` is the *only* accent — reserved for streaming/active/CTA. Dark hairline borders. No gradients-as-decoration.

**Type:** Inter (display + body), JetBrains Mono (all technical metadata). 16px body minimum. Headings `-0.02em` tracking, `text-wrap: balance`.

**Motion:** ease-out exponential only. The one signal: rotating cyan scope-ring while `status === "streaming"`. Nothing else spins. `prefers-reduced-motion` safe.

**Components:** 100% stateless adapters (React 19, `ref` as normal prop). Data + `status` union + callbacks via props. No `useState`/`useEffect`/fetch.

**Architecture:** Hexagonal (Ports & Adapters). Presentation owns no state.

## Per-design request format

When starting a new screen or component:

```
**What:** [screen/component]
**Context:** [journey moment / user action]
**Data:** [typical content + which `status` values]
**Constraints:** [size / responsive / a11y]
**Success look:** [reference or brief description]
```

The system will map your request to the frozen tokens and motifs, never improvise.

## If the user invokes this without further guidance

Ask: "What do you want to design or build?" Then ask focused questions:
- Is this a new product surface, a throwaway mock, or production code?
- Which surfaces does it touch (console app, marketing, internal tool)?
- What's the core job or journey you're designing?
- Do you want variations explored, or one refined direction?
- Any data or copy to work from?

Then act as an expert designer: produce **live, pixel-perfect HTML/TSX artifacts**, never mockups. Every screen is visually distinct from Notion/Glasp/generic dark dashboards. Reference the frozen spec religiously.
