# Data Sources

## Zweck

Dieses Dokument beschreibt, woher die App ihre Daten bezieht, welche Daten intern daraus abgeleitet werden und welche Informationen bewusst nicht im Scope sind.

Die App baut auf externen Mobilitäts- und Realtime-Daten auf, berechnet daraus aber eigene Journey-Zustände, Bewertungen und Empfehlungen.

---

## 1. Grundprinzip

Die App konsumiert primär externe Fahrplan- und Realtime-Datenquellen und erzeugt daraus eine eigene, stabile interne Journey-Repräsentation.

Externe Datenquellen liefern vor allem:

- Stationen und Halte,
- geplante Abfahrts- und Ankunftszeiten,
- Realtime-Abweichungen (Verspätungen, geänderte Gleise, Ausfälle),
- Routen- und Verbindungsoptionen.

Das Backend der App leitet daraus zusätzliche Zustände und Kennzahlen ab, etwa:

- `eta`,
- `timeGainVsOriginalMinutes`,
- `minTransferBufferMinutes`,
- `status` (`ok`, `critical`, `failed`),
- `criticalTransfer`,
- `alternativeAvailable`,
- `nextStep`.

---

## 2. Primäre externe Datenquellen

### 2.1 HAFAS-nahe Routing-/Journey-Quelle

**Primär empfohlene Quelle:** `db.transport.rest`

Diese Quelle eignet sich gut für einen MVP, weil sie Journey-, Trip- und Stop-Abfragen bereitstellt und Realtime-Verspätungen bzw. ähnliche Informationen abbildet.

Typische Nutzungen:

- Journey-Suche zwischen Punkten,
- Abfahrts- und Ankunftsabfragen an Halten,
- Trip-/Fahrt-Details für laufende Verbindungen,
- Grundlage für Re-Routing und Alternativvorschläge.

**Wofür wir sie verwenden:**

- Ausgangssuche für Verbindungen,
- Identifikation von Reiseabschnitten (Legs),
- Ermittlung geplanter und realtime-basierter Zeiten,
- Alternative Verbindungen, die früher als die Referenz ankommen.

### 2.2 DB Timetables API / DB-nahe Realtime-Daten

**Sekundäre / ergänzende Quelle:** DB Timetables API bzw. DB-nahe Timetable-/Realtime-Endpunkte.

Diese Quelle ist besonders relevant für:

- Sollfahrplandaten,
- Realtime-Abweichungen,
- Gleisänderungen,
- Störungen und Fahrplananpassungen.

**Wofür wir sie verwenden können:**

- Validierung oder Ergänzung der Primärquelle,
- Verbesserung der Realtime-Qualität,
- Fallback bei Teil-Ausfällen,
- genauere Bewertung von Trip-Details einzelner Abschnitte.

**MVP-Status:** In V1 wird ausschließlich db.transport.rest verwendet. Die DB Timetables API wird nicht in den MVP-Datenfluss integriert — sie bleibt als dokumentierte Option für V2+ (verbesserte Realtime-Qualität, Validierungsschicht). Aktivierung erfordert explizite Implementierung im `hafas/` Package.

---

## 3. Optionale / spätere Datenquellen

### 3.1 Delay-Historie / Vorhersage-Daten

**Optional für spätere Versionen:** Bahn-Vorhersage-Datasets oder ähnliche historische Delay-Quellen.

Diese Daten sind nicht notwendig für den MVP, aber relevant für spätere Features wie:

- Risiko-Score je Verbindung,
- bessere Bewertung knapper Umstiege,
- Priorisierung robuster Alternativen.

**Hinweis:**

Aktuell ist keine prädiktive Logik Pflichtbestandteil der App. Zunächst reichen Live-Daten plus heuristische Regeln.

### 3.2 Gerätesignale / lokale Kontextdaten

Lokale Daten aus dem Gerät oder Browser:

- aktuelle Uhrzeit,
- optional GPS-/Standortdaten,
- Display-Mode (`browser` vs. `standalone`),
- Netzqualität (sofern verfügbar),
- lokale Präferenzen/Favoriten.

**Wofür wir sie verwenden:**

- Plausibilisierung von `iAmOnThisTrain`,
- Optimierung der Startposition,
- Anpassung von Polling-/PWA-Verhalten,
- UX-Personalisierung (letzte Ziele, letzte Zugnummern).

---

## 4. Interne Datenableitungen

Die App zeigt nicht nur Rohdaten an, sondern berechnet zentrale Produktmetriken selbst.

### 4.1 Aus externen Daten abgeleitete Werte

Das Backend berechnet insbesondere:

- **`eta`**: prognostizierte Ankunft am Ziel auf Basis der aktiven Route,
- **`timeGainVsOriginalMinutes`**: Zeitgewinn gegenüber der ursprünglich betrachteten Referenzverbindung,
- **`minTransferBufferMinutes`**: kleinster verbleibender Puffer über alle relevanten Umstiege,
- **`status`**:
  - `ok` = Route aktuell stabil,
  - `critical` = Umstieg oder Reiseverlauf kritisch,
  - `failed` = Route sinnvoll nicht mehr nutzbar,
- **`criticalTransfer`**: boolescher Marker, ob mindestens ein Umstieg kritisch ist,
- **`alternativeAvailable`**: boolescher Marker, ob derzeit bessere Alternativen existieren,
- **`nextStep`**: nächster konkreter Handlungshinweis für den Reisebegleiter.

### 4.2 Journey-Modell

Die interne Journey besteht aus:

- Metadaten (`journeyId`, Ursprung, Ziel, Referenzzug),
- `stops` (Halte),
- `legs` (Fahrtabschnitte),
- `summary` (kompakte, häufig aktualisierte Gesamtsicht),
- optionalen Detail-Updates (`details`).

Diese Struktur ist unabhängig von der konkreten externen API und dient dazu, Quellwechsel oder Mischquellen im Backend zu kapseln.

---

## 5. Fallback-Strategie

Die App sollte nicht vollständig an genau eine Datenquelle gekoppelt sein.

### 5.1 Zielbild

- **Primärquelle:** HAFAS-nahe Journey-/Realtime-Quelle.
- **Sekundärquelle / Fallback:** DB-nahe Timetable-/Realtime-Daten.
- **Interne Stabilisierung:** eigenes Backend-Modell, das externe Unterschiede abstrahiert.

### 5.2 Verhalten bei Problemen

Wenn eine Quelle vorübergehend unvollständig ist:

- letzte bekannte `summary` aus Cache/IndexedDB weiter anzeigen,
- Journey visuell nicht „verschwinden“ lassen,
- `lastUpdateAt` sichtbar machen,
- falls nötig Status auf eingeschränkt / veraltet markieren: `dataFetchedAt` > 3 Minuten → Summary als "möglicherweise veraltet" kennzeichnen; > 10 Minuten → expliziter Warn-Hinweis im UI ("Daten veraltet – kein Netz?").

---

## 6. Daten, die bewusst nicht im Scope sind

Die App verwendet bewusst **keine** der folgenden Daten als Kernbestandteil:

- Ticketdaten,
- Buchungsdaten,
- Nutzerkonten von Verkehrsunternehmen,
- Zahlungsdaten,
- personenbezogene DB-Kundendaten,
- interne Dispatch-/Betriebsdaten von Verkehrsunternehmen.

Die App ist ein Routing- und Reisebegleitungswerkzeug, kein Ticket- oder Account-Produkt.

---

## 7. Empfehlung für den MVP

Für den MVP ist folgende Aufteilung sinnvoll:

- **Primär:** `db.transport.rest` oder vergleichbare HAFAS-nahe Quelle für Journeys, Stops, Trips und Realtime.
- **Ergänzend / später:** DB Timetables API für zusätzliche Validierung, genauere Realtime-Daten oder Fallback.
- **Intern:** eigenes Journey-Modell mit `summary` + `details`, damit Frontend und UX unabhängig von Roh-API-Strukturen bleiben.

So bleibt der MVP relativ schnell umsetzbar, ohne sich früh auf einen vollständig selbst betriebenen Router festlegen zu müssen.

## DB APIs für den MVP

Für den MVP wird **db.transport.rest** als primäre Datenquelle für Routing, Realtime und Alternativen verwendet, weil die Integration schlank ist und keine separate Key- oder Marketplace-Komplexität wie bei RIS erfordert. RIS-Bausteine werden nicht als primäre MVP-Quelle eingeplant, sondern nur optional für spätere DB-nahe Integrationen.

### Begründung

- Direkt nutzbar für Prototyping und frühe Produktiteration.
- Browserfreundlich und gut für schnelle UI-Entwicklung.
- Liefert die für das MVP relevanten Fahrplan- und Realtime-Daten.
- RIS bleibt eine spätere Option, wenn Zugriff, Governance und Integrationsaufwand gerechtfertigt sind.
