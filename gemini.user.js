// ==UserScript==
// @name         Gemini Enhancement
// @namespace    https://loongphy.com
// @version      1.7.1
// @icon         https://www.google.com/s2/favicons?sz=64&domain=gemini.google.com
// @description  Performance tweaks (kills aurora blur, animations, backdrop-filter) + squircle input and widescreen layout
// @author       Loongphy
// @license      PolyForm-Noncommercial-1.0.0; https://polyformproject.org/licenses/noncommercial/1.0.0/
// @match        https://gemini.google.com/*
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const WIDESCREEN_STORAGE_KEY = 'gemini-wide-enabled';
    const DEFAULT_WIDE_ENABLED = true;

    // ==================== Perf: 卡顿根因（实测于 5K 屏） ====================
    // 页面 JS 很轻（点击 handler ~1ms，无 longtask），卡的是渲染管线：
    //  1. 首页极光背景：.nl-blob 带 146px/116px 的 filter: blur() 无限动画，
    //     .gradient-strip 是 ~6000×5800px 的巨型图层。菜单打开触发覆盖层合成时，
    //     整个模糊背景被迫重光栅 → 单帧 ~1.4s（实测）。
    //  2. 「New chat」视图切换：CSS 过渡 + .blur-bg 的 backdrop-filter blur(10px)
    //     在 15MP 画面上逐帧重光栅 → 连续 ~3s 长帧（实测）。
    // 全部禁用后两次操作均回落到 ~50-200ms。
    const PERF_AURORA_KEY = 'gemini-perf-no-aurora';
    const PERF_MOTION_KEY = 'gemini-perf-no-motion';
    const PERF_BACKDROP_KEY = 'gemini-perf-no-backdrop';
    const PERF_CVV_KEY = 'gemini-perf-content-visibility';

    const PERF_AURORA_STYLES = `
        .nl-blob,
        .gradient-strip,
        .lm-glow,
        [class*="aurora-bg"],
        [class*="aurora-gradient"] {
            display: none !important;
        }
    `;

    // 秒杀动画/过渡，但豁免功能性加载动画——否则 mat-progress-bar 的
    // indeterminate 滑动段会瞬移到终点，顶部进度条看起来"跳来跳去"。
    const PERF_MOTION_KEEP = [
        'mat-progress-bar', 'mat-progress-spinner', 'mat-spinner',
        '.mdc-linear-progress', '.mdc-circular-progress',
        '[class*="skeleton"]', '[class*="shimmer"]',
        'lottie-player', 'dotlottie-player',
    ];
    const PERF_MOTION_STYLES = `
        *:not(${PERF_MOTION_KEEP.join(',')}, ${PERF_MOTION_KEEP.map(s => s + ' *').join(',')}),
        *:not(${PERF_MOTION_KEEP.join(',')}, ${PERF_MOTION_KEEP.map(s => s + ' *').join(',')})::before,
        *:not(${PERF_MOTION_KEEP.join(',')}, ${PERF_MOTION_KEEP.map(s => s + ' *').join(',')})::after {
            animation-duration: 0.01ms !important;
            animation-delay: 0ms !important;
            transition-duration: 0.01ms !important;
            transition-delay: 0ms !important;
        }
        * {
            scroll-behavior: auto !important;
        }
    `;

    const PERF_BACKDROP_STYLES = `
        *,
        *::before,
        *::after {
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
        }
        .blur-bg {
            background: var(--bard-sidenav-background, #1b1c1d) !important;
        }
    `;

    // 长会话：视口外的消息不做布局/绘制
    const PERF_CVV_STYLES = `
        model-response,
        user-query,
        .conversation-turn {
            content-visibility: auto;
            contain-intrinsic-size: auto 220px;
        }
    `;

    // ==================== Styles ====================
    const STYLES = `
        /* Squircle for input box */
        input-area-v2 { corner-shape: squircle; }
    `;

    // Smallest width constraint for content is set on .conversation-container (760px);
    // we widen that only to avoid touching the input box layout.
    const WIDESCREEN_STYLES = `
        :root {
            --gemini-wide-message-max-width: 1120px;
        }

        body.gemini-wide main .conversation-container {
            max-width: var(--gemini-wide-message-max-width) !important;
            width: min(100%, var(--gemini-wide-message-max-width)) !important;
        }

        body.gemini-wide main user-query,
        body.gemini-wide main model-response {
            max-width: 100% !important;
            width: 100% !important;
        }
    `;

    function readPref(key, fallback) {
        try {
            const v = localStorage.getItem(key);
            return v === null ? fallback : v === 'true';
        } catch {
            return fallback;
        }
    }

    function writePref(key, value) {
        try {
            localStorage.setItem(key, value ? 'true' : 'false');
        } catch {
            /* ignore persistence errors */
        }
    }

    const styleEls = {};

    // document-start 时 head 可能还没出现：挂 MutationObserver 兜底
    function ensureStyle(id, css) {
        let el = styleEls[id];
        if (!el) {
            el = document.getElementById(id) || document.createElement('style');
            el.id = id;
            styleEls[id] = el;
        }
        el.textContent = css;
        if (el.parentNode !== document.head && document.head) {
            document.head.appendChild(el);
        }
        return el;
    }

    const menuIds = [];
    function registerMenu(label, fn) {
        if (typeof GM_registerMenuCommand !== 'function') return;
        menuIds.push(GM_registerMenuCommand(label, fn));
    }
    function resetMenus() {
        if (typeof GM_unregisterMenuCommand === 'function') {
            while (menuIds.length) GM_unregisterMenuCommand(menuIds.pop());
        }
    }

    // ==================== Perf toggles ====================
    const perfState = {
        aurora: readPref(PERF_AURORA_KEY, true),
        motion: readPref(PERF_MOTION_KEY, true),
        backdrop: readPref(PERF_BACKDROP_KEY, true),
        cvv: readPref(PERF_CVV_KEY, false),
    };
    const PERF_KEYS = { aurora: PERF_AURORA_KEY, motion: PERF_MOTION_KEY, backdrop: PERF_BACKDROP_KEY, cvv: PERF_CVV_KEY };

    function applyPerfStyles() {
        ensureStyle('gemini-perf-aurora', perfState.aurora ? PERF_AURORA_STYLES : '');
        ensureStyle('gemini-perf-motion', perfState.motion ? PERF_MOTION_STYLES : '');
        ensureStyle('gemini-perf-backdrop', perfState.backdrop ? PERF_BACKDROP_STYLES : '');
        ensureStyle('gemini-perf-cvv', perfState.cvv ? PERF_CVV_STYLES : '');
    }

    function setupPerfToggles() {
        const defs = [
            ['aurora', '去极光模糊背景'],
            ['motion', '秒开动画/过渡'],
            ['backdrop', '去 backdrop-filter'],
            ['cvv', '长会话视口外跳过渲染'],
        ];
        defs.forEach(([key, name]) => {
            registerMenu(`${name}：${perfState[key] ? '开' : '关'}`, () => {
                perfState[key] = !perfState[key];
                writePref(PERF_KEYS[key], perfState[key]);
                applyPerfStyles();
                refreshAllMenus();
            });
        });
    }

    // ==================== Widescreen ====================
    function setupWideScreenToggle() {
        let wideEnabled = readPref(WIDESCREEN_STORAGE_KEY, DEFAULT_WIDE_ENABLED);

        const applyWideStyles = (enabled) => {
            document.body.classList.toggle('gemini-wide', enabled);
            ensureStyle('gemini-wide-style', enabled ? WIDESCREEN_STYLES : '');
        };

        applyWideStyles(wideEnabled);

        registerMenu(`宽屏显示：${wideEnabled ? '开' : '关'}`, () => {
            wideEnabled = !wideEnabled;
            writePref(WIDESCREEN_STORAGE_KEY, wideEnabled);
            applyWideStyles(wideEnabled);
            refreshAllMenus();
        });
    }

    // ==================== Initialize ====================
    function refreshAllMenus() {
        resetMenus();
        setupPerfToggles();
        setupWideScreenToggle();
    }

    // Perf styles must land before first paint — inject the moment head exists.
    function bootPerf() {
        if (document.head) {
            applyPerfStyles();
        } else {
            const mo = new MutationObserver(() => {
                if (document.head) {
                    applyPerfStyles();
                    mo.disconnect();
                }
            });
            mo.observe(document, { childList: true, subtree: true });
        }
    }

    function init() {
        ensureStyle('gemini-enh-styles', STYLES);
        refreshAllMenus();
    }

    bootPerf();
    if (document.body) {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    }
})();
