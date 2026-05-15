---
name: UI/UX Design System Generator
description: Transforms product briefs (PRD, design docs, related context) into complete Claude Design system configs. Reads domain docs, researches color/typography/architecture best practices for user personas and industry, confirms assumptions, then outputs: design brief, palette.json, typography.json, motion spec, constraints, and a ready-to-paste Claude Design system prompt.
---

# UI/UX Design System Generator

This skill transforms your product brief into a complete, research-backed design system scaffold ready for Claude Design. Input: PRD + supporting docs. Output: 6 files (brief, palette, typography, motion, constraints, prompt) + copy-paste Claude Design instructions.

---

## When to Use This Skill

**Trigger:** User is building a new product or redesigning existing product and needs a unique, branded design system (not boilerplate).

**Input Required:**
- Product brief / PRD (or link to one)
- Supporting docs: user research, market analysis, personas, competitive landscape, any existing design work
- Product domain/vertical (healthcare, automotive, fintech, wellness, etc.)

**Output Delivered:**
1. Design brief (research-backed)
2. palette.json (semantic colors for domain + personas)
3. typography.json (font strategy for readability + brand)
4. motion-language.md (interaction principles)
5. constraints.md (forbidden patterns + guardrails)
6. claude-design-system-prompt.md (copy-paste ready for Claude Design "Setup Design System")

---

## Workflow

### Stage 1: Ingest & Parse PRD

**Goal:** Understand product, users, domain, market positioning.

1. **Request PRD + Context**
   - Ask for product brief, PRD, or link to docs
   - Ask for supporting materials: personas, user research, market analysis, existing design files, competitive analysis
   - Shorthand answers acceptable

2. **Parse & Extract**
   Extract from provided materials:
   - Product name, category, primary use case
   - User personas (demographics, psychographics, pain points, contexts)
   - User journey (key flows, moments of truth)
   - Market/domain (healthcare, automotive, fintech, wellness, B2B, consumer, regional, global)
   - Geography/culture context (if relevant)
   - Competitive positioning (vs. existing solutions)
   - Existing brand guidelines or design patterns (if any)
   - Technical constraints (platform: web, mobile, both; device types; accessibility requirements)

3. **Clarify Gaps**
   If critical info missing, ask targeted questions:
   - "Who is the primary user persona?"
   - "What's the #1 user problem this solves?"
   - "Is this B2B, B2C, or both?"
   - "Geographic/cultural context?"
   - "Existing brand identity or starting from scratch?"
   - "Platform(s): web/mobile/both?"
   - "Timeline/MVP vs. mature product?"

   Keep to 3-5 high-impact questions max. If user answers in shorthand, that's fine.

### Stage 2: Parallel Research Track

**Goal:** Generate domain-specific design recommendations (color psychology, typography, interaction patterns, component architecture).

**Do NOT ask user for these**—research autonomously as SME.

Research:
- **Color Psychology for Domain + Personas**
  - What colors drive trust/calm/action in this domain?
  - Cultural color associations (if international)
  - Accessibility: contrast ratios, colorblind-safe palettes
  - Competitive color landscape (what's overused in space?)
  - Emotional response by persona type

- **Typography Strategy**
  - Readability for user context (e.g., on-the-go, medical, financial)
  - Gender/age presentation (some fonts feel "gendered" or dated)
  - Dyslexia-friendly options (if accessibility-critical, e.g., healthcare, education)
  - Font pairings that convey domain positioning (premium vs. approachable vs. technical)
  - International support (if multilingual)

- **Interaction & Motion Principles**
  - Domain norms (fintech: fast/precise; healthcare: calm/reassuring; gaming: energetic)
  - User context (e.g., ADHD users: clear focus states; fast-paced: zippy motion)
  - Accessibility: reduced-motion preferences, vestibular sensitivity
  - Competitive interaction patterns (what works in space? what feels dated?)

- **Component Architecture**
  - Data-dense vs. whitespace-driven layout
  - Functional density (how much per screen?)
  - Navigation style (hierarchical, flat, persistent bottom bar, sidebar, etc.)
  - Input pattern (forms, inline editing, multi-step wizards, etc.)

- **Forbidden Patterns**
  - Generic AI design clichés (overused fonts, layouts, color combos)
  - Domain-specific anti-patterns (e.g., animations in medical contexts that trigger anxiety)
  - Accessibility violations (e.g., insufficient contrast for elderly users)
  - Cultural missteps (if international product)

**Output this research clearly**, organized by category, with citations/rationale.

### Stage 3: Assumption Confirmation

**Goal:** Validate research against user intent. Reduce misalignment.

Present findings as a **2-part confirmation**:

**Part A: Quick Scan Confirmation**
If research aligns well with PRD context, present as:
```
## Research Summary (Validation)

Based on [domain/personas], I recommend:

**Color Direction:** [2-3 colors] because [reasoning]
**Typography:** [font pairing] because [reasoning]
**Motion Approach:** [principle] because [reasoning]
**Layout Strategy:** [style] because [reasoning]

Does this feel right, or adjust?
```

Allow user to respond with:
- "Yes, proceed" (skip to Stage 4)
- "Adjust X because..." (iterate)
- "Missing context: [details]" (loop back to Stage 1)

**Part B: Detailed Questions (only if needed)**
If critical gaps remain, ask:
```
Before finalizing palette:
1. Brand tone: premium/accessible/technical?
2. User stress level in product: high (needs calm) or low (can be energetic)?
3. Primary device: mobile/desktop/equal?
4. Accessibility priority: legal requirement or nice-to-have?
```

Keep to 4-6 questions max. Again, shorthand answers fine.

---

### Stage 4: Generate Design System Outputs

**Goal:** Produce 6 machine-readable, copy-paste-ready outputs.

Once assumptions confirmed, generate:

#### **1. Design Brief (design-brief.md)**
```markdown
# [Product Name] Design System Brief

## Product Context
- **Name:** [Product]
- **Category:** [Domain]
- **Primary Users:** [Personas]
- **Core Problem:** [What it solves]

## User Research Summary
- Pain points: [List]
- Key moments of truth: [Flows]
- Device/context: [How used]

## Design Philosophy
[2-3 guiding principles based on domain research]

## Visual Strategy
- **Color Logic:** [Semantic meaning of palette]
- **Typography Logic:** [Why these fonts, readable at what sizes]
- **Motion Logic:** [When, why, principle]
- **Layout Logic:** [Data density, component distribution]

## Accessibility Requirements
- **WCAG Level:** [AA or AAA]
- **Specific Needs:** [e.g., dyslexia-friendly, reduced motion, high contrast]

## Competitive Differentiation
- **What Others Do:** [Common patterns in space]
- **Our Approach:** [How we differ]
- **Forbidden Patterns:** [Explicit no-gos]

## Success Criteria
- Non-boilerplate (visually distinct from competitors)
- Branded (every pixel reflects domain + personas)
- Accessible (meet WCAG + user needs)
- Performant (production-ready code, not images)
```

#### **2. palette.json (semantic color system)**
```json
{
  "metadata": {
    "product": "[Product]",
    "purpose": "Semantic color palette for [domain]",
    "rationale": "[Why these colors for this domain/personas]"
  },
  "semantic": {
    "primary": {
      "value": "#[hex]",
      "usage": "[Where/when used]",
      "psychology": "[Why this color works for domain]"
    },
    "secondary": {
      "value": "#[hex]",
      "usage": "[Accent, contrast, secondary actions]",
      "psychology": "[Emotional intent]"
    },
    "tertiary": {
      "value": "#[hex]",
      "usage": "[Supporting, if needed]",
      "psychology": "[Intent]"
    },
    "status": {
      "success": "#[hex]",
      "warning": "#[hex]",
      "error": "#[hex]",
      "info": "#[hex]"
    },
    "neutral": {
      "background": "#[hex]",
      "surface": "#[hex]",
      "text-primary": "#[hex]",
      "text-secondary": "#[hex]",
      "border": "#[hex]"
    }
  },
  "contrast_audit": {
    "note": "All text-on-background combos meet WCAG AAA (7:1 minimum)",
    "tested": ["primary-on-white", "secondary-on-white", ...]
  },
  "cultural_notes": "[If international: color associations by market]",
  "accessibility": {
    "colorblind_safe": true/false,
    "high_contrast_mode": "[If needed]"
  }
}
```

#### **3. typography.json (font strategy)**
```json
{
  "metadata": {
    "product": "[Product]",
    "rationale": "[Why these fonts for domain + personas]",
    "accessibility": "[Dyslexia-friendly? High readability? etc.]"
  },
  "font_stack": {
    "display": {
      "family": "[Font Name]",
      "fallback": "[Backup]",
      "usage": "Hero sections, headlines",
      "sizes": "[Size range, e.g., 32-48px]",
      "line_height": "[1.2-1.4]",
      "letter_spacing": "[Tracking in px or %]",
      "rationale": "[Why this font conveys [brand tone]]"
    },
    "headline": {
      "family": "[Font]",
      "fallback": "[Backup]",
      "usage": "H1, H2, section headers",
      "sizes": "[24-32px]",
      "line_height": "[1.3-1.5]",
      "letter_spacing": "[0 to +0.5px]",
      "rationale": "[Why readable + on-brand]"
    },
    "body": {
      "family": "[Font]",
      "fallback": "[Backup]",
      "usage": "Paragraph text, descriptions, long-form",
      "sizes": "[14-16px for mobile, 16-18px for desktop]",
      "line_height": "[1.5-1.8, varies by device]",
      "letter_spacing": "[0 to +0.3px]",
      "rationale": "[Optimized for readability + domain context]"
    },
    "caption": {
      "family": "[Font]",
      "fallback": "[Backup]",
      "usage": "Labels, timestamps, helper text",
      "sizes": "[12-14px]",
      "line_height": "[1.4-1.6]",
      "letter_spacing": "[0 to +0.2px]",
      "rationale": "[Readable at small sizes, doesn't get lost]"
    }
  },
  "international_support": {
    "arabic": "[If needed: font choice for Arabic]",
    "chinese": "[If needed: CJK support]",
    "note": "[Any language-specific considerations]"
  },
  "contrast_audit": {
    "body_on_white": "[Hex 1] on [Hex 2] = [Ratio, e.g., 8.5:1 (AAA)]",
    "body_on_surface": "[Same audit]"
  }
}
```

#### **4. motion-language.md (interaction principles)**
```markdown
# Motion & Interaction Language

## Philosophy
[1-2 sentences on when/why motion is used in this product]

## Core Principles
- **Timing:** [Fast (200ms) / Medium (300ms) / Slow (500ms+) based on context]
- **Easing:** [ease-out for exits, ease-in for entries, custom for domain]
- **Purpose:** [Motion confirms state change, doesn't just decorate]
- **Accessibility:** [respects prefers-reduced-motion]

## Interaction Patterns

### Page Transitions
- Type: [Fade / Slide / None]
- Duration: [300-400ms]
- Rationale: [Why this works for product context]

### Form Interactions
- Focus state: [Animated border + shadow]
- Error feedback: [Shake or highlight, not beep]
- Success feedback: [Subtle checkmark + color shift, not celebratory]

### Data Loading
- Skeleton screens: [Yes/no]
- Progress indicator: [Animated bar, spinner, none]
- Empty state: [Static or animated encouragement?]

### Navigation
- Menu open/close: [Stagger, slide, expand]
- Breadcrumb highlights: [Underline animate, bold shift]
- Tab switches: [Fade, slide, none]

## Forbidden Patterns
- No bouncing animations (feels unprofessional in [domain])
- No auto-playing motion (accessibility issue)
- No parallel animations (cognitive overload)
- No more than [2 properties] animating simultaneously

## Accessibility Compliance
```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```
```

#### **5. constraints.md (guardrails)**
```markdown
# Design System Constraints

## Color Constraints
- ❌ Never: [Forbidden color combos, e.g., "High saturation purples + pinks"]
- ✅ Always: [e.g., "Primary color for CTAs", "Semantic status colors for feedback"]
- Palette Lock: [3-color max per screen (primary + 2 accents)]

## Typography Constraints
- ❌ Never: [Overused fonts, e.g., "Inter, Roboto, system fonts for display"]
- ✅ Always: [e.g., "Body text 16px minimum on mobile", "Line-height 1.5+ for accessibility"]
- Font Lock: [Only approved fonts from typography.json]

## Layout Constraints
- Grid baseline: [8px / 4px / 6px]
- Spacing scale: [1x, 1.5x, 2x, 3x, 5x multiples]
- Max content width: [1200px / full-bleed / other]
- Responsive breakpoints: [sm: 480px, md: 768px, lg: 1024px, xl: 1440px]

## Motion Constraints
- Duration limits: [Min 150ms, max 800ms for single interaction]
- Easing: [No bounces, springs, or overshoot in medical/fintech contexts]
- No auto-play animations

## Component Constraints
- Data density: [Sparse (whitespace-driven) / Medium / Dense (information-packed)]
- Button states: [Default, hover, active, disabled, loading]
- Form density: [One input per line / multiple columns / determined by context]

## Accessibility Constraints
- Contrast: [All text-on-background WCAG AAA (7:1 minimum)]
- Focus indicators: [Always visible, min 2px outline]
- Touch targets: [Min 44x44px on mobile]
- Alt-text: [All images + icons require descriptive alt]

## Imagery Constraints
- Photography: [Bespoke / illustration / no photography]
- Icons: [Stroke style / filled / mixed]
- Patterns/textures: [Allowed / forbidden]

## Forbidden Patterns (Explicit)
1. [e.g., "Symmetrical layouts (too corporate)"]
2. [e.g., "Stock photography (use illustrations instead)"]
3. [e.g., "More than 1 shadow per element"]
4. [e.g., "Micro-interactions without purpose"]
5. [e.g., "Animations that trigger on every load"]

## Quality Gates
- Lighthouse: 95+
- WCAG AAA compliance: [Yes]
- Coherence audit: [Every screen visually distinct from competitors]
- Performance budget: [Max 50ms time-to-interactive]
```

#### **6. claude-design-system-prompt.md (copy-paste for Claude Design)**
```markdown
# Claude Design System Setup Prompt

**Copy this entire prompt into Claude Design's "Setup Design System" feature.**

---

You are building a world-class, non-boilerplate design system for **[Product]**.

## Design Context

**Product:** [Product name]
**Domain:** [Category, e.g., healthcare, automotive]
**Primary Users:** [Personas]
**Core Goal:** [What the product solves]

## Design Brief
[Paste full design-brief.md here]

## Color Palette (Semantic)
[Paste palette.json here]

## Typography System
[Paste typography.json here]

## Motion & Interaction Principles
[Paste motion-language.md here]

## Design Constraints & Guardrails
[Paste constraints.md here]

---

## Your Role

You are a world-class design system architect and UI/UX expert specializing in [domain]. You understand:
- The psychology of color for [domain] users
- Accessibility requirements (WCAG AAA compliance)
- Interaction patterns that reduce user anxiety/friction
- Motion that serves purpose, not decoration
- Component architecture for this user context

You generate:
- Live, interactive prototypes (React/HTML/SVG)
- Production-ready code (not mockups)
- Unique, branded UI (not generic AI aesthetics)
- Every pixel intentional and purposeful

## Design Philosophy

- **Simplicity through constraint:** More rules = cleaner output
- **Material honesty:** Form follows function + intent
- **Obsessive detail:** Micro-interactions, spacing, breathing room all matter
- **Non-boilerplate:** Every design is visually distinct from competitors
- **Accessible by default:** WCAG AAA, never an afterthought

## Guardrails

### Colors
- Use semantic palette only (no custom hex unless specified)
- 3-color max per screen (primary + 2 accents)
- All text-on-background combos must be WCAG AAA (7:1 contrast)
- Never use: [Forbidden colors from constraints.md]

### Typography
- Font stack locked: [approved fonts only]
- Body text min 16px on mobile, 16-18px on desktop
- Line-height always 1.5+ for accessibility
- Never use: [Forbidden fonts]

### Layout
- 8px grid baseline (all spacing in 8px multiples)
- Responsive: mobile-first, test at sm/md/lg breakpoints
- Whitespace is design: don't fill empty space just because it exists

### Motion
- Animations 150-800ms duration (no bounces/springs in this context)
- Respects prefers-reduced-motion
- Motion has purpose: confirms state, guides attention, never just decorates
- No auto-play animations

### Components
- Atomic approach: buttons → cards → sections → full layout
- Every component state tested: default, hover, active, disabled, loading
- Touch targets on mobile min 44x44px
- Focus indicators always visible (2px outline minimum)

## Success Criteria for Every Design

✓ **Non-boilerplate:** Visually distinct from [competitor 1], [competitor 2], [competitor 3]
✓ **Branded:** Every element reflects color, typography, motion system
✓ **Accessible:** WCAG AAA, tested for [specific accessibility needs]
✓ **Production-ready:** Code, not image; live artifact
✓ **Intentional:** No generic filler; every pixel has purpose

---

## Design Request Format

When ready to design a specific screen/component, provide:

**What:** [Feature/screen name]
**Context:** [User journey moment, what precedes/follows]
**Data/Content:** [Typical content that will appear]
**Constraints:** [Size, responsiveness, special requirements]
**Success Look:** [Reference inspiration image or description]

Then I will generate a live, production-ready design artifact that follows this system.

---

**System ready. What would you like to design first?**
```

---

### Stage 5: Deliver & Confirm

**Goal:** Hand off 6 outputs + instructions for Claude Design.

Once all 6 files generated:

1. **Present outputs** in clear sections (design-brief, palette, typography, motion, constraints, prompt)

2. **Provide delivery instructions:**
   ```
   ## How to Use These Files in Claude Design
   
   1. Open Claude Design
   2. Click "Setup Design System"
   3. Copy-paste the contents of `claude-design-system-prompt.md` into the prompt field
   4. Upload (or reference) these files:
      - design-brief.md
      - palette.json
      - typography.json
      - motion-language.md
      - constraints.md
   5. Click "Create System"
   6. For any design request, provide feature context + data
   7. Claude Design will generate branded, unique artifacts
   ```

3. **Exit condition:** User confirms system ready, or asks for adjustments.

   If adjustments needed (e.g., "Make colors warmer," "Change motion to be faster"):
   - Update only affected files
   - Re-confirm assumptions
   - Re-present updated outputs

---

## Tips for Execution

**Research Quality:**
- Do NOT use generic color recommendations (e.g., "blue = trust"). Research *why* for *this domain*
- Reference scientific studies if available (ADHD color research, elderly readability studies, etc.)
- Acknowledge trade-offs (e.g., "High contrast helps vision, but can feel clinical")

**Assumption Confirmation:**
- Present research clearly so user can calibrate
- Offer adjustments, not a final prescription
- If user says "that's not quite right," ask what's off (not enough research, different vision, etc.)

**Output Quality:**
- Every JSON file must be machine-readable (valid syntax)
- Every markdown file must be copy-paste ready
- Claude Design prompt must be exhaustive (if system is incomplete, Claude Design will improvise)

**Handling Scope Creep:**
- If user asks "can you also design the whole app?" during Stage 1-3, note this and ask if needed now or after system validation
- Keep Stage 1-4 focused on system generation, not full designs

**Agent Consistency:**
- If user references prior work/conversations, extract lessons and fold into research
- If user mentions "like the ADHD prep system," use that as precedent for style/approach

---

## When to Stop

Exit the skill and hand off to Claude Design when:
1. All 6 outputs generated
2. User confirms system is ready
3. User pastes prompt into Claude Design

From here, user designs with Claude Design using the system as guardrails. Any future design requests in that product use the same system.

---

## Example: ADHD Prep Assessment System

**Input:** ADHD-prep PRD + user research (companion input, childhood recall, physician handoff)

**Output:**
- **Brief:** Emphasizes calm, clarity, support for patient + companion
- **Palette:** Sage green (focus/calm), coral (approachable), gold (reassurance)—research-backed for ADHD
- **Typography:** Dyslexia-friendly (Atkinson Hyperlegible), warm sans (Poppins), generous spacing
- **Motion:** Slow, intentional; staggered reveals to reduce cognitive load; respects ADHD low-frustration tolerance
- **Constraints:** No overwhelming color; max 2 actions per screen; clear progress; undo everywhere
- **Prompt:** Ready to feed into Claude Design for session UI, companion invite flow, report preview, etc.

---

**Skill execution: Understand the product → Research domain deeply → Confirm assumptions → Generate 6 outputs → Deliver to Claude Design.**
