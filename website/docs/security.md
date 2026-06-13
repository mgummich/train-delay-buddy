---
id: security
title: Security
---

# Security

Security model, mitigations, known limits.

## Auth model

**No user accounts.** Identity via persistent device UUID (`X-Install-Id`), first-launch generated, IDB + localStorage fallback. Device-scoped, not person-scoped — one user, two devices, two IDs.

Intentional: no sign-up friction, no password store, no reset flows. Abuse bounded by rate limit + capacity caps instead.

## Journey ownership (IDOR prevention)

Per-journey routes enforce ownership via `JourneyOwnership` middleware:

1. Load journey by ID.
2. Compare request `X-Install-Id` against recorded `install_id`.
3. Mismatch or missing header → **404 Not Found** (never 403).

Unconditional 404 prevents enumeration. Journey IDs are ULIDs (~125 bits random) — brute force infeasible; ownership check is defence-in-depth if an ID leaks via logs/referrers/screenshots.

## Rate limit

### Per-install
`RATE_LIMIT_PER_INSTALL` (default 60 req/min). When `X-Install-Id` present.

### Per-IP fallback
`RATE_LIMIT_PER_IP` (default 30 req/min). When install header absent.

`X-Real-IP` (Nginx-set from `$remote_addr`) is trusted; `X-Forwarded-For` is never trusted (client-supplied, spoofable).

### Backend selection

Single-instance: in-memory token-bucket (`golang.org/x/time/rate`). Fast but **not shared**.

Multi-instance: auto-switches to **Valkey-backed fixed-window** when `VALKEY_URL` set:

```
Lua INCR + EXPIRE atomic fixed-window (60 s)
  └─ Key: rl:install:<X-Install-Id>
     Key: rl:ip:<remote-ip>
```

Valkey limiter **fails open** on error — outage means unenforced limits, not locked-out users. Alert on `valkey_command_duration_seconds` p99 to detect.

## Idempotency-key scoping

`Idempotency-Key` is namespaced by install ID internally: Valkey key is `installID:rawKey`. Prevents two installs with the same client-chosen key from seeing each other's cached responses (which would disclose foreign journey IDs).

## CORS

`CORS_ALLOWED_ORIGINS` is explicit allow-list (default empty — no cross-origin). When set, only listed origins get CORS headers. `Vary: Origin` set. `Access-Control-Allow-Credentials` **not set** — no cookies.

## Security headers (Nginx)

| Header | Value |
|--------|-------|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `no-referrer` |
| `Permissions-Policy` | camera, microphone, geolocation blocked |
| `Content-Security-Policy` | `default-src 'self'`; no inline scripts |

HSTS intentionally omitted from Nginx — set at TLS terminator (Caddy/Traefik/Cloud LB), not app layer (Nginx may serve plain HTTP behind the terminator).

## Container posture

All prod containers:

- **Non-root** — backend UID 10001 (`app`), nginx non-root.
- **`cap_drop: ALL`** — no capabilities unless re-added.
- **`no-new-privileges: true`** — blocks setuid escalation.
- **`read_only: true`** on backend — root fs read-only; `/tmp` is tmpfs.
- **Pinned tags** — `nginx:1.31.1-alpine` (in frontend image), `valkey/valkey:9.1.0-alpine3.23`, `postgres:18.4-alpine3.23`. Not digests, but avoids floating `latest`.

Full table: [Docker Compose layout → Security posture](./configuration/docker-compose#security-posture-production).

## SAST in CI

`sast` job on every push:

- **gitleaks** — secrets, full git history.
- **gosec** — Go SAST, HIGH+, SARIF → GitHub Code Scanning.
- **semgrep** — `p/default`, `p/security-audit`, `p/owasp-top-ten`, `p/dockerfile`, `p/secrets`.

## Known limits + accepted risks

| Risk | Status | Mitigation |
|------|--------|-----------|
| No user auth | Accepted | Rate limit + ULID + ownership |
| In-memory limit bypass on multi-instance | Fixed | Valkey `RedisLimiter` auto-selected when `VALKEY_URL` set |
| `X-Install-Id` device-scoped, not person-scoped | Accepted by design | No PII tied |
| No TLS at app layer | Accepted | TLS at terminator upstream |
| `/metrics` blocked by Nginx but not backend itself | Accepted | Internal network only — document in runbook |
| Floating minor tags (no digest pin) | Low | Auto-rebuilds rescan; digest-pin for high-compliance |

## Reporting

Open a private GitHub security advisory at the repo's **Security** tab. Include: component, repro, impact. Critical findings handled within 48 h.
