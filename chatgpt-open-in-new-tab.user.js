// ==UserScript==
// @name         ChatGPT Open in New Tab
// @namespace    https://loongphy.com
// @version      0.1.0
// @description  Adds "Open in new tab" to the top of the conversation context menu, and turns the sidebar "New chat" button into a real link so the native browser right-click menu works (open in new tab / new window, copy link, middle-click, Ctrl/Cmd+click)
// @author       Loongphy
// @license      PolyForm-Noncommercial-1.0.0; https://polyformproject.org/licenses/noncommercial/1.0.0/
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @grant        GM_openInTab
// @grant        GM.openInTab
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const MENU_ITEM_ATTR = 'data-cgpt-open-in-new-tab';
  const LINK_ATTR = 'data-cgpt-newchat-link';

  const isZh = () =>
    /^(zh|cn)/i.test(document.documentElement.lang || '') ||
    /zh|cn/i.test(navigator.language || '');

  // Label follows the language of the menu itself: Chinese item -> Chinese
  // label, otherwise English, so it always blends in with native items.
  const MENU_LABEL = (sampleText) => {
    if (sampleText && /[\u4e00-\u9fff]/.test(sampleText)) return '在新标签页打开';
    if (sampleText && /[a-z]/i.test(sampleText)) return 'Open in new tab';
    return isZh() ? '在新标签页打开' : 'Open in new tab';
  };

  // Tabler "external-link" icon as mask-image data URI, matching the icon
  // style ChatGPT uses inside its own menu items.
  const EXTERNAL_LINK_ICON =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6" />' +
        '<path d="M11 13l9 -9" /><path d="M15 4h5v5" /></svg>'
    );

  // ------------------------------------------------------------------ utils

  function openInNewTab(url) {
    try {
      if (typeof GM_openInTab === 'function') {
        GM_openInTab(url, { active: true, insert: true });
        return;
      }
    } catch (e) {}
    try {
      if (typeof GM !== 'undefined' && GM.openInTab) {
        GM.openInTab(url, { active: true, insert: true });
        return;
      }
    } catch (e) {}
    const w = window.open(url, '_blank', 'noopener');
    if (!w) {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      (document.body || document.documentElement).appendChild(a);
      a.click();
      a.remove();
    }
  }

  // --------------------------------------- 1. conversation context menu item

  // Most recent conversation link that triggered a menu: {href, el, t}
  let lastConv = null;

  document.addEventListener(
    'contextmenu',
    (e) => {
      const a = e.target && e.target.closest && e.target.closest('a[href^="/c/"]');
      lastConv = a ? { href: a.href, el: a, t: Date.now() } : null;
    },
    true
  );

  // The "..." button on a conversation row opens the same menu; support it
  // too. Radix opens that menu on POINTERDOWN (before click fires), so the
  // conversation link must be captured there — otherwise the menu mounts
  // before lastConv is set and nothing gets injected.
  function findConversationForButton(btn) {
    // The row may be an <a> that contains the button, or the button and the
    // <a> may be siblings inside the same row container.
    const direct = btn.closest('a[href^="/c/"]');
    if (direct) return direct;
    let up = btn.parentElement;
    for (let i = 0; i < 6 && up && up !== document.body; i++) {
      const found = up.querySelectorAll('a[href^="/c/"]');
      if (found.length === 1) return found[0];
      if (found.length > 1) break; // reached the list container, stop
      up = up.parentElement;
    }
    return null;
  }

  function captureConversationFromButton(e) {
    const btn = e.target && e.target.closest && e.target.closest('button');
    if (!btn || !btn.closest('nav')) return;
    if ((btn.getAttribute('aria-haspopup') || '') !== 'menu') return;
    const a = findConversationForButton(btn);
    if (a) lastConv = { href: a.href, el: a, t: Date.now() };
  }

  document.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0) return;
      captureConversationFromButton(e);
    },
    true
  );

  // Fallback for environments where the menu opens on click instead
  document.addEventListener('click', captureConversationFromButton, true);

  function freshConversation() {
    if (!lastConv) return null;
    if (Date.now() - lastConv.t > 30000) return null;
    return lastConv.href;
  }

  function buildMenuItem(menu) {
    const first = menu.querySelector('[role="menuitem"]');
    if (!first) return null;
    const item = first.cloneNode(true);
    item.setAttribute(MENU_ITEM_ATTR, '');
    const sampleText = (first.textContent || '').trim();

    // Replace the text (the cloned item has a single visible text node)
    const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (n.textContent.trim()) {
        n.textContent = MENU_LABEL(sampleText);
        break;
      }
    }

    // Replace the icon (mask-image data URI or inline svg)
    const iconHost =
      item.querySelector('[class*="leadingIcon"]') || item.firstElementChild;
    if (iconHost) {
      const masked = iconHost.querySelector('[style*="mask-image"]');
      if (masked) {
        masked.style.maskImage = `url("${EXTERNAL_LINK_ICON}")`;
        masked.style.webkitMaskImage = `url("${EXTERNAL_LINK_ICON}")`;
      } else if (iconHost.querySelector('svg')) {
        iconHost.innerHTML = `<span aria-hidden="true" style="display:inline-block;width:20px;height:20px;background-color:currentColor;-webkit-mask-image:url(${EXTERNAL_LINK_ICON});mask-image:url(${EXTERNAL_LINK_ICON});-webkit-mask-size:contain;mask-size:contain;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center"></span>`;
      }
    }

    item.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const href = freshConversation();
      closeMenu(menu);
      if (href) openInNewTab(href);
    });
    return item;
  }

  function closeMenu(menu) {
    const target = document.activeElement || menu;
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    // Fallback for Radix DismissableLayer: simulate a pointerdown outside
    setTimeout(() => {
      if (menu.isConnected) {
        document.body.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true })
        );
      }
    }, 0);
  }

  function injectIntoMenu(menu) {
    if (menu.querySelector('[' + MENU_ITEM_ATTR + ']')) return;
    // Only inject right after a conversation link was right-clicked (or its
    // "..." button pressed) — keeps unrelated menus untouched.
    if (!freshConversation()) return;
    const first = menu.querySelector('[role="menuitem"]');
    // The menu may mount before its items render; retry instead of giving up.
    if (!first) return scheduleMenuRetry(menu);
    // "Move to project"-style submenus stay open together with the parent
    // conversation menu; skip those (a conversation menu always has a rename
    // item, and it is the only open menu at injection time).
    const firstText = (first.textContent || '').trim().toLowerCase();
    if (!/^(rename|\u91cd\u547d\u540d)$/.test(firstText)) {
      const anotherOpen = [
        ...document.querySelectorAll('[role="menu"][data-state="open"]'),
      ].some((m) => m !== menu);
      if (anotherOpen) return;
    }
    // The template item must already carry its icon, otherwise the clone
    // inherits a half-rendered placeholder (gray blob icon).
    const iconHost =
      first.querySelector('[class*="leadingIcon"]') || first.firstElementChild;
    const iconReady =
      iconHost &&
      (iconHost.querySelector('[style*="mask-image"]') ||
        iconHost.querySelector('svg'));
    if (!iconReady) return scheduleMenuRetry(menu);
    const item = buildMenuItem(menu);
    if (!item) return;
    const target = menu.querySelector('[role="menuitem"]');
    if (target && target.parentElement === menu) {
      menu.insertBefore(item, target);
    } else if (target) {
      target.parentElement.insertBefore(item, target);
    } else {
      menu.appendChild(item);
    }
  }

  const RETRY_ATTR = 'data-cgpt-retries';

  function scheduleMenuRetry(menu) {
    const n = Number(menu.getAttribute(RETRY_ATTR) || '0');
    if (n >= 10) return;
    menu.setAttribute(RETRY_ATTR, String(n + 1));
    setTimeout(() => {
      if (menu.isConnected && menu.getAttribute('data-state') === 'open') {
        injectIntoMenu(menu);
      }
    }, 60);
  }

  function scanMenus(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('[role="menu"][data-state="open"]').forEach(
      injectIntoMenu
    );
  }

  const menuObserver = new MutationObserver((muts) => {
    const targets = new Set();
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches && node.matches('[role="menu"]')) {
          targets.add(node);
          continue;
        }
        // Items (or icons) can arrive AFTER the menu element mounted — retry
        // injection on the containing menu.
        if (node.parentElement) {
          const host =
            node.parentElement.closest &&
            node.parentElement.closest('[role="menu"]');
          if (host) targets.add(host);
        }
        if (node.querySelectorAll) {
          node.querySelectorAll('[role="menu"]').forEach((x) => targets.add(x));
        }
      }
    }
    targets.forEach(injectIntoMenu);
  });

  // ------------------------------------------------- 2. New chat -> real link

  function isNewChatButton(btn) {
    if (btn.tagName !== 'BUTTON') return false;
    if (!btn.closest('nav')) return false;
    // Skip the per-project "+ new chat" buttons inside sidebar sections —
    // they create a chat IN that project and must keep their own behavior.
    if (btn.closest('section')) return false;
    const label = (btn.getAttribute('aria-label') || '').trim();
    const text = (btn.textContent || '').trim();
    // Exact match only — "New chat in <project>" buttons must NOT match
    const hit = /^(new chat|新聊天|新对话|新建对话|新しいチャット)$/i;
    if (label && hit.test(label)) return true;
    if (text && hit.test(text)) return true;
    return false;
  }

  function linkifyNewChat(btn) {
    if (btn.hasAttribute(LINK_ATTR)) return;
    const a = document.createElement('a');
    // Copy the original class/aria attributes to keep the look identical
    for (const attr of btn.attributes) {
      if (attr.name === 'type') continue;
      a.setAttribute(attr.name, attr.value);
    }
    a.setAttribute('href', '/');
    a.setAttribute(LINK_ATTR, '');
    a.style.textDecoration = 'none';
    a.style.color = 'inherit';
    while (btn.firstChild) a.appendChild(btn.firstChild);
    // Plain left-click stays on the SPA router: prevent native navigation so
    // React's delegated click handler runs as before
    a.addEventListener('click', (e) => {
      if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
      }
    });
    btn.replaceWith(a);
  }

  function scanNewChat(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('nav button').forEach((b) => {
      if (isNewChatButton(b)) linkifyNewChat(b);
    });
  }

  const navObserver = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'BUTTON' && isNewChatButton(node)) {
          linkifyNewChat(node);
          continue;
        }
        scanNewChat(node);
      }
    }
  });

  // ------------------------------------------------------------------ start

  function start() {
    scanNewChat(document);
    scanMenus(document);
    menuObserver.observe(document.body, { childList: true, subtree: true });
    navObserver.observe(document.body, { childList: true, subtree: true });
  }

  if (document.body) {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  }
})();
