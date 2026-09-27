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
| `--dh-teal-400` | `#18B29E` | Checkmark | Checkmark icon, progress fill |
| `--dh-teal-50` | `#E7F7F4` | derived | Teal badge background |
| `--dh-blue-50` | `#E8F3FD` | derived | Info badge background, icon tiles in the launcher |

Brand gradient (logo mark, splash, and empty-state art only):
`linear-gradient(160deg, #0BA1F1 0%, #0462B6 55%, #034491 100%)`.

### Neutrals (white-based UI)

| Token | Hex | Use |
| --- | --- | --- |
| `--dh-white` | `#FFFFFF` | Page background, cards, header |
| `--dh-gray-25` | `#F8FAFC` | Section wash, table header, launcher column header |
| `--dh-gray-100` | `#EEF2F6` | Dividers, input backgrounds |
| `--dh-gray-200` | `#E2E8F0` | Card and input borders |
| `--dh-gray-500` | `#64748B` | Secondary text, captions, keyboard hints |
| `--dh-gray-700` | `#334155` | Body text |
| `--dh-gray-900` | `#0F172A` | Strong body text (when navy is too much) |

### Status

Status must never be conveyed by color alone. Always pair it with an icon and a label.

| Status | Token | Hex | Label examples |
| --- | --- | --- | --- |
| Compliant / on track | `--dh-status-ok` | `#0EAC97` (teal) | Compliant, Clear, Current |
| Due soon | `--dh-status-warn` | `#B7791F` on `#FEF6E7` | Expires in 30 days |
| Non-compliant / critical | `--dh-status-critical` | `#C2410C`, `#B91C1C` on `#FDECEC` | Expired, Excluded, Condition |
| Informational | `--dh-status-info` | `#0462B6` on `#E8F3FD` | Planned, In review |
| Neutral / not started | `--dh-status-neutral` | `#64748B` on `#F1F5F9` | Not started, N/A |
| Preview banner | `--dh-preview` | `#8A5A00` on `#FFF4DB` | PREVIEW · Synthetic data only |

Contrast: every text/background pair must meet WCAG 2.1 AA (4.5:1 for body
text, 3:1 for large text and UI glyphs). `#0EAC97` on white fails for small
text, so teal text on white uses `--dh-teal-700: #0B7E6F`. Teal fills with
white text use bold text of 14px or larger.

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
- Left: the full-color logo, 32px tall, linking to Home (Command Center overview).
- Search trigger: a pill input, gray-25 fill, with placeholder "Go to a module or
  page", a magnifier icon, and a `Ctrl K` / `⌘ K` keycap. Clicking it opens the
  launcher.
- Right cluster: the tenant logo(s), then a label pair with eyebrow `HEALTH
  CENTER` over the organization name, then the user chip (initials avatar in
  navy-900, name, role, chevron) that opens the user menu (Profile, Language
  EN/ES, Switch health center, Sign out).

### 4.2 Module bar (navy-900)
- Far left: the **module switcher button**, which shows the white logo mark and a
  chevron and opens the launcher with the Module column focused.
- A vertical divider in `rgb(255 255 255 / 0.15)`.
- Then the current module's pages as tabs: a Lucide icon plus the label, white at
  80% opacity. The active tab is full white on navy-700 with a 3px teal-400
  underline.
- When the tabs overflow, the extra ones go into a "More ▾" menu. The bar never scrolls horizontally.

### 4.3 Module launcher / command palette (modal)
This follows the DenialDesk pattern.
- 960px wide, 14px radius, anchored 80px from the top.
- Top row: a large search input ("Go to a module or page…"), a close ×, and a
  2px sky-500 underline on focus.
- Column headers MODULE | PAGES in a gray-25 band, 12px uppercase.
- Each module row has:
  - Left (40%): a 40px icon tile (blue-50 fill, navy icon), the module name
    (16px/600), a `Current` badge (teal-50 bg, teal-700 text) when it is the
    active module, and a two-line description in gray-500.
  - Right (60%): the module's pages, each shown as a Lucide icon plus a name, one per line.
- Footer: `N modules · M pages` on the left and `Tab move  Enter open  Esc close` on the right.
- Typing filters modules and pages together, fuzzy-matched, with the matches highlighted.
- Keyboard: `Ctrl/⌘ K` opens it, `Esc` closes it, the arrow keys and `Tab` move
  between items, and `Enter` opens the selection. Focus is trapped inside while
  it is open and returns to the trigger when it closes.
- The data comes from the module registry (`docs/product/module-map.md` → `packages/ui/module-registry.ts`).
  Pages the user's role cannot open are left out.

### 4.4 Home / module overview page
- Eyebrow line, then the display serif greeting, then a one-sentence description.
- Actions on the right: a secondary **Wiki** button (outline, navy) and one primary CTA (navy-900 fill).
- "How Deemed Health works": numbered step cards (`01`–`05`) in mono gray. Each
  card has a title, a short description, a link with an arrow, and an optional
  `Planned` badge.
- KPI tiles for readiness. Each tile shows a value, a label, a status badge, and
  a "View …" link. Tiles never show a number without its denominator (e.g. `117 of 124 providers ready`).

## 5. Components (in `packages/ui`)

Button (primary navy, secondary outline, ghost, danger) · IconTile · Badge
(status variants) · Card · StepCard · KpiTile · DataTable (sticky header,
column filters, CSV export, row actions) · Drawer (record detail) · Tabs ·
Form controls with inline validation · DatePicker (UTC-safe) · FileDrop (evidence
upload) · Timeline (audit/history) · EmptyState · Toast · ConfirmDialog
(for approvals, requires typed reason) · CitationChip (shows `CM Ch.5` and opens
the requirement drawer) · AssistantPanel (right-side panel, see AI agent).

## 6. Iconography & imagery
- Use Lucide icons at a 1.75px stroke. Use 20px icons in navigation and 16px icons inline.
- Every module has exactly one icon, which the module map assigns.
- There are no stock photos. Illustrations use the brand gradient and simple geometric shapes.

## 7. Motion
- 150ms ease-out for hover and focus, and 200ms for the launcher opening (a scale
  from 0.98 plus a fade). Respect `prefers-reduced-motion`.

## 8. Tailwind mapping (sketch)

```ts
colors: {
  navy:  { 900: '#043262', 700: '#0A4A85' },
  blue:  { 50: '#E8F3FD', 600: '#0462B6', 700: '#034491' },
  sky:   { 500: '#0BA1F1' },
  teal:  { 50: '#E7F7F4', 400: '#18B29E', 500: '#0EAC97', 700: '#0B7E6F' },
}
```
