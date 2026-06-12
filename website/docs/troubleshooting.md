---
id: troubleshooting
title: Troubleshooting
---

# Troubleshooting

Symptoms grouped by where they surface. Each entry: what you see → what is happening → what to do.

## Startup and boot

### `docker compose up` fails with "port already allocated"

Another process is using one of the ports the stack binds.

```bash
lsof -i :80 -i :5173 -i :8080 -i :5432 -i :6379
```

Either stop the conflicting process or remap ports in `docker-compose.override.yml`.

### `docker compose up` fails with "POSTGRES_PASSWORD required"

The required-variable enforcement in the Compose file caught a missing env. Fix:

```bash
cp .env.example .env
$EDITOR .env     # set POSTGRES_PASSWORD
docker compose up -d
```

### Backend exits immediately with `migration failed`

A SQL migration could not apply. Compose logs show the failing file. Two paths:

- **A bad new migration you just wrote** — edit it, save, restart. (Migrations run in transactions, so partial state is impossible.)
- **A migration that conflicts with existing data** — you may need to manually patch the DB. See [Database → Migrations](./database#migrations) for conventions.

### Backend exits with "dial tcp: connect: connection refused"

The backend started before its dependency was ready. With Compose `depends_on.condition: service_healthy`, this should never happen — but a slow Postgres start can still time out. Bump `start_period`:

```yaml
backend:
  healthcheck:
    start_period: 30s   # was 15s
```

## Runtime

### Frontend shows a blank screen

1. Open browser devtools → **Console**. Errors there usually point to a module import failure or a TanStack Query error boundary.
2. Open **Network**. Look for failed requests to `/v1/*`. Common causes:
   - Backend not running (`curl http://localhost:8080/health` to verify).
   - Wrong port (use `:5173` in dev, not `:8080`).
   - CORS failure (look for missing `Access-Control-Allow-Origin` — set `CORS_ALLOWED_ORIGINS`).
3. Clear the service worker: devtools → **Application** → **Service Workers** → **Unregister**. Stale SW can serve a broken cached `index.html` after a botched deploy.

### Frontend shows "API error: not-found" for a journey that should exist

The journey was GCed by the janitor (TTL expired) or terminated by another tab. The frontend reads `journeyId` from `localStorage` — it survives reloads, but the backend journey it points to does not survive past `JOURNEY_TTL_HOURS` of inactivity.

Solution: the frontend should detect 404 on the journey endpoint and clear the persistent state. If you see this happening at the wrong time, check the `last_polled_at` in Postgres:

```sql
SELECT id, terminated_at, last_polled_at FROM journeys WHERE id = 'jrn_...';
```

### Stations autocomplete is empty

The Redis cache may be empty and HAFAS may be slow or unavailable. Verify:

```bash
curl 'http://localhost:8080/v1/stations?q=Berlin'
curl 'https://v6.db.transport.rest/stations?query=Berlin' | head -c 200
```

If the public HAFAS proxy itself is unreachable, the issue is upstream.

### `summary.status: INFEASIBLE`

The backend cannot find a route that reaches the destination given the realtime data. This is a real, user-visible state — show it.

Common causes:

- The user's destination is no longer reachable from their current position (e.g. last connecting train left).
- The filters are too restrictive (e.g. `safetyLevel=high` combined with `maxTransfers=1`).
- HAFAS is returning incomplete data.

Inspect the journey via `GET /v1/journeys/{id}` to see the full leg state.

### Live data is stale

If `summary.dataConfidence === "low"` for a journey that should have realtime data:

1. Check `/readyz` — is the HAFAS circuit breaker open?
2. Check the backend logs for `poller_errors_total` increments.
3. Curl HAFAS directly for the trip:

   ```bash
   curl 'https://v6.db.transport.rest/trips/<tripId>' | jq '.realtime'
   ```

   If the proxy returns no realtime fields, the data is genuinely unavailable upstream.

## HAFAS

### `urn:verspbegl:error:hafas-unavailable`

The circuit breaker is open. `/readyz` will report `hafas.state = circuit-open`. Backend behaviour:

- Reads (cached state) still work.
- Writes that need fresh HAFAS data (`POST /v1/journeys`) fail with this URN.

The breaker will probe HAFAS every `HAFAS_CB_PROBE_INTERVAL` (default 30 s) and reset itself on the first success. If it stays open for more than a few minutes, check `https://v6.db.transport.rest` directly — the public proxy itself may be down.

### HAFAS is slow but not down

Symptoms: high `hafas_request_duration_seconds` p99, queue depth near max, occasional `503 at capacity`.

Mitigations, in order of preference:

1. **Increase the request timeout**: `HAFAS_REQUEST_TIMEOUT=15s`. A slow response is better than a failure.
2. **Increase the worker pool**: `HAFAS_WORKER_POOL_SIZE=100`. Caution: the public proxy may impose its own rate limits.
3. **Increase queue depth**: `HAFAS_QUEUE_DEPTH=400`.
4. **Run your own HAFAS proxy**: see `https://github.com/derhuerst/db-rest` for the source.

## Networking and CORS

### `CORS policy: No 'Access-Control-Allow-Origin'`

The frontend is calling the backend on a different origin and `CORS_ALLOWED_ORIGINS` does not include it. Two fixes:

- **Local dev**: open the app at `:5173`, not `:8080` directly. The Vite proxy makes requests same-origin.
- **Different domain in prod**: set `CORS_ALLOWED_ORIGINS=https://app.example.com` (comma-separated for multiple).

### Requests to `/v1/*` return 404 from Nginx

Nginx's `location /v1/` rule didn't match. Check `nginx/nginx.conf`:

```nginx
location /v1/ {
    proxy_pass http://backend:8080;
}
```

`proxy_pass` ending in `;` (not `/;`) preserves the path. If you changed the rule, restart nginx: `docker compose restart nginx`.

## Database

### "too many connections"

```sql
SHOW max_connections;
SELECT count(*) FROM pg_stat_activity WHERE datname = 'vbb';
```

If `count > DB_MAX_OPEN_CONNS`, something is leaking — likely a long-running query holding a connection. Inspect:

```sql
SELECT pid, query, query_start FROM pg_stat_activity
WHERE datname = 'vbb' AND state = 'active'
ORDER BY query_start;
```

Otherwise, tune Postgres's `max_connections` upward, or `DB_MAX_OPEN_CONNS` downward.

### `tx commit: read only`

Backend is connected to a Postgres read replica by mistake. Verify `DATABASE_URL` points at the primary.

## Build and CI

### TypeScript types are out of sync with `openapi.yaml`

```bash
cd frontend
npm run codegen:check   # CI runs this; fails if drift detected
npm run codegen         # regenerate
git add src/api/types.gen.ts ../backend/openapi.yaml
git commit -m "chore(api): sync generated TypeScript types"
```

### `tsc` fails after a backend OpenAPI change

Expected — the generated types changed and your call sites haven't caught up. Walk through each error: it tells you exactly which field or operation moved. See [Codegen](./development/codegen) for the full workflow.

### `docker compose build` fails on `RUN npm ci`

Stale `package-lock.json`. Regenerate:

```bash
cd frontend
rm -rf node_modules
npm install
```

Commit the new `package-lock.json`.

### CI fails on `npm run codegen:check`

You changed `openapi.yaml` without regenerating types. See [Codegen](./development/codegen). Run `npm run codegen`, commit `types.gen.ts`.

## Resetting state

### Reset all local data

```bash
docker compose down -v   # -v drops the postgres_data named volume
docker compose up -d     # fresh DB, migrations re-applied
```

### Reset only the frontend's persisted state

In browser devtools → **Application** → **Storage** → **Clear site data**.

Or, programmatically in the JS console:

```js
indexedDB.databases().then(dbs => dbs.forEach(db => indexedDB.deleteDatabase(db.name)));
localStorage.clear();
location.reload();
```

### Clear the service worker cache

Browser devtools → **Application** → **Service Workers** → **Unregister**, then hard reload (Ctrl/Cmd+Shift+R).
