# Astryx Migration Audit — 2026-08-03

The product owner discovered the Astryx (`@astryxdesign/core`) migration was
incomplete despite believing it was finished after a full day of migration
work plus a further day of troubleshooting. This doc is the ground-truth
record of what's actually converted, what's judged not to need conversion
(with reasoning), and what's still genuinely outstanding — so this doesn't
get lost again.

## Part 1 — `web/components/` (51 files) — DONE, merged to main

17 of 51 `.tsx` files under `web/components/` had zero `@astryxdesign/core`
import. Audited and resolved via PRs #194–#197, all merged to `main`
2026-08-03.

### Converted (real hand-rolled chrome, matching Astryx component existed)

| File | What changed | PR |
|---|---|---|
| `dashboard/RightPanelAccordion.tsx` | Hand-rolled toggle pill → `Switch`; 6 hand-rolled `<button>` icon buttons → `IconButton` | #194 |
| `templates/console/UsageTab.tsx` | Hand-rolled `div` percentage bar → `ProgressBar` | #195 |
| `organisms/GlobalKnowledgeMap.tsx` | Hand-rolled loading/error/empty `<div>` states → `EmptyState` | #196 |
| `templates/console/VideoPlayerCard.tsx` | Retry/YouTube-link buttons → `Button`; fallback link → `Button(href)`; spinner → `Spinner(label)` | #196 |
| `TimestampLink.tsx` | Hand-rolled `<a role="button">` → `Link` | #196 |
| `UserMenu.tsx` | Sign Out `<button>` → `Button` | #197 |
| `containers/dashboard/SettingsPanel.tsx` | Breadcrumb button, density toggle, filter input, sidebar nav → `Button`/`ButtonGroup`/`TextInput` | #197 |

### Judged NOT needing conversion (reasoning given, not skipped silently)

| File | Why |
|---|---|
| `containers/dashboard/DashboardMainContent.tsx` | Pure memoized layout/composition, no chrome |
| `containers/dashboard/DashboardStats.tsx` | Pure layout wrapper, no chrome |
| `dashboard/DimensionAccordion.tsx` | Thin empty/loading/error wrapper, no chrome of its own |
| `dashboard/VisualizationPanel.tsx` | Layout wrapper around a canvas component, no chrome |
| `templates/console/WordCloud.tsx` | 100% canvas-drawn, zero DOM chrome outside the `<canvas>` element |
| `templates/console/VideoPlayerCard.tsx`'s play facade | Full-bleed background-image overlay, doesn't fit `Button`'s label/icon model |
| `templates/console/DashboardLayout.tsx` | Structural grid shell; mobile-drawer backdrop is plain click-to-close, not a component-shaped control |
| `organisms/Navigation.tsx`, `Footer.tsx` | Pure `next/link` navigation, no button/toggle/dialog chrome — matches precedent set by already-converted `MobileMenu.tsx`, which keeps plain `next/link` for nav and only converts real buttons |
| `organisms/MobileDrawerContainer.tsx` | Backdrop/drawer layout plumbing only |
| `containers/dashboard/DashboardHeader.tsx` | Pure prop-forwarding wrapper, no chrome of its own |

### One genuine bespoke-design exception (documented, not converted)

**`templates/console/DimensionAccordion.tsx`** — the dimension trigger is a
hand-rolled `<button>`, but it's a bespoke composite (index badge, icon tile,
`StatusBadge`, animated chevron, `GlowBorder`/`CornerFrame`) core to this
project's frozen console visual design. Astryx's `Collapsible`/`Button`
primitives would force their own StyleX font/color/chevron — using them
would be a redesign, not a like-for-like swap. Left as-is deliberately.
Matches existing precedent: `StatusBadge` already wraps Astryx `Tooltip`
only, keeping its own bespoke visuals rather than becoming a full Astryx
component.

### Verification (all 4 PRs, independently re-run before each merge, not just trusted)

`tsc --noEmit` 0 errors, `vitest run` full suite passing (956/956 non-skipped
on final merged main), `qa-intel` 0 critical/high findings on each diff.

## Part 2 — `web/app/` (34 page files) — NOT STARTED

Not covered by the agents above (their scope was `components/` only). Full
audit run 2026-08-03, after Part 1 shipped:

**30 of 34 `.tsx` files under `web/app/` have zero `@astryxdesign/core`
import**, including:

- **The actual landing/root route**: `app/page.tsx` (note: a *separate* file,
  `app/landing-page.tsx`, does use Astryx — need to check whether `page.tsx`
  renders `landing-page.tsx` or has independent content; not yet
  investigated).
- All auth pages: `app/auth/signin/{page,form}.tsx`, `app/auth/error/{page,form}.tsx`
- All admin pages: `app/admin/dashboards/{page,AdminDashboardsClient}.tsx`, `app/admin/logs/page.tsx`, `app/admin/settings/{page,AdminSettingsClient}.tsx`, `app/admin/users/UsersAdminClient.tsx`
- `app/billing/page.tsx`, `app/pricing/page.tsx`
- `app/settings/page.tsx` (note: `app/settings/logs/LogsViewerClient.tsx` DOES use Astryx, but the parent `app/settings/page.tsx` and `app/settings/logs/page.tsx` don't)
- `app/atlas/{page,AtlasClient}.tsx`
- `app/status/{page,status-dashboard-client}.tsx`
- `app/search/page.tsx`
- `app/dashboard/page.tsx` (the main app shell route itself)
- Legal/static pages: `app/privacy-policy/page.tsx`, `app/refund-policy/page.tsx`, `app/terms-and-conditions/page.tsx`, `app/legal/sub-processors/page.tsx`
- `app/global-error.tsx`, `app/not-found.tsx`, `app/test-error/page.tsx`, `app/sentry-example-page/page.tsx`

**Already using Astryx**: `app/landing-page.tsx`, `app/providers.tsx`,
`app/settings/logs/LogsViewerClient.tsx`, `app/share/[token]/MarkdownRenderer.tsx`,
`app/analyses/saved/page.tsx`.

### Per-file verdicts (2026-08-03, second pass)

All 30 files opened and judged individually against Part 1's precedent
(real hand-rolled interactive chrome → convert; pure layout/shell/static
content → no change needed). 10 of 30 have real chrome; 20 are legitimate
no-action, same class as Part 1's "no change needed" verdicts.

**P0 — user-facing, high-traffic, brand-consistency risk (4 files)**

| File | Chrome found |
|---|---|
| `app/auth/signin/form.tsx` | hand-rolled logo card, error banner, OAuth CTA `<button>` w/ loading state — first-touch signup screen |
| `app/auth/error/form.tsx` | hand-rolled error card + "Try again" link styled as button |
| `app/billing/page.tsx` | hand-rolled header/nav (`btn-primary`/`btn-secondary` Link chrome), breadcrumb, error-state card |
| `app/pricing/page.tsx` | hand-rolled header/nav, same `btn-primary`/`btn-secondary` pattern as billing — pre-signup marketing page |

**P1 — real chrome, internal or lower-traffic (6 files)**

| File | Chrome found |
|---|---|
| `app/admin/dashboards/AdminDashboardsClient.tsx` | hand-rolled StatusBadge, MetricCard, loading state, collapsible `<details>` FAQ blocks |
| `app/admin/settings/AdminSettingsClient.tsx` | hand-rolled sidebar nav buttons, textarea editors, Save buttons, saved/error states |
| `app/admin/users/UsersAdminClient.tsx` | hand-rolled search input, sort `<select>`, expandable table rows, loading/empty states |
| `app/atlas/AtlasClient.tsx` | hand-rolled loading skeleton, URL input + Analyze button w/ loading label |
| `app/status/status-dashboard-client.tsx` | hand-rolled status pill/badge, hover tooltip, 90-day uptime bar grid (public but pure display, not conversion funnel) |
| `app/search/page.tsx` | hand-rolled back button, search input w/ clear, loading spinner, empty/no-results states, skeleton loaders |

**P2 / no action — pure shells, static content, error boundaries, test pages (20 files)**

`app/page.tsx` (5-line pass-through to already-Astryx `landing-page.tsx`),
`app/auth/signin/page.tsx` + `app/auth/error/page.tsx` (server guard/Suspense
shells, real chrome is in the sibling `form.tsx`), `app/admin/dashboards/page.tsx`
+ `app/admin/settings/page.tsx` (server-only role gates, no UI),
`app/admin/logs/page.tsx` (1-line re-export of `settings/logs/page`),
`app/settings/page.tsx` + `app/settings/logs/page.tsx` (server guards
rendering Part-1-converted `SettingsPanel`), `app/atlas/page.tsx` +
`app/status/page.tsx` (server guard/fetch shells), `app/dashboard/page.tsx`
(server guard aliasing Part-1-converted `DashboardContainer`),
`app/privacy-policy/page.tsx`, `app/refund-policy/page.tsx`,
`app/terms-and-conditions/page.tsx`, `app/legal/sub-processors/page.tsx`
(static markdown via `LegalPage` wrapper, no interactive chrome),
`app/global-error.tsx` (Sentry capture + `NextError` fallback),
`app/test-error/page.tsx` (dev-only, throws intentionally).

Borderline/negligible, noted but not worth a pass: `app/not-found.tsx`
(one hand-rolled "Back to Home" link styled as a button) and
`app/sentry-example-page/page.tsx` (one throwaway test-error button).

**Follow-up open question**: `app/settings/logs/LogsViewerClient.tsx` (561
lines, already uses Astryx per the earlier grep) is not directly rendered
by `app/settings/logs/page.tsx` — that page renders `SettingsPanel`
instead. Not yet determined whether `LogsViewerClient` is wired in via
`SettingsPanel` or is dead code.

**Status: 10 files (4 P0 + 6 P1) identified as real conversion work,
not yet assigned or started. 20 files confirmed no-action.**
