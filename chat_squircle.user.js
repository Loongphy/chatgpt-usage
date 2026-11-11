// ==UserScript==
// @name         Chat Squircle
// @namespace    https://loongphy.com
// @version      1.4.4
// @description  Adds corner-shape: squircle to the ChatGPT / Copilot / Grok chat input box
// @author       Loongphy
// @license      PolyForm-Noncommercial-1.0.0; https://polyformproject.org/licenses/noncommercial/1.0.0/
// @match        https://chatgpt.com/*
// @match        https://copilot.com/*
// @match        https://copilot.cloud.microsoft/*
// @match        https://grok.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const PROP = 'corner-shape';
    const VAL = 'squircle';
    // ChatGPT: .ProseMirror[data-composer-markdown] — new composer is a
    //   ProseMirror contenteditable; #prompt-textarea was removed.
    //   Its visible corner box is the ancestor .ComposerLayoutRoot-*
    //   (border-radius: 28px). Old #prompt-textarea kept for older deploys.
    // Copilot (copilot.com) & Microsoft 365 Copilot (copilot.cloud.microsoft,
    //   ex-m365.cloud.microsoft) share the same Fluent editor:
    //   #m365-chat-editor-target-element
    // Grok (grok.com): .query-bar-editor (TipTap ProseMirror contenteditable);
    // its visible corner box is the ancestor .query-bar (border-radius: 160px pill)
    const INPUT_SELECTORS = '#prompt-textarea, .ProseMirror[data-composer-markdown], #m365-chat-editor-target-element, .query-bar-editor';

    // ChatGPT re-renders the composer frequently and occasionally wraps it in
    // an extra (or fewer) layer of divs. A fixed parent depth therefore breaks
    // whenever the DOM shifts by one level. Instead, walk up from the input
    // and pick the nearest ancestor that actually paints a visible rounded
    // border (non-zero computed border-radius) — that is the container whose
    // corners we see, so it is the one that needs `corner-shape: squircle`.
    function findVisibleCornerBox(el, maxDepth) {
        let node = el.parentElement;
        for (let i = 0; i < maxDepth && node; i++) {
            const r = getComputedStyle(node).borderRadius;
            // border-radius may be "0px" or "12px 34px ..." — inspect first value
            const first = parseFloat(r);
            if (!Number.isNaN(first) && first > 0) return node;
            node = node.parentElement;
        }
        return null;
    }

    function applySquircle(el) {
        const target = findVisibleCornerBox(el, 12);
        if (!target) return;
        if (target.style.getPropertyValue(PROP) === VAL) return; // already applied
        target.style.setProperty(PROP, VAL);
    }

    function applyAll() {
        document.querySelectorAll(INPUT_SELECTORS).forEach(applySquircle);
    }

    // Initial run
    applyAll();

    // Re-apply on dynamic SPA changes (throttled to one run per animation frame)
    let scheduled = false;
    const observer = new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            applyAll();
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });
})();
