// ==UserScript==
// @name         ChatGPT Open in New Tab
// @namespace    https://loongphy.com
// @version      0.3.1
// @description  1) Turns the collapsed-sidebar titlebar "New chat" button (Ctrl+Shift+O, inside the rounded-lg bg-surface wrapper) into a real link so native browser actions work: open in new tab / new window, copy link, middle-click, Ctrl/Cmd+click. Plain left-click still opens a new chat in place. 2) Defaults every new conversation to "Chat" on surfaces showing the home composer Chat/Work mode toggle.
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

  // ------------------------------------------------------------------
  // Default new conversations to "Chat" mode
  // ------------------------------------------------------------------
  // On surfaces showing the home composer mode toggle (the
  // `@container/home-mode-toggle` "Composer mode" group, e.g. the Atlas /
  // codex_webview home), ChatGPT restores the previous or server-default
  // mode — often "Work" — for every new conversation. Two cookies drive it:
  //   codex_composer_mode = "chat" | "work"              (persistent)
  //   oai-chat-surface-mode-chat-override-expires-at      (4h cap)
  // A server recommendation (`oai-tpp-default-tab-recommendation`, usually
  // suggestedTab:"work") wins again as soon as that 4h override lapses, so
  // new chats keep drifting back to Work. The home toggle only exists on
  // the composer surface, so every new conversation mounts a fresh one —
  // correcting it on mount (and on late attribute flips) keeps the
  // default at Chat. Clicking Chat also persists `codex_composer_mode=chat`
  // for the next load. Switching modes flips aria-pressed in place; real
  // user clicks are respected via a short suppression window.

  // NOTE: use `div[...]`, not just `[class*=...]`: the toggle *buttons* also
  // carry `@max-xs/home-mode-toggle:...` classes, and a bare attribute
  // selector would make closest() resolve to the button instead of the
  // container, silently breaking all attribute-mutation handling.
  const MODE_TOGGLE_SEL = 'div[class*="home-mode-toggle"]';
  const MODE_FIX_ATTR = 'data-cgpt-mode-fixes';
  const MODE_RETRY_ATTR = 'data-cgpt-mode-retry';
  let suppressModeFixUntil = 0;
  // A mount can add several wrapper nodes in one MutationObserver batch; all
  // of them would see aria-pressed still unmoved and click again before React
  // commits. Keep one correction per toggle per short window.
  const modeFixAt = new WeakMap();

  document.addEventListener(
    'click',
    (e) => {
      // Our own correction clicks are untrusted — don't let them suppress
      // the next check. Only a real user click on the toggle is intent.
      if (!e.isTrusted) return;
      if (e.target && e.target.closest && e.target.closest(MODE_TOGGLE_SEL)) {
        suppressModeFixUntil = Date.now() + 2000;
      }
    },
    true
  );

  function modeToggleButtons(toggle) {
    const btns = [...toggle.querySelectorAll('button[aria-pressed]')];
    // The home toggle is exactly two segments. A broader layout wrapper can
    // contain unrelated aria-pressed buttons; never mix those into a pair.
    if (btns.length !== 2) return null;
    // Chat is the left segment, Work the right one.
    const chat = btns.find((b) => b.className.includes('col-start-1')) || btns[0];
    const work =
      btns.find((b) => b.className.includes('col-start-2')) || btns[btns.length - 1];
    return { chat, work };
  }

  // The toggle mounts disabled while the app hydrates / resolves the server
  // recommendation (often a few seconds in a throttled background tab). Keep
  // one retry chain per toggle so repeated attribute mutations can't stack
  // timers; the observer also re-checks as soon as `disabled` clears.
  function scheduleModeRetry(toggle) {
    if (toggle.hasAttribute(MODE_RETRY_ATTR)) return;
    toggle.setAttribute(MODE_RETRY_ATTR, '');
    let left = 30;
    const tick = () => {
      if (!toggle.isConnected || --left <= 0) {
        toggle.removeAttribute(MODE_RETRY_ATTR);
        return;
      }
      const pair = modeToggleButtons(toggle);
      if (!pair) {
        toggle.removeAttribute(MODE_RETRY_ATTR);
        return;
      }
      if (pair.chat.disabled || pair.work.disabled) {
        setTimeout(tick, 150);
        return;
      }
      toggle.removeAttribute(MODE_RETRY_ATTR);
      fixModeToggle(toggle);
    };
    setTimeout(tick, 150);
  }

  function fixModeToggle(toggle) {
    if (!toggle.isConnected) return;
    if (Date.now() < suppressModeFixUntil) return;
    const pair = modeToggleButtons(toggle);
    if (!pair) return;
    if (pair.work.getAttribute('aria-pressed') !== 'true') return;
    // React can set chat=true before work=false is committed; never click a
    // segment that is already selected.
    if (pair.chat.getAttribute('aria-pressed') === 'true') return;
    if (pair.chat.disabled || pair.work.disabled) {
      scheduleModeRetry(toggle);
      return;
    }
    const n = +(toggle.getAttribute(MODE_FIX_ATTR) || 0);
    // Cap corrections per mount so a server that keeps re-pushing "work"
    // can't bounce the toggle forever (each switch fires API calls).
    if (n >= 3) return;
    const now = Date.now();
    if (now - (modeFixAt.get(toggle) || 0) < 500) return;
    modeFixAt.set(toggle, now);
    toggle.setAttribute(MODE_FIX_ATTR, String(n + 1));
    pair.chat.click();
    // Confirm a beat later in case the click landed mid-transition and React
    // ignored it; the cooldown makes this a no-op when Chat took effect.
    setTimeout(() => fixModeToggle(toggle), 800);
  }

  function scanModeToggle(root) {
    const scope = root && root.querySelectorAll ? root : document;
    if (scope.matches && scope.matches(MODE_TOGGLE_SEL)) fixModeToggle(scope);
    scope.querySelectorAll(MODE_TOGGLE_SEL).forEach((t) => fixModeToggle(t));
  }

  const observer = new MutationObserver((muts) => {
    for (const m of muts) {
      // Any observed attribute change inside a toggle (aria-pressed flips or
      // the disabled flag clearing after hydration) can unmask a Work
      // selection — re-check the owning container.
      if (m.type === 'attributes') {
        const toggle = m.target.closest && m.target.closest(MODE_TOGGLE_SEL);
        if (toggle) fixModeToggle(toggle);
        continue;
      }
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        // React remounts the titlebar button on route changes, wiping the
        // injected anchor — re-linkify whenever it comes back.
        if (node.tagName === 'BUTTON' && isNewChatButton(node)) {
          linkifyNewChat(node);
        } else {
          scanNewChat(node);
        }
        scanModeToggle(node);
        // Buttons re-rendered inside a persistent toggle arrive already
        // pressed — check the toggle above them too.
        const host = node.closest && node.closest(MODE_TOGGLE_SEL);
        if (host) fixModeToggle(host);
      }
    }
  });

  function start() {
    scanNewChat(document);
    scanModeToggle(document);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-pressed', 'disabled'],
    });
  }

  if (document.body) {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  }
})();
