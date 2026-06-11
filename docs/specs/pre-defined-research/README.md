# App Documentation

Diese Dokumentation beschreibt Produkt, Architektur, Datenquellen, Routing-Algorithmen, API und Design der DB-Routing-App.

## Dokumente

- **product-spec.md** – Produktzielen, Use Cases, Kernfunktionen und MVP-Definition.
- **architecture.md** – Verbindendes Dokument zwischen Produkt, Daten, Architektur und Technik. Enthalt die Einordnung der Routing-Algorithmen.
- **data-sources.md** – Herkunft der Daten, primare externe Quellen (db.transport.rest), Ableitungen und Scope.
- **routing-algorithms.md** – Routing- und Re-Routing-Algorithmen, Zieldefinition, Transferlogik, Statuslogik, Ergebnisstruktur.
- **api-spec.md** – Schnittstellen zwischen Frontend, Backend und externen Datenquellen.
- **design-system.md** – UI/UX-Regeln, Komponenten, Farben, Typografie, Motion- und Feedbackverhalten.

## Dokumentenbeziehungen

```
product-spec.md
      ↓
architecture.md ←→ data-sources.md
      ↓              ↓
routing-algorithms.md  → api-spec.md
      ↓              ↓
design-system.md  → Frontend
```

- `architecture.md` verbindet Produkt, Daten und Technik.
- `data-sources.md` definiert db.transport.rest als primare MVP-Datenquelle.
- `routing-algorithms.md` beschreibt die Routing-Logik, die im Backend nach architecture.md umgesetzt wird.
- `api-spec.md` definiert die Schnittstellen, die das Frontend nutzt.
- `design-system.md` beschreibt das UI/UX, das auf den API-Daten aufbaut.

## MVP-Entscheidungen

- Routing-Engine: robust, klar erklärbar, ohne komplexe KI-Modelle.
- Datenquelle MVP: db.transport.rest als primare Quelle.
- RIS: optional für spaterere DB-nahe Integrationen.
- UI: inkrementell aktualisierbare Summaries, Risikoanzeigen, klare Handlungen.
- Architektur: austauschbare Datenquellen durch eigenes Journey-Modell.
- **Default-Filter: Nur von DB betriebene Zuge** (DB-Operatoren wie DB Navigator, DB Fernverkehr, DB Regio).


Siehe auch **architecture.md → Operator-Filter im Backend** für die technische Implementierung (Filterlogik, DB-Operatoren, Code-Beispiel).


## Default-Filter: Nur DB-Zuge

Als Default-Einstellung nutzt die App **nur von DB betriebene Zuge**.

- Der Filter ist im Frontend aktiviert und kann vom Nutzer deaktiviert werden.
- Im Backend wird dieser Filter bei der Journey-Suche angewendet.
- Operatoren, die als DB zugehorig gelten: DB Navigator, DB Fernverkehr, DB Regio, weitere DB-Unternehmen.
- Nicht-DB-Operatoren (z. B. Flixtrain, andere private Betreiber) sind im Default ausgefiltert.

Diese Entscheidung sorgt für:
- hoheres Vertrauen bei DB-Nutzern,
- konsistente Realtime-Daten durch DB-Quellen,
- simpleres MVP mit klarerem Scope.

## Zukunftige Erweiterungen

Mogliche Erweiterungen für spaterere Versionen:

- historische Delay-Modelle,
- Risiko-Prognosen,
- lernende Präferenzen,
- automatische Route-Wechsel,
- integrative RIS-Bausteine.
