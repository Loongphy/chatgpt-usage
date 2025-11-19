// ==UserScript==
// @name         Chat Squircle
// @namespace    https://loongphy.com
// @version      1.0
// @description  Adds corner-shape: squircle to chat input boxes on ChatGPT, Gemini, Grok, and AI Studio
// @author       loongphy
// @match        https://chatgpt.com/*
// @match        https://gemini.google.com/*
// @match        https://grok.com/*
// @match        https://aistudio.google.com/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const SQUIRCLE_CSS = `
        corner-shape: squircle;
    `;

    const CONFIG = {
        'chatgpt.com': {
            selector: '#prompt-textarea',
            targetParent: true,
            parentDepth: 3
        },
        'gemini.google.com': {
            selector: '.ql-editor',
            targetParent: true,
            parentDepth: 7
        },
        'grok.com': {
            selector: '[contenteditable="true"]',
            targetParent: true,
            parentDepth: 4
        },
        'aistudio.google.com': {
            selector: '.prompt-input-wrapper',
            targetParent: false, 
            parentDepth: 0
        }
    };

    function getDomain() {
        return window.location.hostname;
    }

    function applySquircle() {
        const domain = getDomain();
        // Find the config that matches the current domain (handling subdomains)
        const configKey = Object.keys(CONFIG).find(key => domain.includes(key));
        
        if (!configKey) return;
        
        const config = CONFIG[configKey];
        const elements = document.querySelectorAll(config.selector);

        elements.forEach(el => {
            let target = el;
            
            if (config.targetParent) {
                // Traverse up to find the container that likely has the border
                // This is heuristic: look for a div with a border or background
                let parent = el.parentElement;
                for(let i=0; i<config.parentDepth && parent; i++) {
                     target = parent;
                     parent = parent.parentElement;
                }
            }

            // Apply the style directly to the target element
            if (!target.dataset.squircleApplied) {
                target.style.cssText += SQUIRCLE_CSS;
                target.dataset.squircleApplied = "true";
            }
        });
    }

    // Initial run
    applySquircle();

    // Observe changes for dynamic SPAs
    const observer = new MutationObserver((mutations) => {
        applySquircle();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

})();
