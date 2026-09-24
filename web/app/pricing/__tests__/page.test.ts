import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Copy-contract test: qa-intel's SecurityFixWithoutTestRule flags page.tsx
// as authorization-relevant (it calls supabase.auth.getUser()), and this
// PR's real risk is refund-copy drift between the pricing page and
// docs/legal/refund-policy.md. The refund is first-purchase-only and
// usage-gated (founder pricing master model §6r) -- assert the live FAQ
// copy states exactly that, and that the old "any purchase" phrasing is
// gone. Rendering the full server component would require mocking the
// Supabase auth client plus four organism components; the copy itself is
// the contract under test here.
const pageSource = readFileSync(join(__dirname, '../page.tsx'), 'utf8');

describe('pricing page refund FAQ copy', () => {
  it('states the 7-day refund is first-purchase-only and usage-gated', () => {
    expect(pageSource).toContain(
      'the 7-day refund applies to your first purchase, if no analysis has been run on it'
    );
  });

  it('does not claim refunds for any purchase beyond the first', () => {
    // Old pre-PR326 phrasing implied every purchase was refundable.
    expect(pageSource).not.toContain("within 7 days of purchase, if you haven't used any analysis credits on that purchase");
  });
});
