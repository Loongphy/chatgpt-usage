// ==UserScript==
// @name         ChatGPT Tooltip Anti-Jitter
// @namespace    https://loongphy.com
// @version      0.1.0
// @description  Fix the composer tooltip flicker on ChatGPT (reasoning-level pill & send button). ChatGPT renders its anchored tooltips with `pointer-events: auto` directly inside the composer (not portaled), and they overlap their triggers, so a hovered tooltip steals the pointer from its trigger → Radix closes it → pointer returns → reopens → endless flicker. Restoring the Radix default `pointer-events: none` breaks the loop.
// @author       loongphy
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    /*
     * Root cause (verified on the live site via DOM inspection):
     *
     *   1. ChatGPT's composer tooltips (the reasoning-level pill and the send
     *      button, among others) are `position: fixed` but are NOT portaled —
     *      they live inline inside the composer DOM as children of the trigger.
     *   2. They are positioned with CSS Anchor Positioning
     *      (`inset-s-[calc(anchor(center)+...)]` + `-translate-x-1/2`) plus
     *      `position-try-fallbacks: flip-block`. Under the flip fallback the
     *      tooltip ends up overlapping its trigger by ~30px.
     *   3. Crucially ChatGPT sets these tooltips to `pointer-events: auto`
     *      (Radix's default for a plain Tooltip is `pointer-events: none`).
     *
     *   => When the mouse is over the part of the trigger that the tooltip now
     *      covers, the tooltip — being on top AND pointer-interactive — steals
     *      the pointer. Radix sees `pointerleave` on the trigger and closes the
     *      tooltip; the tooltip disappears, the pointer is over the trigger
     *      again, Radix reopens it. This repeats every animation frame = the
     *      "出现后一直闪烁来回抖动" flicker the user sees.
     *
     * Fix: force `pointer-events: none` on ChatGPT's anchor-positioned tooltips.
     * They are plain text (no interactive children), so this is safe and is
     * exactly what Radix intends for non-interactive tooltips. The cursor then
     * passes straight through the tooltip onto the trigger, so there is no
     * pointerleave/enter oscillation and no flicker.
     */

    const STYLE_ID = 'chatgpt-tooltip-antijitter';

    const CSS = `
        /* Target ChatGPT's anchor-positioned tooltips (the class signature used
           by the composer buttons). High specificity + !important so it wins
           over ChatGPT's utility classes and survives re-renders. */
        [role="tooltip"].fixed[class*="inset-s-[calc(anchor(center)"] {
            pointer-events: none !important;
        }
    `;

    function inject() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS;
        (document.head || document.documentElement).appendChild(style);
    }

    // Inject ASAP (run-at document-start) and re-inject if ChatGPT reflows head.
    inject();
    new MutationObserver(inject).observe(document.documentElement, {
        childList: true,
        subtree: true,
    });
})();
