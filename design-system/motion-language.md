# Motion & Interaction Language

## Philosophy
Motion in HEX-YT-INTEL exists to structure cognitive load, not to decorate. Because users are analyzing massive datasets and complex transcript syntheses, motion must guide the eye logically and gracefully without causing fatigue.

## Core Principles
- **Timing:** Fast-Medium (150ms - 300ms).
- **Easing:** `ease-out` strictly. Elements should feel precise and grounded, settling into place naturally.
- **Purpose:** Sequence staggering to prevent wall-of-text overwhelm; hover states to indicate interactivity in dense matrices.
- **No Bounce:** Bouncy/spring animations cheapen the "elite intelligence" vibe.

## Interaction Patterns

### Sequence Animations (Loading & Revealing)
- **Type:** Staggered Fade + Subtle Slide Up (10px).
- **Timing:** 0.1s delay between cards/sections.
- **Rationale:** Allows the brain to parse the appearance of insight tiers, executive summaries, and tables sequentially.

### Hover States (Cards & Interactive Elements)
- **Type:** Subtle Lift (-2px Y-axis) + Beautiful Shadow enhancement.
- **Duration:** 150ms `ease-out`.
- **Rationale:** "Outline Styling" cards feel grounded. Hovering lifts them, expanding the multi-layered shadow to communicate depth and interactivity seamlessly.

### Scroll Reveals
- **Type:** Fade + 15px Slide Up on intersecting viewport.
- **Usage:** As the user scrolls down long analyses (e.g., through 16 sections of UCIS output), new sections ease into view rather than remaining static.

## Accessibility Compliance
- Fully respects `prefers-reduced-motion: reduce`.