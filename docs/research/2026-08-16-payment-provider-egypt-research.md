# Payment Provider Research — Egypt, Solo Founder, No LLC — 2026-08-16

**Tools used**: Exa + Brave, parallel, per standing multi-engine research directive. SerpAPI/Decodo were not provisioned as callable tools in this session — only Exa, Brave, and generic WebSearch were available. Flagging honestly rather than claiming 4 engines when 2 ran.

## Paddle — CONFIRMED viable

- Egypt is a listed supported country: `developer.paddle.com/concepts/sell/supported-countries-locales/` — `EG | Egypt | USD | Inclusive`.
- Individual/sole-trader account type exists explicitly, distinct from "Public Company"/"Private Company." Selecting "Individual" at signup skips business-registration requirements entirely.
- Verification (`paddle.com/help/start/account-verification/what-is-identity-verification`): for individuals, only the individual's own government ID + address proof is checked (via Sumsub), no business documents requested. Business verification (registration docs, ownership breakdown) is explicitly "not required for individuals or sole traders."
- Source: boathouse.co walkthrough confirms — select "Individual," submit personal ID + bank details, no incorporation needed, payouts go directly to personal bank account.

**Verdict**: Paddle works for you as-is, individual account, Egypt supported, no LLC needed. Original assumption holds — good to proceed with KYC.

## Dodo Payments — CONFIRMED viable, strong candidate #2

- Egypt explicitly listed in both country lists: `docs.dodopayments.com/miscellaneous/accepted-countries-and-territories` (#49 Egypt) and `.../list-of-countries-we-accept-payments-from` (#59 EG Egypt).
- Eligibility is based on **the ID document's issuing country**, not company registration or tax residence — an Egyptian-issued government ID qualifies directly.
- FAQ explicitly: "Yes, we support unregistered businesses... You can onboard as an individual and start receiving international payments without any hassle."
- Flow: Product Information Form → Identity Verification (KYC, ~minutes via Persona) → Bank Verification. No business form at all for individual accounts.
- Payout currencies: USD, GBP, EUR natively (EGP not a native payout currency — receiving bank does the conversion).
- Independent confirmation found on Reddit (`r/EgyptianFreelancers`): named directly as working for Egypt-based sellers alongside Polar.sh.

**Verdict**: real, working alternative #2.

## Polar.sh — surfaced as candidate #3, not yet independently verified

Named in the same Reddit thread as accepting Egypt sellers, described as strong on developer experience. Not yet checked against Paddle/Dodo's level of official-docs confirmation — needs its own pass before treating as equally solid.

## Ruled out

- **LemonSqueezy, Gumroad**: both pay out exclusively via Stripe Connect. Stripe does not support Egypt. Not viable regardless of KYC ease, confirmed prior session.

## Still open

- **PayPal**: not directly researched this pass. Known to operate in Egypt but with historical outbound-transfer friction — needs its own confirmation + real fee comparison before treating as a co-equal option, not just a trust-brand fallback.
- Real fee comparison table (Paddle ~5% per earlier scan, Dodo/Polar not yet pulled) — next research pass.

## Update 2026-08-16 (2nd pass) — fee comparison, ingested from user-supplied source

Source: https://affonso.io/blog/paddle-alternatives-for-saas (listicle, no Egypt/MENA-specific claims — cross-referenced against our own direct confirmations above, not taken standalone).

| Provider | Fee | Individual/no-LLC | Egypt confirmed? |
|---|---|---|---|
| Paddle | ~5% (per earlier scan) | Yes (confirmed above, official docs) | **Yes — confirmed direct** |
| Dodo Payments | 4% + $0.40; +1.5% international; +0.5% subscriptions | Yes (confirmed above, official docs) | **Yes — confirmed direct** |
| Polar | 4% + $0.40 + recurring/international add-ons | Not stated in this source | Reddit-sourced only (r/EgyptianFreelancers), not yet verified against Polar's own docs |
| Creem | 3.9% + $0.40; free SEPA payouts EU | Not stated | EU-focused per this source; no Egypt claim — low priority |
| BagelPay | flat 5% + $0.50 | Not stated | Noted for India/SE Asia focus, not Egypt — low priority |
| Payhip | 5% free tier / 2% ($29/mo) / 0% ($99/mo) | Not stated | Not a true MoR per this source (no tax handling) — mismatched to our need, drop |
| Mollie | not stated | Not stated | EU-focused, not MoR — drop |
| LemonSqueezy, Gumroad | 5-10%+ | N/A | **Ruled out** — Stripe Connect payout dependency, confirmed prior pass |

**Updated verdict**: Paddle (primary) and Dodo Payments (fallback) remain the only two candidates with *direct, official-docs-level* Egypt confirmation. Dodo is also the cheapest of the two on a like-for-like domestic transaction (4% vs Paddle's ~5%), which matters given launch-stage margins. Polar is the only other candidate worth a direct-docs verification pass (not just a Reddit mention) if a 3rd option is ever needed — the rest (Creem/BagelPay/Payhip/Mollie) don't clear the bar (EU/APAC-focused, or not true MoRs) and aren't worth further research time this window.

## Recommendation given the 9-day window

Proceed with Paddle KYC as primary (confirmed viable, matches original plan). Dodo Payments is a real, confirmed fallback if Paddle KYC stalls or rejects — not just a hypothetical. Polar.sh and PayPal fee comparison can happen in parallel, non-blocking.
