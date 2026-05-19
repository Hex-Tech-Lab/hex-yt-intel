---
Filename: $file
Location: docs/specs/$file
Version: v1.5.0
Build: b947767
Timestamp: Saturday, 16 May 2026 at 17:11:06 EEST
Purpose: Architectural specification document
---
Filename: design.md
Location: /docs/specs/
Version: v1.5.0
Build: b947767
Timestamp: Saturday, 16 May 2026 at 17:13:51 EEST (GCW)
Purpose: design
---

# HEX-YT-INTEL Design System (design.md)

## 1. Core Philosophy
- **Vibe:** Elite content intelligence engine for creators and analysts.
- **Styling:** Outline styling (1px translucent borders), multi-layered beautiful shadows, subtle glassmorphism (max 6px blur), deep dark mode default. 
- **Motion:** Precise sequence animations (staggered 0.1s), ease-out (cubic-bezier(0.16, 1, 0.3, 1)). No bounce. 

## 2. Color System (Tailwind Tokens)
- **slate-950** (`#0F172A`): Primary app background (Dark)
- **slate-900** (`#1E293B`): Cards, panels, elevated surfaces (Dark)
- **slate-800** (`#334155`): Hover states, modals (Dark)
- **cyan** (`#06B6D4`): Primary Action, intelligence extraction, active states
- **indigo** (`#6366F1`): Secondary accents, subtle gradients
- **coral** (`#FF6B6B`): Alerts, critical insights, destructive actions ONLY
- **slate-50** (`#F8FAFC`): Primary text
- **slate-400** (`#94A3B8`): Secondary text, metadata

## 3. Typography
- **Display & Headings:** `Geist, sans-serif` (Tight tracking `-0.02em`, sharp, technical)
- **Body & Data:** `Inter, sans-serif` (Highly legible, 14px-16px, dense matrices)
- **Code & Snippets:** `JetBrains Mono, monospace` (Transcripts, raw data, JSON)

## 4. Component Guardrails & Rules

### Outlines & Borders
- Cards must use `.outline-card` (`border 1px solid rgba(255, 255, 255, 0.1)`).
- Never use flat, borderless cards for data.

### Shadows (Beautiful Shadows)
- Use multi-layered shadows, not single harsh drop shadows.
- `.beautiful-shadow-lg`: `0 4px 8px rgba(0,0,0,0.08), 0 8px 16px rgba(0,0,0,0.12), 0 16px 32px rgba(0,0,0,0.15)`
- Hover states should lift elements (`-translate-y-0.5`) and expand the shadow.

### Motion & Animation
- **Default Easing:** `cubic-bezier(0.16, 1, 0.3, 1)` (snappy, no bounce).
- **Default Duration:** `150ms` (fast) to `300ms` (medium).
- Use staggered sequence animations for rendering lists/intelligence cards (0.1s delay between items).

### Layout & Density
- High information density: tighten padding (12px-16px) inside matrices.
- Use tables with clear outline boundaries for comparative data.
- Glassmorphism is restricted to floating headers or elevated modals (max 6px backdrop blur).

## 5. Integration Context
- Always combine this design.md with the target component's HTML structure.
- Apply specific Aura Skills (e.g., GSAP Web Animation, Progressive Blur) to elevate the baseline HTML to match this system's motion and depth requirements.
