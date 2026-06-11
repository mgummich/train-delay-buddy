# Produkt- und UX-Spezifikation

## 1. Produkt-Essenz

**Produkt**

Mobile-first Webapp / PWA für Bahn-Poweruser, die bei Verspätungen:

- schnell eine bessere Verbindung finden (früher ankommen, Umstiege sind erlaubt),
- und sich auf der gewählten Route aktiv begleiten lassen (Status, nächster Schritt, Störungen, Alternativen).

**Zielgruppe**

- Bahn-Nerds, Vielreisende mit BahnCard 100, Flexpreis, Mitarbeitenden-Tickets.
- Menschen, die ihre Zugnummer kennen, eher technikaffin sind und Komfort gegen Zeitgewinn eintauschen.

**Abgrenzung**

- Keine Verbindung zur Deutschen Bahn AG.
- Kein Ticketkauf, keine Ticketanzeige, keine Validitätsprüfung.
- Fokus ausschließlich auf Routing & Reisebegleitung.

### Default-Filter: Nur DB-Zuge

Als Default-Einstellung nutzt die App **nur von DB betriebene Zuge** (DB-Operatoren wie DB Navigator, DB Fernverkehr, DB Regio).

- Der Filter ist im Frontend aktiviert und kann vom Nutzer deaktiviert werden.
- Im Backend wird dieser Filter bei der Journey-Suche angewendet.
- Nicht-DB-Operatoren (z. B. Flixtrain, andere private Betreiber) sind im Default ausgefiltert.

Diese Entscheidung sorgt fur:
- hoheres Vertrauen bei DB-Nutzern,
- konsistente Realtime-Daten durch DB-Quellen,
- simpleres MVP mit klarerem Scope.



**Zielbild**

- Extrem funktional und effizient (wenig Klicks, wenig "Denken").
- Modern, ruhig, bewusst nicht wie eine generische AI- oder Marketing-Landingpage.
- Offline-/schlechte-Netz-tauglich (PWA, progressive enhancement).

---

## 2. Use Cases & Flows

### 2.1 Primärflow: Im Zug → schneller ans Ziel

1. Nutzer sitzt im verspäteten Zug.
2. Öffnet die App (Browser oder installierte PWA).
3. Startscreen: gibt Zugnummer und Zielbahnhof ein, Toggle "Ich befinde mich in diesem Zug" ist standardmäßig AN.
4. App validiert die Zugnummer, plausibilisiert "bin ich in diesem Zug?" (Zeit/GPS).
5. Backend berechnet eine optimale Route ab diesem Zug (POST `/reroute`).
6. Alternativen-Screen zeigt eine Liste mit Verbindungen, die früher ankommen als die Referenz (ursprünglicher Zug oder aktuelle Route).
7. Nutzer wählt eine Route → App wechselt in den Reisebegleiter-Screen mit Perlschnur.
8. Reisebegleiter überwacht die Route (ETA, Verspätungen, Puffer für Umstiege) und weist bei kritischen Situationen auf Alternativen hin.

### 2.2 Sekundärflow: Von/Nach

- Nutzer wählt statt Zugnummer-Modus den klassischen "Von / Nach"-Modus.
- Eingabe von Startbahnhof, Zielbahnhof, Zeitpunkt (Standard: jetzt).
- Routing- und Reisebegleitungslogik sind identisch, Startpunkt ist kein konkreter Zug, sondern eine Journey-Suche.

---

## 3. Screens & UX-Struktur

### 3.1 Startscreen (Zugnummer-Primärflow)

**Zweck**: Kontext definieren ("Ich sitze (bald) in Zug X, will nach Y").

**Elemente**

- App-Bar: App-Name links, Settings-Icon rechts.
- Titel: ein Satz, z. B. "Schneller ans Ziel – ab deinem jetzigen Zug.".
- Form-Card:
  - Textfeld "Zugnummer" mit Auto-Suggest aktueller/laufender Züge.
  - Textfeld "Zielbahnhof" mit Autocomplete (letzte Ziele, Halte des Zuges, globale Suche).
  - Autocomplete Zielbahnhof: 200 ms Debounce, min. 2 Zeichen. Laufende Anfrage wird bei neuem Keystroke abgebrochen (AbortController). Fehlermeldung bei keinen Treffern: "Kein Bahnhof gefunden".
  - Toggle "Ich befinde mich in diesem Zug" (Default AN) mit Subtext "Wir planen ab dem Halt, an dem du in diesen Zug einsteigst.".
  - Bei Toggle AUS zusätzliches Feld "Startbahnhof".
- Primärbutton "Beste Verbindung jetzt finden".
- Sekundärlink "Stattdessen Start- und Zielbahnhof eingeben".
- Fußzeile mit Hinweis auf Unabhängigkeit von der DB und Scope (kein Ticketing).

**Formular-Validierung**

- Zugnummer: Validierung bei Blur (Feldverlassen) via `GET /v1/trains/{number}`. Inline-Fehler darunter.
- Zielbahnhof: Validierung erst bei Submit — Autocomplete-Auswahl impliziert gültige ID.
- Bei `POST /v1/journeys` → 422 `errors[]`: Feldnamen aus Backend direkt auf Formularfelder mappen via `setError()`.
- Submit-Button deaktiviert während laufender Validierung oder HAFAS-Anfrage.

**Plausibilitätslogik**

- Wenn Zugnummer heute nicht gefunden → Inline-Fehler.
- Wenn `plausibility.onTrainConfidence != "high"` (Backend-Antwort auf POST /v1/journeys) → Dialog:
  - "Wir konnten nicht sicher feststellen, dass du gerade in diesem Zug bist. Trotzdem von diesem Zug aus planen?".
  - Buttons: "Ja, Route planen" / "Nein, ich sitze nicht in diesem Zug" (setzt Toggle AUS).
  - Hinweis: Plausibility wird server-seitig via Fahrplandaten berechnet (kein GPS im Backend). GPS-Daten bleiben client-seitig optional.

### 3.2 Alternativen-Screen

**Zweck**: In wenigen Sekunden die beste Ersatzroute wählen.

**Header**

- Wenn noch keine alternative Route aktiv:
  - "Dein aktueller Zug bringt dich voraussichtlich um 19:42 ans Ziel.".
- Wenn bereits eine alternative Route aktiv:
  - "Deine derzeit überwachte Route → Ankunft 19:42.".
- Optional: Mini-Perlschnur der aktuellen Route.

**Inhalt**

- Titel: "Bessere Verbindungen gefunden".
- Filter-Zeile:
  - Button "Filter" → Sheet mit Optionen:
    - "Nur DB-Züge" (Toggle)
    - "Maximale Umstiege" (0 / 1–2 / egal)
    - "Sicherheitslevel" (Aggressiv / Normal / Vorsichtig → min. Puffer)
  - Aktive Filter als Badges (z. B. "Nur DB", "max. 2 Umstiege").
- Kartenliste:
  - Pro Karte:
    - Titel: "+18 Minuten früher am Ziel".
    - Subline: "Ankunft 19:24 · 3 Umstiege · min. Puffer 9 Minuten".
    - Badges: "Nur DB", "Riskant", optional "Schnellste" / "Am stabilsten".
  - Tap öffnet Detail-Sheet:
    - Vergleich vs. ursprünglichem Zug (und ggf. aktueller Route), Mini-Perlschnur, Button "Diese Route wählen".

**Ladezustand**

- Initial-Load (AlternativesScreen mount): Skeleton-Cards (3 Platzhalter) für max. 8s, danach Fehler-Banner wenn keine Antwort.
- Neuberechnung via "Neu berechnen"-Button: Spinner im Button, Karten-Liste zeigt vorherige Ergebnisse (nicht leer) bis neue Daten kommen.
- Zugnummer-Validierung: Inline-Spinner im Textfeld.

**Nullfall**

- Bei keiner besseren Alternative:
  - Info: "Keine schnellere Verbindung gefunden. Dein aktueller Zug bringt dich am schnellsten ans Ziel. Bleib sitzen – wir können deine Route trotzdem überwachen.".
  - Button "Route überwachen".

### 3.3 Reisebegleiter-Screen (Perlschnur)

**Zweck**: Status der Reise, nächste Aktion, Orientierung und Störungshandling.

**Header (sticky)**

- KPI-Zeile: "+18 Minuten schneller als dein ursprünglicher Zug.".
- Zeile 2: "Gegenüber Fahrplan: +10 Minuten Verspätung.".
- Next-Step-Card: "In 27 Minuten in Kassel Hbf aussteigen. Anschluss: RE 4321 ab Gleis 5 · Puffer 9 Minuten.".

**Perlschnur (Timeline)**

- Linke Spalte: vertikale Linie mit Knoten (Stops):
  - vergangene Halte (gefüllte neutrale Perle),
  - aktueller Halt (größere, akzentfarbene Perle),
  - zukünftige Halte (Outline-Perle).
- Rechte Spalte: pro Halt
  - Name, Ankunft/Abfahrt (Plan + Realtime + Delay), Gleis,
  - Puffer-Badges bei Umstiegen ("Puffer 4 Minuten").
- Zwischen Halten: Leg-Blöcke mit Zug, Richtung, Fahrzeit und optional Delay.

**Interaktionen & States**

- Floating-Button "Zu 'Jetzt' springen" scrollt Liste zum aktuellen Leg.
- Bei kritischer Situation (`status = critical` oder `criticalTransfer = true`):
  - Warn-Badge am betroffenen Halt (Puffer-Badge in Warnfarbe),
  - interaktiver Hinweis ("Umstieg kritisch – Alternative +9 Minuten schneller ansehen") → Routenvergleich-Sheet.

**Monitoring-Modi**

- Standard: neue Routes werden automatisch überwacht (konfigurierbar in Settings).
- Nicht überwacht: Header-Hinweis ("Diese Route wird nicht überwacht. Tippe hier, um sie als aktive Reise zu überwachen."), keine Live-Warnungen.

**Ladezustand**

- CompanionScreen mount: Skeleton-Timeline (5 Platzhalter-Stops) bis erste API-Antwort.
- Poll-Update (200 response): SummaryHeader updatet sich in-place, Timeline animiert Delta (geänderte Stops pulsen kurz).
- Poll-Fehler: letzter bekannter Zustand bleibt sichtbar + Staleness-Badge in SummaryHeader.

**Reiseende & Cleanup**

- Button "Reise abschließen".
- Automatischer Stopp des Monitorings nach X Minuten nach Zielankunft.
- Alte Journeys (z. B. älter als 6–12 h) werden beim App-Start als "historisch" behandelt, mit Option "Neue Reise starten".

---

## 4. States & Logik

### 4.1 Wichtige States

- `NO_TRIP` – keine Reise aktiv.
- `CANDIDATES_SHOWN` – Alternativen sind sichtbar, aber noch nicht gewählt.
- `TRIP_SELECTED_NOT_MONITORED` – Route gewählt, aber Monitoring aus.
- `TRIP_ACTIVE_MONITORED` – Route aktiv überwacht.
- `DISRUPTION_DETECTED` – kritische Störung erkannt.
- `ALTERNATIVE_PROPOSED` – Alternative für aktive Route berechnet.
- `ALTERNATIVE_ACTIVE` – neue Route ist aktiv und wird überwacht.

### 4.2 Referenzen

- Ursprünglicher Zug: der Zuglauf, mit dem die App gestartet wurde.
- Aktuelle Route: aktuell aktive Journey (kann vom ursprünglichen Zug abweichen).

`timeGainVsOriginalMinutes` – immer vs. Ankunft des ursprünglichen Zuges.

### 4.3 Statusdefinitionen

- `status = ok` – min. Puffer ≥ Schwelle (8 Minuten bei safetyLevel `normal`; konfigurierbar per safetyLevel, siehe api-spec.md), keine massiven neuen Verspätungen.
- `status = critical` – min. Puffer < Schwelle oder starke Verschlechterung.
- `status = failed` – Route kann sinnvoll nicht mehr fortgesetzt werden.

Flags:

- `criticalTransfer`: mindestens ein Umstieg kritisch.
- `alternativeAvailable`: es gibt sinnvolle Alternativen.

---

### 4.4 Error State UX Matrix

| Fehler | HTTP / Typ | Frontend-Verhalten |
|--------|------------|-------------------|
| Ungültige Zugnummer | 404 `train-not-found` | Inline-Fehler unter Textfeld: "Zug nicht gefunden für heute" |
| Server-Validierung | 422 `validation-error` | Feld-Fehler via `errors[]`-Mapping, kein Toast |
| Netzwerk-Offline | Network Error | Banner oben: "Offline — Daten von {{lastUpdatedAt}}", Journey bleibt sichtbar |
| HAFAS nicht erreichbar | 503 `upstream-unavailable` | Banner: "Live-Daten gerade nicht verfügbar — letzte bekannte Route wird angezeigt" |
| Server-Überlast | 503 `capacity-exceeded` | Vollbild-Fehler: "Server überlastet — bitte in Kürze erneut versuchen". Retry-Button. |
| Rate Limit | 429 `rate-limit-exceeded` | Kein Toast. Stilles Backoff. Banner erst wenn Blockade > 60s: "Zu viele Anfragen — kurz warten" |
| Unbekannter Fehler | 500 `internal-error` | Toast: "Etwas ist schiefgelaufen". Journey-State bleibt erhalten. Request-ID in Fehlermeldung für Support. |
| Journey abgelaufen | 404 `journey-not-found` (beim Poll) | Hinweis: "Deine Reise ist abgelaufen". CTA: "Neue Verbindung suchen" → StartScreen |

---

## 5. Backend-API (Kurzüberblick)

- `POST /v1/journeys` – neue Journey aus Zugnummer + Ziel.
- `GET /v1/journeys/{id}/summary` – schlanker Realtime-Snapshot (ETag-gecacht, Poll-Pfad).
- `GET /v1/journeys/{id}/legs` – Leg/Stop-Deltas für Perlschnur (ETag-gecacht).

---

## 6. Performance, Offline & Betriebsmodi (Kurz)

- App-Shell cache-first (Service Worker).
- Daten network-first mit Cache-Fallback und `stale-while-revalidate`.
- IndexedDB für Journey-State.
- Polling im Vordergrund: 30 s; Hintergrund-Tab (Page Visibility API): 90 s.
- Zeitzone-Anzeige: Alle Zeiten in **Europe/Berlin** (Zugbetrieb in DE). Relative Zeitangaben ("vor 2 Minuten") in Nutzer-Lokalzeit via `Intl.RelativeTimeFormat`. API-Timestamps (UTC ISO 8601) werden client-seitig formatiert.
- Kritischer Status: Poll-Intervall auf 10 s erhöht wenn `status === 'critical'` ODER `minTransferBufferMinutes < 5`.
- Background Sync/Periodic Sync: nicht im MVP — Page Visibility API + adaptive Polling reichen für V1. V2+ kann Background Sync ergänzen, erfordert separates Spec.
- Browser-Tab vs. PWA:
  - **Android:** `beforeinstallprompt`-Event abfangen → "App installieren"-Banner auf StartScreen (dismissbar, 7-Tage-Snooze in localStorage). Banner verschwindet wenn `display-mode: standalone`.
  - **iOS:** Kein Install-Prompt verfügbar → persistenter Hinweis "Zum Home-Bildschirm hinzufügen" (Safari Share → Add to Home Screen) beim ersten Besuch (7-Tage-Snooze). Nur im Browser anzeigen, nicht in `standalone`-Mode.
  - **Beide:** im Tab "Für zuverlässigere Updates App installieren" als dismissbares Info-Banner.
