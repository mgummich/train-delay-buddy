---
id: security
title: Security
---

# Security

Security model, threat mitigations, and known limitations.

## Authentication model

The API has **no traditional user accounts or passwords.** Identity is established via a persistent device UUID (`X-Install-Id`), generated on first app launch and stored in IndexedDB with a localStorage fallback. This is device-scoped, not person-scoped — a single human using two devices has two install IDs.

This model is intentional: the app has no sign-up friction, no password store to leak, and no password-reset flows to abuse. Abuse is bounded by rate limiting and capacity caps rather than authentication.

## Journey ownership (IDOR prevention)

Every per-journey route (`GET /v1/journeys/{id}`, `DELETE`, `/summary`, `/legs`, `/alternatives`) enforces **ownership** via the `JourneyOwnership` middleware:

1. The middleware loads the journey from the store by ID.
2. It compares the request's `X-Install-Id` to the `install_id` recorded at journey creation.
3. On mismatch, or when the header is absent, it returns **404 Not Found** — never 403.

Returning 404 unconditionally means an attacker cannot confirm whether a journey ID exists for a different install, preventing enumeration. Journey IDs are ULIDs (~125 bits random), making brute-force infeasible, but the ownership check provides defence-in-depth if an ID is leaked via logs, referrers, or screenshots.

## Rate limiting

Two layers of rate limiting protect the API:

### Per-install limit
Controlled by `RATE_LIMIT_PER_INSTALL` (default 60 req/min). Applied when `X-Install-Id` is present.

### Per-IP fallback
Controlled by `RATE_LIMIT_PER_IP` (default 30 req/min). Applied when the install header is absent.

`X-Real-IP` (set by Nginx from `$remote_addr`) is trusted; `X-Forwarded-For` is never trusted because it is client-supplied and can be spoofed.

### Backend selection

In single-instance deployments, rate limits are enforced by an in-memory token-bucket (`golang.org/x/time/rate`). This is fast but **not shared across instances**.

In multi-instance deployments, the backend automatically switches to a **Valkey-backed fixed-window counter** when `VALKEY_URL` is set:

```
Lua INCR + EXPIRE atomic fixed-window (60 s)
  └─ Key: rl:install:<X-Install-Id>
     Key: rl:ip:<remote-ip>
```

The Valkey limiter fails open on backend error — a Valkey outage causes rate limits to be unenforced rather than locking out all users. Log and alert on `valkey_command_duration_seconds` p99 spikes to detect this.

## Idempotency key scoping

`Idempotency-Key` values are namespaced by install ID internally: the Valkey cache key is `installID:rawKey`. This prevents two different installs using the same client-chosen key from seeing each other's cached responses — which would otherwise disclose foreign journey IDs.

## CORS

`CORS_ALLOWED_ORIGINS` is an explicit allow-list (default empty — no cross-origin requests). When set, only listed origins receive CORS headers. `Vary: Origin` is set. `Access-Control-Allow-Credentials` is **not** set — the API does not use cookies.

## Security headers (Nginx)

Nginx applies the following headers on every response:

| Header | Value |
|--------|-------|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `no-referrer` |
| `Permissions-Policy` | camera, microphone, geolocation blocked |
| `Content-Security-Policy` | `default-src 'self'`; no inline scripts |

HSTS is intentionally omitted from Nginx — it should be set at the TLS terminator (Caddy, Traefik, Cloud LB), not at the application layer, because Nginx may serve plain HTTP behind the terminator.

## Container security posture

All production containers run with:

- **Non-root user** — backend as UID 10001 (`app`), nginx as `node`/non-root.
- **`cap_drop: ALL`** — no Linux capabilities unless explicitly added.
- **`no-new-privileges: true`** — prevents privilege escalation via setuid binaries.
- **`read_only: true`** on the backend container — root filesystem is read-only; `/tmp` is a `tmpfs` mount.
- **Pinned image tags** — `nginx:1.27-alpine`, `valkey/valkey:8-alpine`, `postgres:16.4-alpine`. Not digests, but avoids the floating `latest` risk.

See [Docker Compose layout](./configuration/docker-compose#security-posture-production-stack) for the full table.

## SAST in CI

The `.github/workflows/ci.yml` `sast` job runs on every push:

- **gitleaks** — secrets scan across full git history.
- **gosec** — Go SAST, severity HIGH+, SARIF upload to GitHub Code Scanning.
- **semgrep** — multi-ruleset: `p/default`, `p/security-audit`, `p/owasp-top-ten`, `p/dockerfile`, `p/secrets`.

## Known limitations and accepted risks

| Risk | Status | Mitigation |
|------|--------|-----------|
| No user authentication | Accepted | Rate limiting + ULID IDs + ownership check |
| In-memory rate limits bypass on multi-instance | Fixed | Valkey-backed `RedisLimiter` auto-selected when `VALKEY_URL` set |
| `X-Install-Id` is device-scoped, not person-scoped | Accepted by design | Not a security concern; no PII tied to the ID |
| No TLS at app layer | Accepted | TLS must be terminated upstream (Caddy/Traefik/LB) |
| `/metrics` blocked by Nginx but not the backend itself | Accepted | Internal network only; document in ops runbook |
| Floating minor image tags (no digest pinning) | Low | Automated rebuilds re-scan images; consider digest pinning for high-compliance environments |

## Reporting a vulnerability

Open a private GitHub security advisory at the repository's **Security** tab. Include: affected component, reproduction steps, and assessed impact. Critical findings will be addressed within 48 hours.
