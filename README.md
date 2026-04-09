# Generic HTTP Gateway (Fixed Port + Path Routing)

Reusable Caddy + Docker Compose template for the common case where firewall rules allow only one external port (for example `33001`) and you still need multiple internal services.

## What this gives you

- HTTP gateway on one fixed external port.
- Path-based routing to internal apps:
  - `/` -> hub landing page (static)
  - `/service1/*` -> `app1`
  - `/service2/*` -> `app2`
- Upstream apps are private to Docker network (not publicly exposed).
- Works for normal HTTP, SSE, and WebSockets behind the proxy.

## Files

- `docker-compose.yml`: gateway + two demo upstream services
- `Caddyfile`: HTTP listener and path routing rules
- `hub/`: static landing page + service catalog (`services.yml`)
- `.env.example`: configurable ports
- `services/app1`, `services/app2`: tiny demo HTTP apps

## Quick start

1. Create your local env file:

```bash
cp .env.example .env
```

2. Start everything:

```bash
docker compose up --build -d
```

3. Check services via HTTP:

```bash
# hub landing page
curl "http://localhost:33001/"

# app1 (path-routed)
curl "http://localhost:33001/service1/health"

# app2 (path-routed)
curl "http://localhost:33001/service2/health"
```

No certificate setup is needed in this HTTP-only template.

## Routing behavior

The key logic in `Caddyfile`:

- `/` serves the hub static files (from `hub/`)
- requests matching `/service1*` are sent to `app1`
- requests matching `/service2*` are sent to `app2`
- `/service1` and `/service2` prefixes are stripped before forwarding upstream
- `/service2` prefix is stripped before forwarding to `app2`

If you add more services, create more `@matcher` + `handle` blocks.

## Hub service catalog (`hub/services.yml`)

Tiles shown on the hub page come from `hub/services.yml` (YAML).

Optional **branding** for the landing page lives in the same file under a top-level `hub:` block:

- `title` — browser tab title and main header
- `tagline` — subtitle under the title in the top bar
- `description` — longer intro text above the service tiles; use a YAML block scalar (`description: |`) for multiple lines

```yaml
hub:
  title: SmartOps Hub
  tagline: Efficiency starts with the smallest workflows.
  description: |
    One or more lines of text.

services:
  - id: app1
    name: App 1
    path: /service1/
```

If `hub:` is omitted, the page uses the default title and tagline and hides the description block.

- The hub does **not** generate or modify `Caddyfile`.
- To help catch drift, the hub performs lightweight runtime checks (prefers `healthPath` if provided) and shows a warning badge/banner if a tile looks out-of-sync with routing or an upstream is down.
- You can also add **external or direct internal links** by setting `path` to an absolute URL (like `https://github.com/...` or `http://internal-tool.local/...`). By default, those links are **not health-checked** (to avoid CORS issues and because they may not be proxied).
- You can organize tiles into **categories** using a comma-separated `categories` field (a service can be in multiple categories). The hub will render tabs (including **All** and **Uncategorized**) and will only run status checks for tiles visible in the selected tab.

### Caching notes

- `services.yml` is served with `Cache-Control: no-store` so changes show up immediately on refresh.
- `*.css` and `*.js` are served with a short cache (`max-age=3600`) for snappier reloads.

## Use with PM2 apps (without Docker upstreams)

You can keep Caddy in Docker and point to host services, or run all on host.
For PM2-managed apps, run each app on its own internal port (for example `127.0.0.1:33101`, `127.0.0.1:33102`) and update `reverse_proxy` targets in `Caddyfile`.

## Stop stack

```bash
docker compose down
```

## Troubleshooting

- Port already in use:
  - Change `EXTERNAL_HTTP_PORT` in `.env`, or free the port.
- Route mismatch:
  - Check `docker compose logs gateway` for routing/proxy errors.
