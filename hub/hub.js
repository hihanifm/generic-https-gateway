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

  function normalizePath(p) {
    if (!p) return "/";
    let s = String(p).trim();
    if (!s.startsWith("/")) s = "/" + s;
    return s;
  }

  function tileTemplate(svc, status) {
    const title = escapeHtml(svc.name || svc.id || "Service");
    const desc = escapeHtml(svc.description || "");
    const path = normalizePath(svc.path || "/");
    const healthPath = svc.healthPath ? normalizePath(svc.healthPath) : "";

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

    return `
      <a class="tile" href="${escapeHtml(path)}">
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

    elOverall.textContent = `Loaded ${services.length} service${services.length === 1 ? "" : "s"}. Checking status…`;

    // Render tiles quickly (unknown status), then update status badges.
    elGrid.innerHTML = services.map((svc) => tileTemplate(svc, { kind: "warn", label: "Checking…" })).join("");

    // Validate in parallel but with a small cap on concurrency to avoid spiking upstreams.
    const concurrency = 6;
    const statuses = new Array(services.length);
    let idx = 0;

    async function worker() {
      while (idx < services.length) {
        const i = idx++;
        statuses[i] = await validateService(services[i]);
        const tile = elGrid.children[i];
        if (tile) {
          tile.outerHTML = tileTemplate(services[i], statuses[i]);
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, services.length) }, () => worker()));

    const warnings = services
      .map((svc, i) => ({ svc, st: statuses[i] }))
      .filter((x) => x.st.kind !== "good")
      .map((x) => ({
        name: x.svc.name || x.svc.id || "Service",
        label: x.st.label,
        detail: x.st.detail
      }));

    renderWarnings(warnings);

    const upCount = statuses.filter((s) => s.kind === "good").length;
    elOverall.textContent = `Status: ${upCount}/${services.length} up.`;
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

