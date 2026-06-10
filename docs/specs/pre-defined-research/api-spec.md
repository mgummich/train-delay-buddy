# API-Spezifikation

## Prinzipien

- REST, ressourcenorientiert — keine Verben in URIs
- URI-Versionierung: `/v1/`
- Alle Fehler: `application/problem+json` (RFC 7807)
- Abuse-Shaping via API-Key (`Authorization: Bearer <key>`) + IP-Rate-Limiting — kein echter Auth, Key liegt im Public Bundle
- Stationen immer als HAFAS-ID (z. B. `8000105`), nie als Namensstring
- ETag + `If-None-Match` für cachefähige Poll-Endpunkte

---

## Endpunkte

```
POST   /v1/journeys                       Journey anlegen, Alternativen berechnen
GET    /v1/journeys/{id}                  Vollständige Journey (Summary + Legs)
GET    /v1/journeys/{id}/summary          Kompakter Status (ETag-gecacht, schneller Poll-Pfad)
GET    /v1/journeys/{id}/details          Leg/Stop-Deltas (ETag-gecacht)
DELETE /v1/journeys/{id}                  Monitoring beenden, Poller-Goroutine abbrechen
POST   /v1/journeys/{id}/alternatives     Alternativen für aktive Journey neu berechnen
GET    /v1/trains/{number}                Zugnummer validieren, Metadaten zurückgeben
```

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
- `plausibility.onTrainConfidence`: `"high"` | `"low"` | `"unknown"` — Frontend zeigt Bestätigungsdialog wenn nicht `"high"`

**Idempotenz**: optionaler Header `Idempotency-Key: <UUID>`. Gleicher Key innerhalb 10 Minuten → bestehende Journey zurückgeben statt neue anlegen.

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

---

## Fehlerformat (RFC 7807)

Alle 4xx/5xx: `Content-Type: application/problem+json`

```json
{
  "type": "https://verspaetungsbegleiter.app/errors/train-not-found",
  "title": "Train Not Found",
  "status": 404,
  "detail": "Train ICE 123 does not operate on 2026-06-10.",
  "instance": "/v1/trains/ICE123"
}
```

**Fehlerkatalog**

| `type`-Slug | Status | Auslöser |
|------------|--------|----------|
| `train-not-found` | 404 | Zugnummer ungültig oder fährt nicht |
| `journey-not-found` | 404 | journeyId unbekannt oder abgelaufen |
| `validation-error` | 422 | Fehlende oder ungültige Felder |
| `upstream-unavailable` | 503 | db.transport.rest nicht erreichbar |
| `rate-limit-exceeded` | 429 | Zu viele Anfragen |

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

---

## Versionierung & Deprecation

- Aktuelle Version: `/v1/`
- Breaking Changes → `/v2/`, `/v1/` bleibt mindestens 6 Monate aktiv
- Deprecated Endpunkte: `Deprecation: true` + `Sunset: <date>` Header

---

## OpenAPI-Spezifikation

`openapi.yaml` liegt im Backend-Root (`backend/openapi.yaml`) und ist MVP-Pflichtlieferung. Validierung: `npx @redocly/cli lint openapi.yaml`.
