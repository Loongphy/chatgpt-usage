// ==UserScript==
// @name         ChatGPT Instant Conversation Warmup
// @namespace    https://loongphy.com
// @version      1.2.0
// @description  Opens ChatGPT conversations without the empty-bubble wait.
// @author       Loongphy
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @icon         https://chatgpt.com/favicon.ico
// @run-at       document-start
// @grant        none
// @noframes
// @license      PolyForm-Noncommercial-1.0.0; https://polyformproject.org/licenses/noncommercial/1.0.0/
// ==/UserScript==
(() => {
  "use strict";

  // Skip layout/paint for off-screen turns: assistant units run 1-3k px
  // tall, so on open ~90% of a long thread is below the fold. Measured
  // ~3-7s faster to rendered content on cold loads (same conv A/B).
  const injectCV = () => {
    const s = document.createElement("style");
    s.textContent =
      "@media screen{[data-chatgpt-search-unit-key]{" +
      "content-visibility:auto;contain-intrinsic-size:auto 1000px}}";
    (document.head || document.documentElement).appendChild(s);
  };
  if (document.documentElement) injectCV();
  else {
    new MutationObserver((_, obs) => {
      if (document.documentElement) {
        injectCV();
        obs.disconnect();
      }
    }).observe(document, { childList: true });
  }

  const API_PREFIX = "/backend-api/conversations/";
  const QUERY = "num_turns=10&include_has_versions=true";
  const TTL_MS = 20_000;
  const DUP_WINDOW_MS = 2_000;
  const HOVER_DELAY_MS = 150;
  const AUTH_WAIT_MS = 30_000;
  const cache = new Map();
  const appRequested = new Set();

  let authHeaders = null;
  let resolveAuth;
  const authReady = new Promise((res) => (resolveAuth = res));
  setTimeout(resolveAuth, AUTH_WAIT_MS);

  const stats = (window.__warmStats ??= {
    served: 0,
    miss: 0,
    warmed: 0,
    authCaptures: 0,
  });

  // Reuse the browser's own auth context: steal headers (authorization,
  // chatgpt-account-id, oai-*) from any authorized request the app makes,
  // and replay them verbatim on our warm fetches.
  const captureAuth = (input, init) => {
    try {
      const h = new Headers(
        input instanceof Request ? input.headers : undefined,
      );
      for (const [k, v] of new Headers(init?.headers)) h.set(k, v);
      if (h.has("authorization")) {
        h.delete("content-type");
        h.delete("if-none-match");
        h.delete("if-modified-since");
        authHeaders = h;
        stats.authCaptures++;
        resolveAuth(h);
      }
    } catch {}
  };

  const urlForId = (id) => `${API_PREFIX}${id}?${QUERY}`;
  const idFromHref = (href) => /\/c\/([0-9a-f-]{36})/i.exec(href || "")?.[1];

  const prefetch = (url) => {
    const hit = cache.get(url);
    if (
      hit &&
      Date.now() - hit.at < TTL_MS &&
      (hit.phase === "fetch" ||
        (hit.body !== undefined && hit.servedAt === undefined))
    ) {
      return hit;
    }
    const entry = { at: Date.now(), phase: "auth" };
    entry.promise = authReady
      .then(() => {
        if (!authHeaders || appRequested.has(url)) return undefined;
        entry.phase = "fetch";
        return origFetch(url, { credentials: "include", headers: authHeaders })
          .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
          .then((body) => {
            stats.warmed++;
            cache.set(url, { at: Date.now(), body, servedAt: entry.servedAt });
            return body;
          });
      })
      .catch(() => {
        if (cache.get(url) === entry) cache.delete(url);
        return undefined;
      });
    cache.set(url, entry);
    return entry;
  };

  const jsonResponse = (body) =>
    new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  const toPath = (u) => {
    if (typeof u !== "string") return null;
    if (u.startsWith("/")) return u;
    try {
      const p = new URL(u);
      return p.origin === location.origin ? p.pathname + p.search : null;
    } catch {
      return null;
    }
  };

  const origFetch = window.fetch;
  window.fetch = function patchedFetch(input, init) {
    const url = toPath(typeof input === "string" ? input : input?.url);
    captureAuth(input, init);
    const method = (init?.method || input?.method || "GET").toUpperCase();
    if (
      method === "GET" &&
      url?.startsWith(API_PREFIX) &&
      /num_turns=10\b/.test(url)
    ) {
      const hit = cache.get(url);
      if (hit && Date.now() - hit.at < TTL_MS) {
        const inflight = hit.phase === "fetch";
        const unserved =
          hit.body !== undefined && hit.servedAt === undefined;
        const dupGrace =
          hit.servedAt !== undefined &&
          Date.now() - hit.servedAt < DUP_WINDOW_MS;
        if (inflight || unserved || dupGrace) {
          stats.served++;
          hit.servedAt ??= Date.now();
          return (hit.body !== undefined
            ? Promise.resolve(hit.body)
            : hit.promise
          ).then((body) =>
            body !== undefined
              ? jsonResponse(body)
              : origFetch.call(this, input, init),
          );
        }
        // Already served once — a later request is a deliberate refetch
        // and must hit the network, not get our stale copy back.
        cache.delete(url);
      }
      stats.miss++;
      appRequested.add(url);
      if (hit?.phase === "auth") cache.delete(url);
    }
    return origFetch.call(this, input, init);
  };

  // Direct /c/<id> loads and reloads: warm the API as soon as the app's
  // first authorized request lands, while its own fetch is still booting.
  const id = idFromHref(location.pathname);
  if (id) prefetch(urlForId(id));

  let hoverEl = null;
  let hoverTimer = 0;
  const warmAnchor = (a) => {
    const cid = a && idFromHref(a.getAttribute("href"));
    if (cid) prefetch(urlForId(cid));
  };
  // Hover is cheap intent — sweeping across the sidebar shouldn't fire a
  // fetch per item, so warm only after the pointer settles briefly.
  const onOver = (e) => {
    const a = e.target?.closest?.("a[href*='/c/']");
    if (!a || a === hoverEl) return;
    clearTimeout(hoverTimer);
    hoverEl = a;
    hoverTimer = setTimeout(() => {
      hoverEl = null;
      warmAnchor(a);
    }, HOVER_DELAY_MS);
  };
  const onOut = (e) => {
    const a = e.target?.closest?.("a[href*='/c/']");
    if (a === hoverEl && !a.contains(e.relatedTarget)) {
      clearTimeout(hoverTimer);
      hoverEl = null;
    }
  };
  const onCommit = (e) => {
    clearTimeout(hoverTimer);
    hoverEl = null;
    warmAnchor(e.target?.closest?.("a[href*='/c/']"));
  };
  document.addEventListener("pointerover", onOver, {
    capture: true,
    passive: true,
  });
  document.addEventListener("pointerout", onOut, {
    capture: true,
    passive: true,
  });
  for (const type of ["touchstart", "focusin", "pointerdown"]) {
    document.addEventListener(type, onCommit, { capture: true, passive: true });
  }
})();
