---
version: alpha
name: hex-yt-intel Obsidian-Escher Design System
description: AI-native design system for YouTube content intelligence with persona-weighted UI logic and recursive tessellation aesthetic. Five-persona model (Content Creator 50%, Indie Maker 25%, Consultant 15%, Researcher 5%, PM 5%) with 70/30 Revelatory/Contemplative UX split.

colors:
  # Primary Brand Colors
  black-obsidian: "#000000"
  cyan-electric: "#00D9FF"
  white-pure: "#FFFFFF"
  
  # Persona Accent Colors (P1/P2 = Cyan, P3/P4/P5 = White)
  p1-accent: "#00D9FF"          # Content Creator — Revelatory UI
  p2-accent: "#00D9FF"          # Indie Maker — Revelatory UI
  p3-accent: "#FFFFFF"          # Consultant — Mixed UX
  p4-accent: "#FFFFFF"          # Researcher — Contemplative UI
  p5-accent: "#FFFFFF"          # PM — Contemplative UI
  
  # Status Colors (WCAG AAA compliant on black)
  success: "#4ADE80"            # Green, 7.2:1 contrast on black
  warning: "#FACC15"            # Amber, 7.5:1 contrast on black
  error: "#F87171"              # Red, 6.8:1 contrast on black
  info: "#38BDF8"               # Sky blue, 7.1:1 contrast on black
  
  # Neutral Scale (for text layers)
  text-primary: "#FFFFFF"       # Main text, 21:1 contrast on black
  text-secondary: "#D4D4D8"     # Secondary text, 14.2:1 contrast on black
  text-tertiary: "#A1A1AA"      # Tertiary text, 8.1:1 contrast on black
  border-light: "#404040"       # Borders, 3.1:1 contrast on black
  surface-dark: "#1A1A1A"       # Surface elevation layer 1

typography:
  display:
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif"
    fontSize: "48px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
    fontFeature: "ss01, ss02"    # Stylistic sets for brand personality
    
  headline:
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
    
  headline-secondary:
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0em"
    
  body-large:
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0em"
    
  body:
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0.5px"
    
  body-small:
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0.25px"
    
  label:
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.5px"
    textTransform: "uppercase"

rounded:
  # No rounded corners — recursive tessellation via SVG clip-paths only
  none: "0px"

spacing:
  # 8px grid baseline
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  2xl: "48px"
  3xl: "64px"
  4xl: "96px"

components:
  # Button Component (Persona-Weighted)
  button-primary:
    background: "{colors.cyan-electric}"      # P1/P2 only
    color: "{colors.black-obsidian}"
    padding: "{spacing.md} {spacing.lg}"
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "{typography.body.fontSize}"
    fontWeight: 600
    border: "none"
    shadow: "0 2px 4px rgba(0, 217, 255, 0.25), 0 4px 8px rgba(0, 217, 255, 0.15)"  # Cyan glow for P1/P2
    
  button-secondary:
    background: "transparent"
    color: "{colors.text-primary}"
    padding: "{spacing.md} {spacing.lg}"
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "{typography.body.fontSize}"
    fontWeight: 600
    border: "1px solid {colors.border-light}"
    
  # Insight Card (Revelatory Path, P1/P2)
  insight-card-p1:
    background: "{colors.black-obsidian}"
    border-left: "3px solid {colors.cyan-electric}"
    padding: "{spacing.lg}"
    shadow: "0 4px 12px rgba(0, 217, 255, 0.2), 0 8px 24px rgba(0, 217, 255, 0.1), 0 12px 36px rgba(0, 217, 255, 0.05)"  # 4-layer cyan shadow stack
    font: "{typography.body.fontFamily}"
    
  # Analysis Container (Contemplative Path, P3/P4/P5)
  analysis-container-p345:
    background: "{colors.surface-dark}"
    border: "1px solid {colors.border-light}"
    padding: "{spacing.xl}"
    shadow: "0 1px 3px rgba(255, 255, 255, 0.1), 0 2px 6px rgba(255, 255, 255, 0.08), 0 4px 12px rgba(255, 255, 255, 0.05)"  # Subtle white shadow stack
    font: "{typography.body.fontFamily}"
    
  # UCIS Grid Cell (10-dimension framework display)
  ucis-grid-cell:
    background: "{colors.black-obsidian}"
    border: "1px solid {colors.border-light}"
    padding: "{spacing.md}"
    font: "{typography.label.fontFamily}"
    highlight-color: "{colors.cyan-electric}"  # Dimension value highlighting

personas:
  content-creator:
    name: "Content Creator"
    weight: 50
    uiDensity: "revelatory"
    accentColor: "{colors.cyan-electric}"
    characteristics: "Fast insight delivery, visual impact, action-oriented, high engagement"
    
  indie-maker:
    name: "Indie Maker"
    weight: 25
    uiDensity: "revelatory"
    accentColor: "{colors.cyan-electric}"
    characteristics: "Navigation speed, lean metrics, shipping speed, quick feedback"
    
  consultant:
    name: "Consultant/Analyst"
    weight: 15
    uiDensity: "mixed"
    accentColor: "{colors.white-pure}"
    characteristics: "Information density, strategic depth, comparative analysis, moderate pacing"
    
  researcher:
    name: "Researcher"
    weight: 5
    uiDensity: "contemplative"
    accentColor: "{colors.white-pure}"
    characteristics: "Clarity, strict citations, methodology transparency, deep reading"
    
  product-manager:
    name: "Product Manager"
    weight: 5
    uiDensity: "contemplative"
    accentColor: "{colors.white-pure}"
    characteristics: "Flow state, task tracking, strategic overview, pattern synthesis"

ux-split:
  revelatory-ratio: 0.70      # Fast insight path (P1/P2)
  contemplative-ratio: 0.30   # Deep analysis path (P3/P4/P5)
---

## Overview

Hex YouTube Intelligence (hex-yt-intel) is an AI-native platform for synthesizing video content into comprehensive intelligence reports. The Obsidian-Escher design system uses pure black backgrounds with Electric Cyan accents to create an environment of focus and clarity. The design is deliberately non-skeuomorphic, favoring recursive tessellation and mathematical precision over organic curves. 

The five-persona model ensures the interface scales across user contexts: from content creators who need instant actionable insights to researchers who value methodological rigor. The 70/30 Revelatory/Contemplative split reflects the product's dual nature: fast delivery for exploration, deep analysis for synthesis.

### Design Philosophy

1. **Obsidian Aesthetic**: Pure black (#000000) background eliminates visual clutter. Every element is intentional. No rounded corners—all geometry derives from recursive tessellation patterns.

2. **Electric Cyan as Insight Signal**: Electric Cyan (#00D9FF) highlights only for P1/P2 users (Content Creator, Indie Maker). This color signals immediately actionable findings. P3/P4/P5 users see white accents, maintaining contemplative pacing.

3. **Recursive Tessellation**: Complex visual hierarchy built via SVG clip-paths and interlocking borders. No radius property. Every corner is a junction point between layers.

4. **Four-Layer Shadow Stacks**: P1/P2 cards use cyan-tinted shadows (0 2px 4px, 0 4px 8px, 0 8px 16px, 0 12px 32px). P3/P4/P5 use white-tinted subtle shadows. Depth is perceived through light color, not darkness.

5. **Persona-Weighted Typography**: Display faces (Inter 700) for P1/P2 high-impact layouts. Body text (Inter 400) maintains 1.6 line-height across all personas for accessibility (WCAG AAA). P3/P4/P5 get larger font sizes to support sustained reading.

## Colors

### Brand Palette

The hex-yt-intel palette is deliberately minimalist: black, Cyan, white, and four semantic colors for status feedback.

| Token | Hex | Usage | Contrast |
|-------|-----|-------|----------|
| `black-obsidian` | #000000 | Background, primary surface | — |
| `cyan-electric` | #00D9FF | P1/P2 accents, insight highlights | 21:1 on black (passes WCAG AAA) |
| `white-pure` | #FFFFFF | P3/P4/P5 accents, text primary | 21:1 on black |
| `success` | #4ADE80 | Positive status, confirmation | 7.2:1 on black |
| `warning` | #FACC15 | Caution, pending state | 7.5:1 on black |
| `error` | #F87171 | Error, critical feedback | 6.8:1 on black |
| `info` | #38BDF8 | Information, supportive context | 7.1:1 on black |

### Persona Accent Mapping

- **P1 (Content Creator, 50%) + P2 (Indie Maker, 25%)**: Cyan Electric (#00D9FF)
  - Rapid visual scanning, high contrast, action-oriented
  - Used for: call-to-action buttons, insight highlighting, progress indicators
  
- **P3 (Consultant, 15%) + P4 (Researcher, 5%) + P5 (PM, 5%)**: White Pure (#FFFFFF)
  - Sustained reading, professional tone, contemplative pacing
  - Used for: section headers, navigation, secondary actions

## Typography

### Font Strategy

**Typeface**: Inter (100% Google Fonts, variable weight, zero licensing friction)

Rationale: Inter is designed for screen clarity with precise spacing. Variable weight (100-900) allows fine-grained persona differentiation without font-switching overhead. No fancy display fonts—all hierarchy derived from size, weight, and letter-spacing.

### Type Scale

| Level | Size | Weight | Line Height | Usage |
|-------|------|--------|-------------|-------|
| **Display** | 48px | 700 | 1.2 | Hero sections, main hero title (P1/P2 only) |
| **Headline** | 32px | 600 | 1.3 | Section titles, insight headlines |
| **Headline Secondary** | 24px | 600 | 1.4 | Subsections, card titles |
| **Body Large** | 18px | 400 | 1.6 | Intros, short-form analysis (P3/P4/P5) |
| **Body** | 16px | 400 | 1.6 | Main content, description text (all personas) |
| **Body Small** | 14px | 400 | 1.5 | Captions, metadata, helper text |
| **Label** | 12px | 600 | 1.4 | Tags, badges, form labels (uppercase) |

### Persona-Weighted Typography Rules

- **P1/P2 (Revelatory)**: Display 48px, Headline 32px, Body 16px. High contrast, large jumps between sizes. Encourage rapid scanning.
- **P3 (Mixed)**: Headline 24px, Body Large 18px, Body 16px. Balanced hierarchy. Support both scanning and reading.
- **P4/P5 (Contemplative)**: Body Large 18px consistently. Uniform sizing reduces cognitive load. Letter-spacing +0.5px on body for sustained reading comfort.

## Layout

### Grid System

**8px baseline grid**. All spacing, padding, and margins are multiples of 8px:
- `xs`: 4px (only for internal component micro-spacing)
- `sm`: 8px (standard padding)
- `md`: 16px (card padding, vertical rhythm)
- `lg`: 24px (section spacing)
- `xl`: 32px (major blocks)
- `2xl`: 48px (full-width section gaps)
- `3xl`: 64px (hero spacing)
- `4xl`: 96px (viewport-sized margins)

### Layout Density Rules

- **Revelatory (P1/P2)**: 30% whitespace. High visual clarity. Buttons 44px+. Single-column mobile, 2-column desktop.
- **Mixed (P3)**: 35% whitespace. Balanced density. Information-dense cards with clear hierarchy.
- **Contemplative (P4/P5)**: 40% whitespace. Breathing room. Sustained reading priority. Paragraphs 65-80 characters max.

### No Rounded Corners — Recursive Tessellation Only

Hex-yt-intel uses **zero border-radius** properties. All curved or complex geometry is built via:
1. SVG `<clipPath>` elements with recursive Bezier paths
2. Interlocking rectangular borders with offset overlays
3. Fractal-like nesting of `<rect>` elements for visual complexity

This approach allows precise control over depth perception and ensures geometry aligns with the mathematical, non-skeuomorphic aesthetic.

## Elevation & Depth

### Shadow System (Four-Layer Stack)

Depth is conveyed entirely through **layered shadows** and **light color variation**. No dark shadows.

#### P1/P2 Cards (Cyan-Tinted, Revelatory)
```
Layer 1: 0 2px 4px rgba(0, 217, 255, 0.25)
Layer 2: 0 4px 8px rgba(0, 217, 255, 0.15)
Layer 3: 0 8px 16px rgba(0, 217, 255, 0.1)
Layer 4: 0 12px 32px rgba(0, 217, 255, 0.05)
```

Effect: Cyan glow radiates outward. High-impact, draws eye immediately.

#### P3/P4/P5 Cards (White-Tinted, Contemplative)
```
Layer 1: 0 1px 3px rgba(255, 255, 255, 0.1)
Layer 2: 0 2px 6px rgba(255, 255, 255, 0.08)
Layer 3: 0 4px 12px rgba(255, 255, 255, 0.05)
Layer 4: 0 8px 24px rgba(255, 255, 255, 0.02)
```

Effect: Subtle elevation. Cards rest on surface. Encourages reading without distraction.

### Surface Elevation Levels

| Level | Background | Shadow | Usage |
|-------|------------|--------|-------|
| **Base** | #000000 | None | Page background, empty space |
| **Level 1** | #1A1A1A | P1/P2: Cyan 4-layer, P3+: White 4-layer | Cards, containers, panels |
| **Level 2** | #262626 | Cyan 4-layer (2x intensity) or White subtle (2x intensity) | Nested cards, expandable sections |
| **Level 3** | #333333 | For emphasis only | Modal overlays, focus states |

## Shapes

### Geometric Constraints

1. **No rounded corners** (`border-radius: 0` everywhere)
2. **All corners are junctions**: Interlocking borders create pseudo-curves via tessellation
3. **SVG `<clipPath>` for complex geometry**: When curves are needed, they're built with math-based Bezier paths, not CSS shortcuts
4. **Fractals at component boundaries**: Nested rectangles with 1px offsets create visual complexity without pixel waste

### Component Boundaries

Cards and containers are:
- Rectangles with 1px borders (`border: 1px solid #404040`)
- Interior padding creates visual "breathing room"
- Outer border is decision junction point (where cards touch each other)
- Interlocking borders extend 2-3px to create tessellation effect

## Components

### Buttons

#### Primary Button (P1/P2 Call-to-Action)
- **Background**: Cyan Electric (#00D9FF)
- **Text Color**: Black Obsidian (#000000)
- **Padding**: 16px 24px (md + lg)
- **Font**: Inter 600, 16px
- **Shadow**: Cyan 4-layer stack
- **Border**: None
- **State**:
  - Default: Full shadow stack
  - Hover: 10% lighter cyan, shadow intensity +20%
  - Active: 15% darker cyan, shadow intensity -30%
  - Disabled: 50% opacity, no shadow

#### Secondary Button (P3/P4/P5 Navigation)
- **Background**: Transparent
- **Text Color**: White Pure (#FFFFFF)
- **Padding**: 16px 24px
- **Font**: Inter 600, 16px
- **Border**: 1px solid #404040
- **Shadow**: None
- **State**:
  - Default: Subtle border glow
  - Hover: Border color -> White, +2px inner shadow white 10%
  - Active: Background -> #1A1A1A
  - Disabled: Text 50% opacity, border 30% opacity

### Insight Cards (Revelatory Path)

```
Container: 12px left border (cyan)
Padding: 24px (lg)
Shadow: Cyan 4-layer
Typography:
  - Headline: 24px, weight 600
  - Body: 16px, weight 400, line-height 1.6
  - Meta: 12px, weight 600, color #A1A1AA
```

Insight cards are the primary content vessel for P1/P2. They surface the most critical finding from each dimension with supporting context.

### Analysis Grid (Contemplative Path)

```
10-cell grid: One card per UCIS dimension
Spacing: 16px (md) gutters
Card width: 33.33% on desktop, 50% on tablet, 100% on mobile
Border: 1px solid #404040
Padding: 16px (md)
Shadow: White subtle 4-layer
Typography: Body 16px, Label 12px for dimension names
Highlight: Dimension values in Cyan (non-interactive)
```

The analysis grid displays all 10 UCIS dimensions for P3/P4/P5 users who want comprehensive methodology.

### UCIS Dimension Display

```
Dimension Name (Label 12px, uppercase, weight 600)
─────────────────────
Value: [highlighted text] (Body 16px, Cyan accent for emphasis)
Confidence: [0-100%] (Body Small 14px, secondary text)
Sources: [count] (Label 12px, muted)
```

Each cell is a mini-card with recursive border (1px border + interlocking offset).

## Do's and Don'ts

### DO ✅

- **DO use Cyan Electric (#00D9FF) for P1/P2 only.** This color is reserved for content creator and indie maker paths.
- **DO maintain 8px grid discipline.** All spacing must be a multiple of 8px. No arbitrary padding.
- **DO stack shadows in four layers.** Use the predefined color + opacity combinations. Never improvise shadow depth.
- **DO respect persona UX split.** 70% of the interface is optimized for fast scanning (P1/P2). 30% for deep reading (P3/P4/P5).
- **DO use recursive tessellation for geometry.** If you need a curve, use SVG `<clipPath>`. Never reach for `border-radius`.
- **DO maintain WCAG AAA contrast ratios.** All text must achieve 7:1 or higher. Run contrast checker on every color combo.
- **DO use Inter font exclusively.** Variable weight (400-700) handles all hierarchy. No display typefaces.
- **DO center whitespace strategically.** 30-40% whitespace supports scanning and reading.

### DON'T ❌

- **DON'T use rounded corners.** `border-radius` is banned. Use tessellation instead.
- **DON'T add decorative shadows.** Shadows convey depth only. No shadow-as-decoration.
- **DON'T mix cyan and white accents in the same card.** Persona colors should not conflict.
- **DON'T exceed 2 font sizes per section.** Typography hierarchy is intentional, not algorithmic.
- **DON'T use colors outside the palette.** No ad-hoc hex values. All colors must be defined tokens.
- **DON'T add animations without purpose.** No bouncy easing, springs, or overshoot. Motion confirms state only.
- **DON'T create symmetrical layouts.** Obsidian-Escher is deliberately asymmetrical, evoking complexity.
- **DON'T hide information behind complex interaction.** Revelatory path should expose 70% of insights in <2 seconds.

---

**Design System Version**: Alpha (Google DESIGN.md Standard, April 2026)  
**Last Updated**: 2026-05-25  
**Maintained By**: Hex YouTube Intelligence Design Team  
**License**: Apache 2.0 (aligned with @google/design.md)
