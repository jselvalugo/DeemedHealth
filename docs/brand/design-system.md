# Deemed Health Design System

Owner: `design-system-engineer`. The layout follows the Loogo Labs product shell
(the same one DenialDesk uses). The colors come from the Deemed Health logo.
**The canvas is white.** Brand color is for structure and emphasis: the module
bar, primary actions, focus, status. It is never used as a page background.

## 1. Color

These values were sampled from `assets/brand/deemed-health-logo.png`.

### Brand

| Token | Hex | Source in logo | Use |
| --- | --- | --- | --- |
| `--dh-navy-900` | `#043262` | "Deemed" wordmark | Module bar, headings, primary button, text on light |
| `--dh-navy-700` | `#0A4A85` | derived | Module bar hover/active tab background |
| `--dh-blue-700` | `#034491` | "D" mark, bottom | Links (pressed), chart series 1 dark |
| `--dh-blue-600` | `#0462B6` | "D" mark, body | Links, info status, selected row accent |
| `--dh-sky-500` | `#0BA1F1` | "D" mark, top | Focus ring, highlights, gradient start |
| `--dh-teal-500` | `#0EAC97` | "Health" wordmark | Success/compliant, "Current" badges, secondary accent |
| `--dh-teal-400` | `#18B29E` | Checkmark | Checkmark icon, progress fill, active tab underline |
| `--dh-teal-700` | `#0B7E6F` | derived | Teal text on white; teal status glyph on `teal-50` |
| `--dh-teal-800` | `#0A6E61` | derived | Teal text on `teal-50` (badge labels such as `Current`) |
| `--dh-teal-50` | `#E7F7F4` | derived | Teal badge background |
| `--dh-blue-50` | `#E8F3FD` | derived | Info badge background, icon tiles in the launcher |

Brand gradient (logo mark, splash, and empty-state art only):
`linear-gradient(160deg, #0BA1F1 0%, #0462B6 55%, #034491 100%)`.

### Neutrals (white-based UI)

| Token | Hex | Use |
| --- | --- | --- |
| `--dh-white` | `#FFFFFF` | Page background, cards, header |
| `--dh-gray-25` | `#F8FAFC` | Section wash, table header, launcher column header |
| `--dh-gray-50` | `#F1F5F9` | Neutral status badge background |
| `--dh-gray-100` | `#EEF2F6` | Dividers, disabled input backgrounds, skeletons |
| `--dh-gray-200` | `#E2E8F0` | Card borders (decorative; 1.2:1) |
| `--dh-gray-500` | `#64748B` | Secondary text, captions, keyboard hints, **form input borders** (3:1 boundary, WCAG 1.4.11) |
| `--dh-gray-700` | `#334155` | Body text |
| `--dh-gray-900` | `#0F172A` | Strong body text (when navy is too much) |

### Status

Status must never be conveyed by color alone. Always pair it with an icon and a label.

Each status has three tokens: `--dh-status-<s>-icon` (glyph, at least 3:1 on its
background), `--dh-status-<s>-text` (label, at least 4.5:1), and `--dh-status-<s>-bg`.

| Status | Icon | Text on background | Lucide glyph | Label examples |
| --- | --- | --- | --- | --- |
| `ok`: Compliant / on track | `#0B7E6F` (teal-700) | `#0A6E61` (teal-800) on `#E7F7F4` | circle-check | Compliant, Clear, Current |
| `warn`: Due soon | `#B7791F` | `#8A5A00` on `#FEF6E7` | clock | Expires in 30 days |
| `critical`: Non-compliant | `#C2410C` | `#B91C1C` on `#FDECEC` | octagon-alert | Expired, Excluded, Condition |
| `info`: Informational | `#0462B6` | `#0462B6` on `#E8F3FD` | info | Planned, In review |
| `neutral`: Not started | `#64748B` | `#334155` on `#F1F5F9` | circle-minus | Not started, N/A, No access |
| Preview banner | `#8A5A00` | `#8A5A00` on `#FFF4DB` | triangle-alert | PREVIEW · Synthetic data only |

Contrast: every text/background pair must meet WCAG 2.1 AA (4.5:1 for body
text, 3:1 for large text and UI glyphs). `packages/ui/src/tokens.test.ts` checks
the pairs above. Measured corrections made in S1: `#0EAC97` on white fails for
small text, so teal text on white uses `--dh-teal-700: #0B7E6F`; `teal-700` on
`teal-50` is 4.496:1 (just under AA), so badge labels use `teal-800`; `#B7791F`
on `#FEF6E7` is 3.4:1, so it is used only for the warn glyph; `#64748B` on
`#F1F5F9` is 4.3:1, so neutral labels use gray-700. Teal fills with white text
use bold text of 14px or larger.

### Focus

Every interactive element uses the `focus-ring` utility: a 2px sky-500 outline
with a 2px offset, and the offset band filled with navy-900. Sky-500 alone is
2.8:1 on white, below the 3:1 that WCAG 1.4.11 asks of a focus indicator, so the
navy band (12:1 on white) carries the contrast on light surfaces; on the navy
module bar the sky ring itself is 4.5:1. Full-height items inside clipped
containers (module bar tabs) use `focus-ring-inset` (the outline drawn 4px
inside). In forced-colors mode the outline remains.

## 2. Typography

- UI: **Inter** (400/500/600/700), with a system-ui fallback.
- Display (welcome headings only, like DenialDesk's "Welcome, David"): **Source
  Serif 4** 600. Use it at most once per page.
- Mono (IDs, NPIs, keyboard hints like `Ctrl K`): **JetBrains Mono** 500.
- Scale (px): 12 caption · 14 body-sm · 16 body · 18 lead · 20 h4 · 24 h3 · 30 h2 · 36 display.
- Eyebrows (e.g. `DEEMED HEALTH · XYZ COMMUNITY HEALTH · SEP 27`): 12px, 600, tracking 0.08em, uppercase, gray-500.

## 3. Spacing, radius, elevation

- 4px grid. Card padding 24px. Page gutter 32px desktop, 16px mobile.
- Radius: 6px inputs/buttons, 10px cards, 14px modals, 999px badges.
- Shadows: cards get a 1px `--dh-gray-200` border and no shadow. Modals and the
  launcher get `0 24px 48px -12px rgb(4 50 98 / 0.25)`.
- Behind a modal, dim the page with `rgb(4 50 98 / 0.35)` and a 2px backdrop blur.

## 4. App shell

The shell layout matches DenialDesk's: a white header, a navy module bar, and a
white canvas.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ PREVIEW · Synthetic data only. Do not enter real patient information.  (amber)│  non-prod only
├───────────────────────────────────────────────────────────────────────────────┤
│ [DH logo] Deemed Health   [🔍 Go to a module or page…  Ctrl K]                │  header (white, 64px)
│                          [tenant logo]  HEALTH CENTER / XYZ Community Health  │
│                                                   (DS) David Selva ▾ Admin    │
├───────────────────────────────────────────────────────────────────────────────┤
│ [D▾] │ ⊞ Overview │ ☑ Readiness │ 📁 Evidence │ ⚑ Findings │ …                │  module bar (navy-900, 56px)
├───────────────────────────────────────────────────────────────────────────────┤
│  EYEBROW · CONTEXT                                                            │
│  Welcome, David                                  [Wiki]  [Primary CTA]        │  canvas (white)
│  One-sentence description of what this module does.                           │
│                                                                               │
│  ┌ How Deemed Health works ────────────────────────────────────────────────┐  │
│  │ 01 …        02 …        03 …        04 …        05 … [Planned]          │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Header (white)
- Left: the full-color logo, 32px tall, linking to Home (Command Center overview,
  or the user's first permitted page when their role has no Command Center).
- Search trigger: a pill input, gray-25 fill, with placeholder "Go to a module or
  page", a magnifier icon, and a `Ctrl K` / `⌘ K` keycap. Clicking it opens the
  launcher.
- Right cluster: the tenant logo(s), then a label pair with eyebrow `HEALTH
  CENTER` over the organization name, then the user chip (initials avatar in
  navy-900, name, role, chevron) that opens the user menu (Profile, Language
  EN/ES, Switch health center, Sign out). Without a tenant logo, a tile with the
  tenant's initials is shown. Below 1024px the eyebrow and name collapse to the
  tile, and below 768px the search trigger becomes a 40px icon button.

### 4.2 Module bar (navy-900)
- Far left: the **module switcher button**, which shows the white logo mark and a
  chevron and opens the launcher with the Module column focused.
- A vertical divider in `rgb(255 255 255 / 0.15)`.
- Then the current module's pages as tabs: a Lucide icon plus the label, white at
  80% opacity. The active tab is full white on navy-700 with a 3px teal-400
  underline and `aria-current="page"`.
- When the tabs overflow, the extra ones go into a "More ▾" menu. The bar never scrolls
  horizontally. Widths are measured on a hidden copy of the tabs and recomputed on resize.
  When the active page is in "More", the More trigger shows the active style.

### 4.3 Module launcher / command palette (modal)
This follows the DenialDesk pattern.
- 960px wide (at most the viewport minus 64px), 14px radius, anchored 80px from
  the top. Below 640px it is full-screen and the two columns stack.
- Top row: a large search input ("Go to a module or page…"), a close ×, and a
  2px sky-500 underline on focus.
- Column headers MODULE | PAGES in a gray-25 band, 12px uppercase.
- Each module row has:
  - Left (40%): a 40px icon tile (blue-50 fill, navy icon), the module name
    (16px/600), a `Current` badge (teal-50 bg, teal-800 text) when it is the
    active module, and a two-line description in gray-500.
  - Right (60%): the module's pages, each shown as a Lucide icon plus a name, one per line.
- Footer: `N modules · M pages` on the left and `Tab move  Enter open  Esc close` on the right.
- Typing filters modules and pages together, fuzzy-matched, with the matches highlighted.
- Keyboard: `Ctrl/⌘ K` opens it, `Esc` closes it, the arrow keys and `Tab` /
  `Shift+Tab` move between items (module, then its pages, then the next module;
  wrapping), `Page Down` / `Page Up` jump between modules, and `Enter` opens the
  selection. Focus stays in the search field (combobox with
  `aria-activedescendant` over a listbox of options grouped per module), so Tab
  does not reach the close button; `Esc` and the pointer close it. Focus is
  trapped inside while it is open. On close it returns to the trigger (search
  button, module switcher, or whatever had focus for `Ctrl K`); after opening a
  page it moves to `<main>`.
- The module switcher opens it with the current module's row selected.
- The footer count is a polite live region, so screen readers hear
  `N modules · M pages` as the filter changes.
- Built on Radix Dialog (focus trap, `aria-modal`, Esc, focus return). Matching is
  case- and accent-insensitive (`modulo` finds `Módulo`) and runs on the names in
  the current language.
- The data comes from the module registry (`docs/product/module-map.md` → `packages/ui/module-registry.ts`).
  Pages the user's role cannot open are left out, and modules left with no pages
  disappear. `planned` modules never appear. A `<module>:read_own` page (My tasks,
  My profile, board meeting packets) is also shown to holders of `<module>:read`.

### 4.4 Home / module overview page
- Eyebrow line, then the display serif greeting, then a one-sentence description.
- Actions on the right: a secondary **Wiki** button (outline, navy) and one primary CTA (navy-900 fill).
- "How Deemed Health works": numbered step cards (`01`–`05`) in mono gray. Each
  card has a title, a short description, a link with an arrow, and an optional
  `Planned` badge.
- KPI tiles for readiness. Each tile shows a value, a label, a status badge, and
  a "View …" link. Tiles never show a number without its denominator (e.g. `117 of 124 providers ready`).

### 4.5 Page states
Every page designs four states besides the normal one:
- **Loading:** a skeleton of the page layout (`loading.tsx`) with a visually
  hidden `role="status"` "Loading…"; the pulse stops under reduced motion.
- **Empty:** `EmptyState` (gradient disc with a Lucide glyph, title, one
  sentence, optional action).
- **Error:** heading (focused on mount), a critical `Alert` with a plain-language
  next step, and **Try again**. Error details are never shown.
- **No permission:** `EmptyState` with a lock, the page name, who to ask, and a
  link to the user's home page, rendered at the same URL (and at `/no-permission`).

### 4.6 Sign-in (outside the shell)
White canvas, the full-color logo (64px tall) centred above a single card, the
EN/ES switch at the top right, and the PREVIEW banner above everything. Steps:
email → single sign-on or password → passkey or authenticator code, plus
`/sign-in/recovery`. Errors are inline on the field (`aria-invalid`, message
linked by `aria-describedby`, focus moved to the field) or a form-level `Alert`
(wrong credentials, locked, not implemented). Messages never reveal whether an
account exists (ADR-0006 rule 11).

## 5. Components (in `packages/ui`)

Built in Phase 1 slice S1 (`packages/ui/src`): Button (primary navy, secondary
outline, ghost, danger; `loading` keeps focus and uses `aria-disabled`) · Badge
(status variants) · Card · Input (label, hint, inline error) · Alert · IconTile ·
Keycap · Eyebrow · Highlight · LogoMark · PreviewBanner · PageHeader · StepCard /
HowItWorks · EmptyState · Header · ModuleBar · ModuleLauncher · AppShell.

Built in Phase 1 slice S4b (ADR-0014 §3; DataTable, Drawer, Timeline, and form
controls are delivered as parts of the records components):

- Controls (`components/controls.tsx`): **Select**, **Textarea**, **Checkbox**
  (20px box in a 40px hit area, `indeterminate` for "select all"), **Modal** (Radix
  Dialog; full screen below 640px; stacks above another open dialog, so step-up can
  open over the reveal dialog), **Drawer** (right side, 560px, full screen below
  640px), **Tabs** (WAI-ARIA tabs: arrow keys, Home/End, roving tabindex, 3px teal-400
  underline on the selected tab), **CitationChip** (mono chip with the requirement id;
  opening the requirement drawer waits for the catalog record type).
- **RecordTable** (`records/RecordTable.tsx`): native `<table>` with a visually hidden
  caption (name and "Showing 1–25 of N"), `scope` headers, `aria-sort` on sortable
  columns, the first column as the row header linking to the record, sticky header in
  a keyboard-focusable scroll region; column chooser (Modal); filter bar from
  `filterable` fields (enum and boolean selects, date ranges in the health center's
  zone, record pickers for references); search over `searchable` fields; archived
  filter for roles that may restore; saved views (private or shared to roles; a view
  shared by someone else is applied by the API without showing its values); row
  selection and a bulk bar with only the allowed actions and a per-row result summary;
  cursor pager; polite live region with the result count; loading, empty,
  filtered-empty, error (Try again), and no-permission states. "New …" opens
  RecordForm in the Drawer.
- **RecordPage** (`records/RecordPage.tsx`): back link, eyebrow, title, lifecycle
  status Badge, owner and site (linked titles), requirement CitationChips; actions from
  the API's `allowedActions` only (Edit, Archive, Restore); archived banner; detail
  sections as Cards with `<dl>`; tabs: Details, then Evidence, Tasks, Comments, and
  Approvals as "Coming soon", then History (Timeline: action, time in the health
  center's zone, actor, changed field names, reason code; never values).
- Masked fields show `•••` and a **Reveal** button when the API lists the field as
  revealable. The reveal dialog asks for a reason code (and a note for "Other"), says
  the reveal is recorded in the audit log, and the client runs step-up (re-auth
  dialog) before the value is shown. The value lives only in component state; Hide
  drops it.
- **RecordForm** (`records/RecordForm.tsx`): fields from the registry (`editable`),
  widgets by kind, "(required)" markers, validation with the same Zod schemas and
  record rules the API uses, inline errors plus a focused error summary (EN/ES),
  `If-Match` on save, and a 409 panel ("Someone else changed this record", the
  changed field names, "Load their version" or "…and keep my edits").
- Archive and restore dialogs: archive needs a reason (kept on the row; the audit log
  keeps its length and a digest); restore takes an optional reason.

Still to build: KpiTile · DatePicker (UTC-safe; native date inputs for now) · FileDrop
(evidence upload) · Toast · ConfirmDialog (for approvals, requires typed reason) ·
AssistantPanel (right-side panel, see AI agent) · export and import buttons on
RecordTable (the API serves them; the UI follows with S6).

## 6. Iconography & imagery
- Use Lucide icons at a 1.75px stroke. Use 20px icons in navigation and 16px icons inline.
- Every module has exactly one icon, which the module map assigns. Page icons are
  assigned in the registry. Names are the kebab-case Lucide names; `icons.tsx`
  maps them to components (Lucide 1.x renamed `file-signature` to
  `file-pen-line`; the map keeps the module-map name).
- `LogoMark` is an SVG approximation of the "D" mark (D in `currentColor`, cross
  cut out, teal-400 check) for the white-on-navy module switcher. The full-color
  logo is `apps/web/public/brand/deemed-health-logo.png`, cropped from
  `assets/brand/deemed-health-logo.png`. Traced SVG exports (full color,
  white-on-navy, mark-only) are still to do.
- There are no stock photos. Illustrations use the brand gradient and simple geometric shapes.

## 7. Motion
- 150ms ease-out for hover and focus, and 200ms for the launcher opening (a scale
  from 0.98 plus a fade). Respect `prefers-reduced-motion`.

## 8. Tailwind mapping

Tailwind v4, CSS-first. `packages/ui/src/tokens.css` is the only file with color
literals. It defines the `--dh-*` variables, clears Tailwind's default palette
(`--color-*: initial`), and maps each token in `@theme inline`, so the only color
utilities are brand ones: `bg-navy-900`, `text-teal-700`, `bg-status-warn-bg`,
`text-status-critical-text`, `bg-preview-bg`, `bg-overlay`, `bg-bar-divider`, …
It also defines `rounded-control|card|modal`, `shadow-modal`, `font-sans|serif|mono`,
`animate-launcher-in|fade-in`, and the `focus-ring`, `focus-ring-inset`, and
`bg-brand-gradient` utilities. Apps import it after Tailwind and add
`@source` for `packages/ui/src`:

```css
@import 'tailwindcss';
@import '@deemed/ui/tokens.css';
@source '../../../packages/ui/src';
```

A test fails when a hex value appears in `packages/ui/src` or `apps/web` outside
`tokens.css`. Fonts are self-hosted from `@fontsource` (CSP `font-src 'self'`).
