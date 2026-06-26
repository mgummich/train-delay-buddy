---
id: troubleshooting
title: Troubleshooting
---

# Troubleshooting

Symptoms grouped by where they surface. Each entry: what you see → what is happening → what to do.

## Startup

### `docker compose up`: "port already allocated"

```bash
lsof -i :80 -i :5173 -i :8080 -i :5432 -i :6379
```

Stop the conflicting process or remap in `docker-compose.override.yml`.

### `docker compose up`: "POSTGRES_PASSWORD required"

```bash
cp .env.example .env
$EDITOR .env     # set POSTGRES_PASSWORD
docker compose up -d
```

### Backend exits with `migration failed`

Compose logs show the failing file. Migrations run in transactions — no partial state.

- **Bad new migration:** edit, save, restart.
- **Conflicts existing data:** manually patch. See [Database → Migrations](./database#migrations).

### Backend exits: "dial tcp: connect: connection refused"

Dependency not ready. With `depends_on.condition: service_healthy` this shouldn't happen, but a slow Postgres start can time out:

```yaml
backend:
  healthcheck:
    start_period: 30s   # was 15s
```

## Runtime

### Frontend blank screen

1. Devtools → **Console** for module import / TanStack Query errors.
2. **Network** for failed `/v1/*` requests:
   - Backend down (`curl http://localhost:8080/health`).
   - Wrong port (use `:5173` in dev, not `:8080`).
   - CORS — set `CORS_ALLOWED_ORIGINS`.
3. **Application → Service Workers → Unregister.** Stale SW serves broken cached `index.html` after botched deploy.

### "API error: not-found" for a journey that should exist

GCed by janitor (TTL) or terminated in another tab. Frontend reads `journeyId` from `localStorage` — survives reloads, backend journey doesn't survive `JOURNEY_TTL_HOURS` of inactivity.

Frontend should clear persistent state on 404. To inspect:

```sql
SELECT id, terminated_at, last_polled_at FROM journeys WHERE id = 'jrn_...';
```

### Stations autocomplete empty

Valkey may be cold and HAFAS slow/unavailable:

```bash
curl 'http://localhost:8080/v1/stations?q=Berlin'
# Check the sidecar directly (port exposed in dev override):
curl 'http://localhost:3000/locations?query=Berlin&results=3' | head -c 200
```

Upstream issue if the sidecar itself fails — check `docker compose logs hafas-proxy`.

### `summary.status: INFEASIBLE`

Real, user-visible state — show it. Causes: destination no longer reachable, filters too tight (e.g. `safetyLevel=high` + `maxTransfers=1`), incomplete HAFAS data. Inspect via `GET /v1/journeys/{id}`.

### Live data stale (`summary.dataConfidence === "low"`)

1. `/readyz` — is the HAFAS circuit breaker open?
2. Backend logs for `poller_errors_total` increments.
3. Curl the sidecar directly (port 3000 exposed in dev override):

   ```bash
   curl 'http://localhost:3000/trips/<tripId>?stopovers=true' | jq '.trip.stopovers[0].arrival'
   ```

   No realtime fields → genuinely unavailable upstream.

## HAFAS

### `urn:verspbegl:error:hafas-unavailable`

Circuit breaker open (`/readyz` → `hafas.state = circuit-open`). Reads (cached) still work; writes needing fresh data (`POST /v1/journeys`) fail with this URN. Breaker probes every `HAFAS_CB_PROBE_INTERVAL` (default 30 s). If open >few minutes, check `docker compose logs hafas-proxy` and curl `http://localhost:3000/locations?query=Berlin&results=1` directly.

### HAFAS slow but not down

Symptoms: high `hafas_request_duration_seconds` p99, queue near max, occasional `503 at capacity`. Mitigations in order:

1. `HAFAS_REQUEST_TIMEOUT=15s` — slow > failure.
2. `HAFAS_WORKER_POOL_SIZE=100` — watch upstream rate limits.
3. `HAFAS_QUEUE_DEPTH=400`.
4. The project already bundles `db-vendo-client` as `hafas-proxy` — restart it: `docker compose restart hafas-proxy`.

## CORS / Networking

### `CORS policy: No 'Access-Control-Allow-Origin'`

Frontend hitting backend on a different origin not in `CORS_ALLOWED_ORIGINS`:

- **Local dev:** use `:5173`, not `:8080`. Vite proxy makes requests same-origin.
- **Prod:** `CORS_ALLOWED_ORIGINS=https://app.example.com` (comma-sep multiple).

### `/v1/*` returns 404 from Nginx

`location /v1/` didn't match. Check `nginx/nginx.conf`:

```nginx
location /v1/ {
    proxy_pass http://backend:8080;
}
```

`proxy_pass` ending `;` (not `/;`) preserves the path. Restart: `docker compose restart nginx`.

## Database

### "too many connections"

```sql
SHOW max_connections;
SELECT count(*) FROM pg_stat_activity WHERE datname = 'vbb';
```

If `count > DB_MAX_OPEN_CONNS`, something leaks — find the long-running query:

```sql
SELECT pid, query, query_start FROM pg_stat_activity
WHERE datname = 'vbb' AND state = 'active'
ORDER BY query_start;
```

Otherwise tune Postgres `max_connections` up or `DB_MAX_OPEN_CONNS` down.

### `tx commit: read only`

Connected to a read replica by mistake. Verify `DATABASE_URL` → primary.

## Build / CI

### TypeScript types out of sync with `openapi.yaml`

```bash
cd frontend
npm run codegen:check   # CI runs this; fails on drift
npm run codegen
git add src/api/types.gen.ts ../backend/openapi.yaml
git commit -m "chore(api): sync generated TypeScript types"
```

### `tsc` fails after a backend OpenAPI change

Expected — generated types changed, call sites haven't. Errors point to moved fields. See [Codegen](./development/codegen).

### `docker compose build` fails on `RUN npm ci`

Stale `package-lock.json`:

```bash
cd frontend
rm -rf node_modules
npm install
```

Commit the new lockfile.

### CI fails on `npm run codegen:check`

Changed `openapi.yaml` without regenerating. Run `npm run codegen`, commit `types.gen.ts`.

## Resetting state

### All local data

```bash
docker compose down -v   # -v drops postgres_data
docker compose up -d
```

### Only frontend persisted state

Devtools → **Application → Storage → Clear site data.** Or:

```js
indexedDB.databases().then(dbs => dbs.forEach(db => indexedDB.deleteDatabase(db.name)));
localStorage.clear();
location.reload();
```

### Service worker cache

Devtools → **Application → Service Workers → Unregister.** Hard reload (Ctrl/Cmd+Shift+R).
