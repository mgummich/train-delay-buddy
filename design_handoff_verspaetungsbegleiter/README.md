# Handoff: VerspätungsBegleiter — Realtime-Rerouting & Reisebegleiter (Mobile)

## Overview
VerspätungsBegleiter is a mobile-first PWA/web app for rail power users. The user is sitting on a (often delayed) train, knows their train number, and wants to reach their destination **as early as possible** — even with more transfers — as long as they arrive **earlier than with their original connection**.

Two core flows:
1. **Find faster connections** — enter train number + destination, get alternatives that arrive earlier.
2. **Travel companion (Perlschnur / bead-string timeline)** — follow a chosen alternative with live status, delays, transfer buffers, and warnings for critical transfers. An optional **map view** gives spatial orientation.

## About the Design Files
The files in this bundle are **design references created in HTML/React (via in-browser Babel)** — prototypes that show the intended look and behavior. They are **not production code to ship directly**. The task is to **recreate these designs in the target codebase's existing environment** (React, Vue, SwiftUI, native Android, etc.), using its established component library, theming, and patterns. If no environment exists yet, pick the most appropriate framework for the project and implement there.

The HTML prototype is structured as plain functional React components with inline styles + a shared CSS token layer — easy to read as a spec, but you should map it onto your own design-system primitives (Button, Card, Switch, Segmented, ListRow, Badge, Sheet, etc.).

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, radii, shadows, copy (German), and interactions are all specified. Recreate the UI pixel-accurately using your codebase's primitives. All numeric design values are listed in **Design Tokens** below; exact per-component values are in **Screens / Views**.

---

## Design Tokens

### Color — Light (default)
| Token | Hex | Use |
|---|---|---|
| `bg-app` | `#F6F4F2` | App background (warm off-white) |
| `bg-card` | `#FFFFFF` | Cards, inputs |
| `bg-subtle` | `#F0ECE8` | Secondary surfaces, info strips, tab track |
| `text-primary` | `#1F2329` | Primary text |
| `text-muted` | `#6B7280` | Secondary text |
| `text-faint` | `#9CA3AF` | Tertiary / hints / strikethrough plan times |
| `accent` | `#0F766E` | Primary actions, active state, time-gain highlight |
| `accent-hover` | `#0D615B` | Primary hover |
| `accent-active` | `#0B4B47` | Primary pressed |
| `accent-soft` | `#E2EFEC` | Accent-tinted fills (badges, soft transfer block, icon chips) |
| `accent-ink` | `#FFFFFF` | Text/icon on accent (light) |
| `warn` | `#DC6B33` | Warnings, delay (+min), critical transfer |
| `warn-soft` | `#FBEADF` | Critical transfer block background |
| `warn-strong` | `#B91C1C` | Hard errors |
| `border-subtle` | `#E5E7EB` | Hairlines, dividers, card borders |
| `border-strong` | `#D1D5DB` | Input borders, future timeline line, dashed map route |

### Color — Dark (derived)
| Token | Hex |
|---|---|
| `bg-app` | `#111827` |
| `bg-card` | `#1F2933` |
| `bg-subtle` | `#19212E` |
| `text-primary` | `#E5E7EB` |
| `text-muted` | `#9CA3AF` |
| `text-faint` | `#6B7280` |
| `accent` | `#34D399` |
| `accent-hover` | `#2BBE85` |
| `accent-active` | `#25A874` |
| `accent-soft` | `#15302B` |
| `accent-ink` | `#06241C` (dark text on bright-green buttons) |
| `warn` | `#F97316` |
| `warn-soft` | `#3A2415` |
| `warn-strong` | `#F87171` |
| `border-subtle` | `#2B3543` |
| `border-strong` | `#3A4658` |

Rule: **max one accent color** in the UI; warning colors only for real problems (critical transfers, errors). Neutral surfaces dominate so numbers and type stand out.

### Spacing scale
`4 · 8 · 12 · 16 · 24 · 32` px. Screen outer padding 16–20px. Vertical gap between logical blocks 18–24px. Card inner padding 16px.

### Radius
- Input: `10px`
- Card: `14px`
- Screen frame: `22px`
- Button: `12px` (default) **or** `999px` pill — this is a togglable design choice (see Tweaks). Detail/list/info cards: 12–16px.
- Badge / chip / switch: `999px`

### Shadows
- Card (light): `0 1px 2px rgba(31,35,41,.04), 0 4px 16px rgba(31,35,41,.06)`
- Lifted/selected card (light): `0 2px 4px rgba(31,35,41,.06), 0 12px 28px rgba(31,35,41,.10)`
- Card (dark): `0 1px 2px rgba(0,0,0,.30), 0 4px 16px rgba(0,0,0,.32)`
- FAB: `0 4px 14px {accent @ 40% alpha}`
- Bottom sheet: `0 -8px 40px rgba(0,0,0,.18–.22)`

### Typography
Two sans families (chosen to avoid generic Inter/Roboto/Open Sans look). Default pairing — **Display: Space Grotesk**, **Body: IBM Plex Sans**. Alternatives offered as a tweak: *Bricolage Grotesque + Hanken Grotesk*, *Schibsted Grotesk + Public Sans*. Loaded from Google Fonts.

| Role | Family | Size | Weight | Notes |
|---|---|---|---|---|
| H1 (start title) | Display | 26px | 700 | line-height 1.18, letter-spacing -0.01em, max ~15ch |
| H2 (screen title) | Display | 20–21px | 600 | line-height 1.2 |
| H3 (card / stop name) | Display | 17px | 600 | line-height 1.25 |
| Body | Body | 16px | 400 | line-height ~1.5 |
| Label / field label | Body | 13px | 600 | muted color |
| Badge / chip / meta | Body | 12–14px | 600 | |
| Group header (settings) | Body | 12.5px | 600 | uppercase, letter-spacing .04em, faint |

Big numbers (ETA, time gain like **+18 Min**, clock times) use **tabular-nums** (`font-variant-numeric: tabular-nums`) and `white-space: nowrap`. Max 3–4 type sizes per screen.

### Motion
Tokens: fast `150ms`, medium `200–220ms`, slow `300ms`. Easing `cubic-bezier(0.16, 1, 0.3, 1)`.
- Screen transition (prototype navigator): fade + 16px horizontal slide, 220ms. Forward slides from right, back from left.
- Bottom sheet: slide-up from 100% over 260ms; scrim fades in 200ms.
- Button / card tap: `transform: scale(0.97)`.
- Current timeline node + map "you are here" marker: single soft pulse loop, 2.4s.
- "Live" dots: opacity blink 1.6s.
- **`prefers-reduced-motion: reduce` disables all transitions/animations** (hard state swaps only).

---

## Screens / Views

> Screenshots are in `./screenshots/`. The prototype frame width is **392px** (design target 360–430px).

### 1 · Startscreen — `1-start.png`
- **Purpose:** entry point; user types train number + destination and launches the search.
- **Layout:** single column, left-aligned. Status bar → app bar (brand left, settings gear right) → title block → form card → primary CTA + secondary link. Body padding `20px 16px 28px`, block gap 24px.
- **Components:**
  - **App bar:** brand = 26×26 accent rounded-square mark (radius 8) + wordmark "VerspätungsBegleiter" (Display 15/600). Settings icon button 38×38, radius 10, muted; hover bg `bg-subtle`.
  - **Eyebrow badge:** accent-soft pill, bolt icon + "Live-Umleitung", 12.5/600.
  - **H1:** "Schneller ans Ziel — ab deinem jetzigen Zug."
  - **Subtitle:** muted 15/1.5 — "Wir überwachen deine Verbindung und finden Wege, die früher ankommen — auch mit mehr Umstiegen."
  - **Info line (faint 12.5):** info-circle icon + "Fokus: schnellere Ankunft — kein Ticketverkauf, keine offizielle DB-App." (expectation-setting / differentiation).
  - **Form card** (white, radius 14, border, padding 16, gap 16):
    - Field "Zugnummer" → input (48px, radius 10, border 1.5px `border-strong`) with train icon + value `ICE 1045`. Shown in **focus** state: border `accent`, ring `0 0 0 3px accent@18%`.
    - Field "Zielbahnhof" → input with pin icon + value `Göttingen`.
    - Divider.
    - Toggle row: "Ich sitze in diesem Zug" (15/600) + subtext "Wir nehmen deine aktuelle Position als Startpunkt." + switch (on by default). Switch 46×28, knob 22, on = accent.
  - **Primary button:** full-width, 50px, accent bg, accent-ink text, "Beste Verbindung jetzt finden".
  - **Secondary link button:** accent text "Stattdessen Start- und Zielbahnhof eingeben".

### 2 · Alternativen — `2-alternativen.png`
- **Purpose:** list of connections that arrive earlier than the monitored train.
- **Layout:** status bar → sub app bar (back, centered eyebrow "Alternativen", settings) → body (gap 18): reference strip → H2 → filter row → card list → footer note.
- **Components:**
  - **Reference strip:** `bg-subtle` card, no shadow, clock icon + muted "Dein aktueller Zug bringt dich voraussichtlich um **19:42** ans Ziel."
  - **H2:** "Bessere Verbindungen gefunden".
  - **Filter row** (wrapping flex, gap 8): "Filter" chip (filter icon + count badge showing number of active filters; count badge = accent pill, 11.5/700) + one removable chip per active filter: `Nur DB ×`, `max. 3 Umstiege ×`, `Puffer: Normal ×`. Removable chips use active style (accent-soft bg, accent border+text) and an × that removes the filter on click. Chips: 36px tall, radius 999, border 1.5px.
  - **Alternative card** (white, radius 14, padding 16, gap 12; the recommended one gets accent border + lifted shadow):
    - Top row: big accent tabular number (Display 26/700) e.g. **+18 Min** + muted "früher am Ziel" + trailing arrow icon (faint).
    - Sub-line (muted 14.5, tabular): clock icon + "Ankunft **19:24**" · "2 Umstiege" · "min. Puffer 3 Min".
    - Badge row: e.g. "Schnellste" (accent), "Riskant" (warn), "Am stabilsten" (accent), "Nur DB" (neutral). Badges: pill, 24px, 12.5/600, optional leading icon + 6px dot variant.
    - Demo data: Card 1 `+18 Min / 19:24 / 2 Umstiege / Puffer 3 / Schnellste + Riskant`; Card 2 `+12 Min / 19:30 / 1 Umstieg / Puffer 11 / Am stabilsten + Nur DB`; Card 3 `+6 Min / 19:36 / 3 Umstiege / Puffer 7 / Nur DB`.
  - **Footer note (faint 12.5, centered):** "Verbindungen werden alle 30 Sekunden neu berechnet."
  - Tapping a card → Reisebegleiter.

### 3 · Reisebegleiter — Timeline — `3-reisebegleiter-timeline.png`
- **Purpose:** primary travel-companion view for the chosen alternative.
- **Layout:** status bar → sub app bar ("Reisebegleiter") → **sticky header** (KPI card + next-step card + tab bar) → content (bead-string timeline) → floating action button.
- **Sticky header** (`position: sticky; top: 0`, gradient fade `linear-gradient(bg-app 78%, transparent)`):
  - **KPI card:** big accent **+18 Min** (Display 30/700) + "schneller"; muted "als dein ursprünglicher Zug · Ankunft **19:24**"; divider; warn clock + "Gegenüber Fahrplan: **+10 Min** Verspätung".
  - **Next-step card** (accent border): 38×38 accent-soft icon tile (down-arrow "Now" icon) + "In **27 Min** in Kassel Hbf aussteigen" (14.5/600) + muted "Anschluss **RE 4321** · Gleis 5 · Puffer 9 Min".
  - **Tab bar:** segmented "Timeline | Karte" on `bg-subtle` track (radius 12, padding 4); active tab = white card + shadow + primary text, inactive = muted. Timeline icon = 3-dot list glyph; Karte icon = pin.
- **Bead string (Perlschnur):** left rail (44px) with continuous vertical line; right column with stop content. Node states:
  - **past** = 13px filled accent dot;
  - **current** = 22px accent dot with inner accent-ink dot, pulsing ring, larger;
  - **future** = 14px hollow dot (2.5px border-strong);
  - **dest** = 19px hollow dot with accent ring + inner faint dot.
  - Rail segments: traveled = accent (3px), upcoming = border-strong (2.5px), **active leg = animated accent dashes** with a moving train marker (24px accent circle + train icon).
  - Per stop: H3 name, **TimeLine** row (real time bold tabular, delay `+N` in warn or "pünktl." in accent, struck-through plan time in faint, platform badge "Gl N" right-aligned neutral).
  - **Leg** between stops: line + direction (e.g. "ICE 1045 · Richtung Hamburg-Altona") + duration; active leg shows accent "Jetzt unterwegs · +10 Min" badge with blinking dot.
  - **Transfer block** under a stop: accent-soft (ok) or warn-soft (critical). Shows check/alert icon + "Umstieg · Puffer N Min" + "Weiter mit **{train}** ab Gleis N." Critical adds a warn link "Umstieg kritisch — Alternative ansehen →" (→ navigates back to Alternativen).
  - Demo journey: Frankfurt (Main) Hbf ab 17:53 (past, Gl 9) → *ICE 1045, current, +10* → Kassel Hbf an 18:57 Gl 7 (current node, transfer Puffer 9 → RE 4321 Gl 5) → *RE 4321 0:06h* → Northeim an 19:12 (+1) Gl 2 (**critical** transfer Puffer 3 → ICE 1573 Gl 1) → *ICE 1573 0:09h* → Göttingen an 19:24 Gl 4 (Ziel).
- **FAB:** bottom-right pill, accent bg, "Jetzt" + up-arrow icon — scrolls to current position. Only in Timeline tab.

### 4 · Reisebegleiter — Karte — `4-reisebegleiter-karte.png`
- **Purpose:** optional spatial orientation; **the timeline stays the source of truth.**
- **Components:** same sticky header + tab bar (Karte active). Below, a schematic map card (height 340, radius 16, `bg-subtle` with faint 36px grid lines):
  - SVG route polyline through Frankfurt → Kassel → Northeim → Göttingen. Traveled portion = solid accent (3px); remaining = dashed `border-strong` (2px, dash 4/3). Use `vectorEffect="non-scaling-stroke"`.
  - Station pins (absolute, % positioned) with small white label pills (12/700 + 10.5 tabular sub): Frankfurt (Main) "ab 17:53", **"Du bist hier" + pulsing accent train marker** "ICE 1045 · +10 Min", Kassel Hbf "Umstieg · 18:57", Northeim "19:12", Göttingen "Ziel · 19:24" (dest pin).
  - Legend row (current position dot / dashed remaining route) + muted note: "Schematische Übersicht zur Orientierung. Die **Timeline** bleibt der genaue Fahrplan mit Zeiten und Puffern."

### 5 · Filter-Sheet — `5-filter-sheet.png`
- **Purpose:** refine the alternatives list. Presented as a **bottom sheet** over the dimmed Alternativen screen (scrim `rgba(15,20,28,.42)`).
- **Sheet:** white, top corners radius 22, grab handle (38×4 rounded bar). Header: "Filter" (H2 20) + "Zurücksetzen" link.
- **Blocks** (gap 22, dividers between):
  - **Nur frühere Ankünfte** — toggle (on by default) + subtext "Zeigt nur Wege, die vor deinem aktuellen Zug ankommen." (core product rule).
  - **Verkehrsmittel** — multi-select chips: `Fernverkehr`, `Regional`, `S-Bahn` (first two active) + "Nur DB-Züge" toggle (on). Selected chip shows check icon + active style.
  - **Maximale Umstiege** — segmented full-width: `0 · 1 · 2 · 3 · egal` (3 selected).
  - **Puffer beim Umstieg** (this is the explicit "robustness" control — uses "Puffer" wording, not abstract "Sicherheitslevel"): segmented `Aggressiv · Normal · Vorsichtig` (Normal default) + a `bg-subtle` help block (shield icon + text) that **updates with the selection**:
    - Aggressiv → "Umstiege mit unter 5 Min Puffer werden zugelassen — maximaler Zeitgewinn, höheres Risiko."
    - Normal → "Mindestens rund 5 Min Puffer — guter Kompromiss aus Tempo und Verlässlichkeit."
    - Vorsichtig → "Mindestens rund 10 Min Puffer — entspannte, sichere Umstiege."
  - **Apply button** (full-width accent): label is dynamic — "{n} Verbindungen anzeigen", or "Keine Treffer — Suche anpassen" when the filters yield 0 (demo: max Umstiege `0` → empty state).

### 6 · Einstellungen — `6-einstellungen.png`
- **Purpose:** app settings, grouped iOS-style.
- **Layout:** status bar → sub app bar ("Einstellungen") → groups (gap 22). Each group = uppercase faint header + a card with full-width rows separated by inset hairlines (`margin-left: 15`). Row = label (15/500) + optional subtext (12.5 muted) + right-side control (value text + chevron, or a switch). Chevron rows are tappable.
- **Groups & rows:**
  - **Reisepräferenzen:** "Standard-Suchmodus" → `Zugnummer` (chevron, sub "Womit die App startet"); "Puffer beim Umstieg" → `Normal` (chevron → screen 7, sub "Wie viel Reserve standardmäßig"); "Maximale Umstiege" → `egal` (chevron); "Nur DB-Züge" (toggle off); "Barrierefreie Umstiege" (toggle off, sub "Aufzug / stufenfreier Wechsel").
  - **Benachrichtigungen:** "Kritische Umstiege" (toggle on, sub "Warnen, wenn der Puffer knapp wird"); "Bessere Verbindung gefunden" (toggle on); "Gleiswechsel & Ausfälle" (toggle on).
  - **Darstellung:** "Dark Mode" (toggle, sub "Folgt sonst dem System"); "Sprache" → `Deutsch` (chevron → screen 8).
  - **Daten & Offline:** "Letzte Reise offline speichern" (toggle on); "Datenschutz" (chevron); "Impressum" (chevron).
  - Footer: faint centered "VerspätungsBegleiter · Version 1.4.0".

### 7 · Detail · Puffer beim Umstieg — `7-detail-puffer.png`
- Pushed from settings. Sub app bar ("Puffer beim Umstieg"), H2 + intro ("Wie viel Reserve du beim Umsteigen mindestens brauchst. Mehr Puffer = sicherer, aber meist etwas langsamer."), then a card of radio rows: **Aggressiv** (`< 5 Min`), **Normal** (`≥ 5 Min`, selected), **Vorsichtig** (`≥ 10 Min`) — each with title + meta neutral badge + description; selected = filled accent radio with check. Footer info card (subtle): "Knappe Umstiege werden trotzdem angezeigt — aber als **Riskant** markiert."

### 8 · Detail · Sprache — `8-detail-sprache.png`
- Pushed from settings. Sub app bar ("Sprache"), H2, search input (placeholder "Sprache suchen", magnifier icon), then a card list of languages: name (15) + native name (faint 13); selected row (Deutsch) bold + accent check. Rows: Deutsch ✓, Englisch (English), Französisch (Français), Italienisch (Italiano), Niederländisch (Nederlands), Polnisch (Polski).

### 9 · Zustand · Keine Verbindung (Empty state) — `9-leer-zustand.png`
- Variant of Alternativen when nothing beats the current train. Reference strip (19:42) → centered block: 64×64 accent-soft rounded tile with shield icon, H2 "Aktuell keine schnellere Verbindung", muted reassurance "Dein jetziger Zug ist gerade die beste Option. Wir suchen weiter und melden uns, sobald etwas Schnelleres auftaucht.", accent "Live-Überwachung aktiv" badge with blinking dot. Action card: "Benachrichtigen, wenn schneller möglich" (toggle on) + ghost button "Filter lockern" (re-opens the filter sheet).

### Dark mode reference — `10-darkmode-beispiel.png`
Structure is identical to light; only token values swap. Note `accent-ink = #06241C` so text on the bright-green accent stays legible.

---

## Interactions & Behavior

### Navigation (prototype navigator)
Stack-based router (`push`/`pop`) with a separate sheet overlay flag:
- Start → "Beste Verbindung jetzt finden" → **Alternativen**.
- Alternativen → tap any alternative card → **Reisebegleiter**.
- Alternativen / Empty → "Filter" chip or "Filter lockern" → **Filter sheet** (overlay).
- Filter sheet → Apply: if max-Umstiege `0` (0 results) → **Empty state**; otherwise → **Alternativen**. Scrim tap closes the sheet.
- Any sub-screen settings gear → **Einstellungen**; settings chevron rows → **detail screens** (Puffer, Sprache).
- Reisebegleiter critical transfer "Alternative ansehen" → back to **Alternativen**.
- Back arrows pop the stack.
- Reisebegleiter "Timeline | Karte" tabs swap the content region (local state, no navigation).

### Transitions
Fade + 16px horizontal slide on route change (220ms, forward from right / back from left). Sheet slides up 260ms with scrim fade 200ms. All gated behind `prefers-reduced-motion`.

### States
- Input focus: accent border + soft ring.
- Toggles/segmented/chips/radios are interactive (local component state in the prototype).
- Filter chips on Alternativen are removable (× removes; "Filter" count badge reflects active count).
- Empty/no-results state is a first-class screen.
- Loading (not built): spec calls for skeleton + shimmer when fetching alternatives and the timeline — implement per your design system.

## State Management
Per screen, the implementation will need:
- **Search:** trainNumber, destination, "onboard" boolean.
- **Filters:** onlyEarlierArrivals (bool), modes (set: Fernverkehr/Regional/S-Bahn), onlyDB (bool), maxTransfers (`0|1|2|3|egal`), buffer level (`Aggressiv|Normal|Vorsichtig`). Derives result count → drives empty state.
- **Alternatives list:** array of {timeGain, eta, transfers, minBuffer, badges, legs[]}.
- **Companion:** chosen route, live deltas (delay vs schedule, time gain vs original), per-stop realtime/plan/platform/buffer, current position, active tab (timeline|map).
- **Navigation stack** + sheet-open flag.
- **Settings/preferences:** default search mode, default buffer level, max transfers, onlyDB, accessibility, notification toggles, dark mode, language, offline-last-trip.
- **Data:** realtime departures/arrivals, delays, platform changes, transfer-buffer computation, periodic re-search (~30s).

## Assets
- **Icons:** simple 24px stroke icons drawn inline as SVG (settings, train, pin, arrow, back, filter, bolt, shield, alert, chevron, clock, check, now, platform, search, close, list). Replace with your icon set (1-px-ish, ~1.75 stroke, rounded caps/joins). See `icons.jsx`.
- **Brand mark:** placeholder accent rounded-square with two dots + a bar (abstract "train window"). Replace with the real product logo.
- **Map:** the map view is a **schematic placeholder** (CSS grid + SVG polyline + positioned pins), not a real map tile layer. For production, integrate a real map (MapLibre/Leaflet/etc.) but keep the same visual language: traveled vs remaining route, station pins, "you are here" marker, and the "timeline is the precise plan" framing.
- **Fonts:** Google Fonts — Space Grotesk, IBM Plex Sans (defaults); plus Bricolage Grotesque, Hanken Grotesk, Schibsted Grotesk, Public Sans, IBM Plex Mono.
- No raster images are used.

## Files
All in this bundle:
- `VerspätungsBegleiter.html` — entry; design tokens (CSS custom properties for light/dark), font loading, and the app bootstrap. Also hosts the **canvas presentation** (all screens side-by-side) and the **live clickable prototype**. The token `<style>` block is the canonical source for colors/spacing/radius/shadows.
- `screens.jsx` — StatusBar, AppBar/SubAppBar, Startscreen (1), Alternativen (2) + FilterRow + AltCard.
- `companion.jsx` — Reisebegleiter (3/4): timeline (Stop/Leg/TimeLine/Transfer/Node/Rail) + MapView/MapPin + Timeline/Karte tabs.
- `extras.jsx` — Filter sheet (5) incl. RobustnessBlock, Einstellungen (6) incl. SetRow/SetGroup, detail screens (7/8), empty state (9), shared Toggle/Segmented/MultiChips.
- `nav.jsx` — navigation context (`useNav`) used by the live prototype; no-ops in the static side-by-side views.
- `proto.jsx` — the stack navigator + transitions + sheet overlay that wires the screens into the clickable prototype.
- `icons.jsx` — inline SVG icon set.
- `design-system.md` — the original product/visual design-system spec.
- `screenshots/` — PNG renders of every screen (light) plus a dark-mode reference.

> `design-canvas.jsx` and `tweaks-panel.jsx` are presentation scaffolding (side-by-side canvas + the in-prototype tweak panel for font/radius/dark). They are **not** part of the product UI and don't need to be reimplemented.
