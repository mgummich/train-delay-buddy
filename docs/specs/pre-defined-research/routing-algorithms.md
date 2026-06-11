# Routing Algorithms

## Zweck

Dieses Dokument beschreibt die Routing- und Re-Routing-Algorithmen der App. Es definiert, wie aus Echtzeitdaten, Fahrplaninformationen und Nutzerkontext optimale Alternativen berechnet werden.

Die Grundidee ist einfach:

- Finde die früheste brauchbare Ankunft am Ziel.
- Erlaube beliebig viele Umstiege.
- Verwerfe jede Alternative, die nicht früher ankommt als die Referenz.
- Bevorzuge stabile Verbindungen mit ausreichend Puffer.

---

## 1. Zieldefinition

### Primäres Optimierungsziel

Die App sucht die Verbindung mit der **frühesten prognostizierten Ankunftszeit** am Ziel.

Formal:

- Minimiere `eta`.
- Akzeptiere nur Alternativen mit `eta < eta_original`.

### Sekundäre Optimierungsziele

Wenn mehrere Alternativen ähnlich früh sind, werden zusätzlich bevorzugt:

- höhere Umstiegsstabilität,
- größerer minimaler Transferpuffer,
- weniger riskante Umstiege,
- geringere Gesamtkomplexität der Reise.

---

## 2. Routing-Grundmodell

Die Reise wird als zeitabhängiger Graph modelliert.

### Knoten

- Haltepunkte / Stationen
- Zustände an Stationen zu bestimmten Zeiten

### Kanten

- einzelne Legs / Fahrabschnitte
- Fußwege / Transferwege, falls relevant
- Übergänge zwischen Fahrten an einem Umstiegspunkt

### Eigenschaften einer Kante

Jede Kante hat mindestens:

- Abfahrtszeit geplant,
- Ankunftszeit geplant,
- Realtime-Abweichung,
- Betreiber / Produktklasse,
- minimale Umstiegszeit bzw. Transferdauer,
- Status (z. B. fahrend, verspätet, ausgefallen).

---

## 3. Referenz und Vergleich

Die Routinglogik vergleicht jede Alternative gegen eine Referenz.

### Referenzarten

- **Original-Zug**: die vom Nutzer initial betrachtete Verbindung.
- **Aktive Route**: die aktuell überwachte Reise, falls bereits eine Alternative gewählt wurde.

### Vergleichsgrößen

- `timeGainVsOriginalMinutes`
- `timeGainVsCurrentRouteMinutes` (optional, wenn eine aktive Route bereits existiert)
- `minTransferBufferMinutes`
- `status`

### Filterregel

Eine Alternative wird nur gezeigt, wenn sie die Referenz wirklich verbessert:

- `eta_alternative < eta_reference`

---

## 4. High-Level-Routing-Flow

### Schritt 1: Kontext bestimmen

- Nutzer gibt Zugnummer oder Start/Ziel ein.
- Optional wird geprüft, ob der Nutzer sich realistisch in diesem Zug befindet.
- Das Backend bestimmt den Abfahrtskontext: aktueller Halt, nächster erreichbarer Halt oder Startbahnhof.

### Schritt 2: Journey-Suche

- Suche alle plausiblen Verbindungen im relevanten Zeitfenster.
- Das Zeitfenster beginnt beim aktuellen Zeitpunkt bzw. beim nächstmöglichen Einstiegspunkt.
- Das Zeitfenster endet 4 Stunden nach der aktuellen Zeit (MVP-Konstante, konfigurierbar). Verbindungen mit Abfahrt außerhalb dieses Fensters werden nicht berücksichtigt.

### Schritt 3: Realtime-Bewertung

- Für jede Verbindung werden Realtime-Daten eingerechnet.
- Verspätungen verschieben Abfahrts- und Ankunftszeiten.
- Ausfälle werden entfernt oder als ungültig markiert.

### Schritt 4: Transfer-Check

- Alle Umstiege werden auf Machbarkeit geprüft.
- Wenn die reale Ankunft am Umstiegspunkt zu spät ist, wird die Verbindung verworfen.
- Wenn ein Umstieg zwar möglich, aber kritisch ist, bleibt die Verbindung erhalten, aber mit Risiko-Markierung.

### Schritt 5: Ranking

- Sortiere primär nach frühester Ankunft.
- Bei ähnlicher Ankunft sortiere nach Stabilität und Puffer.
- Optional berücksichtige weniger Umstiege und weniger kritische Transfers als Tiebreaker.

### Schritt 6: Ausgabe

- Liefere eine Liste von Alternativen.
- Jede Alternative enthält Summary, Legs, nächste Handlung und Risikoindikatoren.

---

## 5. Transfer- und Pufferlogik

### Mindestpuffer

Jeder Umstieg muss eine Mindestzeit zwischen tatsächlicher Ankunft des ersten Legs und tatsächlicher Abfahrt des Folge-Legs haben.

### Pufferberechnung

`buffer = departure_next_leg - arrival_previous_leg`

### Bewertung

- `buffer >= threshold` → stabil
- `buffer < threshold` → kritisch

Der Schwellenwert kann je nach Sicherheitslevel variieren.

### Sicherheitslevel

- **Aggressiv**: kleine Puffer erlaubt, Ziel ist maximale Zeitersparnis.
- **Normal**: ausgewogene Balance.
- **Vorsichtig**: nur robuste Umstiege mit höherem Puffer.

---

## 6. Suchstrategie für Alternativen

### 6.1 Kriterium: frühe Ankunft

Die Basisstrategie ist ein zeitabhängiger früheste-Ankunfts-Algorithmus.

### 6.2 Mehrere Umstiege

Es gibt keine harte Begrenzung auf eine feste Zahl von Umstiegen.

Stattdessen:

- erlaubte Umstiege sind durch Zeitfenster, Stabilität und Benutzerfilter begrenzt,
- Verbindungsketten werden verworfen, wenn sie keine Verbesserung darstellen.

### 6.3 Dominanzfilter

Wenn zwei Verbindungen gleich oder nahezu gleich früh ankommen, wird bevorzugt:

- die stabilere Verbindung,
- die mit höherem Puffer,
- die mit weniger riskanten Transfers.

---

## 7. Bewertung einzelner Verbindungen

Jede Alternative erhält intern einen Score oder mehrere Teilwerte.

### Primärwert

- `eta`

### Sekundärwerte

- `minTransferBufferMinutes`
- Anzahl Umstiege
- Anzahl kritischer Umstiege
- Verspätungsrisiko (MVP: heuristisch — z. B. Zug mit laufender Verspätung >10 min erhält höheren Risikowert; keine historischen Delay-Modelle in V1)
- Produkt-/Betreiberfilter

### Beispiel für Ranking-Hierarchie

1. Früheste ETA.
2. Größter minimaler Puffer.
3. Wenigste kritische Umstiege.
4. Wenigste Umstiege insgesamt.
5. Zusätzliche Nutzerfilter.

Ein zusammengesetzter Score ist möglich, sollte aber die ETA nicht überdecken.

---

## 8. Statuslogik

### `ok`

- Reise ist aktuell stabil.
- Umstiege sind ausreichend sicher.
- Keine massive Verzögerung gegenüber der erwarteten Route.

### `critical`

- Mindestens ein Umstieg ist knapp.
- Oder die Route ist stark verspätet.
- Oder eine sofort bessere Alternative sollte aktiv vorgeschlagen werden.

### `failed`

Die Route ist nicht mehr fortsetzbar. Konkrete Auslöser:

- **Ausfall**: mindestens ein Leg der aktiven Route ist als `cancelled` markiert, kein Ersatz verfügbar.
- **Verpasster Anschluss**: `buffer < 0 Minuten` an einem Umstieg (Zug bereits abgefahren).
- **Keine Weiterfahrt**: ab aktuellem Halt keine Verbindung zum Ziel mehr im Suchzeitfenster.
- **Ziel bereits passiert**: Route physisch nicht mehr fortsetzbar.

Bei `status = failed` zeigt das Frontend "Route nicht mehr nutzbar" + primären CTA "Neue Verbindung suchen".

---

## 9. Re-Routing-Strategie während einer aktiven Reise

Wenn eine aktive Reise überwacht wird, läuft das Routing wiederholt neu.

### Trigger für Re-Routing

- neue Realtime-Daten,
- geänderte Gleisangaben,
- zunehmende Verspätung,
- kritischer werdender Umstieg,
- Nutzer bewegt sich in Richtung eines Umstiegs oder Aufenthaltsortes.

### Verhalten

- Route bleibt bestehen, solange sie stabil ist.
- Bei Verschlechterung wird im Hintergrund eine bessere Alternative berechnet.
- Wenn eine bessere Alternative klar früher ankommt, wird sie als Vorschlag angezeigt.
- Falls gewünscht, kann automatisch auf die bessere Route gewechselt werden, ansonsten nur Vorschlag.

---

## 10. Daten, die in die Routingentscheidung eingehen

### Extern

- geplante Fahrzeiten,
- Realtime-Verspätungen,
- Gleisänderungen,
- Ausfälle,
- Verbindungsalternativen,
- Transferzeiten.

### Intern

- aktuelle Journey-Referenz,
- letzte bekannte Summary,
- Benutzerfilter,
- Sicherheitslevel,
- Plausibilisierung des Startkontexts,
- ggf. Standort- oder Zeitkontext.

---

## 11. Ergebnisstruktur

Die Routing-Engine sollte mindestens liefern:

- `journeyId`
- `stops`
- `legs`
- `summary`
- `eta`
- `timeGainVsOriginalMinutes`
- `timeGainVsCurrentRouteMinutes` (optional — nur wenn bereits eine aktive Route gewählt wurde)
- `status`
- `minTransferBufferMinutes`
- `criticalTransfer`
- `alternativeAvailable`
- `nextStep`

Für die UI ist entscheidend, dass die Summary klein, häufig aktualisierbar und stabil ist.

---

## 12. MVP-Empfehlung

Für den ersten MVP reicht ein robustes, klar erklärbares Routingmodell:

- früheste-Ankunft als Hauptziel,
- beliebig viele Umstiege,
- harte Filter gegen nicht machbare Anschlüsse,
- klare Risiko-Markierung bei kritischen Transfers,
- einfache Rankingregeln ohne überkomplexe KI-Modelle.

Spätere Versionen können ergänzt werden um:

- historische Delay-Modelle,
- Risiko-Prognosen,
- lernende Präferenzen,
- automatische Route-Wechsel.
