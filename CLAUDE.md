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
curl "http://localhost:33001/"                  # routes to app1
curl "http://localhost:33001/service2/health"  # routes to app2
```

## Architecture

```
Internet → EXTERNAL_HTTP_PORT (33001)
              └── Caddy (gateway container)
                    ├── /service2/* → app2:APP2_PORT (33102), prefix stripped
                    └── /*          → app1:APP1_PORT (33101)
```

All containers communicate over a private Docker bridge network (`internal`). Only Caddy is exposed externally.

### Key files

- **`Caddyfile`** — All routing logic lives here. To add a new upstream, add a `@matcher` + `handle` block before the default catch-all.
- **`docker-compose.yml`** — Declares gateway, app1, app2 services. Upstream ports are injected via `.env`.
- **`.env.example`** — Port configuration template (`EXTERNAL_HTTP_PORT`, `APP1_PORT`, `APP2_PORT`).
- **`services/app{1,2}/server.js`** — Minimal Node.js demo upstreams (no deps). Replace or extend these with real applications.

### Extending the gateway

To add a third upstream service:
1. Add the service to `docker-compose.yml` on the `internal` network.
2. Add a path matcher and `handle` block to `Caddyfile` before the catch-all `handle`.
3. Add the port variable to `.env.example` and `.env`.

The Caddy config supports HTTP, SSE, and WebSocket proxying out of the box.
