---
id: prerequisites
title: Prerequisites
sidebar_position: 1
---

# Prerequisites

The project can be run two ways: **fully containerised** with Docker Compose (recommended for first-time setup) or **hybrid local** with the infrastructure in Docker and the application services running directly on your host (recommended for IDE debugging and faster build cycles).

## Required for Docker Compose path

| Tool | Minimum version | Check command |
|------|-----------------|---------------|
| Docker Engine | 24.0 | `docker --version` |
| Docker Compose | v2 (plugin) | `docker compose version` |

That is the full list. The containers carry their own Go, Node, Postgres, and Valkey runtimes.

## Required for local development

In addition to Docker (for Postgres and Valkey):

| Tool | Minimum version | Check command |
|------|-----------------|---------------|
| Go | 1.25 | `go version` |
| Node.js | 22 LTS | `node --version` |
| npm | 10 | `npm --version` |

Use [`mise`](https://mise.jdx.dev/) or [`asdf`](https://asdf-vm.com/) to pin and switch versions if you work across multiple projects.

## Network requirements

The backend calls the public HAFAS proxy at `https://v6.db.transport.rest`. No API key is needed, but your machine (or your Docker network) must be able to reach the internet over HTTPS port 443.

If you sit behind a corporate proxy, configure Docker's daemon proxy settings *and* the `HTTPS_PROXY` / `HTTP_PROXY` environment variables for the backend container.

## Disk and memory

- **Disk**: ~1.5 GB after `docker compose build` (multi-stage builders pull Go and Node toolchain images).
- **RAM**: 1.5 GB is comfortable. The hard caps are `backend: 512 MB`, `valkey: 300 MB`, `postgres: 256 MB`, `nginx: 128 MB`.

## Optional but recommended

- `httpie` or `curl` — exploring the API by hand.
- `jq` — formatting JSON responses.
- `psql` — direct database access during debugging (Docker Compose forwards the port in dev mode).
- A modern browser with PWA support (any recent Chrome, Edge, Safari, or Firefox).
