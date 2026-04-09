(() => {
  /**
   * This hub is intentionally dependency-free. It supports a small YAML subset:
   *
   * services:
   *   - id: app1
   *     name: App 1
   *     path: /service1/
   *     healthPath: /service1/health
   *
   * Only string scalars are supported. Quoted strings are allowed.
   */

  const CONFIG_PATH = "/services.yml";

  const elGrid = document.getElementById("grid");
  const elWarnings = document.getElementById("warnings");
  const elOverall = document.getElementById("overallStatus");
  const elRefresh = document.getElementById("refreshBtn");
  const elTabs = document.getElementById("tabs");

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function stripInlineComment(line) {
    // Very small helper: strips '#' comments when they appear after whitespace.
    // This is not a full YAML comment implementation; it's good enough for our simple config.
    const idx = line.indexOf(" #");
    if (idx >= 0) return line.slice(0, idx);
    return line;
  }

  function parseYamlServices(text) {
    const lines = text
      .replaceAll("\r\n", "\n")
      .replaceAll("\r", "\n")
      .split("\n");

    const out = { services: [] };
    let inServices = false;
    let current = null;

    for (let raw of lines) {
      raw = stripInlineComment(raw);
      if (!raw.trim()) continue;

      const line = raw.replace(/\t/g, "  ");
      const trimmed = line.trim();

      if (!inServices) {
        if (trimmed === "services:" || trimmed.startsWith("services:")) {
          inServices = true;
        }
        continue;
      }

      if (trimmed.startsWith("- ")) {
        if (current) out.services.push(current);
        current = {};
        const rest = trimmed.slice(2).trim();
        if (rest) {
          const [k, v] = rest.split(/:(.+)/).map((s) => s?.trim());
          if (k && v != null && v !== "") current[k] = parseYamlScalar(v);
        }
        continue;
      }

      const kv = trimmed.split(/:(.+)/);
      if (kv.length >= 2) {
        const key = kv[0].trim();
        const value = (kv[1] ?? "").trim();
        if (!current) current = {};
        current[key] = parseYamlScalar(value);
      }
    }

    if (current) out.services.push(current);

    if (!Array.isArray(out.services)) out.services = [];
    return out;
  }

  function parseYamlScalar(value) {
    // Only strings needed; allow quotes.
    const v = String(value ?? "").trim();
    if (!v) return "";
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      return v.slice(1, -1);
    }
    return v;
  }

  function isAbsoluteUrl(s) {
    const v = String(s ?? "").trim();
    return v.startsWith("http://") || v.startsWith("https://");
  }

  function parseCategories(raw) {
    const s = String(raw ?? "").trim();
    if (!s) return [];
    return s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }

  function categoryKey(label) {
    return String(label ?? "").trim().toLowerCase();
  }

  function serviceKey(svc) {
    return String(svc?.id || svc?.path || "");
  }

  function normalizePath(p) {
    if (!p) return "/";
    let s = String(p).trim();
    if (isAbsoluteUrl(s)) return s;
    if (!s.startsWith("/")) s = "/" + s;
    return s;
  }

  function tabLabelFromKey(key) {
    // Prefer config-provided label; this is only a fallback.
    return String(key)
      .split(/[-_]/g)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  function buildCategoryIndex(services) {
    const idx = new Map(); // key -> { key, label, services[] }
    let hasUncategorized = false;

    for (const svc of services) {
      const cats = parseCategories(svc.categories);
      if (!cats.length) hasUncategorized = true;
      for (const c of cats) {
        const k = categoryKey(c);
        if (!k) continue;
        if (!idx.has(k)) idx.set(k, { key: k, label: c, services: [] });
        idx.get(k).services.push(svc);
      }
    }

    return { idx, hasUncategorized };
  }

  function filterByCategory(services, selectedKey) {
    if (selectedKey === "all") return services;
    if (selectedKey === "uncategorized") {
      return services.filter((s) => parseCategories(s.categories).length === 0);
    }
    return services.filter((s) => parseCategories(s.categories).some((c) => categoryKey(c) === selectedKey));
  }

  function renderTabs({ services, categoryIndex, hasUncategorized, selectedKey }) {
    if (!elTabs) return;

    const uniqueCats = Array.from(categoryIndex.values()).sort((a, b) => a.key.localeCompare(b.key));
    const tabs = [
      { key: "all", label: "All", count: services.length },
      ...uniqueCats.map((c) => ({ key: c.key, label: c.label || tabLabelFromKey(c.key), count: c.services.length }))
    ];
    if (hasUncategorized) tabs.push({ key: "uncategorized", label: "Uncategorized", count: filterByCategory(services, "uncategorized").length });

    elTabs.innerHTML = tabs
      .map((t) => {
        const selected = t.key === selectedKey;
        return `<button class="tab" type="button" role="tab" aria-selected="${selected ? "true" : "false"}" data-tab="${escapeHtml(
          t.key
        )}">${escapeHtml(t.label)}<span class="tabCount">${t.count}</span></button>`;
      })
      .join("");
  }

  function tileTemplate(svc, status) {
    const title = escapeHtml(svc.name || svc.id || "Service");
    const desc = escapeHtml(svc.description || "");
    const path = normalizePath(svc.path || "/");
    const healthPath = svc.healthPath ? normalizePath(svc.healthPath) : "";
    const external = isAbsoluteUrl(path);

    const badgeClass = status?.kind || "warn";
    const badgeText = status?.label || "Unknown";
    const badgeTitle = status?.detail || "";

    const metaParts = [
      `<span class="badge ${badgeClass}" title="${escapeHtml(badgeTitle)}"><span class="dot"></span>${escapeHtml(
        badgeText
      )}</span>`,
      `<span><code>${escapeHtml(path)}</code></span>`
    ];
    if (healthPath) metaParts.push(`<span class="muted">health: <code>${escapeHtml(healthPath)}</code></span>`);

    const targetAttrs = external ? ` target="_blank" rel="noreferrer noopener"` : "";

    return `
      <a class="tile" href="${escapeHtml(path)}"${targetAttrs}>
        <div class="tileTop">
          <div class="tileTitle">${title}</div>
        </div>
        ${desc ? `<div class="tileDesc">${desc}</div>` : `<div class="tileDesc"></div>`}
        <div class="tileMeta">${metaParts.join("")}</div>
      </a>
    `;
  }

  async function fetchText(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  }

  async function validateService(svc, timeoutMs = 2500) {
    const started = performance.now();
    const healthPath = svc.healthPath ? normalizePath(svc.healthPath) : "";
    const path = normalizePath(svc.path || "/");

    // External links often can't be fetched due to browser CORS, and they
    // don't necessarily represent proxied services. Skip checks by default.
    if (isAbsoluteUrl(path) && !healthPath) {
      return { kind: "warn", label: "External", detail: "External link (no status check)" };
    }

    // Abort after timeout so a dead upstream doesn't hang the hub.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      if (healthPath) {
        const res = await fetch(healthPath, {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: controller.signal
        });
        const ms = Math.round(performance.now() - started);
        if (!res.ok) {
          return {
            kind: res.status >= 500 ? "bad" : "warn",
            label: `Health ${res.status}`,
            detail: `${healthPath} returned HTTP ${res.status} (${ms}ms)`
          };
        }

        let json = null;
        try {
          json = await res.json();
        } catch {
          return {
            kind: "warn",
            label: "Bad health JSON",
            detail: `${healthPath} returned non-JSON (${ms}ms)`
          };
        }

        // Optional stronger check: if upstream returns { app: "app1" } we can detect drift.
        if (svc.id && json && typeof json.app === "string" && json.app !== svc.id) {
          return {
            kind: "warn",
            label: "Mismatch",
            detail: `Health says app=${json.app}, expected ${svc.id} (${ms}ms)`
          };
        }

        return { kind: "good", label: `Up (${ms}ms)`, detail: `${healthPath} OK` };
      }

      // No healthPath: try HEAD first, then GET.
      let res = await fetch(path, { method: "HEAD", cache: "no-store", signal: controller.signal });
      if (res.status === 405) res = await fetch(path, { method: "GET", cache: "no-store", signal: controller.signal });

      const ms = Math.round(performance.now() - started);
      if (res.ok) return { kind: "good", label: `Up (${ms}ms)`, detail: `${path} reachable` };

      return {
        kind: res.status >= 500 ? "bad" : "warn",
        label: `HTTP ${res.status}`,
        detail: `${path} returned HTTP ${res.status} (${ms}ms)`
      };
    } catch (err) {
      const ms = Math.round(performance.now() - started);
      const msg = err?.name === "AbortError" ? "Timeout" : (err?.message || "Network error");
      return { kind: "bad", label: msg, detail: `${path} check failed (${ms}ms): ${msg}` };
    } finally {
      clearTimeout(timer);
    }
  }

  function renderWarnings(warnings) {
    if (!warnings.length) {
      elWarnings.innerHTML = "";
      return;
    }

    elWarnings.innerHTML = warnings
      .map(
        (w) => `
        <div class="warning">
          <div>⚠</div>
          <div>
            <div><strong>${escapeHtml(w.name)}</strong> — ${escapeHtml(w.label)}</div>
            <div class="tileDesc">${escapeHtml(w.detail)}</div>
          </div>
        </div>
      `
      )
      .join("");
  }

  async function loadAndRender() {
    elOverall.textContent = "Loading config…";
    const configText = await fetchText(CONFIG_PATH);
    const parsed = parseYamlServices(configText);
    const services = (parsed.services || []).filter((s) => s && (s.id || s.name || s.path));

    if (!services.length) {
      elGrid.innerHTML = `<div class="tileDesc">No services found in <code>${escapeHtml(
        CONFIG_PATH
      )}</code>.</div>`;
      elOverall.textContent = "No services configured.";
      return;
    }

    const statusCache = new Map(); // serviceKey -> status
    const { idx: categoryIndex, hasUncategorized } = buildCategoryIndex(services);
    let selectedKey = "all";

    function renderSelected() {
      const visible = filterByCategory(services, selectedKey);
      renderTabs({ services, categoryIndex, hasUncategorized, selectedKey });

      if (!visible.length) {
        elGrid.innerHTML = `<div class="tileDesc">No services in this category.</div>`;
        renderWarnings([]);
        elOverall.textContent = `Status: 0/0 up.`;
        return;
      }

      // Render visible tiles using cached statuses if present.
      elGrid.innerHTML = visible
        .map((svc) => {
          const key = serviceKey(svc);
          const st = statusCache.get(key) || { kind: "warn", label: "Checking…" };
          return tileTemplate(svc, st);
        })
        .join("");

      elOverall.textContent = `Showing ${visible.length}/${services.length}. Checking status…`;

      // Validate only the visible services.
      validateVisible(visible).catch(() => {
        // Non-fatal: tile badges will show errors per-service.
      });
    }

    async function validateVisible(visibleServices) {
      const concurrency = 6;
      const statuses = new Array(visibleServices.length);
      let idx2 = 0;

      async function worker() {
        while (idx2 < visibleServices.length) {
          const i = idx2++;
          const svc = visibleServices[i];
          const st = await validateService(svc);
          statuses[i] = st;
          statusCache.set(serviceKey(svc), st);

          // Update tile in-place if still visible and order unchanged.
          const tile = elGrid.children[i];
          if (tile) tile.outerHTML = tileTemplate(svc, st);
        }
      }

      await Promise.all(Array.from({ length: Math.min(concurrency, visibleServices.length) }, () => worker()));

      const warnings = visibleServices
        .map((svc, i) => ({ svc, st: statuses[i] }))
        .filter((x) => x.st && x.st.kind !== "good")
        .map((x) => ({
          name: x.svc.name || x.svc.id || "Service",
          label: x.st.label,
          detail: x.st.detail
        }));
      renderWarnings(warnings);

      const upCount = statuses.filter((s) => s && s.kind === "good").length;
      elOverall.textContent = `Status: ${upCount}/${visibleServices.length} up. (Showing ${visibleServices.length}/${services.length})`;
    }

    function attachTabHandlers() {
      if (!elTabs) return;
      elTabs.addEventListener("click", (e) => {
        const btn = e.target?.closest?.("button[data-tab]");
        const key = btn?.getAttribute?.("data-tab");
        if (!key) return;
        selectedKey = key;
        renderSelected();
      });
    }

    attachTabHandlers();
    renderSelected();
  }

  async function main() {
    try {
      await loadAndRender();
    } catch (err) {
      elOverall.textContent = "Failed to load hub config.";
      elWarnings.innerHTML = `
        <div class="warning">
          <div>⚠</div>
          <div>
            <div><strong>Hub error</strong> — could not load <code>${escapeHtml(CONFIG_PATH)}</code></div>
            <div class="tileDesc">${escapeHtml(err?.message || String(err))}</div>
          </div>
        </div>
      `;
    }
  }

  elRefresh?.addEventListener("click", () => {
    main();
  });

  main();
})();

