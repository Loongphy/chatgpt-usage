// ==UserScript==
// @name         Gemini Enhancement
// @namespace    https://loongphy.com
// @version      1.5.0
// @icon         https://www.google.com/s2/favicons?sz=64&domain=gemini.google.com
// @description  Adds a button to open new Gemini tab and squircle input
// @author       loongphy
// @match        https://gemini.google.com/*
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // Keep a stable opener reference and the target URL we always want to open
    const nativeOpen = window.open.bind(window);
    const TARGET_URL = 'https://gemini.google.com/app';
    const WIDESCREEN_STORAGE_KEY = 'gemini-wide-enabled';
    const DEFAULT_WIDE_ENABLED = true;
    const THOUGHT_ITALIC_STORAGE_KEY = 'gemini-thought-italic-enabled';
    const DEFAULT_THOUGHT_ITALIC_ENABLED = true; // true = keep site default italic

    // ==================== Styles ====================
    const STYLES = `
        /* Squircle for input box */
        input-area-v2 { corner-shape: squircle; }

        /* New tab button - positioned next to Gemini logo */
        .gemini-new-tab-btn {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: transparent;
            border: none;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            transition: background-color 0.2s ease;
            color: #444746;
            margin-left: 6px;
            flex-shrink: 0;
            vertical-align: middle;
            align-self: center;
        }
        .gemini-new-tab-btn:hover {
            background-color: rgba(68, 71, 70, 0.08);
        }
        .gemini-new-tab-btn:active {
            background-color: rgba(68, 71, 70, 0.12);
        }
        .gemini-new-tab-btn svg {
            width: 18px;
            height: 18px;
            fill: currentColor;
        }
        @media (prefers-color-scheme: dark) {
            .gemini-new-tab-btn {
                color: #E8EAED;
            }
            .gemini-new-tab-btn:hover {
                background-color: rgba(232, 234, 237, 0.18);
            }
            .gemini-new-tab-btn:active {
                background-color: rgba(232, 234, 237, 0.26);
            }
        }
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

    const THOUGHT_ITALIC_RESET_STYLES = `
        model-thoughts message-content {
            font-style: normal !important;
        }
    `;

    function injectStyles() {
        const styleEl = document.createElement('style');
        styleEl.textContent = STYLES;
        document.head.appendChild(styleEl);
    }

    function setupWideScreenToggle() {
        const wideStyleEl = document.createElement('style');

        const readWidePref = () => {
            try {
                const saved = localStorage.getItem(WIDESCREEN_STORAGE_KEY);
                if (saved === null) return DEFAULT_WIDE_ENABLED;
                return saved === 'true';
            } catch {
                return DEFAULT_WIDE_ENABLED;
            }
        };

        const writeWidePref = (enabled) => {
            try {
                localStorage.setItem(WIDESCREEN_STORAGE_KEY, enabled ? 'true' : 'false');
            } catch {
                /* ignore persistence errors */
            }
        };

        const applyWideStyles = (enabled) => {
            document.body.classList.toggle('gemini-wide', enabled);
            wideStyleEl.textContent = enabled ? WIDESCREEN_STYLES : '';
        };

        document.head.appendChild(wideStyleEl);

        let wideEnabled = readWidePref();
        applyWideStyles(wideEnabled);

        const registerMenu = () => {
            if (typeof GM_registerMenuCommand !== 'function') return;
            if (typeof GM_unregisterMenuCommand === 'function' && registerMenu.menuId) {
                GM_unregisterMenuCommand(registerMenu.menuId);
            }
            registerMenu.menuId = GM_registerMenuCommand(`宽屏显示：${wideEnabled ? '开' : '关'}`, () => {
                wideEnabled = !wideEnabled;
                writeWidePref(wideEnabled);
                applyWideStyles(wideEnabled);
                registerMenu();
            });
        };

        registerMenu();
    }

    function setupThoughtItalicToggle() {
        const italicStyleEl = document.createElement('style');

        const readItalicPref = () => {
            try {
                const saved = localStorage.getItem(THOUGHT_ITALIC_STORAGE_KEY);
                if (saved === null) return DEFAULT_THOUGHT_ITALIC_ENABLED;
                return saved === 'true';
            } catch {
                return DEFAULT_THOUGHT_ITALIC_ENABLED;
            }
        };

        const writeItalicPref = (enabled) => {
            try {
                localStorage.setItem(THOUGHT_ITALIC_STORAGE_KEY, enabled ? 'true' : 'false');
            } catch {
                /* ignore persistence errors */
            }
        };

        const applyItalicStyles = (enabled) => {
            italicStyleEl.textContent = enabled ? '' : THOUGHT_ITALIC_RESET_STYLES;
        };

        document.head.appendChild(italicStyleEl);

        let italicEnabled = readItalicPref();
        applyItalicStyles(italicEnabled);

        const registerMenu = () => {
            if (typeof GM_registerMenuCommand !== 'function') return;
            if (typeof GM_unregisterMenuCommand === 'function' && registerMenu.menuId) {
                GM_unregisterMenuCommand(registerMenu.menuId);
            }
            registerMenu.menuId = GM_registerMenuCommand(`思维链斜体：${italicEnabled ? '开' : '关'}`, () => {
                italicEnabled = !italicEnabled;
                writeItalicPref(italicEnabled);
                applyItalicStyles(italicEnabled);
                registerMenu();
            });
        };

        registerMenu();
    }

    function createNewTabButton() {
        const button = document.createElement('button');
        button.className = 'gemini-new-tab-btn';
        button.title = 'Open Gemini in New Tab';
        button.type = 'button';
        
        // SVG icon (open in new tab) using DOM APIs
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z');
        svg.appendChild(path);
        button.appendChild(svg);

        // Always open the Gemini home/app entry, prevent parent handlers from hijacking
        const openTarget = (event) => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();

            const newTab = nativeOpen(TARGET_URL, '_blank', 'noopener,noreferrer');
            if (newTab) return;

            // Fallback if popups are blocked
            const anchorEl = document.createElement('a');
            anchorEl.href = TARGET_URL;
            anchorEl.target = '_blank';
            anchorEl.rel = 'noopener noreferrer';
            document.body.appendChild(anchorEl);
            anchorEl.click();
            anchorEl.remove();
        };

        // Capture + bubble to beat site handlers
        button.addEventListener('click', openTarget, true);
        button.addEventListener('click', openTarget);

        // Mount button after Gemini text
        function mountButton() {
            const geminiText = document.querySelector('.bard-text');
            if (geminiText && geminiText.parentNode) {
                // Prevent duplicate insertion or unnecessary moves
                if (geminiText.nextSibling === button) return;
                
                geminiText.parentNode.insertBefore(button, geminiText.nextSibling);
            }
        }

        // Observe DOM changes to handle SPA navigation and dynamic rendering
        const observer = new MutationObserver(() => {
            mountButton();
        });
        
        observer.observe(document.body, { childList: true, subtree: true });
        mountButton();
    }

    // ==================== Initialize ====================
    function init() {
        injectStyles();
        setupWideScreenToggle();
        setupThoughtItalicToggle();
        createNewTabButton();
    }

    init();
})();
