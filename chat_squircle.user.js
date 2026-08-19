// ==UserScript==
// @name         Chat Squircle
// @namespace    https://loongphy.com
// @version      1.2
// @description  Adds corner-shape: squircle to the ChatGPT chat input box
// @author       loongphy
// @match        https://chatgpt.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const PROP = 'corner-shape';
    const VAL = 'squircle';
    const INPUT_SELECTOR = '#prompt-textarea';

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
        const target = findVisibleCornerBox(el, 8);
        if (!target) return;
        if (target.style.getPropertyValue(PROP) === VAL) return; // already applied
        target.style.setProperty(PROP, VAL);
    }

    function applyAll() {
        document.querySelectorAll(INPUT_SELECTOR).forEach(applySquircle);
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
