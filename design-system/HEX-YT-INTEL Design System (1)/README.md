# HEX-YT-INTEL — Design System

A premium, dark-themed AI analytics console. HEX-YT-INTEL turns a YouTube URL into a
structured, searchable **11-dimension synthesis** in seconds — a "synthesis console,"
not a generic dashboard. The visual identity is a **technical instrument register**:
obsidian-slate canvas, a single disciplined cyan accent, scope-bracket framing, and a
monospace metadata voice. The architecture is strictly **Hexagonal (Ports & Adapters)** —
every presentation component is a pure, stateless adapter.

> **The Hexagonal Guardrail is law.** Deep dark theme only. Cyan is the *only* accent.
> JetBrains Mono for metadata/logs. Pure stateless components (no `useState`,
> `useEffect`, or fetching). React 19 (`ref` is a normal prop — no `forwardRef`,
> no `displayName`). Motion is semantic: animate only when `status === "streaming"`.

---

## Product context

- **Name:** HEX-YT-INTEL (Hex-YT-Intel Synthesis Console)
- **Category:** AI content-synthesis SaaS + developer tool (YouTube → persistent knowledge graph, semantic search, team repos)
- **Primary users:** Content creators, indie makers, consultants/analysts. Desktop-first, power-user posture.
- **Core problem:** high-volume video consumption with no durable, searchable, structured recall. Drop a URL, get an 11-dimension synthesis mapped into your knowledge graph.
- **The 11 UCIS dimensions:** Core Thesis, Key Arguments, Evidence, Frameworks, Entities, Tactics, Contrarian Takes, Open Questions, Action Items, Notable Quotes, Graph Links — rendered as an **asymmetric bento** (span weights, never an identical N-col grid).

### Surfaces / products represented
1. **Synthesis Console** (the app) — sidebar shell, top bar, URL analysis hero, streaming bento, terminal-style processing log. → `ui_kits/console/`
2. **Marketing site** (public) — sticky nav, landing hero with framed product still, alternating feature sections, pricing. → `ui_kits/marketing/`

---

## Sources

This system was reverse-engineered from two attached codebases (read-only, mounted locally):

- **`hex-yt-intel - Design System - Stateless Presentation Layer/`** — the **authoritative frozen brand spec**. Contains:
  - `hex-ds/design-system/` — `design-brief.md`, `palette.json`, `typography.json`, `motion-language.md`, `constraints.md`, `claude-design-system-prompt.md`
  - `hex-ds/web/` — production stateless React 19 presentation adapters (`primitives/`, `templates/`) + the Tailwind v4 `@theme` token layer (`app/globals.css`)
- **`components/`** — an earlier, pre-refactor production build (emoji icons, multi-color glows, `rounded-[2rem]`, light-theme search/pricing). **Treated as historical context only** — it predates the frozen spec and violates several locked rules. Do not copy its patterns.

No Figma file, slide deck, or binary brand assets (logo files, illustrations, photography) were provided. The brand mark is constructed in markup (see Iconography). If you have these, attach them and I'll fold them in.

---

## CONTENT FUNDAMENTALS

How copy is written across the product.

- **Voice:** precise, technical, confident. Reads like instrument output, not marketing fluff. The product is an "instrument," and the copy respects the operator.
- **Person:** addresses *you* ("Drop a YouTube URL.", "your knowledge graph", "Get a structured synthesis"). Imperative for actions ("Synthesize a video", "Analyze", "See a sample").
- **Casing:**
  - Headings & body — **sentence case** ("Drop a YouTube URL. Get a structured synthesis across 11 dimensions.").
  - Mono labels, status chips, dimension keys — **UPPERCASE** with wide tracking ("STREAMING", "SYNTHESIS CONSOLE", "07 · CONTRARIAN TAKES").
  - Plan/tier pills — uppercase ("PRO", "FREE").
- **Mono register:** all machine/metadata strings are JetBrains Mono — counts ("7 / 11 complete"), timestamps, dimension indices ("03"), the processing log, quota lines ("2 of 3 syntheses left"), keyboard hints ("⌘K"), the `synthesis.log` filename. A leading `//` or zero-padded index ("07") often prefixes a mono kicker.
- **Tone examples:**
  - Hero kicker: `// YouTube → knowledge graph`
  - Subhead: "Transcript, claims, frameworks, and contrarian takes, mapped into your knowledge graph and searchable in seconds."
  - Empty log: "Awaiting input. Submit a URL to begin synthesis."
  - Error: "Synthesis failed for this dimension. Retry available."
- **Punctuation:** **no em dashes in UI copy** — use commas, colons, periods, parentheses. Arrows (`→`) and middots (`·`) are allowed as connective glyphs.
- **Banned buzzwords:** streamline, empower, supercharge, seamless, world-class, next-generation. Say what it does.
- **Emoji:** **none.** The earlier `components/` build used 🔬📡🏗️🧠 — these are forbidden under the frozen spec. Iconography is the Solar icon set only.
- **Numbers:** tabular-nums everywhere counts/timestamps appear, so columns align. Counts are framed as progress ("7 / 11 complete").
- **Vibe:** a calm, high-density diagnostic console. Quiet until something is *streaming*, at which point exactly one cyan signal lights up.

---

## VISUAL FOUNDATIONS

- **Color & mood:** deep obsidian-slate, cool and dim. Canvas `#11141D`, the locked primary surface `#1A1F2B`, elevated cards on `slate-900/50–40`. A **single cyan accent** (`#06B6D4`) owns all attention — reserved for active/streaming/primary-action only. Status hues (green/amber/red) are *data*, never decoration, and always paired with an icon + label (never hue alone). At most **one accent-saturated focal per screen region**.
- **Type:** Inter for display + body (weight 500 display, 400 body, tight `-0.02em` tracking on headings, `text-wrap: balance`); JetBrains Mono for every technical string. Body never below 16px; line-height ≥1.5 on prose; line length 65–75ch. No third display family.
- **Spacing & layout:** strict **8px grid** (4px only for hairline insets). Marketing max-width **64rem**, app max-width **80rem** (`max-w-7xl`). The bento uses **asymmetric span weights** (1=unit, 2=wide, 3=hero) on a 6-col grid — rhythm comes from spans, not decoration. Sidebar shell (256px) for internal pages.
- **Backgrounds:** CSS-only ambient — soft cyan **glow blobs** (blur 60–120px, low opacity, secondary to content) plus a very faint (~4% opacity) 48px **grid texture**. No full-bleed photography, no gradients-as-decoration, no diagonal stripe patterns. An optional WebGL canvas can be *injected* by a container but the default is pure CSS.
- **The scope-bracket motif (signature):** four L-shaped corner brackets framing a region — the recurring "instrument viewport." `tone="line"` for neutral, `tone="accent"` to mark a focal/active region. This is the off-generic-SaaS tell.
- **Borders:** dark hairlines — `--line` (`#1E293B`, slate-800) default, `--line-strong` (`#334155`, slate-700) emphasized. Gradient hairline (`135deg, slate-400/18 → transparent`) wraps cards via the GlowBorder. **No side-stripe accent borders** (`border-left` accent > 1px is banned).
- **Corner radii:** cards/sections **16px max** (never 24/28/32px+), controls **8px**, tags/badges/chips **pill** (9999px). The earlier build's `rounded-[2rem]` is out of spec.
- **Cards:** flat `--surface` fill, wrapped in a gradient-hairline GlowBorder, 16px radius, generous internal padding (~20–32px). **No nested cards.** Cards only where they're the best affordance.
- **Transparency & blur:** `backdrop-blur-xl` is reserved for floating/sticky surfaces — the sidebar (`surface/40`), sticky headers (`bg/70`), and framed media. Not a default glass everywhere (glassmorphism-by-default is banned).
- **Shadows:** minimal. Elevation reads through the surface ramp + gradient hairline + ambient glow, not drop shadows. The accent glow is the only "halo."
- **Animation:** ease-out exponential only (`cubic-bezier(0.22,1,0.36,1)` / `(0.16,1,0.3,1)`), 160–520ms. **No bounce, spring, elastic, or overshoot.** Exactly **one signature animation product-wide**: a rotating cyan conic **scope-ring** that means `status === "streaming"`. Nothing else spins. Entrances are a restrained 12px crossfade-rise, staggered only within the bento (60/120/180/240ms buckets) — never an identical fade on every section. `prefers-reduced-motion` collapses all motion, including the ring.
- **Hover states:** color-only on most controls (160ms) — text `secondary → ink`, button `accent-strong → accent`, sidebar item gains 10% accent bg + cyan icon. Interactive cards lift `-translate-y-0.5` (280ms). **Never animate an image inside a card.**
- **Press / active states:** buttons settle to `--accent-strong`; sidebar active item carries cyan icon + accent/10 background. Focus rings always visible (≥2px), touch targets ≥44px.
- **Loading state:** skeleton bars (`line-strong` at 35–50% opacity) stand in until content arrives, then a 280ms crossfade swaps them in and the ring stops. A blinking cyan caret marks a live log.

---

## ICONOGRAPHY

- **Icon set:** **Solar (linear variants)**, delivered via **Iconify** as the `<iconify-icon>` web component. Names look like `solar:bolt-linear`, `solar:graph-up-linear`, `solar:magnifer-linear`, `solar:target-linear`. Thin, consistent stroke; rendered at `text-base`/`text-lg` sizes inline with mono labels.
- **Delivery in these artifacts:** loaded from CDN —
  `<script src="https://code.iconify.design/iconify-icon/2.1.0/iconify-icon.min.js"></script>`
  then `<iconify-icon icon="solar:bolt-linear"></iconify-icon>`. This is the *same* set the production spec uses (Solar via Iconify), so it is an exact match, not a substitution.
- **The 11 dimension icons (canonical):** target (thesis), chat-square-like (arguments), database (evidence), widget-5 (frameworks), users-group-rounded (entities), bolt (tactics), shuffle (contrarian), question-circle (questions), checklist-minimalistic (actions), quote-up (quotes), graph (connections).
- **Brand mark:** there is **no logo image file** in the sources. The mark is built in markup: a 28px cyan-600 rounded square (8px radius) holding `solar:graph-up-linear` in `--void`, followed by the wordmark **`HEX·YT·INTEL`** (or `HEX·YT` compact) in JetBrains Mono semibold, tracking `0.04em`. See `assets/logo.html` for the canonical lockup. Provide a real SVG/PNG logo and I'll swap it in.
- **Emoji:** **never.** **Unicode glyphs** used deliberately as connective tissue only: `//`, `·`, `→`, `⌘K`, `●`/`○` (live/idle log status), `✓`/`✗` (pricing rows). No decorative emoji icons.
- **No hand-drawn SVG icons** — always use Solar via Iconify so stroke weight and family stay consistent.

---

## Index / manifest

Root files:
- **`README.md`** — this file: context, content + visual foundations, iconography, manifest.
- **`colors_and_type.css`** — the token layer (CSS vars + semantic type classes). Drop into any artifact.
- **`SKILL.md`** — Agent-Skill front-matter so this folder works as a downloadable Claude Code skill.

Folders:
- **`assets/`** — `logo.html` (the canonical brand lockup, since no logo file was provided).
- **`preview/`** — small HTML specimen cards that populate the Design System tab (colors, type, spacing, motion, components).
- **`ui_kits/console/`** — the Synthesis Console app recreation. `index.html` (interactive) + JSX components. See its README.
- **`ui_kits/marketing/`** — the public marketing site recreation. `index.html` + JSX components. See its README.

Reference (read-only, not copied — see Sources): the frozen spec lives in the attached
`hex-yt-intel-design-system/` bundle (`design-system/*.md|json`, `web/components/*`).

---

## Caveats / substitutions
- **Fonts** load from Google Fonts (Inter + JetBrains Mono — both genuinely the spec'd families, not substitutes). Swap for self-hosted `.woff2` in production.
- **Icons** are the real Solar set via Iconify CDN — exact match.
- **No binary brand assets** (logo, illustrations, photography) existed in the sources; the logo is reconstructed in markup. Attach real assets to upgrade.
