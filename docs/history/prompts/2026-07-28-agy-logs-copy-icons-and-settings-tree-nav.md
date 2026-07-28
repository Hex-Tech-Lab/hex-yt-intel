# Task Batch: Logs Copy-Icon Parity + Settings Tree Navigation

Dispatched to AGY 2026-07-28, follow-up to `d5602b37`/`a8f46d79`.

## Task 1 — Logs page copy buttons: icon-only, same morph pattern as everywhere else

Current state in `web/app/settings/logs/LogsViewerClient.tsx`: the page header has a
"Copy All Tabs" text button, and the content area has a separate "Copy {label} Logs"
text button per tab — both are plain text buttons with a static toast on click, not the
icon-morph pattern the rest of the app already uses.

**Exact reference pattern** (`web/components/templates/console/ChatDock.tsx:434-436`,
also used per-message at `:546-548`):

```tsx
icon={<Icon icon={copiedAllHeader ? 'solar:check-read-linear' : 'solar:copy-linear'} size={14} />}
className={copiedAllHeader ? '!border-[var(--accent)] !text-[var(--accent)] !bg-[var(--accent-a10)]' : ''}
```

i.e. an icon button that swaps `solar:copy-linear` → `solar:check-read-linear` plus an
accent-colored border/bg/text on click, auto-reverting after 2s (`ChatDock.tsx`'s
`copiedAllHeader`/`copiedMessageId` state pattern — reuse the same timeout convention).

1. Convert the page-header "Copy All Tabs" button to an icon-only button using this
   exact morph pattern.
2. Convert each tab's "Copy {label} Logs" button to its own icon-only copy button,
   same morph pattern, scoped to that tab's own copied-state (don't share one boolean
   across all tabs — each tab's icon should morph independently, mirroring how
   `copiedMessageId` scopes per-message rather than one shared flag for all messages).
3. Do not remove the underlying copy functionality (all-tabs vs single-tab), only the
   visual treatment changes — text button labels replaced by icon + tooltip.
4. Proof required: screenshot of a tab's copy icon mid-morph (checkmark + accent state)
   alongside another tab's copy icon in its default (un-copied) state, showing they're
   independent.

## Task 2 — Settings needs to be an actual expanding tree, not a list of full-page links

User's instruction verbatim: "I said clearly submenus. So the menu is a tree that
expands with submenus. When you click the submenu, you see its page in the central
panel. I gave you screenshots from OpenRouter as reference. As it stands there's no way
to return home."

Current (wrong) architecture: `SettingsPanel.tsx`'s `SETTINGS_ENTRIES` renders a flat
list of `ListItem`s, each with an `href` that does a **full route navigation** away from
the dashboard shell (`/settings/logs`, `/billing`) — clicking one leaves the dashboard's
"settings" tab entirely and loads a completely separate page with its own layout, no
persistent settings nav visible, and critically **no way back to the settings list
short of browser back / re-navigating the dashboard tab**.

What's actually needed, modeled on the OpenRouter reference screenshot (left column:
"ACCOUNT" section header, then Profile / Activity / Logs / Credits / Management Keys /
Privacy / Preferences as a persistent vertical list; clicking one swaps the **right-hand
content pane** in place, the left nav never disappears):

1. Restructure Settings into a **persistent two-pane layout** scoped to the dashboard's
   "settings" tab: a left-hand tree/list of submenu entries that stays visible and
   highlights the active entry (`SettingsPanel.tsx` already has the right visual
   language for the list itself — the bug is that clicking navigates away instead of
   swapping content).
2. Clicking a submenu entry (Logs, Activity & Usage, and any future entries) must swap
   the **content pane only** — via client-side state (selected submenu key) or a nested
   route with a shared layout (`web/app/settings/layout.tsx` if one doesn't exist yet —
   check first) — not a full top-level navigation that drops the left nav.
3. `LogsViewerClient.tsx` and the billing/usage view become the content pane's rendered
   child when their submenu is selected, not standalone pages reached by leaving the
   settings shell.
4. Add a persistent "back to Settings home" affordance — either the left nav is always
   visible (preferred, matches the OR reference, makes this moot) or, if a nested-route
   approach is used instead, a breadcrumb/back link at the top of the content pane.
5. Check whether `/settings/logs` and `/billing` have other inbound links/bookmarks
   elsewhere in the app before changing their routing — don't break existing deep links,
   redirect or alias them into the new structure if needed.
6. Proof required: a driven-browser capture (not just code) showing (a) the settings
   tree with an entry selected and its content in the right pane, (b) the left tree
   still visible/clickable at that point, (c) clicking a different entry swaps content
   without a full page reload, (d) a way back to whatever "home" means for this view
   works from at least two clicks deep if there end up being any nested submenus.

## Non-negotiable process requirements (same as prior batches)

1. Every "done" claim needs an attached, checkable artifact — screenshot or driven
   capture for anything visual, not a description of what the code should do.
2. Task 2 is an architecture change — trace it end-to-end (nav click → state/route
   change → content pane render → back navigation) before declaring it done, not just
   the entry point.
3. If something referenced here doesn't exist as described (e.g. no `settings/layout.tsx`
   file), say so and describe what you found instead before proceeding.
