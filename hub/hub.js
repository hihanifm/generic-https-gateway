(() => {
  /**
   * This hub is intentionally dependency-free. It supports a small YAML subset:
   *
   * hub:
   *   title: My Hub
   *   tagline: Short subtitle
   *   description: |
   *     Multi-line text (block scalar)
   *
   * services:
   *   - id: app1
   *     name: App 1
   *     path: /service1/
   *     healthPath: /service1/health
   *
   * Only string scalars are supported (plus hub.description as | block). Quoted strings are allowed.
   */

  const CONFIG_PATH = "/services.yml";
  const DEFAULT_HUB_TITLE = "Gateway";
  const DEFAULT_HUB_TAGLINE = "Choose a service";
  const THEME_STORAGE_KEY = "hub-theme";

  const elGrid = document.getElementById("grid");
  const elWarnings = document.getElementById("warnings");
  const elOverall = document.getElementById("overallStatus");
  const elRefresh = document.getElementById("refreshBtn");
  const elTabs = document.getElementById("tabs");
  const elHubTitle = document.getElementById("hubTitle");
  const elHubTagline = document.getElementById("hubTagline");
  const elHubDescription = document.getElementById("hubDescription");
  const elHubDescriptionWrap = document.getElementById("hubDescriptionWrap");

  function getStoredTheme() {
    try {
      const v = localStorage.getItem(THEME_STORAGE_KEY);
      if (v === "light" || v === "dark") return v;
    } catch (_) {}
    return null;
  }

  function preferredTheme() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function resolveTheme() {
    return getStoredTheme() ?? preferredTheme();
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const light = document.getElementById("themeLight");
    const dark = document.getElementById("themeDark");
    if (light) light.checked = theme === "light";
    if (dark) dark.checked = theme === "dark";
  }

  function initTheme() {
    applyTheme(resolveTheme());

    document.querySelectorAll('input[name="hub-theme"]').forEach((input) => {
      input.addEventListener("change", () => {
        if (!input.checked) return;
        const v = input.value;
        if (v !== "light" && v !== "dark") return;
        try {
          localStorage.setItem(THEME_STORAGE_KEY, v);
        } catch (_) {}
        applyTheme(v);
      });
    });

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", () => {
      if (getStoredTheme() !== null) return;
      applyTheme(mq.matches ? "dark" : "light");
    });
  }

  initTheme();

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

  function lineIndent(line) {
    const m = String(line).match(/^(\s*)/);
    return m ? m[1].length : 0;
  }

  function dedentBlockScalar(rawLines) {
    const nonempty = rawLines.filter((l) => String(l).trim() !== "");
    if (nonempty.length === 0) return "";
    let min = Infinity;
    for (const l of nonempty) {
      const ind = lineIndent(l);
      if (ind < min) min = ind;
    }
    const dedented = rawLines.map((l) => {
      if (String(l).trim() === "") return "";
      return l.length >= min ? l.slice(min) : String(l).trimEnd();
    });
    return dedented.join("\n").replace(/\n+$/, "");
  }

  function parseHubYaml(text) {
    const rawLines = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
    const lines = rawLines.map((raw) => stripInlineComment(raw).replace(/\t/g, "  "));

    const hub = {};
    const services = [];
    let mode = "top"; // top, hub, hub_desc, services
    let hubKeyIndent = 0;
    let descRawLines = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();
      const indent = lineIndent(line);

      if (mode === "top") {
        if (!trimmed) {
          i++;
          continue;
        }
        if (trimmed === "hub:" || trimmed.startsWith("hub:")) {
          mode = "hub";
          i++;
          continue;
        }
        if (trimmed === "services:" || trimmed.startsWith("services:")) {
          mode = "services";
          break;
        }
        i++;
        continue;
      }

      if (mode === "hub") {
        if (!trimmed) {
          i++;
          continue;
        }
        if (indent === 0 && (trimmed === "services:" || trimmed.startsWith("services:"))) {
          mode = "services";
          break;
        }
        const hm = trimmed.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
        if (hm) {
          const key = hm[1];
          const rest = hm[2].trim();
          if (key === "description" && (rest === "|" || rest === "|-" || rest === "|+")) {
            hubKeyIndent = indent;
            mode = "hub_desc";
            descRawLines = [];
            i++;
            continue;
          }
          if (rest) hub[key] = parseYamlScalar(rest);
        }
        i++;
        continue;
      }

      if (mode === "hub_desc") {
        if (trimmed === "") {
          descRawLines.push("");
          i++;
          continue;
        }
        if (indent === 0 && (trimmed === "services:" || trimmed.startsWith("services:"))) {
          hub.description = dedentBlockScalar(descRawLines);
          mode = "services";
          break;
        }
        if (indent <= hubKeyIndent && /^[a-zA-Z0-9_-]+:/.test(trimmed)) {
          hub.description = dedentBlockScalar(descRawLines);
          mode = "hub";
          continue;
        }
        if (indent > hubKeyIndent) {
          descRawLines.push(line);
          i++;
          continue;
        }
        hub.description = dedentBlockScalar(descRawLines);
        mode = "hub";
        continue;
      }
    }

    if (mode === "hub_desc") {
      hub.description = dedentBlockScalar(descRawLines);
    }

    let inServices = mode === "services";
    let current = null;
    if (inServices && i < lines.length) {
      i++;
    }

    for (; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (!inServices) {
        if (trimmed === "services:" || trimmed.startsWith("services:")) {
          inServices = true;
        }
        continue;
      }

      if (trimmed.startsWith("- ")) {
        if (current) services.push(current);
        current = {};
        const rest = trimmed.slice(2).trim();
        if (rest) {
          const parts = rest.split(/:(.+)/);
          const k = parts[0]?.trim();
          const v = parts[1]?.trim();
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

    if (current) services.push(current);

    return { hub, services };
  }

  function applyHubBranding(h) {
    const title = (h?.title && String(h.title).trim()) || DEFAULT_HUB_TITLE;
    const tagline = (h?.tagline && String(h.tagline).trim()) || DEFAULT_HUB_TAGLINE;
    const desc = (h?.description && String(h.description).trim()) || "";

    document.title = title;
    if (elHubTitle) elHubTitle.textContent = title;
    if (elHubTagline) elHubTagline.textContent = tagline;
    if (elHubDescription && elHubDescriptionWrap) {
      if (desc) {
        elHubDescription.textContent = desc;
        elHubDescriptionWrap.hidden = false;
      } else {
        elHubDescription.textContent = "";
        elHubDescriptionWrap.hidden = true;
      }
    }
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

  /** Decorative server graphic for tile fronts (inline SVG, no network). */
  const TILE_SERVER_ART = `
    <div class="tileArt" aria-hidden="true">
      <svg class="tileServerSvg" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" focusable="false">
        <rect x="8" y="10" width="48" height="44" rx="4" fill="none" stroke="currentColor" stroke-width="2" opacity="0.32"/>
        <rect x="14" y="16" width="36" height="10" rx="2" fill="currentColor" opacity="0.14"/>
        <rect x="14" y="30" width="36" height="10" rx="2" fill="currentColor" opacity="0.1"/>
        <rect x="14" y="44" width="36" height="4" rx="1" fill="currentColor" opacity="0.12"/>
        <circle cx="20" cy="21" r="2" fill="currentColor" opacity="0.45"/>
        <circle cx="44" cy="21" r="2" fill="currentColor" opacity="0.28"/>
        <circle cx="20" cy="35" r="2" fill="currentColor" opacity="0.28"/>
        <circle cx="44" cy="35" r="2" fill="currentColor" opacity="0.28"/>
      </svg>
    </div>
  `;

  function tileTemplate(svc, status) {
    const title = escapeHtml(svc.name || svc.id || "Service");
    const desc = svc.description ? escapeHtml(svc.description) : "";
    const path = normalizePath(svc.path || "/");
    const healthPath = svc.healthPath ? normalizePath(svc.healthPath) : "";
    const external = isAbsoluteUrl(path);

    const badgeClass = status?.kind || "warn";
    const badgeText = status?.label || "Unknown";
    const badgeTitle = status?.detail || "";

    const metaRows = [
      `<span class="badge ${badgeClass}" title="${escapeHtml(badgeTitle)}"><span class="dot"></span>${escapeHtml(
        badgeText
      )}</span>`,
      `<div class="tileBackPath"><code>${escapeHtml(path)}</code></div>`
    ];
    if (healthPath) {
      metaRows.push(`<div class="tileBackPath muted">health: <code>${escapeHtml(healthPath)}</code></div>`);
    }

    const targetAttrs = external ? ` target="_blank" rel="noreferrer noopener"` : "";

    const descBlock = desc ? `<div class="tileDesc tileBackDesc">${desc}</div>` : "";

    return `
      <div class="tile">
        <div class="tileScene">
          <div class="tileFlip">
            <div class="tileFace tileFace--front">
              <a class="tileNav" href="${escapeHtml(path)}"${targetAttrs}>
                ${TILE_SERVER_ART}
                <div class="tileTitle">${title}</div>
              </a>
              <button type="button" class="tileInfoBtn" aria-label="Show service details" aria-expanded="false">
                <svg class="tileInfoIcon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
                  <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.75" opacity="0.85"/>
                  <path fill="currentColor" d="M11 10h2v8h-2v-8zm0-4h2v2h-2V6z" opacity="0.9"/>
                </svg>
              </button>
            </div>
            <div class="tileFace tileFace--back">
              <div class="tileBackInner">
                ${descBlock}
                <div class="tileMeta tileMeta--stack">${metaRows.join("")}</div>
                <div class="tileBackActions">
                  <button type="button" class="btn tileFlipBack">Back</button>
                  <a class="link tileOpenLink" href="${escapeHtml(path)}"${targetAttrs}>Open service</a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  let tileFlipDelegationAttached = false;

  function attachTileFlipDelegation() {
    if (!elGrid || tileFlipDelegationAttached) return;
    tileFlipDelegationAttached = true;
    elGrid.addEventListener("click", (e) => {
      const infoBtn = e.target?.closest?.(".tileInfoBtn");
      if (infoBtn && elGrid.contains(infoBtn)) {
        e.preventDefault();
        e.stopPropagation();
        const tile = infoBtn.closest(".tile");
        if (!tile) return;
        const flipped = tile.classList.toggle("is-flipped");
        infoBtn.setAttribute("aria-expanded", flipped ? "true" : "false");
        infoBtn.setAttribute("aria-label", flipped ? "Hide service details" : "Show service details");
        return;
      }

      const backBtn = e.target?.closest?.(".tileFlipBack");
      if (backBtn && elGrid.contains(backBtn)) {
        e.preventDefault();
        e.stopPropagation();
        const tile = backBtn.closest(".tile");
        if (!tile) return;
        tile.classList.remove("is-flipped");
        const info = tile.querySelector(".tileInfoBtn");
        if (info) {
          info.setAttribute("aria-expanded", "false");
          info.setAttribute("aria-label", "Show service details");
        }
      }
    });
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
    const parsed = parseHubYaml(configText);
    applyHubBranding(parsed.hub || {});
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

  attachTileFlipDelegation();
  main();
})();

