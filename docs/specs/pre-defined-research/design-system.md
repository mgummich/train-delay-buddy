# Design-System – UI & Motion

Dieses Dokument beschreibt das visuelle und interaktive Designsystem der App. Es ergänzt die Produkt- und UX-Spezifikation.

---

## 1. Design-Ziele

- Funktional: Reiseentscheidungen in Sekunden ermöglichen.
- Ruhig & modern: Minimalistische Flächen, klare Typografie, keine überladenen Effekte.
- Nicht generisch / nicht "AI-Template": Vermeidet typische generische UI-Patterns.
- Accessible & performant: Mobile-optimiert, gute Kontraste, respektiert `prefers-reduced-motion`.

---

## 2. Layout & Spacing

### 2.1 Viewports

- Primär: mobile Devices (Breite 360–430 px).
- Sekundär: Tablet (768–1024 px).

### 2.2 Spacing-Scale

- XS: 4 px
- S: 8 px
- M: 12 px
- L: 16 px
- XL: 24 px
- XXL: 32 px

Regeln:

- Außen-Padding des Screens: L–XL (16–20 px).
- Vertikale Abstände zwischen logischen Blöcken: XL–XXL.
- Card-Inneres: M–L Padding.
- Enge Beziehungen (Label→Input): XS–S.

### 2.3 Grid

- Einspaltig auf Mobil, max. Content-Breite ~640 px auf Tablet.
- Alles linksausrichtet (Headlines, Body), außer ganz kurze Slogans.

---

## 3. Farb-System

### 3.1 Palette (Light Mode)

- Hintergrund:
  - `bg-app`: #F6F4F2 (leicht warm, off-white)
  - `bg-card`: #FFFFFF
  - `bg-subtle`: #F0ECE8

- Text:
  - `text-primary`: #1F2329
  - `text-muted`: #6B7280
  - `text-faint`: #9CA3AF

- Akzent:
  - `accent-primary`: #0F766E
  - `accent-hover`: #0D615B
  - `accent-active`: #0B4B47

- Warnung:
  - `warn`: #DC6B33
  - `warn-strong`: #B91C1C

- Linien / Border:
  - `border-subtle`: #E5E7EB
  - `border-strong`: #D1D5DB

### 3.2 Palette (Dark Mode – abgeleitet)

- `bg-app`: #111827
- `bg-card`: #1F2933
- `bg-subtle`: #111827 (oder leicht heller Ton)
- `text-primary`: #E5E7EB
- `text-muted`: #9CA3AF
- `accent-primary`: #34D399
- `warn`: #F97316

Dark Mode übernimmt Struktur 1:1 aus Light Mode, nur Werte invertiert und angepasst. Kontrast-Pflicht: `#34D399` (accent-primary) auf `#1F2933` (bg-card) ≈ 5.2:1 — ausreichend für Large Text (≥18 px bold), für Badges und Body-Text (<18 px) separat prüfen. Alle Farbpaare vor Deployment mit WCAG AA (4.5:1) verifizieren.

### 3.3 Einsatzregeln

- Maximal eine Akzentfarbe im UI (keine Rainbow-UIs).
- Warnfarben ausschließlich für echte Probleme (kritische Umstiege, Fehlermeldungen).
- Neutrale Flächen dominieren, um Zahl und Typo hervorzuheben.

---

## 4. Typografie

### 4.1 Font-Familien

- Display Sans (Headlines): **Geist** (Vercel, open-source) oder **DM Sans** (Google Fonts) — moderne Grotesk, eigenständig ohne Überladung.
- Body Sans (UI/Text): **Inter** (hoch lesbar, mobile-optimiert). Wenn einheitlich: Geist für beide Rollen möglich.

**MVP-Empfehlung:** Geist als Variable Font (ein HTTP-Request, beide Rollen). CSS-Fallback: `system-ui, -apple-system, sans-serif`.

### 4.2 Hierarchie & Größen (Mobile)

- H1 (Start-Titel): 1.5–1.75 rem (24–28 px @ 16px base), Bold.
- H2 (Screen-Titel): 1.25–1.375 rem (20–22 px @ 16px base), Semibold.
- H3 (Kartentitel, Stop-Name): 1–1.125 rem (16–18 px @ 16px base), Semibold.
- Body: 1 rem (16 px @ 16px base), Regular.
- Label / Badge: 0.75–0.875 rem (12–14 px @ 16px base), Medium.

Basis: `html { font-size: 100%; }` — respects user browser font-size preference. Never override with fixed px on `html`/`body`.

Regeln:

- Max. 3–4 Typo-Größen pro Screen.
- Wichtige Zahlen (ETA, Zeitgewinn) prominent.

---

## 5. Komponenten

### 5.1 Textfelder

- Höhe: 44–48 px.
- Breite: 100% des Content-Bereichs.
- Border-Radius: 8 px.
- Border: 1 px `border-strong`.
- Hintergrund: `bg-card`.

Zustände:

- Fokus: Border 1.5 px in `accent-primary`, leichter Shadow.
- Fehler: Border in `warn`, Fehlermeldung klein darunter.

### 5.2 Toggle

- Switch mit On/Off-Farbgebung.
- Label rechts, Subtext in Muted.

### 5.3 Buttons

Primär:

- Vollbreite, 44–48 px Höhe.
- Border-Radius: 999 px oder 10–12 px.
- Hintergrund: `accent-primary`, Text: Weiß.

Sekundär:

- Transparent, Border `border-strong`, Text `text-primary`.

### 5.4 Karten (Alternativen)

- Hintergrund: `bg-card`, Radius: 12 px, Shadow dezent.
- Padding: 16 px.
- Inhalt: Titel (Zeitgewinn), Subline (ETA, Umstiege, Puffer), Badges.

### 5.5 Badges

- Pill-Form, 4–8 px Padding.
- Hintergründe: neutral, leicht akzentuiert oder warnungsfarben.

### 5.6 Perlschnur

- Vertikale Linie links, Knoten (Stops) in drei Varianten.
- Rechts Textblöcke mit Stop-Name, Zeiten, Delays, Puffer.

---

## 6. Motion & Interaktionen

### 6.1 Motion-Tokens

- `motion-fast`: 150 ms.
- `motion-medium`: 200–220 ms.
- `motion-slow`: 300 ms.

Easing: `cubic-bezier(0.16, 1, 0.3, 1)`.

### 6.2 Core-Motion

- Screen-Transitions: Fade-in + Slide.
- Button/Karten-Tap: Scale 0.97.
- Perlschnur: aktueller Knoten pulst einmal.

`prefers-reduced-motion` wird respektiert: Bei aktivem Reduce-Flag werden Animationen auf minimale, nicht ablenkende Zustandswechsel reduziert.

---

## 7. Accessibility & Robustheit

- Kontrast: ≥ 4,5:1 für Bodytext, ≥ 3:1 für Large Text (≥18 px bold).
- Touch Targets: ≥ 44×44 px auf mobil.
- Fokus-Indikatoren: sichtbar via `:focus-visible` (outline 2px `accent-primary`, offset 2px).
- `prefers-reduced-motion`: Animationen auf Zustandswechsel reduziert.
- Offline: letzte Reise immer angezeigt.

**Focus-Visible (Tastaturnavigation):**
```css
:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
  border-radius: inherit;
}
/* Dark mode: accent shifts to #34D399 — contrast sufficient on #1F2933 bg */
```
Gilt für alle interaktiven Elemente. `:focus` (ohne `:focus-visible`) bleibt unstyled — verhindert blauen Ring bei Maus-/Touch-Klick.

### Live-Regionen (Screen-Reader)

Asynchrone Statusupdates (ETA, Status-Wechsel) brauchen ARIA Live Regions:

```html
<!-- SummaryHeader — status änderungen polite ankündigen -->
<div aria-live="polite" aria-atomic="true">
  {eta} · {status}
</div>

<!-- Kritische Warnungen — sofort ankündigen -->
<div role="alert" aria-live="assertive">
  {status === 'critical' && 'Umstieg kritisch — Alternative verfügbar'}
</div>
```

- `aria-live="polite"`: ETA, Delay-Updates, Puffer-Änderungen
- `role="alert"` / `aria-live="assertive"`: status-Wechsel `ok → critical`, `failed`-State

### Toggle / Switch (ARIA)

Radix UI `Switch`-Primitive verwenden — liefert `role="switch"`, `aria-checked`, Tastatursteuerung (Space-Taste) gratis.

```tsx
import { Switch } from '@radix-ui/react-switch'
// <Switch checked={dbOnly} onCheckedChange={setDbOnly} aria-label="Nur DB-Züge" />
```

### Perlschnur Tastaturnavigation

```html
<ol role="list" aria-label="Reisestationen">
  <li tabindex="0" aria-current="step">  <!-- aktueller Halt -->
  <li tabindex="0">                       <!-- zukünftige Halte -->
  <li tabindex="-1" aria-hidden="true">  <!-- vergangene Halte (skip) -->
</ol>
```

"Zu 'Jetzt' springen"-Button: `aria-label="Zum aktuellen Halt springen"`, Fokus-Management auf aktuellen Halt nach Klick.

### Screen-Reader-Labels

| Element | ARIA |
|---------|------|
| RiskBadge "Riskant" | `aria-label="Umstieg riskant — Puffer unter 5 Minuten"` |
| Zeitgewinn "+18 Min" | `aria-label="18 Minuten früher als ursprünglicher Zug"` |
| ETA-Anzeige | `aria-label="Voraussichtliche Ankunft 19:24 Uhr"` |
| Ladeindikator | `role="status" aria-label="Verbindungen werden geladen"` |

---

## 8. Component Library & CSS-Strategie

### Primitive Library: Radix UI via shadcn/ui

Radix UI-Primitives über shadcn/ui (copy-paste, kein Lock-in):

| Komponente | Radix Primitive | Verwendung |
|------------|----------------|------------|
| Bestätigungsdialog | Dialog | Plausibility-Dialog, Reise-beenden-Bestätigung |
| Filter-Panel | Sheet | Alternativen-Filter (Umstiege, Sicherheitslevel) |
| DB-Toggle | Switch | DB-only Filter, iAmOnThisTrain |
| Fehler-Toast | Toast | API-Fehlermeldungen |
| Umstiegs-Details | Popover | Transfer-Puffer-Details auf Kartenklick |

Alle Primitives: Tastaturnavigation, ARIA-Attribute, Focus-Trap gratis.

### CSS-Strategie: Tailwind + CSS Custom Properties

Design-Token als CSS-Variablen (`src/styles/tokens.css`):
```css
:root {
  --bg-app: #F6F4F2;
  --bg-card: #FFFFFF;
  --accent-primary: #0F766E;
  --warn: #DC6B33;
  /* ... */
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg-app: #111827;
    --bg-card: #1F2933;
    --accent-primary: #34D399;
    --warn: #F97316;
  }
}
```

Tailwind-Konfiguration mappt Token-Namen auf CSS-Variablen:
```typescript
colors: { 'bg-app': 'var(--bg-app)', 'accent': 'var(--accent-primary)' }
```

Klassen-Präfix: Tailwind-Utilities direkt (`bg-bg-card`, `text-accent`). Keine CSS-in-JS, keine SCSS.

### Screen-Transitions: View Transitions API

```typescript
// router.tsx — wraps navigation in View Transition
document.startViewTransition(() => flushSync(() => navigate(path)))
```

```css
/* Fade + Slide für Screen-Wechsel */
::view-transition-old(root) { animation: slide-out 220ms ease-in-out; }
::view-transition-new(root) { animation: slide-in 220ms ease-in-out; }

@media (prefers-reduced-motion: reduce) {
  ::view-transition-old(root),
  ::view-transition-new(root) { animation: none; }
}
```

Browser ohne View Transitions API (`if (!document.startViewTransition)`) → normale Navigation ohne Animation, kein Fehler.

---

## 9. Internationalisierung (i18n)

V1 ships Deutsch-only. Extraktion-Scaffolding in V1 sodass V2 Locales ohne Refactor hinzugefügt werden können.

**Setup:** `react-i18next`, `i18next`, Sprach-JSON in `src/locales/de.json`.

**Pflicht-Regel:** Alle User-Facing Strings via `t()` — niemals Rohstrings in JSX.

```typescript
// src/locales/de.json
{
  "companion": {
    "nextStep": {
      "transfer": "In {{minutes}} Min in {{station}} aussteigen. Anschluss: {{train}} ab Gleis {{platform}}.",
      "disembark": "Ziel erreicht: {{station}}.",
      "ride": "Im Zug bleiben bis {{station}}."
    },
    "status": {
      "critical": "Umstieg kritisch — Alternative ansehen",
      "failed": "Route nicht mehr nutzbar — Neue Verbindung suchen"
    }
  }
}
```

Extraktion-Script (V2): `i18next-scanner` scannt `src/**/*.tsx`, erzeugt fehlende Keys in `de.json`.
