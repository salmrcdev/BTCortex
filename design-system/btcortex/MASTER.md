# BTCortex design system — master file

> **Logic:** when building a specific page, first check `design-system/btcortex/pages/<page-name>.md`. If it exists, its rules **override** this file. Otherwise follow the rules below exactly.

**Project:** BTCortex, a native Windows desktop application (Tauri 2 + WebView2).
**Generated with:** ui-ux-pro-max (`--design-system -p "BTCortex" --variance 3 --motion 3 --density 8`) on 2026-10-21, then adapted for a desktop operations tool, as recorded under *Adaptations*.
**Base recommendation:** Minimalism & Swiss Style + Dark Mode (the "Developer Tool / IDE" product profile), real-time monitoring dashboard, dense but scannable, subtle motion.

Implementation: tokens live in `apps/desktop/src/styles/globals.css` (OKLCH variables under `:root` and `.dark`, mapped to Tailwind v4 with `@theme inline`, as shadcn/ui CLI 4 expects). Components must use the semantic tokens and never hard-coded palette colours.

---

## Principles

1. **Real data only.** Never render decorative numbers or charts without a backend source. Every live value shows its source and update time; stale values are visibly marked as stale.
2. **The active network is always obvious.** Mainnet and test networks are visually distinct at all times (see *Network identity*).
3. **Colour never carries meaning alone.** Every status uses an icon plus a text label as well as colour.
4. **Keyboard first.** Every action works without a pointer, and every interactive control shows a visible focus indicator.
5. **Progressive disclosure.** Beginners see recommended actions first; advanced controls are one level deeper, never removed.
6. **Calm density.** The layout is dense like a professional console, but it keeps a clear hierarchy and generous line height.

---

## Colour

Text contrast is at least 4.5:1 (WCAG 2.2 AA). Control boundaries and focus indicators are at least 3:1. The ratios below were calculated for these exact values.

### Dark theme (default)

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--background` | `#0F172A` (slate-900) | Window background | — |
| `--foreground` | `#F8FAFC` (slate-50) | Primary text | 17.1:1 |
| `--card` | `#1B2336` | Cards, panels | — |
| `--muted` | `#272F42` | Subtle fills, table stripes | — |
| `--muted-foreground` | `#94A3B8` (slate-400) | Secondary text | 7.0:1 on background, 6.1:1 on card |
| `--border` | `#334155` (slate-700) | Decorative dividers | decorative |
| `--input` | `#64748B` (slate-500) | Input and control boundaries | 3.8:1 |
| `--primary` | `#F7931A` (Bitcoin orange) | Primary actions, brand | 7.8:1 |
| `--primary-foreground` | `#0F172A` | Text on primary | 7.8:1 |
| `--ring` | `#F7931A` | Focus ring | 7.8:1 |
| `--destructive` | `#DC2626` (red-600) | Destructive buttons, with white text | 4.8:1 |
| `--danger-text` | `#F87171` (red-400) | Error text and icons | 6.5:1 |
| `--success` | `#22C55E` (green-500) | Healthy and running | 7.8:1 |
| `--warning` | `#FBBF24` (amber-400) | Degraded, attention needed | 10.7:1 |
| `--info` | `#38BDF8` (sky-400) | Informational | 8.3:1 |

### Light theme

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--background` | `#F8FAFC` (slate-50) | Window background | — |
| `--foreground` | `#0F172A` (slate-900) | Primary text | 17.1:1 |
| `--card` | `#FFFFFF` | Cards, panels | — |
| `--muted` | `#F1F5F9` (slate-100) | Subtle fills | — |
| `--muted-foreground` | `#475569` (slate-600) | Secondary text | 7.2:1 |
| `--border` | `#E2E8F0` (slate-200) | Decorative dividers | decorative |
| `--input` | `#64748B` (slate-500) | Control boundaries | 4.8:1 |
| `--primary` | `#C2410C` (orange-700) | Primary actions | 5.2:1 with white text |
| `--primary-foreground` | `#FFFFFF` | Text on primary | 5.2:1 |
| `--ring` | `#C2410C` | Focus ring | 5.0:1 on background |
| `--destructive` | `#DC2626` | Destructive buttons, with white text | 4.8:1 |
| `--danger-text` | `#B91C1C` (red-700) | Error text | 6.5:1 |
| `--success` | `#15803D` (green-700) | Healthy | 5.0:1 |
| `--warning` | `#B45309` (amber-700) | Attention | 5.0:1 |
| `--info` | `#0369A1` (sky-700) | Informational | 5.9:1 |

The brand mark keeps Bitcoin orange `#F7931A` in both themes.

### Status vocabulary

| Status | Colour token | Icon (Lucide) | Label examples |
|---|---|---|---|
| Healthy, running | `--success` | `CircleCheck` | Running, Synchronised, Connected |
| Working | `--info` | `LoaderCircle` (spinning unless reduced motion) | Starting, Synchronising, Installing |
| Attention | `--warning` | `TriangleAlert` | Degraded, Stalled, Update available |
| Failed | `--danger-text` | `CircleX` | Stopped unexpectedly, Unreachable |
| Inactive | `--muted-foreground` | `CircleDashed` | Stopped, Not installed |
| Unknown | `--muted-foreground` | `CircleHelp` | Unknown, Not yet checked |

### Network identity

| Network | Dark | Light | Treatment |
|---|---|---|---|
| Mainnet | `#F7931A` | `#C2410C` | Badge "Mainnet"; real funds |
| Testnet4 / Testnet3 | `#2DD4BF` (teal-400) | `#0F766E` (teal-700) | Badge plus a 3 px coloured stripe along the top of the window |
| Signet | `#A78BFA` (violet-400) | `#6D28D9` (violet-700) | Badge plus stripe |
| Regtest | `#A5B4FC` (indigo-300) | `#4338CA` (indigo-700) | Badge plus stripe |

Test environments always show the stripe and the network name in the status bar. Operations are bound to a specific node profile and network, and confirmation dialogues repeat the network name.

---

## Typography

Fonts are **bundled with the application** through `@fontsource` packages. No font is ever loaded from a CDN.

| Role | Font | Size / weight | Notes |
|---|---|---|---|
| Page title | Fira Code | 20 px / 600 | Short titles only |
| Section title | Fira Sans | 16 px / 600 | |
| Body and controls | Fira Sans | 14 px / 400–500, line height 1.5 | Desktop density baseline |
| Secondary metadata | Fira Sans | 12 px / 400 | Timestamps and captions only; never body text |
| Technical values | Fira Code | 13–14 px / 400–500 | Hashes, txids, addresses, ports, file paths |
| KPI values (stat tiles) | Fira Sans | 24 px / 600, proportional figures, compact (12.9K) | Dataviz skill stat-tile contract: label in sentence case without a colon, value, optional delta |
| Numbers in table columns | Fira Sans | 13–14 px, `tabular-nums` | Tabular figures only where digits must align vertically |

**Meters and progress tracks** (dataviz skill): the fill carries severity — `--info` normally, `--warning` from 80 %, `--danger` from 95 % for capacity meters; the unfilled track is a lighter step of the same hue (the fill colour at about 20 % opacity), so the state reads across the whole bar. A progress track that has stalled turns `--warning` and says so in text.

Long identifiers (hashes, txids) are truncated in the middle (`0000…3f2a`), show the full value on hover and focus, and always have a copy action.

## Spacing, radius, elevation

- Spacing scale (density 8/10): 2, 4, 8, 12, 16, 24, 32 px (Tailwind `0.5`, `1`, `2`, `3`, `4`, `6`, `8`).
- Card padding 16 px; table row height 36 px; control height 32 px (36 px for primary actions); minimum target 24 × 24 px with 8 px spacing (WCAG 2.2 target size).
- Radius: 6 px for controls, 8 px for cards and dialogues.
- Elevation is flat: borders separate surfaces. Shadows only for popovers, menus and dialogues.

## Layout (application shell)

- **Sidebar:** 240 px, collapsible to 56 px icon rail; auto-collapses below 1280 px window width; grouped sections; current item marked by background *and* an accent bar.
- **Status bar** (top, 44 px): node selector, network badge, synchronisation state, alerts, command palette trigger (Ctrl+K).
- **Content:** breadcrumbs, page title with primary action, then content. Resizable inspector panels on detail pages.
- Minimum window size 1024 × 680. No horizontal scrolling of the page; wide tables scroll inside their own container with a sticky header.
- A *Skip to main content* link is the first focusable element.

## Components

shadcn/ui (Radix primitives) styled by the tokens above. Rules:

- **Buttons:** primary (filled `--primary`), secondary (outline with `--input` border), ghost (toolbar), destructive (filled `--destructive`, white text). Loading state keeps the width and shows a spinner plus text. No transforms on hover.
- **Cards:** `--card` surface, 1 px `--border`, no hover lift. Clickable cards show a focus ring and a chevron.
- **Tables:** shadcn `Table` for tabular data (never div grids); sortable headers announce sort state; sticky header; zebra striping with `--muted` only for dense tables.
- **Forms:** visible labels (never placeholder-only), helper text, errors beside the field and announced, explicit units (sat/vB, MiB).
- **Dialogues:** only for confirmation or focused tasks. Destructive confirmations name the affected resource and network and preview the consequences.
- **Empty states:** explain what the area does, why it is empty and the next recommended action.
- **Charts:** follow the dataviz skill. Every chart shows its data source and time range, has a text alternative or summary, and never invents data.

## Motion

- CSS transitions only: 150 ms ease-out for colour, opacity and border changes; 150–200 ms for dialogues and popovers (fade and slight scale).
- Spinners and progress indicators are the only continuous motion.
- `prefers-reduced-motion: reduce` disables non-essential animation; progress is then shown by text and static bars.

## Accessibility checklist (pre-delivery)

- [ ] No emojis as icons (Lucide SVG icons only); icon-only buttons have accessible names and tooltips.
- [ ] Visible focus indicator on every interactive control, including inside dialogues and menus.
- [ ] Status is never conveyed by colour alone.
- [ ] Text contrast ≥ 4.5:1; control boundaries and focus rings ≥ 3:1 in both themes.
- [ ] Tab order follows the visual order; no keyboard traps; Escape closes overlays.
- [ ] Live regions announce asynchronous results (installation finished, node stopped).
- [ ] `prefers-reduced-motion` respected.
- [ ] Layout works from 1024 × 680 up to large high-DPI displays.
- [ ] All application-owned text is British English.

---

## Adaptations from the generated recommendation

| Generated | Adopted | Reason |
|---|---|---|
| Google Fonts import | Bundled `@fontsource` fonts | Desktop app: works offline, no third-party requests (privacy), strict CSP |
| "Real-Time / Operations Landing" page pattern (hero, CTA, trial) | Application shell (sidebar, status bar, command palette) | BTCortex is an installed tool, not a marketing site |
| GSAP scroll reveal | CSS transitions only | Dashboards must not animate content into view; avoids a dependency |
| Hover lift on cards and buttons | No transforms | Layout stability in dense data views |
| Green accent as the call-to-action colour | Bitcoin orange for actions; green reserved for *healthy* status | Status colours must not double as brand colours |
| Fira Code for all headings | Fira Code for page titles and data; Fira Sans for section titles | Readability of longer section titles |
| Light modal and input colours inside the dark palette | Semantic tokens per theme | Consistency and contrast in both themes |
| Breakpoints 375–1440 px | Window sizes from 1024 × 680 | Desktop-only target; minimum window size enforced |
