# Architecture

Dieses Dokument beschreibt die architektonische Struktur der App, die Beziehungen zwischen den Dokumenten und die Grundprinzipien der Datenverarbeitung, der Routinglogik und der API.

---

## 1. Dokumentenstruktur

Die folgenden Dokumente bilden die Spezifikation und Architektur der App:

- **product-spec.md** – Produktzielen, Use Cases, Kernfunktionen und MVP-Definition.
- **data-sources.md** – Herkunft der Daten, primare externe Quellen, Ableitungen und Scopedatenerweiterungen.
- **routing-algorithms.md** – Routing- und Re-Routing-Algorithmen, Zieldefinition, Transferlogik, Statuslogik, Ergebnisstruktur.
- **api-spec.md** – Schnittstellen zwischen Frontend, Backend und externen Datenquellen.
- **design-system.md** – UI/UX-Regeln, Komponenten, Farben, Typografie, Motion- und Feedbackverhalten.

Diese Architektur bildet das verbindende Dokument zwischen Produkt, Daten und Technik.

---

## 2. Architekturprinzipien

### 2.1 Datenfluss

Die App konsumiert externe Fahrplan- und Realtime-Daten und erzeugt daraus eigene Journey-Zustande, Bewertungen und Empfehlungen.

Einfacher Datenfluss:

external sources -> backend journey model -> frontend summary + actions

Das Backend:

- konsumiert db.transport.rest als primare Quelle,
- konsumiert DB Timetables API als erganzende Quelle,
- erweitert externe Daten mit eta, timeGainVsOriginalMinutes, minTransferBufferMinutes, status, criticalTransfer, alternativeAvailable, nextStep.

Das Frontend:

- zeigt inkrementell aktualisierbare Summaries,
- reagiert auf Statuswechsel (ok / critical / failed),
- bietet konkrete Aktionen wie "Jetzt wechseln" oder "Umstieg morgen".

### 2.2 Journey-Modell

Das Backend arbeitet mit einem eigenen Journey-Modell, das:

- immer das gleiche Schema hat, egal welche externe Quelle ingest wurde,
- alle relevanten Routing- und Statusinformationen zusammenfasst,
- Summary und Legs in einer stabilen Struktur bereitstellt.

Externe Quellen sind austauschbar, ohne dass sich das Frontend verändern muss.

### 2.3 Routing-Entscheidungen

Die Routinglogik folgt den Regeln aus routing-algorithms.md:

- Primares Ziel: fruheste ETA am Ziel.
- Sekundare Ziele: Stabilitat, Puffer, weniger riskante Umstiege.
- Filter: nur Alternativen mit eta < eta_reference.
- Status: ok, critical, failed.

Re-Routing wird im Hintergrund ausgefuhrt und bei signifikanter Verbesserung als Vorschlag angezeigt.

### 2.4 API-Struktur

Die API ist als schlanker REST-Service konzipiert, mit:

- einer Journey-Route,
- klaren Request/Response-Strukturen,
- inkrementellen Updates (nur Summary/Status/nextStep),
- klaren Statuscodes und Fehlermeldungen.

Die externe Datenanbindung erfolgt im Backend, nicht direkt im Frontend.

---

## 3. Komponenten

### 3.1 Frontend

- Zeigt Summary mit ETA, Zugnummern, Zeitgewinn, Status.
- Zeigt nächste Handlung und Risikoindikatoren.
- Aktualisiert Summary inkrementell, ohne gesamte Route neu zu rendern.
- Reagiert auf Statuswechsel und "AlternativeAvailable".

### 3.2 Backend

- Ingestet externe Datenquellen.
- Fuhrt Routing nach routing-algorithms.md.
- Berechnet eta, timeGainVsOriginalMinutes, minTransferBufferMinutes, status und weitere Kennzahlen.
- Speichert Journey-Zustande und fuhrt Re-Routing bei Trigger aus.
- Bietet REST-Endpoints für Frontend.

### 3.3 Externe Datenquellen

- Primar (MVP): db.transport.rest für Routing, Realtime, Alternativen.
- Sekundar (erganzend): DB Timetables API für Sollfahrplandaten und Realtime-Erganisse.
- Optional (spater): RIS-Bausteine für DB-nahe Integrationen.

---

## 4. Datenmodell (vereinfacht)

### 4.1 Journey

- journeyId
- stops
- legs
- summary
- eta
- timeGainVsOriginalMinutes
- status
- minTransferBufferMinutes
- criticalTransfer
- alternativeAvailable
- nextStep

### 4.2 Leg

- legId
- vehicleNumber
- lineName
- operator
- departureTimePlanned
- departureTimeActual
- arrivalTimePlanned
- arrivalTimeActual
- delayMinutes
- platformPlanned
- platformActual
- status
- isWalkingSegment

### 4.3 Summary

- fromStation
- fromTime
- toStation
- toTime
- eta
- timeGainVsOriginalMinutes
- timeGainVsCurrentRouteMinutes (optional — nur wenn bereits eine aktive Route gewählt wurde)
- minTransferBufferMinutes
- status
- criticalTransfer
- alternativeAvailable
- nextStep

---

## 5. Routing und Re-Routing

### 5.1 Routing

Routing folgt der Beschreibung in routing-algorithms.md:

- Zeitabhangiger Graph.
- Fruheste-Ankunft als Hauptziel.
- Keine harte Limitierung der Umstiege.
- Filter: nur Alternativen mit besserer ETA.
- Ranking: ETA -> Puffer -> kritische Umstiege -> Anzahl Umstiege.

### 5.2 Re-Routing

Re-Routing wird ausgelost durch:

- neue Realtime-Daten,
- Verspatungen,
- geanderte Gleise,
- kritische Umstiege,
- Nutzerbewegung in Richtung Umstieg.

Re-Routing passiert im Hintergrund; bei klarem Vorteil wird die Alternative als Vorschlag angezeigt.

---

## 6. Statuslogik

Die Journey hat drei Hauptzustande:

- ok – stabil, keine Sofortaktion notig.
- critical – Umstieg knapp, Verspatung, bessere Alternative verfügbar.
- failed – Route praktisch nicht mehr sinnvoll fortsetzbar.

Diese Zustande stammen aus routing-algorithms.md und werden vom Backend berechnet und vom Frontend angezeigt.

---

## 7. MVP-Entscheidungen

- Routing-Engine: robust, klar erklärbar, ohne komplexe KI-Modelle.
- Datenquelle MVP: db.transport.rest als primare Quelle.
- RIS: optional für spaterere DB-nahe Integrationen.
- UI: inkrementell aktualisierbare Summaries, Risikoanzeigen, klare Handlungen.
- Architektur: austauschbare Datenquellen durch eigenes Journey-Modell.
- **Default-Filter: Nur von DB betriebene Zuge** (DB-Operatoren wie DB Navigator, DB Fernverkehr, DB Regio).

### Operator-Filter im Backend

Der DB-only-Filter wird im Backend bei der Journey-Suche angewendet:

**Filterlogik**

- Bei der Journey-Suche werden alle returned Verbindungen durchlaufen.
- Jedes Leg wird auf seinen Operator geprüft.
- Wenn ein Leg einen Nicht-DB-Operator hat, wird die gesamte Verbindung ausgefiltert (im Default).
- Der Filter ist konfigurierbar und kann vom Nutzer im Frontend deaktiviert werden.

**DB-Operatoren (im Filter enthalten)**

Hinweis: Operator-Strings müssen empirisch gegen live db.transport.rest-Daten abgeglichen werden. Bekannte Einträge (Startpunkt):

- DB Fernverkehr AG (ICE, IC, EC)
- DB Regio AG (Regionalzüge)
- S-Bahn Berlin GmbH, S-Bahn Hamburg GmbH, S-Bahn München GmbH
- Weitere DB-Tochtergesellschaften (vollständige Allow-List in `hafas/filter.go`)

Korrekt ausgefiltert (kein Transportbetreiber für Personenzüge):
- DB Navigator → App, kein Operator
- DB Cargo → Güterverkehr, keine Personenzüge

**Nicht-DB-Operatoren (im Default ausgefiltert)**

- Flixtrain
- andere private Betreiber
- nicht-DB Regionalverkehrsunternehmen

**Implementierung (vereinfacht)**

```
def is_db_only_journey(journey):
    """Returns True if all legs are operated by a DB entity — journey should be kept."""
    for leg in journey.legs:
        if leg.operator not in DB_OPERATORS:
            return False
    return True

# Strings müssen empirisch gegen live db.transport.rest-Daten verifiziert werden.
# Vollständige Allow-List in hafas/filter.go pflegen.
DB_OPERATORS = [
    "DB Fernverkehr AG",   # ICE, IC, EC
    "DB Regio AG",         # Regionalzüge
    "S-Bahn Berlin GmbH",
    "S-Bahn Hamburg GmbH",
    "S-Bahn München GmbH",
    # Weitere DB-Tochtergesellschaften nach empirischer Verifikation ergänzen
]
```

**Vorteile**

- höheres Vertrauen bei DB-Nutzern (konsistente Markenerwartung),
- konsistente Realtime-Daten durch DB-Quellen (db.transport.rest ist DB-nahe),
- simpleres MVP mit klarerem Scope (weniger Operatoren, weniger Ausnahmefall).

**Zukunftige Erweiterung**

- Nutzer kann Filter deaktivieren → alle Operatoren erlaubt.
- Spater: lernende Präferenzen (App lernt, ob Nutzer bevorzugt DB oder nicht-DB).
- Spater: Operator-spezifische Regeln (z. B. bestimmte private Betreiber immer erlauben).

## 8. Zukunftige Erweiterungen

Mogliche Erweiterungen für spaterere Versionen:

- historische Delay-Modelle,
- Risiko-Prognosen,
- lernende Präferenzen,
- automatische Route-Wechsel,
- integrative RIS-Bausteine.
