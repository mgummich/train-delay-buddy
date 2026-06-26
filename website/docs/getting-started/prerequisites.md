---
id: prerequisites
title: Prerequisites
sidebar_position: 1
---

# Prerequisites

Two paths: **Docker Compose** (recommended first-time) or **hybrid local** (infra in Docker, app on host — best for IDE debug + fast cycles).

## Docker Compose path

| Tool | Min | Check |
|------|-----|-------|
| Docker Engine | 24.0 | `docker --version` |
| Docker Compose | v2 (plugin) | `docker compose version` |

That's all — containers carry Go, Node, Postgres, Valkey.

## Local development

Plus, for the host-running services:

| Tool | Min | Check |
|------|-----|-------|
| Go | 1.25 | `go version` |
| Node.js | 22 LTS | `node --version` |
| npm | 10 | `npm --version` |

Use [`mise`](https://mise.jdx.dev/) or [`asdf`](https://asdf-vm.com/) to pin / switch versions.

## Network

The `db-vendo-client` HAFAS sidecar is bundled in Docker Compose — no external API key or outbound HTTPS to third-party endpoints required for local dev.

The sidecar itself reaches DB's upstream; ensure port 443 outbound is open from the Docker network.

Corporate proxy: set Docker daemon proxy + `HTTPS_PROXY`/`HTTP_PROXY` for the `hafas-proxy` container.

## Disk + memory

- **Disk:** ~1.5 GB after `docker compose build` (multi-stage pulls Go + Node toolchains).
- **RAM:** 1.5 GB comfortable. Caps: `backend 512 MB`, `valkey 300 MB`, `postgres 256 MB`, `nginx 128 MB`.

## Optional

- `httpie` / `curl` — API exploration.
- `jq` — JSON formatting.
- `psql` — direct DB access (dev mode forwards port).
- Modern PWA-capable browser (recent Chrome, Edge, Safari, Firefox).
