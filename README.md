# Generic HTTP Gateway (Fixed Port + Path Routing)

Reusable Caddy + Docker Compose template for the common case where firewall rules allow only one external port (for example `33001`) and you still need multiple internal services.

## What this gives you

- HTTP gateway on one fixed external port.
- Path-based routing to internal apps:
  - `/` -> `app1`
  - `/service2/*` -> `app2`
- Upstream apps are private to Docker network (not publicly exposed).
- Works for normal HTTP, SSE, and WebSockets behind the proxy.

## Files

- `docker-compose.yml`: gateway + two demo upstream services
- `Caddyfile`: HTTP listener and path routing rules
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
# app1 (default route)
curl "http://localhost:33001/"

# app2 (path-routed)
curl "http://localhost:33001/service2/health"
```

No certificate setup is needed in this HTTP-only template.

## Routing behavior

The key logic in `Caddyfile`:

- requests matching `/service2*` are sent to `app2`
- all other requests are sent to `app1`
- `/service2` prefix is stripped before forwarding to `app2`

If you add more services, create more `@matcher` + `handle` blocks.

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
