# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

A reusable Caddy + Docker Compose template for running a unified HTTP gateway on a single external port (default: `33001`) with path-based routing to multiple internal upstream services. Designed for environments where firewall rules restrict external access to one port.

## Commands

```bash
# Start everything
cp .env.example .env          # first time only
docker compose up --build -d

# Inspect logs
docker compose logs gateway   # proxy/routing issues
docker compose logs app1
docker compose logs app2

# Stop
docker compose down

# Smoke test
curl "http://localhost:33001/"                   # hub landing page (static)
curl "http://localhost:33001/service1/health"   # routes to app1
curl "http://localhost:33001/service2/health"   # routes to app2
curl "http://localhost:33001/wnm/"              # routes to host-process upstream
```

## Architecture

```
Internet → EXTERNAL_HTTP_PORT (33001)
              └── Caddy (gateway container)
                    ├── /service1/* → app1:APP1_PORT (33101), prefix stripped
                    ├── /service2/* → app2:APP2_PORT (33102), prefix stripped
                    ├── /wnm/*      → WNM_UPSTREAM (host process), prefix stripped
                    └── /           → hub/ static files (file_server)
```

All containers communicate over a private Docker bridge network (`internal`). Only Caddy is exposed externally.

### Key files

- **`Caddyfile`** — All routing logic. Each route is a `@matcher` + `handle` block; the `file_server` catch-all at the end serves the hub. Caddy substitutes `{$VAR}` from the container environment at runtime.
- **`docker-compose.yml`** — gateway, app1, app2 services. Upstream ports and WNM vars injected from `.env`. The gateway uses `extra_hosts: host.docker.internal:host-gateway` to reach host-process upstreams.
- **`.env.example`** — Port config (`EXTERNAL_HTTP_PORT`, `APP1_PORT`, `APP2_PORT`) and host-proxy vars (`WNM_UPSTREAM`, `WNM_HOST_HEADER`).
- **`hub/index.html`** + **`hub/hub.js`** — Dependency-free vanilla JS landing page. Reads `hub/services.yml` at runtime; no build step.
- **`hub/services.yml`** — Service catalog (tile definitions) and optional hub branding (`hub.title`, `hub.tagline`, `hub.description`). Served with `Cache-Control: no-store` so changes appear on refresh.
- **`services/app{1,2}/server.js`** — Minimal Node.js demo upstreams. Each exposes `GET /health` → `{ status, app, time }` and a catch-all echo route.

### Hub service catalog (`hub/services.yml`)

Each tile entry supports: `id`, `name`, `description`, `path` (proxied path or absolute URL), `healthPath` (optional health-check URL), `categories` (comma-separated). External/direct URLs (`https://…`, `http://…`) are not health-checked by default.

### Extending the gateway

To add a new Docker upstream:
1. Add the service to `docker-compose.yml` on the `internal` network.
2. Add a `@matcher` + `handle` block in `Caddyfile` before the `file_server` line.
3. Add port/env vars to `.env.example` and `.env`.
4. Add a tile to `hub/services.yml`.

To proxy a host-process (non-Docker) upstream, follow the `/wnm` pattern: set `WNM_UPSTREAM` (host:port reachable from the container) and `WNM_HOST_HEADER` (Host header the upstream expects).

The Caddy config supports HTTP, SSE, and WebSocket proxying out of the box.
