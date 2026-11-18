// ==UserScript==
// @name         ChatGPT Open in New Tab
// @namespace    https://loongphy.com
// @version      0.2.0
// @description  Turns the collapsed-sidebar titlebar "New chat" button (Ctrl+Shift+O, inside the rounded-lg bg-surface wrapper) into a real link so native browser actions work: open in new tab / new window, copy link, middle-click, Ctrl/Cmd+click. Plain left-click still opens a new chat in place.
// @author       Loongphy
// @license      PolyForm-Noncommercial-1.0.0; https://polyformproject.org/licenses/noncommercial/1.0.0/
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const LINK_ATTR = 'data-cgpt-newchat-link';

  function isNewChatButton(btn) {
    if (btn.tagName !== 'BUTTON') return false;
    // Skip per-section "+ new chat" buttons (e.g. project sections create a
    // chat IN that project and must keep their own behavior).
    if (btn.closest('section')) return false;
    const label = (btn.getAttribute('aria-label') || '').trim();
    const text = (btn.textContent || '').trim();
    // Exact match only — "New chat in <project>" buttons must NOT match
    const hit = /^(new chat|新聊天|新对话|新建对话|新しいチャット)$/i;
    if (!((label && hit.test(label)) || (text && hit.test(text)))) return false;
    // The collapsed sidebar moves "New chat" into the titlebar as an
    // icon-only button inside a `div.rounded-lg.bg-surface` wrapper (that is
    // the ctrl+shift+o component). The expanded sidebar already renders a
    // native <a href="/">, so only buttons in <header>/<nav> need linkifying.
    return !!(btn.closest('header') || btn.closest('nav'));
  }

  // Plain left-click must keep the in-place SPA behavior. React remounts the
  // original button (its handler isn't reachable from a foreign node), so we
  // fire ChatGPT's own "New chat" shortcut (Ctrl/Cmd+Shift+O), which performs
  // a client-side transition, and fall back to a plain navigation.
  function triggerNewChatInPlace() {
    const before = location.pathname + location.search;
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'o',
        code: 'KeyO',
        ctrlKey: true,
        metaKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    setTimeout(() => {
      if (
        location.pathname + location.search === before &&
        location.pathname !== '/'
      ) {
        location.assign('/');
      }
    }, 400);
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
    // Plain left-click stays in place; modified clicks (middle, Ctrl/Cmd,
    // Shift) and the right-click menu get the native anchor behavior.
    a.addEventListener('click', (e) => {
      if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        triggerNewChatInPlace();
      }
    });
    btn.replaceWith(a);
  }

  function scanNewChat(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('header button, nav button').forEach((b) => {
      if (isNewChatButton(b)) linkifyNewChat(b);
    });
  }

  const observer = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        // React remounts the titlebar button on route changes, wiping the
        // injected anchor — re-linkify whenever it comes back.
        if (node.tagName === 'BUTTON' && isNewChatButton(node)) {
          linkifyNewChat(node);
          continue;
        }
        scanNewChat(node);
      }
    }
  });

  function start() {
    scanNewChat(document);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.body) {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  }
})();
