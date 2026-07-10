
Product Schema: Shopify Data Model for A7la Diva
Purpose: Define Shopify product structure for 100 SKU MVP
Database: Shopify Admin (products, variants, inventory) + Supabase (custom attributes)

PRODUCT CATEGORIES (4 Core Types)
1. Eyelashes
Typical Price: $25–$60 per pair
Key Variants: Shade (Black, Brown, Brunette, Blonde), Length (6mm–16mm), Style (Natural, Dramatic, Winged, Cat-Eye), Quantity (1-pair, 3-pair, 5-pair bundle)
Supplier: AliExpress or direct Chinese manufacturers
Example SKUs: 40 unique products for MVP
2. Nails
Typical Price: $30–$80 per set
Key Variants: Color (Red, Pink, Nude, Glitter, etc.), Size (XS, S, M, L, XL), Finish (Gel, Matte, Glossy), Quantity (1-bottle, 3-set, full kit)
Supplier: Korean brands or AliExpress bulk
Example SKUs: 35 unique products for MVP
3. Makeup Sponges
Typical Price: $15–$40 per item/kit
Key Variants: Shape (Round, Teardrop, Wedge), Color (Pink, Black, White, Rainbow), Quantity (1-pack, 3-pack, 10-pack)
Supplier: Beauty brands or AliExpress
Example SKUs: 15 unique products for MVP
4. Premium Packaging
Typical Price: $20–$50 per set
Key Variants: Size (Small, Medium, Gift set), Color (Black, Gold, White, Rose), Material (Cardboard, Luxury kraft)
Supplier: Custom packaging manufacturers
Example SKUs: 10 unique products for MVP
VARIANT STRUCTURE
Eyelashes Variants
Option 1: Shade (Black, Brown, Brunette, Blonde, Transparent)
Option 2: Length (6mm, 8mm, 10mm, 12mm, 14mm, 16mm)
Option 3: Style (Natural, Dramatic, Winged, Cat-Eye)
Option 4: Quantity (1 Pair, 3 Pair Bundle, 5 Pair Bundle)
Nails Variants
Option 1: Color (Red, Pink, Nude, Purple, Glitter, French Tip)
Option 2: Size (XS, S, M, L, XL)
Option 3: Finish (Gel, Matte, Glossy, Glitter)
Option 4: Quantity (1 Bottle, 3-Pack, Full Manicure Set)
Sponges Variants
Option 1: Shape (Round, Teardrop, Wedge)
Option 2: Color (Pink, Black, White, Rainbow)
Option 3: Quantity (1-Pack, 3-Pack, 10-Pack Bulk)
Packaging Variants
Option 1: Size (Small Box, Medium Box, Large Gift Set)
Option 2: Color (Black, Gold, White, Rose Gold)
Option 3: Material (Kraft Paper, Matte Black, Luxury Cardboard)
PRICING STRATEGY
B2C Pricing (Direct to Consumer)
Calculation:

Supplier Cost (AliExpress average):
  - Eyelashes: $8–12/pair
  - Nails: $12–20/set
  - Sponges: $2–5/item
  - Packaging: $3–8/box
Retail Price (B2C):
  - Eyelashes: $35–60/pair (400–600% markup)
  - Nails: $48–80/set (300–500% markup)
  - Sponges: $12–25/item (300–500% markup)
  - Packaging: $20–45/box (300–700% markup)
Gross Margin: 70–80% (after Shopify fees 3% + ads ~20–30% = ~50–57% net)
B2B Pricing (Reseller/Affiliate)
Tier Multipliers (Applied in Supabase):

Bronze Tier: 0.75x base retail price
Silver Tier: 0.65x base retail price (after $5K/month sales)
Gold Tier: 0.50x base retail price (after $20K/month sales)
Custom Tier: Negotiated per account
COLLECTION TAXONOMY
Main Collections (4)
1. Sculpted Lashes
Description: "Handcrafted, dramatic eyelashes for bold beauty"
Products: All eyelash products
2. Artisan Nails
Description: "Premium nail color, gels, and sets"
Products: All nail products
3. Makeup Essentials
Description: "Professional sponges and applicators"
Products: Sponges + makeup tools
4. Premium Packaging
Description: "Luxury gift boxes and presentation"
Products: All packaging products
INVENTORY MANAGEMENT
Location Tracking
Primary Location: Cairo Warehouse
  - Eyelashes: 500 units
  - Nails: 300 units
  - Sponges: 200 units
  - Packaging: 150 units
METADATA ENRICHMENT (Supabase)
Custom Product Attributes
{
  "shopify_product_id": "gid://shopify/Product/123456",
  "title": "Italian Luxury Eyelashes - Natural Black 8mm",
  "supplier_origin": {
    "supplier": "AliExpress Vendor #XYZ",
    "supplier_cost_usd": 8.50,
    "gross_margin_percent": 75.7
  },
  "social_signals": {
    "trending_on_tiktok": true,
    "trending_on_instagram": false,
    "estimated_viral_score": 8.2
  },
  "search_tags": ["eyelashes", "italian", "luxury", "natural", "dramatic"],
  "collection_ids": ["sculpted-lashes"],
  "created_at": "2026-07-09T00:00:00Z"
}
Document Version: 1.0
Status: Ready for Track D (Product Import) implementation
