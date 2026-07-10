# Design Specification: A7la Diva Luxury Cosmetics Brand
**Brand**: A7la Diva (Egyptian: "most beautiful goddess/woman")  
**Market**: Egypt / Gulf region (Cairo-based importer expansion)  
**Positioning**: Luxury, curated, imported quality, aspirational  
**Target Persona**: Women 25–45, upper-middle to high income, influenced by lifestyle content  
**Timeline**: Track B (Hours 0–16) for Figma mockups + design tokens
---
## PART 1: BRAND AESTHETIC
### Visual Identity: Luxury Minimalism
**Color Palette**:
- **Primary**: Deep Charcoal (#1a1a1a) — Sophisticated, luxe, premium
- **Accent 1**: Rose Gold (#B76E79) — Warmth, femininity, approachable luxury
- **Accent 2**: Emerald (#50A895) — Jewel tone, prestige, nature-inspired
- **Accent 3**: Sapphire (#1E3A8A) — Deep, luxe, exclusivity
- **Neutral**: Off-White (#F5F3F0) — Breathing room, elegance
### Typography System
**Headline Typography** (Luxury, editorial):
- **Font**: Playfair Display (serif) or Cormorant (serif alternative)
- **Weight**: 600–700 (bold, commanding)
- **Size**: 32px–56px
- **Line-height**: 1.2–1.3 (tight for impact)
**Subheading Typography** (Refined, readable):
- **Font**: Inter or Poppins (sans-serif, modern)
- **Weight**: 500–600 (medium)
- **Size**: 18px–24px
**Body Typography** (Clear, comfortable):
- **Font**: Inter or Poppins (sans-serif)
- **Weight**: 400–500 (regular to medium)
- **Size**: 14px–16px
- **Line-height**: 1.6–1.8 (generous for readability)
### Motion & Animation
**Principles**:
- Smooth, luxe, never jarring
- 200–400ms transitions (not too fast, not sluggish)
- Ease-in-out preferred (natural, organic)
- Parallax for layering (depth, sophistication)
**Examples**:
- **Hero video autoplay**: Fade in on page load (500ms ease-in)
- **Product hover**: Subtle scale (1.02x) + shadow elevation + price color change (250ms)
- **Image carousel**: Smooth fade between slides (400ms)
- **Parallax scrolling**: Background moves slower than foreground (depth effect)
- **Button hover**: Color shift + subtle lift animation (200ms)
- **Page transitions**: Fade + slide (300ms)
- **3D rotations**: Product viewer spins on hover (600ms smooth)
---
## PART 2: HERO CONCEPT (AI-Generated)
### The Scene
**Setting**: Parisian luxury (implied, visual language only)
- Interior: Modern luxury apartment, subtle classical art in background
- Lighting: Chiaroscuro (dramatic, sculpted light + shadow), warm golden hour
- Mood: Aspirational, elegant, editorial
### The Subject
**Woman**:
- Age: 28–35 (sophisticated, confident)
- Style: Refined, minimalist luxury (tailored clothing, elegant jewelry)
- Accessory: Fancy hat (statement piece, luxury signal — e.g., beret, wide-brim, vintage)
- Expression: Serene, beautiful, aspirational (not smiling, regal)
### The Focus
**Product Showcase**:
- **Hand 1**: Holding eyelashes (displaying length, curl, texture)
- **Hand 2**: Displaying nails (showing color, finish, care)
- **Optional**: Small makeup sponges or premium packaging in background (soft focus)
### Technical Specs
- **Duration**: 8–15 seconds (continuous loop)
- **Resolution**: 1920×1080 (2K for luxury)
- **Framerate**: 24fps or 30fps (cinematic)
- **Audio**: Music-only (no voiceover)
- **Format**: MP4 (H.264) for web
### Production Approach
**Recommended: AI-Generated** (Fastest, on-brand):
- **Tool**: Sora (OpenAI), Runway ML, or similar
- **Prompt**: "Parisian luxury apartment, woman with fancy hat, elegant jewelry, close-up shot of eyelashes and nails being displayed with dramatic chiaroscuro lighting, warm golden hour, serene mood, slow motion hand movements, 15 seconds, 2K resolution"
---
## PART 3: PAGE LAYOUTS & WIREFRAMES
### 1. Landing Page (Hero + Featured Collections)
**Hero Section (Video/Image)** ← Hero: Woman + eyelashes/nails, Parallax scroll enabled
**Featured Collections (Grid)**:
- 4 product grids (Sculpted Lashes, Artisan Nails, Makeup Essentials, Premium Packaging)
- Responsive 1→3 columns
**Brand Story Section** (Lifestyle imagery, editorial):
- Headline: "Imported Luxury, Carefully Curated"
- Image + text blocks (50/50)
**CTA Banner**:
- [Primary: "Shop Now"] [Secondary: "Join Our Reseller"]
---
### 2. E-Commerce Dashboard (Product Grid + Filters)
**LEFT SIDEBAR (Filters)**:
- Collection checkboxes
- Price range slider
- Rating filter
- Apply/Clear buttons
**MAIN CONTENT (Product Grid)**:
- 3–4 column responsive grid
- Product cards: Image + name + price + rating + "Add" button
- Hover effect: Subtle scale (1.02x), shadow, slight color shift
---
### 3. Product Detail Page (50/50 Layout)
**LEFT SIDE (Image Showcase)**:
- Main product image (large, high-res)
- Thumbnail carousel
- Video (if available)
**RIGHT SIDE (Product Info)**:
- Product name + category tag
- Rating + review count
- Price
- Description + bullet points
- Variant selectors (dropdowns)
- Quantity adjuster
- [ADD TO CART] [BUY NOW] buttons
- Shipping info
- Reviews section
---
### 4. B2B Portal (Reseller Dashboard)
**TOP STATS (KPIs)**:
- Referral code
- Monthly revenue
- Tier status
- Pending commissions
**REFERRAL CODE SECTION**:
- Code display
- [Copy] [QR Code] [Share] buttons
- Shareable URL
**COMMISSION LEDGER (Table)**:
- Date | Amount | Status | Actions
- Sortable, filterable, exportable
---
## PART 4: DESIGN TOKENS (Tailwind Config)
### Color Scale
charcoal-900: #1a1a1a (Primary dark)
rose-gold: #B76E79 (Accent)
emerald-500: #50A895 (Jewel tone)
sapphire-500: #1E3A8A (Deep blue)
off-white: #F5F3F0 (Neutral)

### Typography Presets
h1: 2.5rem, 700 weight, 1.2 line-height
h2: 1.875rem, 700 weight, 1.3 line-height
body: 1rem, 400 weight, 1.6 line-height

### Spacing Scale (8px base)
0, 4px, 8px, 12px, 16px, 24px, 32px, 48px, 64px, 96px

### Border Radius
0, 4px (subtle), 8px (default), 16px (large)

---
## PART 5: ACCESSIBILITY (WCAG AAA)
### Color Contrast
- Text on bg: 7:1+ contrast ratio
- Buttons: 4.5:1+ (AAA standard)
### Keyboard Navigation
- Tab order: Logical, left-to-right
- Focus indicators: 2px solid rose gold (#B76E79)
### Screen Reader
- Alt text: Descriptive, not "image1"
- Form labels: Associated with input IDs
- ARIA labels: On icon-only buttons
- Semantic HTML: `<button>`, `<nav>`, `<main>`, `<article>`
### Motion
- Respect `prefers-reduced-motion` media query
- Auto-play video: Muted by default, pausable
---
## PART 6: RESPONSIVE DESIGN
### Breakpoints
- **Mobile**: 320px–640px (1 column)
- **Tablet**: 641px–1024px (2 columns)
- **Desktop**: 1025px+ (3–4 columns)
### Touch-Friendly
- Buttons: 44px minimum touch target
- Spacing: 12px+ between interactive elements
- Font size: 16px+ (prevents iOS auto-zoom)
---
## DELIVERABLES (Track B, Hours 0–16)
### By Hour 4
- ✅ Brand aesthetic finalized
- ✅ Hero video concept approved
- ✅ Hero video storyboard
### By Hour 8
- ✅ Figma landing page mockup
- ✅ Figma product grid page
- ✅ Design tokens documented
### By Hour 12
- ✅ Figma product detail page
- ✅ Figma B2B portal dashboard
- ✅ Component library
### By Hour 16
- ✅ Design system complete
- ✅ Accessibility checklist (WCAG AAA)
- ✅ Responsive breakpoints tested
---
**Document Version**: 1.0  
**Status**: Ready for Track B (Claude Design) implementation
