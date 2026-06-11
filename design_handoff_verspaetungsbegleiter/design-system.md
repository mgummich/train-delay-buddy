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

Dark Mode übernimmt Struktur 1:1 aus Light Mode, nur Werte invertiert und angepasst.

### 3.3 Einsatzregeln

- Maximal eine Akzentfarbe im UI (keine Rainbow-UIs).
- Warnfarben ausschließlich für echte Probleme (kritische Umstiege, Fehlermeldungen).
- Neutrale Flächen dominieren, um Zahl und Typo hervorzuheben.

---

## 4. Typografie

### 4.1 Font-Familien

- Display Sans (Headlines): moderne Grotesk mit leicht eigenem Charakter.
- Body Sans (UI/Text): neutrale Sans-Serif mit guter Lesbarkeit.

Nicht ausschließlich Inter/Roboto/Open Sans verwenden.

### 4.2 Hierarchie & Größen (Mobile)

- H1 (Start-Titel): 24–28 px, Bold.
- H2 (Screen-Titel): 20–22 px, Semibold.
- H3 (Kartentitel, Stop-Name): 16–18 px, Semibold.
- Body: 16 px, Regular.
- Label / Badge: 12–14 px, Medium.

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

### 6.3 Playful Layer

- Micro-Konfetti bei wichtigem Event.
- Ambient-Pattern im Hintergrund.
- Skeleton Shimmer.
- Farbflash bei Wechsel `ok` → `critical`.

Alles optional, via Feature-Flag de-aktivierbar.

---

## 7. Accessibility & Robustheit

- Kontrast: ≥ 4,5:1 für Bodytext.
- Touch Targets: ≥ 44×44 px.
- Sichtbare Fokus-Indikatoren.
- `prefers-reduced-motion` respektieren.
- Offline: letzte Reise immer angezeigt.
