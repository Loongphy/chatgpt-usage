// ==UserScript==
// @name         Gemini Enhancement
// @namespace    https://loongphy.com
// @version      1.0
// @description  Adds a button to open new Gemini tab and squircle input
// @author       loongphy
// @match        https://gemini.google.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ==================== Styles ====================
    const STYLES = `
        /* Squircle for input box */
        input-area-v2 { corner-shape: squircle; }

        /* New tab button - positioned next to Gemini logo */
        .gemini-new-tab-btn {
            position: fixed;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: transparent;
            border: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background-color 0.2s ease;
            z-index: 1000;
            visibility: hidden;
        }
        .gemini-new-tab-btn.visible {
            visibility: visible;
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
            fill: #444746;
        }
    `;

    function injectStyles() {
        const styleEl = document.createElement('style');
        styleEl.textContent = STYLES;
        document.head.appendChild(styleEl);
    }

    function createNewTabButton() {
        const button = document.createElement('button');
        button.className = 'gemini-new-tab-btn';
        button.title = 'Open Gemini in New Tab';
        
        // SVG icon (open in new tab) using DOM APIs
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z');
        svg.appendChild(path);
        button.appendChild(svg);

        button.addEventListener('click', () => {
            window.open('https://gemini.google.com/app', '_blank');
        });

        // Position button dynamically next to Gemini text
        function positionButton() {
            const geminiText = document.querySelector('.bard-text');
            if (geminiText) {
                const rect = geminiText.getBoundingClientRect();
                // Only position if element has valid dimensions
                if (rect.width > 0 && rect.left > 0) {
                    button.style.top = (rect.top + (rect.height - 32) / 2) + 'px';
                    button.style.left = (rect.right + 2) + 'px';
                    button.classList.add('visible');
                    return true;
                }
            }
            return false;
        }

        // Wait for element to be properly positioned
        function waitAndPosition() {
            if (!positionButton()) {
                requestAnimationFrame(waitAndPosition);
            }
        }

        document.body.appendChild(button);
        waitAndPosition();
        window.addEventListener('resize', positionButton);
    }

    // ==================== Initialize ====================
    function init() {
        injectStyles();
        createNewTabButton();
    }

    init();
})();
