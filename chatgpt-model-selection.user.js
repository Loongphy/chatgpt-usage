// ==UserScript==
// @name         chatgpt model selection
// @namespace    https://loongphy.com
// @version      1.4.0
// @description  Forces the Copilot model mode (default: GPT-5.6 Deep Thinking) by rewriting the WebSocket chat payload. ChatGPT override removed — now native at chatgpt.com/admin/models
// @author       Loongphy
// @license      PolyForm-Noncommercial-1.0.0; https://polyformproject.org/licenses/noncommercial/1.0.0/
// @match        https://copilot.com/*
// @match        https://copilot.cloud.microsoft/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // Copilot chat frames travel over a SignalR WebSocket (JSON records split
    // by \x1e). The send frame is {target:"chat", arguments:[{..., tone}]} and
    // tone is the ONLY field the model selector changes on the wire:
    //   自动 Auto                     → "Magic"
    //   快速响应 Quick response        → "Chat"
    //   深度思考 Deep thinking (alias) → "Reasoning"      (resolves to default reasoning model)
    //   GPT-5.6 Sol 快速响应 (submenu) → "Gpt_5_6_Chat"
    //   GPT-5.6 Sol 深度思考 (submenu) → "Gpt_5_6_Reasoning"
    // "Reasoning" tracks the default reasoning model (GPT-5.6 today);
    // "Gpt_5_6_Reasoning" pins the explicit model. The selector resets to
    // 自动 on every page load — nothing is persisted locally or per session.
    const TONE = 'Gpt_5_6_Reasoning';
    const MENU_LABELS = ['深度思考', 'Think deeper', 'Thinking'];

    // Cosmetic only: also drive the visible selector so the UI shows thinking
    // instead of lying about it. The WS rewrite is the real fix.
    const SYNC_UI = true;

    const RS = '\x1e';

    function patchPayload(text) {
        const records = text.split(RS);
        let changed = false;
        for (let i = 0; i < records.length; i++) {
            const rec = records[i];
            if (!rec || rec[0] !== '{') continue;
            let msg;
            try { msg = JSON.parse(rec); } catch (_) { continue; }
            const a0 = msg && msg.arguments && msg.arguments[0];
            if (msg.target === 'chat' && a0 && typeof a0 === 'object' && 'tone' in a0 && a0.tone !== TONE) {
                a0.tone = TONE;
                records[i] = JSON.stringify(msg);
                changed = true;
            }
        }
        return changed ? records.join(RS) : text;
    }

    const origSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
        if (typeof data === 'string' && data.indexOf('"target":"chat"') !== -1) {
            try { data = patchPayload(data); } catch (_) {}
        }
        return origSend.call(this, data);
    };

    if (!SYNC_UI) return;

    // Clicking through (button → menuitemradio) is the fragile path the WS
    // patch exists to avoid, but one best-effort pass keeps the label honest.
    // If it never succeeds nothing breaks — the wire still gets TONE.
    let learnedLabel = null;   // button text while thinking is selected
    let working = false;

    function selectorButton() {
        return [...document.querySelectorAll('button[aria-label]')]
            .find(b => /模型选择器|model selector/i.test(b.getAttribute('aria-label')));
    }

    function shownMode(btn) {
        return (btn.textContent || '').trim();
    }

    function showsThinking(btn) {
        const mode = shownMode(btn);
        return mode === learnedLabel ||
            MENU_LABELS.some(l => mode.startsWith(l));
    }

    function learnLabel() {
        setTimeout(() => {
            const b = selectorButton();
            if (b && showsThinking(b)) learnedLabel = shownMode(b);
        }, 600);
    }

    function syncUi() {
        if (working || document.querySelector('[role="menuitemradio"]')) return;
        const btn = selectorButton();
        if (!btn || showsThinking(btn)) return;
        working = true;
        btn.click();
        const t0 = Date.now();
        const poll = setInterval(() => {
            const items = [...document.querySelectorAll('[role="menuitemradio"]')];
            const item = items.find(x =>
                MENU_LABELS.some(l => (x.textContent || '').includes(l))) ||
                items[items.length - 1];
            if (item) {
                if (item.getAttribute('aria-checked') === 'true') {
                    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                } else {
                    item.click();
                }
                learnLabel();
                clearInterval(poll);
                working = false;
            } else if (Date.now() - t0 > 2500) {
                clearInterval(poll);
                working = false;
                document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                document.body.click();
            }
        }, 150);
    }

    setInterval(syncUi, 2500);
})();
