# API-Spezifikation

## Prinzipien

- REST, ressourcenorientiert — keine Verben in URIs
- URI-Versionierung: `/v1/`
- Alle Fehler: `application/problem+json` (RFC 7807)
- Abuse-Shaping via `X-Install-Id: <uuid>` (UUID v4, client-generiert, in IndexedDB gespeichert) + IP-Rate-Limiting — keine Authentifizierung, kein Bearer Token
- Stationen immer als HAFAS-ID (z. B. `8000105`), nie als Namensstring
- ETag + `If-None-Match` für cachefähige Poll-Endpunkte

---

## Endpunkte

```
POST   /v1/journeys                       Journey anlegen, Alternativen berechnen
GET    /v1/journeys/{id}                  Vollständige Journey (Summary + Legs, nur initialer Load)
GET    /v1/journeys/{id}/summary          Kompakter Status (ETag-gecacht, Poll-Pfad) → 200 / 304
GET    /v1/journeys/{id}/legs             Leg/Stop-Deltas (ETag-gecacht) → 200 / 304
DELETE /v1/journeys/{id}                  Monitoring beenden → 204; unbekannte ID → 404
GET    /v1/journeys/{id}/alternatives     Aktuelle Alternativen-Liste (gecacht, limit=5 default)
POST   /v1/journeys/{id}/alternatives     Neuberechnung auslösen → 202 Accepted
GET    /v1/trains/{number}                Zugnummer validieren, Metadaten zurückgeben
GET    /v1/stations?q=...                 Stationsname-Autocomplete (min 2 Zeichen, limit=10 default)
GET    /health                            Liveness probe → 200 {"status":"ok"}
GET    /readyz                            Readiness probe → 200/503 (Redis + Postgres + HAFAS)
```

---

## Abuse-Shaping Header

Alle Requests sollen enthalten:

```
X-Install-Id: 550e8400-e29b-41d4-a716-446655440000
```

- UUID v4, client-seitig generiert, in IndexedDB gespeichert (Key: `install_id`)
- Fehlt `X-Install-Id` → IP-basiertes Rate-Limiting greift als Fallback
- Kein Authentifizierungsmechanismus — Abuse-Shaping only

---

## POST /v1/journeys

**Request Body**

```json
{
  "trainNumber": "ICE 123",
  "destination": "8000105",
  "iAmOnThisTrain": true,
  "filters": {
    "dbOnly": true,
    "maxTransfers": null,
    "safetyLevel": "normal"
  }
}
```

- `destination`: HAFAS-Station-ID
- `iAmOnThisTrain`: nur Nutzer-Assertion; Backend lehnt nicht ab, gibt stattdessen `plausibility` zurück
- `safetyLevel`: `"aggressive"` | `"normal"` | `"cautious"`
- `maxTransfers`: Integer oder `null` (kein Limit)

**Response 201 Created**

```json
{
  "journeyId": "jrn_01j2k3m4n5",
  "plausibility": {
    "onTrainConfidence": "high",
    "reason": null
  },
  "summary": { "..." : "..." },
  "alternatives": []
}
```

- `Location`-Header: `/v1/journeys/jrn_01j2k3m4n5`
- `journeyId` Format: `^jrn_[0-9a-z]{12,26}$`
- Idempotenter Hit: HTTP 200 (statt 201) + `Idempotency-Replayed: true` Header
- `plausibility.onTrainConfidence`: `"high"` | `"low"` | `"unknown"` — Frontend zeigt Bestätigungsdialog wenn nicht `"high"`

**Idempotenz**: optionaler Header `Idempotency-Key: <UUID>`. Gleicher Key + **identischer Request-Body** (kanonisch: alphabetisch sortierte Keys, kein Whitespace) innerhalb 10 Minuten → bestehende Journey zurückgeben (200) statt neue anlegen. Gleiches Key + abweichender Body → 409 Conflict.

---

## GET /v1/journeys/{id}

Vollständige Journey — Summary + Legs kombiniert. Nur beim initialen Screen-Load aufrufen (AlternativesScreen mount). Danach `/summary` und `/legs` separat pollen.

**Response 200**

```json
{
  "journeyId": "jrn_01j2k3m4n5",
  "trainNumber": "ICE 123",
  "destination": { "id": "8000105", "name": "Frankfurt (Main) Hbf" },
  "filters": {
    "dbOnly": true,
    "maxTransfers": null,
    "safetyLevel": "normal"
  },
  "summary": {
    "fromStation": "München Hbf",
    "fromTime": "2026-06-10T14:00:00Z",
    "toStation": "Frankfurt (Main) Hbf",
    "toTime": "2026-06-10T17:24:00Z",
    "eta": "2026-06-10T17:24:00Z",
    "timeGainVsOriginalMinutes": 18,
    "timeGainVsCurrentRouteMinutes": null,
    "minTransferBufferMinutes": 9,
    "status": "ok",
    "criticalTransfer": false,
    "alternativeAvailable": false,
    "dataConfidence": "high",
    "nextStep": {
      "type": "transfer",
      "stationName": "Kassel Hbf",
      "stationId": "8000294",
      "trainNumber": "RE 4321",
      "platform": "5",
      "departureTime": "2026-06-10T16:57:00Z",
      "bufferMinutes": 9
    },
    "dataFetchedAt": "2026-06-10T19:23:45Z",
    "lastUpdatedAt": "2026-06-10T19:00:12Z"
  },
  "legs": [
    {
      "legId": "leg_01",
      "vehicleNumber": "ICE 123",
      "lineName": "ICE 123",
      "operator": "DB Fernverkehr AG",
      "departureTimePlanned": "2026-06-10T14:00:00Z",
      "departureTimeActual": "2026-06-10T14:12:00Z",
      "arrivalTimePlanned": "2026-06-10T16:48:00Z",
      "arrivalTimeActual": "2026-06-10T16:51:00Z",
      "delayMinutes": 3,
      "platformPlanned": "12",
      "platformActual": "12",
      "status": "running",
      "isWalkingSegment": false,
      "stops": []
    }
  ]
}
```

**Response 404** `urn:verspbegl:error:journey-not-found` — journeyId unbekannt oder abgelaufen.

---

## DELETE /v1/journeys/{id}

- **204 No Content** — Journey terminiert, Poller abgebrochen
- **404** `urn:verspbegl:error:journey-not-found` — unbekannte oder bereits abgelaufene ID
- Zweites DELETE auf dieselbe ID → **404** (keine stille Idempotenz — Client erkennt Drift)

**Hinweis:** HTTP-Spec definiert DELETE als idempotent, aber dieses Design weicht bewusst davon ab. Clients mit Standard-Retry-Middleware müssen 404 auf DELETE als erwartet behandeln, nicht als Fehler. In `openapi.yaml` mit `x-non-idempotent: true` annotieren.

---

## GET /v1/journeys/{id}/alternatives

Gibt die zuletzt berechnete Alternativen-Liste zurück. ETag-gecacht — Client sendet `If-None-Match`, erhält 304 wenn sich die Liste nicht geändert hat.

**Query-Parameter**

- `limit` (integer, default 5, max 20): maximale Anzahl Alternativen

**Response 200**

```
ETag: "jrn_01j2k3m4n5:alts:7"
Cache-Control: private, no-cache, must-revalidate
```

```json
{
  "data": [
    {
      "journeyId": "jrn_alt_01j2k3",
      "summary": { "..." : "..." },
      "legs": []
    }
  ],
  "totalCount": 8
}
```

**Response 304 Not Modified** — Liste unverändert seit letztem `If-None-Match`.

ETag-Counter wird inkrementiert wenn `POST /v1/journeys/{id}/alternatives` eine neue Liste berechnet hat.

---

## POST /v1/journeys/{id}/alternatives

Löst eine frische Neuberechnung der Alternativen aus (HAFAS-Call, BFS-Routing).

**Response 202 Accepted**

```json
{
  "status": "computing",
  "pollPath": "/v1/journeys/jrn_01j2k3m4n5/alternatives"
}
```

Client pollt `GET /v1/journeys/{id}/alternatives` für Ergebnisse.

**Response 404** wenn Journey unbekannt oder abgelaufen.

---

## GET /health

```
GET /health
→ 200 OK { "status": "ok" }
```

Liveness probe. Antwortet sobald der Prozess läuft.

---

## GET /readyz

```
GET /readyz
→ 200 OK  { "status": "ok",    "checks": { "redis": "ok", "postgres": "ok", "hafas": "ok" } }
→ 503     { "status": "degraded", "checks": { "redis": "ok", "postgres": "ok", "hafas": "error" } }
```

Readiness probe. 503 wenn eine Abhängigkeit nicht erreichbar ist.

---

## GET /v1/trains/{number}

```
GET /v1/trains/ICE123?date=2026-06-10
```

**Response 200**

```json
{
  "trainNumber": "ICE 123",
  "date": "2026-06-10",
  "origin": { "id": "8000261", "name": "München Hbf" },
  "destination": { "id": "8011160", "name": "Berlin Hbf" },
  "stops": [],
  "status": "running"
}
```

**Response 404** wenn Zug an diesem Tag nicht fährt.

Wird vom StartScreen aufgerufen bevor `POST /v1/journeys` — verhindert unnötige Journey-Erstellung bei ungültiger Zugnummer.

**Zugnummer-Format im Pfad:** Leerzeichen entfernen, Großbuchstaben. Regex: `^[A-Z]+[0-9]+$`. Beispiele: `ICE123`, `RB27`, `S3`, `IRE200`.

**`date`-Parameter:** ISO 8601 `YYYY-MM-DD`. Standard wenn weggelassen: heutiges Datum in UTC.

---

## GET /v1/stations

```
GET /v1/stations?q=Frank&limit=10
```

**Query-Parameter**

- `q` (required, min 2 Zeichen): Suchbegriff. Prefix- + Substring-Match, diakritik-insensitiv ("Köln" = "Koln").
- `limit` (integer, default 10, max 50): maximale Anzahl Ergebnisse.

**Response 200** (auch bei keinen Treffern — nie 404 für leere Ergebnisse):

```json
{ "stations": [] }
```

---

## ETag-Caching (Summary + Details)

```
GET /v1/journeys/{id}/summary
→ 200 OK  ETag: "v42"  { eta, status, ... }

GET /v1/journeys/{id}/summary  If-None-Match: "v42"
→ 304 Not Modified  (kein Body)

GET /v1/journeys/{id}/summary  If-None-Match: "v42"
→ 200 OK  ETag: "v43"  { eta, status: "critical", ... }
```

ETag = opaker Versionszähler, vom Backend-Poller bei Zustandsänderung inkrementiert.

Alle Responses auf `/summary` und `/legs` enthalten:
```
Cache-Control: private, no-cache, must-revalidate
```
Verhindert stilles Caching durch Corporate Proxies oder CDNs.

---

## Fehlerformat (RFC 7807)

Alle 4xx/5xx: `Content-Type: application/problem+json`

```json
{
  "type": "urn:verspbegl:error:train-not-found",
  "title": "Train Not Found",
  "status": 404,
  "detail": "Train ICE 123 does not operate on 2026-06-10.",
  "instance": "/v1/trains/ICE123"
}
```

Für 422 `validation-error` wird `errors[]` mit Feldinformationen ergänzt:

```json
{
  "type": "urn:verspbegl:error:validation-error",
  "title": "Validation Error",
  "status": 422,
  "detail": "Request body has invalid fields.",
  "instance": "/v1/journeys",
  "errors": [
    { "field": "destination", "message": "Must be a valid HAFAS station ID." },
    { "field": "filters.safetyLevel", "message": "Must be one of: aggressive, normal, cautious." }
  ]
}
```

Alle Responses enthalten:
```
X-Request-Id: 550e8400-e29b-41d4-a716-446655440001
```
UUID v4, server-generiert. In `instance` bei Fehlern enthalten. Für Log-Korrelation.

URN `type`-Werte sind stabile Identifier, keine aufzulösenden URLs. Dokumentation-Link: `Link: <https://verspaetungsbegleiter.app/errors>; rel="describedby"` Header in allen 4xx/5xx Responses.

**Fehlerkatalog**

Vollständiger `type`-Wert: `urn:verspbegl:error:<slug>` (z. B. `urn:verspbegl:error:train-not-found`).

| Slug | Status | Auslöser |
|------|--------|----------|
| `malformed-request` | 400 | Ungültiges JSON oder fehlender Content-Type |
| `train-not-found` | 404 | Zugnummer ungültig oder fährt nicht |
| `journey-not-found` | 404 | journeyId unbekannt oder abgelaufen |
| `validation-error` | 422 | Fehlende oder ungültige Felder (mit `errors[]`) |
| `upstream-unavailable` | 503 | db.transport.rest nicht erreichbar |
| `rate-limit-exceeded` | 429 | Zu viele Anfragen |
| `capacity-exceeded` | 503 | MAX_ACTIVE_JOURNEYS-Cap erreicht |
| `idempotency-conflict` | 409 | Gleicher Idempotency-Key, anderer Request-Body |
| `internal-error` | 500 | Unerwarteter Server-Fehler |

**Kein 401/403:** API ist offen — keine Authentifizierung, keine Autorisierung. Diese Status-Codes werden nicht emittiert.

---

## Rate Limiting

Alle Responses:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 47
X-RateLimit-Reset: 1749600420
```

429-Response zusätzlich:

```
Retry-After: 30
```

**Client-Verhalten bei 429:** Exponentielles Backoff — erster Retry nach `Retry-After` Sekunden, danach `min(Retry-After × 2^n, 300)` Sekunden. Kein sofortiges Retry.

---

## Versionierung & Deprecation

- Aktuelle Version: `/v1/`
- Breaking Changes → `/v2/`, `/v1/` bleibt mindestens 6 Monate aktiv
- Deprecated Endpunkte: `Deprecation: true` + `Sunset: <date>` + `Link: </v2/...>; rel="successor-version"` Header (RFC 8594)
- API akzeptiert nur `application/json`; kein Content-Negotiation. Fehler: `application/problem+json`.

---

## V2 Roadmap (Endpunkte reserviert)

```
GET /v1/journeys/{id}/events     Server-Sent Events (SSE) — real-time push; Endpunkt-Name reserviert
PATCH /v1/journeys/{id}          Filter-Update ohne DELETE+POST — reserviert
```

---

## OpenAPI-Spezifikation

`openapi.yaml` liegt im Backend-Root (`backend/openapi.yaml`) und ist MVP-Pflichtlieferung. Validierung: `npx @redocly/cli lint openapi.yaml`.
