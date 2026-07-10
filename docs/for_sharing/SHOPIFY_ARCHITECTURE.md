
Shopify Architecture: Headless Commerce for 100% Design Freedom
Question: "Can we achieve custom luxury design without drifting from Shopify?"
Answer: YES, via Headless Commerce architecture.

THE CORE TENSION
User requires:

Custom luxury brand aesthetic
Shopify product management (inventory, checkout, payments)
Solution: Headless Commerce. Custom frontend + Shopify backend API.

4 INTEGRATION PATTERNS
Pattern 1: Shopify Online Store (NO — Limits Design)
Use Shopify's built-in theme
Limited customization
Design locked to theme framework
Best For: Budget stores, quick launches
NOT chosen for A7la Diva ❌

Pattern 2: Custom Liquid Theme (MAYBE — Partial Freedom)
Custom Liquid code
Full theme customization
Shopify hosts frontend
Best For: Custom brands wanting Liquid-only dev
NOT chosen for A7la Diva ❌ (Need React power)

Pattern 3: Headless Commerce (YES — Full Freedom) ✅
Custom React frontend (Next.js 16.2.6)
Shopify Storefront API (GraphQL, read-only)
User checkout → Shopify's hosted checkout
Webhook: Order created → Sync to Supabase
Architecture:

Custom React Frontend (Next.js)
    ↓ GraphQL queries
Shopify Storefront API
    ↓
Shopify Backend
    ↓
User Checkout (Shopify hosted)
    ↓
Webhook → Supabase (commission_ledger)
Pros:

✅ 100% design freedom (React)
✅ Keep Shopify ecosystem (inventory, checkout, payments)
✅ Enterprise-standard pattern
✅ Scalable (separate layers)
✅ Performance (CDN, edge caching)
Cons:

⚠️ Requires frontend engineering
⚠️ Two systems to manage
⚠️ Checkout experience leaves custom site (UX might feel disconnected)
CHOSEN for A7la Diva ✅

Pattern 4: Custom + Shopify POS (Omnichannel)
Custom web + Shopify Point-of-Sale
Same inventory across channels
Best For: Brands with physical + online presence
NOT needed for MVP ❌

WHY PATTERN 3 (HEADLESS) IS BEST
Luxury Brand Requirement
A7la Diva needs:

Hero video (8–15s animated Parisian elegance)
Animations (parallax, 3D rotations, smooth transitions)
Custom typography (Playfair + Inter combination)
Luxury color palette (deep charcoal + jewel accents)
3D product viewer (eyelashes + nails showcase)
Only possible with React (Framer Motion, Three.js, custom CSS)

Shopify themes can't deliver this (Liquid has no 3D support)

Shopify Ecosystem Benefit
A7la Diva needs:

Product inventory (100 SKUs + variants)
Checkout processing
Order fulfillment
Webhook integration (order → referral tracking)
Shopify is best-in-class for this

Separation of Concerns
Frontend: Custom React aesthetic
Shopify: Product + inventory + checkout
Supabase: Users + referrals + commissions
Cloudflare Workers: Pricing engine + webhook relay
Each system does what it's best at

GRAPHQL EXAMPLES
Query 1: Fetch All Products
query GetAllProducts($first: Int!, $after: String) {
  products(first: $first, after: $after) {
    edges {
      node {
        id
        title
        handle
        priceRange { minVariantPrice { amount } }
        images(first: 10) { edges { node { src altText } } }
        variants(first: 100) {
          edges {
            node {
              id
              title
              selectedOptions { name value }
              priceV2 { amount currencyCode }
              image { src }
            }
          }
        }
        collections(first: 10) {
          edges { node { handle title } }
        }
      }
    }
  }
}
Query 2: Search Products by Collection
query GetCollectionProducts($handle: String!, $first: Int!) {
  collectionByHandle(handle: $handle) {
    id
    title
    products(first: $first) {
      edges {
        node {
          id
          title
          handle
          priceRange { minVariantPrice { amount } }
          images(first: 5) { edges { node { src } } }
        }
      }
    }
  }
}
WEBHOOK FLOW (Order → Supabase Commission)
Setup: Shopify Admin → Configure Webhook
Settings → Apps and Integrations → Webhooks
Create webhook:
Event: Order created
URL: Cloudflare Worker endpoint
API version: Latest
Handler: Cloudflare Worker
export async function handleShopifyWebhook(req: Request) {
  // 1. Verify webhook signature (Shopify HMAC)
  const hmacHeader = req.headers.get('x-shopify-hmac-sha256');
  const body = await req.text();
  
  if (!verifyWebhookSignature(body, hmacHeader, SHOPIFY_WEBHOOK_SECRET)) {
    return new Response('Unauthorized', { status: 401 });
  }
  
  // 2. Parse order data
  const order = JSON.parse(body);
  const shopifyOrderId = order.id;
  const totalPrice = parseFloat(order.total_price);
  
  // 3. Extract referral code from order notes
  const referralCode = order.note_attributes?.find(
    attr => attr.name === 'referral_code'
  )?.value;
  
  // 4. Look up referrer in Supabase
  if (referralCode) {
    const supabase = new SupabaseClient(SUPABASE_URL, SUPABASE_KEY);
    
    const { data: referrer } = await supabase
      .from('b2b_profiles')
      .select('id, tier')
      .eq('referral_code', referralCode)
      .single();
    
    if (referrer) {
      // 5. Calculate commission
      const { data: tier } = await supabase
        .from('pricing_tiers')
        .select('commission_rate')
        .eq('tier_name', referrer.tier)
        .single();
      
      const commissionAmount = totalPrice * (tier.commission_rate / 100);
      
      // 6. Insert into commission_ledger
      await supabase
        .from('commission_ledger')
        .insert({
          referrer_id: referrer.id,
          shopify_order_id: shopifyOrderId,
          commission_amount: commissionAmount,
          tier: referrer.tier,
          status: 'pending'
        });
    }
  }
  
  return new Response(JSON.stringify({ success: true }), { status: 200 });
}
CHECKOUT EXPERIENCE
Current (MVP)
Browse products on a7ladiva.com (custom React)
Click checkout → Redirect to hex-diva-cosmetics.myshopify.com/checkout
Complete payment
Thank-you page
Phase 2 (Improved UX)
Use Shopify Custom Post-Purchase
Thank-you page on your domain
Phase 3 (Full Control)
Shopify Checkout Extensions
Custom checkout UI without leaving Shopify domain
COMPARISON TABLE
Aspect	Pattern 1 (Theme)	Pattern 2 (Liquid)	Pattern 3 (Headless)
Design Freedom	Low	Medium	High ✅
3D Viewer	❌	❌	✅
Animations	Limited	Limited	Full ✅
Luxury Aesthetic	Hard	Possible	Easy ✅
Scalability	Limited	Medium	High ✅
Development Speed	Fast	Medium	Medium
RECOMMENDATION FOR A7LA DIVA
Use Pattern 3 (Headless Commerce) ✅

Gives full design freedom (hero video, animations, luxury aesthetic)
Keeps Shopify ecosystem (inventory, checkout, payments, webhooks)
Proven enterprise pattern (scalable, reliable)
Separates concerns (frontend / backend / Shopify)
Future-proof (can migrate checkout later if needed)
Document Version: 1.0
Status: Architecture confirmed, ready for Track E (Frontend) implementation
