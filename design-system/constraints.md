# Design System Constraints & Guardrails

## Color Constraints
- ❌ **Never:** Use generic purple/pink heavy gradients as main backgrounds.
- ❌ **Never:** Use Neon Coral (#FF6B6B) for primary CTAs or general buttons.
- ✅ **Always:** Reserve Neon Coral STRICTLY for warnings, destructive actions, or flagging critical AI anomalies.
- ✅ **Always:** Support both Dark (Slate/Obsidian) and Light (FAFAFA) modes.

## Typography Constraints
- ❌ **Never:** Use system fonts for headings; never use Geist for dense paragraph reading.
- ✅ **Always:** Use Inter for tables, data matrices, and heavy body text.
- ✅ **Always:** Use JetBrains Mono for exact transcript quotes or code snippets to separate them from analytical narrative.

## Layout & Styling Constraints
- ❌ **Never:** Use heavy glassmorphism (>8% backdrop blur) on text-heavy cards, as it destroys legibility.
- ❌ **Never:** Use single, harsh drop-shadows (e.g., standard `#000000` at 50% opacity).
- ✅ **Always:** Use **Outline Styling**: Cards and sections must have a subtle 1px translucent border (`rgba(255,255,255,0.1)` in dark mode).
- ✅ **Always:** Use **Beautiful Shadows**: Figma-style, multi-layered, smooth shadows (e.g., combining 3-4 subtle box-shadows for a single element).
- ✅ **Always:** Keep subtle glassmorphism (5-8% blur) reserved ONLY for floating headers, navigation, or elevated modals.

## Motion Constraints
- ❌ **Never:** Use bouncy, spring, or elastic animations.
- ❌ **Never:** Animate text letter-by-letter or word-by-word (distracting and slow).
- ✅ **Always:** Use precise `ease-out` timing.
- ✅ **Always:** Use staggered sequence animations (0.1s delay) for lists and card grids.

## Component Constraints
- **Tables:** Must use exact column/row boundaries with outline styling. No "floating" text tables.
- **Density:** High information density. Use 14px Inter for data, tightened padding (12px-16px) inside matrices to fit more intelligence on screen.

## Quality Gates
- Outline styling must visually separate interactive elements from background.
- Hovering over an outline card must lift it and deepen the beautiful shadow.