// ==UserScript==
// @name         ChatGPT Token Speed
// @namespace    https://loongphy.com
// @version      0.1.2
// @description  Shows token generation speed while ChatGPT streams a reply.
// @author       Loongphy
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @grant        none
// @run-at       document-start
// @noframes
// @license      PolyForm-Noncommercial-1.0.0; https://polyformproject.org/licenses/noncommercial/1.0.0/
// ==/UserScript==

(function () {
    'use strict';

    const SEL = '[data-message-author-role="assistant"]';
    // Reasoning steps ("Thinking", tool calls, "Searching the web") render as
    // siblings of the message node inside the same turn — never inside it — so
    // counting only the role-attributed node's text excludes them. They stream
    // far faster than the real answer (replayed summaries), which is what made
    // bogus 100K+ tok/s spikes appear during the thinking phase.
    const STREAM_SEL = '[data-streaming-response-status]';
    const SAMPLE_MS = 150;   // sampling cadence for token counting
    const WINDOW_MS = 1500;  // rolling window for the live tok/s figure
    const IDLE_MS = 900;     // no text growth for this long → stream finished
    const MIN_SPAN_MS = 600; // first→latest growth must span this to arm the HUD
    const MIN_GROWTH = 3;    // …and at least this many distinct growth samples
    const SPIKE_RATE = 600; // implied tok/s above this = replayed/bulk
                            // content (real models peak around 300)
    const SPIKE_TOK = 800;   // …and only if the jump itself is huge
    const BULK_CHARS = 4000; // a single mutation adding this much text is a
                           // replay/commit dump, not live streaming

    // Exact o200k tokenization via ChatGPT's own lazily-imported chunks —
    // its dev-mode "token-count" component ships a pure-JS Tiktoken plus the
    // 2.3MB o200k ranks table. Chunk filenames are content-hashed per deploy;
    // if they 404 we silently fall back to the char heuristic below.
    let enc = null;
    (async () => {
        try {
            const tk = await import('/cdn/assets/c5df50f9-flin8pehdicnuwv3.js');
            tk.i?.(); tk.t?.();
            const rm = await import('/cdn/assets/d8c9beb7-da0d9u648pjr8t8f.js');
            rm.t?.();
            enc = new tk.n.Tiktoken(rm.n || rm.r?.default || rm.default);
        } catch { /* hash rotated or offline → heuristic stays */ }
    })();

    // Fallback estimate: CJK ideographs/kana/hangul ≈ 1.5 chars per token
    // under o200k; everything else ≈ 4 chars/token.
    function estTokens(s) {
        let cjk = 0;
        for (let i = 0; i < s.length; i++) {
            const c = s.charCodeAt(i);
            if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) ||
                (c >= 0x3040 && c <= 0x30ff) || (c >= 0xac00 && c <= 0xd7af) ||
                (c >= 0x3000 && c <= 0x303f) || (c >= 0xff00 && c <= 0xffef)) cjk++;
        }
        return cjk / 1.5 + (s.length - cjk) / 4;
    }

    let lastEncodeMs = 0, nextEncodeAt = 0;
    function countTokens(s, now) {
        if (!enc) return estTokens(s);
        // Full-text encode costs ~2ms/KB; throttle so it stays < ~30% of a
        // core even on very long replies.
        if (now < nextEncodeAt) return null;
        const t0 = performance.now();
        const n = enc.encode(s).length;
        lastEncodeMs = performance.now() - t0;
        nextEncodeAt = now + Math.max(0, lastEncodeMs * 3 - SAMPLE_MS);
        return n;
    }

    // Unthrottled exact/heuristic count — for one-shot baselines. Capped:
    // a huge hydrated node isn't worth a blocking multi-hundred-ms encode.
    function countNow(s) {
        if (enc && s.length < 60000) return enc.encode(s).length;
        return estTokens(s);
    }

    // Conversation id of the page being viewed (/c/<id>), null on the
    // new-chat page and elsewhere. Used to bury stale figures: after a
    // switch the badge hides instead of showing the last view's numbers.
    const convOf = p => (p.match(/^\/c\/([^/?#]+)/) || [])[1] || null;
    let curConv = convOf(location.pathname);

    // ================= API stream interception (primary) =================
    // Hooks window.fetch, tees the /backend-api/f/conversation SSE stream and
    // counts real server deltas — true generation timing, immune to DOM
    // rendering artifacts, hydration replays and reasoning-summary dumps.
    // Only ops appending to /message/content/parts/* on a message whose
    // content_type is "text" (role assistant) count as answer tokens;
    // reasoning_recap / tool messages are excluded by construction.
    const api = {
        samples: [],       // [t, cumTokens] rolling window
        growth: 0, total: 0, bulk: 0,
        t0: 0, lastT: 0, lastRate: 0,
        armed: false, finalized: false, ended: false,
        curRole: '', curType: '', open: false,
        conv: null,        // conversation the current stream belongs to
        convOk: false,     // conv came from request/SSE, not a URL guess
    };

    function apiDelta(text, t) {
        const n = enc ? enc.encode(text).length : estTokens(text);
        if (!api.t0) api.t0 = t;
        api.total += n; api.lastT = t; api.growth++;
        // Resume/replay: a stream that opens with >1200 tok inside 600ms is
        // re-sending already-generated text — slide it into the baseline.
        if (!api.settled) {
            if (t - api.t0 < 600 && api.total > 1200) {
                api.bulk = api.total - n;
                api.samples.length = 0;
                api.t0 = t;
            } else if (t - api.t0 >= 600) api.settled = true;
        }
        api.samples.push([t, api.total - api.bulk]);
    }

    // SSE frames are either bare text deltas {"v":"..."}, patch envelopes
    // {"o":"patch","v":[ops]}, or single ops {"p":...,"o":...,"v":...}.
    // A delta counts only while the current streaming message is an
    // assistant "text" message that hasn't been marked finished — that flag
    // is what excludes reasoning_recap and tool-call payloads.
    function apiEvent(ev, t) {
        if (!ev || typeof ev !== 'object') return;
        const ops = (ev.o === 'patch' && Array.isArray(ev.v)) ? ev.v : [ev];
        for (const op of ops) {
            if (!op || typeof op !== 'object') continue;
            // Control events (message_marker etc.) carry the server-side
            // conversation id — the authoritative owner of this stream.
            const cid = (typeof op.conversation_id === 'string' && op.conversation_id) ||
                (op.p === '/conversation_id' && typeof op.v === 'string' && op.v) ||
                (op.v && typeof op.v === 'object' &&
                 typeof op.v.conversation_id === 'string' && op.v.conversation_id);
            if (cid) { api.conv = cid; api.convOk = true; }
            const m = op.v && op.v.message;
            if (m && m.author) {
                api.curRole = m.author.role;
                api.curType = (m.content && m.content.content_type) || '';
                api.open = api.curRole === 'assistant' &&
                    api.curType === 'text';
            }
            if ((op.p === '/message/end_turn' && op.v === true) ||
                (op.p === '/message/status' &&
                 op.v === 'finished_successfully')) api.open = false;
            if (!api.open || typeof op.v !== 'string') continue;
            // Delta forms: bare {"v":"..."} (no path) or explicit append/
            // replace on /message/content/parts/N.
            if (!op.p || /\/content\/parts\/\d+$/.test(op.p)) {
                apiDelta(op.v, t);
            }
        }
    }

    function consumeSSE(stream, convId) {
        Object.assign(api, {
            samples: [], growth: 0, total: 0, bulk: 0, t0: 0, lastT: 0,
            lastRate: 0,
            armed: false, finalized: false, ended: false, settled: false,
            curRole: '', curType: '', open: false,
            conv: convId || convOf(location.pathname), convOk: !!convId,
        });
        const mine = api.current = {};
        const rd = stream.getReader();
        const dec = new TextDecoder();
        let buf = '';
        (async () => {
            try {
                for (;;) {
                    const { done, value } = await rd.read();
                    if (done) break;
                    buf += dec.decode(value, { stream: true });
                    let i;
                    while ((i = buf.indexOf('\n\n')) >= 0) {
                        const frame = buf.slice(0, i); buf = buf.slice(i + 2);
                        const t = performance.now();
                        for (const line of frame.split('\n')) {
                            if (!line.startsWith('data:')) continue;
                            const data = line.slice(5).trim();
                            if (data === '[DONE]') { api.ended = true; continue; }
                            try { apiEvent(JSON.parse(data), t); } catch {}
                        }
                    }
                }
            } catch {}
            if (api.current === mine) api.ended = true;
        })();
    }

    (function hookFetch() {
        const orig = window.fetch;
        if (!orig || orig.__ts) return;
        const wrapped = function (...args) {
            return orig.apply(this, args).then(res => {
                try {
                    const url = typeof args[0] === 'string' ? args[0]
                        : (args[0] && args[0].url) || '';
                    if (/\/backend-api\/f\/conversation(?:\/resume)?(?:[?#]|$)/
                            .test(url) && res.body) {
                        // The POST body's conversation_id is the real owner
                        // (absent for a brand-new chat — SSE supplies it).
                        let cid = null;
                        try {
                            const rb = args[1] && args[1].body;
                            if (typeof rb === 'string' && rb[0] === '{') {
                                cid = JSON.parse(rb).conversation_id || null;
                            }
                        } catch {}
                        const [a, b] = res.body.tee();
                        consumeSSE(b, cid);
                        return new Response(a, {
                            status: res.status, statusText: res.statusText,
                            headers: res.headers,
                        });
                    }
                } catch {}
                return res;
            });
        };
        wrapped.__ts = true;
        window.fetch = wrapped;
    })();

    const fmt = n => n >= 100 ? Math.round(n) : n.toFixed(1);
    const states = new Map(); // assistant el -> tracking state
    const dirty = new Set();  // els touched by the latest mutations
    let badge = null;
    let badgeFor = null;    // element whose stats the badge currently shows

    function makeBadge() {
        const b = document.createElement('div');
        b.dataset.tokenSpeed = '';
        b.style.cssText =
            'position:fixed;top:60px;right:16px;z-index:60;pointer-events:none;' +
            'font:11px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;' +
            'padding:2px 9px;border-radius:8px;white-space:nowrap;' +
            'color:var(--text-secondary,#8e8ea0);' +
            'background:var(--main-surface-tertiary,#2f2f2f);' +
            'border:1px solid var(--border-light,rgba(0,0,0,.08));' +
            'display:none;transition:opacity .3s;';
        document.documentElement.appendChild(b);
        return b;
    }

    function lastAssistant() {
        const all = document.querySelectorAll(SEL);
        return all.length ? all[all.length - 1] : null;
    }

    function streamTarget() {
        return lastAssistant();
    }

    // Stream-in-progress signals that survive through thinking/tool pauses:
    // the scroll root carries data-stream-active, the composer swaps its send
    // button for a stop button, and the response-status container exists.
    function streamLive() {
        return !!document.querySelector(
            '[data-scroll-root][data-stream-active],' +
            'button[data-testid="stop-button"],' +
            STREAM_SEL);
    }

    function newState(el) {
        return {
            tokens: countNow(el.textContent || ''),
            samples: [],      // [t, tokens] within the rolling window
            growth: 0,        // total growth samples seen
            t0: 0,            // first growth timestamp of this stream
            base: 0,          // token count when this stream started
            lastT: 0,         // last sample timestamp (spike detection)
            lastGrowth: 0, lastRate: 0,
            armed: false, finalized: false,
        };
    }

    // Renders text plus a small "est" tag when falling back to the char
    // heuristic; the bundled o200k tokenizer is the default and shows no tag.
    function setBadge(text) {
        badge.textContent = text;
        if (enc) return;
        const tag = document.createElement('span');
        tag.style.cssText =
            'opacity:.5;font-size:9px;margin-left:4px;vertical-align:1px';
        tag.textContent = 'est';
        badge.appendChild(tag);
    }

    function finalize(st) {
        st.finalized = true;
        if (!badge || api.growth) return;
        const total = st.tokens - st.base;
        const dur = (st.lastGrowth - st.t0) / 1000;
        const avg = dur > 0.3 ? total / dur : 0;
        badge.style.opacity = '.5';
        setBadge(avg
            ? `${fmt(avg)} tok/s · ${Math.round(total)} tok · ${dur.toFixed(1)}s`
            : '');
        if (!avg) badge.style.display = 'none';
    }

    function sample(now) {
        // Conversation switch or new chat: everything the badge could show
        // belongs to the previous view — hide it and drop per-element state.
        // A stream that started on the new-chat page adopts the conversation
        // the app navigates to (first message navigates / → /c/<id> while
        // the reply is still streaming).
        const conv = convOf(location.pathname);
        if (conv !== curConv) {
            curConv = conv;
            if (badge) badge.style.display = 'none';
            badgeFor = null;
            states.clear();
            dirty.clear();
            // Stream still owned by an unconfirmed guess (new-chat sends can
            // fire while the URL is already a client-side /c/WEB:<id> that
            // the app later replaces) — keep adopting the nav target until
            // an authoritative id arrives via request body or SSE.
            if (!api.convOk && api.current && !api.ended &&
                !api.finalized) api.conv = conv;
        }
        // ---- API path: real server deltas own the badge when present ----
        if (api.growth && api.conv === curConv) {
            while (api.samples.length &&
                   now - api.samples[0][0] > WINDOW_MS) api.samples.shift();
            const idle = now - api.lastT;
            if (!api.armed && api.growth >= 2 && api.lastT - api.t0 >= 300) {
                api.armed = true;
            }
            const ended = api.ended || (!streamLive() && idle > IDLE_MS);
            if (api.armed && !api.finalized && ended) {
                api.finalized = true;
                const total = api.total - api.bulk;
                const dur = (api.lastT - api.t0) / 1000;
                const avg = dur > 0.3 ? total / dur : 0;
                if (!badge) badge = makeBadge();
                badge.style.display = '';
                badge.style.opacity = '.5';
                setBadge(avg ? `${fmt(avg)} tok/s · ${Math.round(total)} tok · ${dur.toFixed(1)}s` : '');
                if (!avg) badge.style.display = 'none';
            } else if (api.armed && !api.finalized) {
                const w = api.samples;
                const wdt = w.length > 1
                    ? (w[w.length - 1][0] - w[0][0]) / 1000 : 0;
                // On pause (tool call / thinking) the window empties — keep
                // showing the last measured rate, dimmed, instead of 0.0.
                if (wdt > 0.25) {
                    api.lastRate =
                        (w[w.length - 1][1] - w[0][1]) / wdt;
                }
                if (!badge) badge = makeBadge();
                badge.style.display = '';
                badge.style.opacity = idle > IDLE_MS ? '.4' : '1';
                setBadge(`${fmt(api.lastRate)} tok/s`);
            }
        }

        const target = streamTarget();
        const streaming = streamLive();
        // Seed the current target even without a mutation — the node may have
        // mounted before this script did (late load / resumed stream).
        if (target && !states.has(target)) {
            states.set(target, newState(target));
            dirty.add(target);
        }
        for (const [el, st] of states) {
            // The reply is still being produced (persists through thinking and
            // tool-call pauses).
            const live = el === target && streaming;
            if (!el.isConnected) {
                // Node committed/replaced mid-measurement → freeze stats.
                if (st.armed && !st.finalized) {
                    st.finalized = true;
                    if (!badgeFor || badgeFor === el) { badgeFor = el; finalize(st); }
                }
                states.delete(el); continue;
            }
            const wasDirty = dirty.delete(el);
            if (!wasDirty && (st.finalized || !st.armed)) continue;

            const counted = countTokens(el.textContent || '', now);
            const tokens = counted === null ? st.tokens : counted;

            if (tokens < st.tokens * 0.7) {
                // Text largely replaced: new stream inside the same node.
                Object.assign(st, newState(el));
            }
            const delta = tokens - st.tokens;
            const elapsed = Math.max(
                st.lastT ? now - st.lastT : SAMPLE_MS, 80);
            st.lastT = now;
            const wasBulk = st.bulk;
            if (counted !== null) st.bulk = false;
            if (delta > 0 && (wasBulk ||
                (delta > SPIKE_TOK &&
                 delta / (elapsed / 1000) > SPIKE_RATE))) {
                // Replayed/backfill content (resumed stream, commit dump):
                // slide the baseline so it feeds neither rate nor total.
                st.base += delta;
            } else if (delta > 0.05) {
                if (!st.growth || st.finalized) {
                    // First growth, or a continuation after we finalized —
                    // start measuring a fresh stream from here.
                    st.t0 = now; st.base = st.tokens;
                    st.samples.length = 0;
                    if (st.finalized) st.growth = 0;
                    st.finalized = false;
                }
                st.samples.push([now, tokens]);
                st.growth++;
                st.lastGrowth = now;
            }
            // No flat samples: on a pause the window simply empties and the
            // badge keeps showing the last measured rate, dimmed.
            st.tokens = tokens;

            while (st.samples.length && now - st.samples[0][0] > WINDOW_MS) {
                st.samples.shift();
            }

            const idle = now - st.lastGrowth;
            // A stream that ended (idle timeout, or node committed while
            // still connected) finalizes regardless of target status — but
            // only writes the badge if it owns it.
            if (st.armed && !st.finalized && !live && idle > IDLE_MS) {
                st.finalized = true;
                if (!badgeFor || badgeFor === el) { badgeFor = el; finalize(st); }
            }
            if (el !== target) continue;
            if (!st.armed) {
                // Sustained growth required — hydration and SSR bursts can't
                // trip it, and a still-thinking turn has no growing answer.
                st.armed = st.growth >= MIN_GROWTH &&
                    st.t0 && st.lastGrowth - st.t0 >= MIN_SPAN_MS;
                if (!st.armed) continue;
            }
            if (api.growth) continue; // API deltas own the badge this stream

            if (!badge) badge = makeBadge();
            badge.style.display = '';
            badgeFor = el;

            const win = st.samples;
            const wdt = win.length > 1
                ? (win[win.length - 1][0] - win[0][0]) / 1000 : 0;
            if (wdt > 0.25) {
                st.lastRate = (win[win.length - 1][1] - win[0][1]) / wdt;
            }
            badge.style.opacity = idle > IDLE_MS ? '.4' : '1';
            setBadge(`${fmt(st.lastRate)} tok/s`);
        }
    }

    // Assistant message element containing node n — never the badge itself,
    // otherwise our own updates would feed back as "growth". Reasoning and
    // tool-call DOM changes never match, so they can't dirty the counter.
    function host(n) {
        const el = n.nodeType === 1 ? n : n.parentElement;
        if (!el || !el.closest) return null;
        if (el.closest('[data-token-speed]')) return null;
        return el.closest(SEL);
    }

    // Net text length a single mutation record added (childList = added minus
    // removed node text; characterData = new minus old value length).
    function mutDelta(m) {
        if (m.type === 'characterData') {
            return (m.target.data || '').length - (m.oldValue || '').length;
        }
        let d = 0;
        for (const n of m.addedNodes) d += (n.textContent || '').length;
        for (const n of m.removedNodes) d -= (n.textContent || '').length;
        return d;
    }

    function touch(el, bulk) {
        if (!states.has(el)) states.set(el, newState(el));
        if (bulk) states.get(el).bulk = true;
        dirty.add(el);
    }

    new MutationObserver(muts => {
        for (const m of muts) {
            const bulk = mutDelta(m) > BULK_CHARS;
            const a = host(m.target);
            if (a) touch(a, bulk);
            for (const n of m.addedNodes) {
                const b = host(n) ||
                    (n.nodeType === 1 && n.querySelector
                        ? n.querySelector(SEL) : null);
                if (b) touch(b, bulk);
            }
        }
    }).observe(document.documentElement, {
        childList: true, subtree: true, characterData: true,
        characterDataOldValue: true,
    });

    setInterval(() => sample(performance.now()), SAMPLE_MS);
})();
