// ==UserScript==
// @name         ChatGPT Always-On Conversation TOC
// @namespace    https://loongphy.com
// @version      1.1.0
// @description  Always show ChatGPT's right-edge conversation TOC (tick rail; hover expands the full prompt outline, click to jump) — removes the native limit of only showing it after N prompts. Yields to the native TOC on long threads and follows dark/light themes.
// @author       Loongphy
// @license      PolyForm-Noncommercial-1.0.0; https://polyformproject.org/licenses/noncommercial/1.0.0/
// @icon64       https://www.google.com/s2/favicons?sz=64&domain=chatgpt.com
// @match        https://chatgpt.com/*
// @grant        none
// @noframes
// @run-at       document-idle
// @downloadURL  https://github.com/Loongphy/chatgpt-usage/raw/refs/heads/main/chatgpt-always-toc.user.js
// ==/UserScript==
//
// 原生 TOC（右侧竖排刻度 + 悬停展开完整提问列表）只有在提问数达到一定阈值的长对话里才会渲染，
// 且挂载时机不稳定。本脚本自建一个外观一致、常驻的 TOC：
//   - 数据源（当前 AppShell 前端）：会话内容根 [data-chatgpt-conversation-selection-target]
//     下的 [data-turn-key] 容器 —— 每个容器 = 一对 user+assistant turn；
//     用户提问单元 [data-chatgpt-search-unit-key$=":user"]（未挂载时无内部内容，
//     容器骨架仍在，可做虚拟化占位）；提问文本取其内 [data-user-message-bubble]。
//   - 滚动容器 .thread-scroll-container（data-app-action-timeline-scroll）。
//   - 长对话里若原生 TOC（button[data-toc-item-index]）挂载则自动让位，卸载后自动接管。
//   - 点击刻度/列表项平滑跳转；目标 turn 未挂载时先滚到占位，挂载后再校准一次。
//   - 滚动时只做一次遍历来同步高亮（rAF 节流），不与滚动加速脚本抢主线程。
//
// 变更：
//   1.1.0 适配 AppShell 新 DOM：thread root/turn/user-unit/scroll container
//         选择器全部更换；一容器一提问，不再需要奇偶位推断。
//   1.0.x 基于 convSearchResultHighlightRoot + data-turn-id-container 的旧实现。

(function () {
  'use strict';

  /* ---------------------------------------------------------------- 配置 */

  var MIN_PROMPTS = 1;          // 用户提问少于该数量时不显示
  var ROOT_SEL = '[data-chatgpt-conversation-selection-target], [data-thread-find-target="conversation"]';
  var TURN_SEL = '[data-turn-key]';
  var USER_UNIT_SEL = '[data-chatgpt-search-unit-key$=":user"], [data-content-search-unit-key$=":user"]';
  var USER_TEXT_SEL = '[data-user-message-bubble] .whitespace-pre-wrap, [data-search-result-target]';
  var SCROLL_SEL = '.thread-scroll-container, [data-app-action-timeline-scroll]';
  var NATIVE_SELECTOR = 'button[data-toc-item-index]';
  var SCROLL_EXTRA = 16;        // 跳转时在 header 之外额外留白
  var HOST_ID = 'cgpt-always-toc';

  /* ---------------------------------------------------------------- 状态 */

  var cid = null;               // 当前会话 id，切换时重置缓存
  var textById = new Map();     // turnKey -> 提问文本（跨虚拟化卸载保留）
  var rail = null;              // 自建 TOC 根节点
  var scrollRoot = null;
  var lastPrompts = [];         // 最近一次 scan 的提问列表，滚动高亮复用
  var lastKey = '';             // 上次渲染的 结构+文本 指纹，避免无谓重建
  var scanTimer = 0;

  /* ---------------------------------------------------------------- 样式 */

  var css = [
    '#' + HOST_ID + '{position:fixed;inset-inline-end:16px;top:50%;transform:translateY(-50%);' +
      'z-index:20;font-family:inherit;}',
    '#' + HOST_ID + ' .cgpt-toc-wrap{position:relative;}',
    '#' + HOST_ID + ' .cgpt-toc-ticks{display:flex;flex-direction:column;align-items:center;gap:8px;' +
      'padding:4px 0;width:36px;max-height:min(50vh,500px);overflow:hidden;box-sizing:border-box;}',
    '#' + HOST_ID + ' .cgpt-toc-tick{display:block;width:18px;height:2px;padding:0;border:0;' +
      'border-radius:9999px;cursor:pointer;flex-shrink:0;background:color-mix(in srgb,' +
      'var(--text-tertiary,#8f8f8f) 60%,transparent);transition:background .15s ease;}',
    '#' + HOST_ID + ' .cgpt-toc-tick:hover{background:var(--text-secondary,#5d5d5d);}',
    '#' + HOST_ID + ' .cgpt-toc-tick[data-active]{background:var(--text-primary,#0d0d0d);}',
    '#' + HOST_ID + ' .cgpt-toc-panel{position:absolute;inset-inline-end:0;top:50%;' +
      'transform:translate(4px,-50%);opacity:0;pointer-events:none;z-index:50;' +
      'min-width:240px;width:max-content;max-width:340px;box-sizing:border-box;' +
      'padding:6px 0;border-radius:16px;border:1px solid var(--border-light,rgba(0,0,0,.05));' +
      'background:var(--main-surface-primary,#fff);box-shadow:0 10px 30px rgba(0,0,0,.12),' +
      '0 2px 8px rgba(0,0,0,.06);transition:opacity .16s cubic-bezier(.33,1,.68,1),' +
      'transform .16s cubic-bezier(.33,1,.68,1);}',
    '#' + HOST_ID + ' .cgpt-toc-wrap:hover .cgpt-toc-panel{opacity:1;transform:translate(0,-50%);' +
      'pointer-events:auto;}',
    '#' + HOST_ID + ' .cgpt-toc-list{list-style:none;margin:0;padding:0;overflow-y:auto;' +
      'max-height:min(50vh,500px);scrollbar-width:thin;}',
    '#' + HOST_ID + ' .cgpt-toc-item{display:block;box-sizing:border-box;margin:0 4px;' +
      'width:calc(100% - 8px);padding:7px 10px;border:0;border-radius:10px;background:none;' +
      'cursor:pointer;text-align:start;font:inherit;font-size:14px;line-height:1.45;' +
      'color:var(--text-primary,#0d0d0d);}',
    '#' + HOST_ID + ' .cgpt-toc-item:hover{background:color-mix(in srgb,' +
      'var(--text-primary,#0d0d0d) 6%,transparent);}',
    '#' + HOST_ID + ' .cgpt-toc-item[data-active]{font-weight:600;background:color-mix(in srgb,' +
      'var(--text-primary,#0d0d0d) 5%,transparent);}',
    '#' + HOST_ID + ' .cgpt-toc-item span{display:block;overflow:hidden;text-overflow:ellipsis;' +
      'white-space:nowrap;}',
    '#' + HOST_ID + ' .cgpt-toc-tick:focus-visible,#' + HOST_ID + ' .cgpt-toc-item:focus-visible' +
      '{outline:2px solid var(--text-tertiary,#8f8f8f);outline-offset:1px;}'
  ];

  function injectStyle() {
    var tag = document.getElementById(HOST_ID + '-style');
    if (!tag) {
      tag = document.createElement('style');
      tag.id = HOST_ID + '-style';
      document.documentElement.appendChild(tag);
    }
    tag.textContent = css.join('\n');
  }

  /* ---------------------------------------------------------------- 工具 */

  function getConversationId() {
    var m = location.pathname.match(/^\/(?:c|share\/c)\/([0-9a-f-]{16,})/i);
    return m ? m[1] : null;
  }

  function getThreadRoot() {
    return document.querySelector(ROOT_SEL);
  }

  function findScrollRoot() {
    var el = document.querySelector(SCROLL_SEL);
    if (el) return el;
    var root = getThreadRoot();
    el = root;
    while (el && el !== document.body) {
      if (el.scrollHeight > el.clientHeight + 50) {
        var oy = getComputedStyle(el).overflowY;
        if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  function isPhantom(tid) {
    return !tid || tid.indexOf('client-created-') === 0;
  }

  function headerHeight() {
    var v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-height')) ||
          parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-shell-titlebar-height'));
    return isFinite(v) && v > 0 ? v : 64;
  }

  function getTurnEl(tid) {
    var root = getThreadRoot();
    if (!root) return null;
    return root.querySelector('[data-turn-key="' + tid + '"]');
  }

  // 一个 turn 容器 = 一对问答；用户提问即容器内的 ":user" 单元
  function userUnitOf(turnEl) {
    return turnEl.querySelector(USER_UNIT_SEL);
  }

  /* ---------------------------------------------------------------- 扫描 */

  function scan() {
    var root = getThreadRoot();
    if (!root || !root.isConnected) { removeRail(); return; }

    // 原生 TOC 已挂载时让位
    if (document.querySelector(NATIVE_SELECTOR)) { removeRail(); lastPrompts = []; return; }

    if (!scrollRoot || !scrollRoot.isConnected) scrollRoot = findScrollRoot();

    var turns = root.querySelectorAll(TURN_SEL);
    var prompts = [];
    for (var i = 0; i < turns.length; i++) {
      var t = turns[i];
      var tid = t.getAttribute('data-turn-key');
      if (isPhantom(tid)) continue;

      // 已挂载时提取提问文本并缓存（虚拟化卸载后仍保留）
      var unit = userUnitOf(t);
      if (unit && !textById.has(tid)) {
        var node = unit.querySelector(USER_TEXT_SEL);
        var text = (node ? node.textContent : unit.textContent) || '';
        text = text.replace(/\s+/g, ' ').trim();
        if (text) textById.set(tid, text.slice(0, 500));
      }
      prompts.push({ tid: tid, el: t, text: textById.get(tid) || 'Prompt ' + (prompts.length + 1) });
    }
    lastPrompts = prompts;

    if (prompts.length < MIN_PROMPTS) { removeRail(); return; }
    render(prompts);
    syncActive();
  }

  /* ---------------------------------------------------------------- 渲染 */

  function render(prompts) {
    var key = prompts.map(function (p) { return p.tid + '|' + p.text; }).join('\n');
    if (rail && rail.isConnected && key === lastKey) return; // 结构与文本都没变
    lastKey = key;

    if (!rail || !rail.isConnected) {
      injectStyle();
      rail = document.createElement('div');
      rail.id = HOST_ID;
      document.body.appendChild(rail);
    }
    rail.textContent = '';

    var wrap = document.createElement('div');
    wrap.className = 'cgpt-toc-wrap';

    var ticks = document.createElement('div');
    ticks.className = 'cgpt-toc-ticks';

    var panel = document.createElement('div');
    panel.className = 'cgpt-toc-panel';
    panel.setAttribute('aria-hidden', 'true');

    var list = document.createElement('ul');
    list.className = 'cgpt-toc-list';

    prompts.forEach(function (p, k) {
      var tick = document.createElement('button');
      tick.type = 'button';
      tick.className = 'cgpt-toc-tick';
      tick.setAttribute('aria-label', p.text);
      tick.title = p.text;
      tick.setAttribute('data-idx', k);
      tick.addEventListener('click', function () { jumpTo(p); });
      ticks.appendChild(tick);

      var li = document.createElement('li');
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'cgpt-toc-item';
      item.setAttribute('data-idx', k);
      var span = document.createElement('span');
      span.textContent = p.text; // textContent，杜绝提问内容注入
      item.appendChild(span);
      item.addEventListener('click', function () { jumpTo(p); });
      li.appendChild(item);
      list.appendChild(li);
    });

    wrap.appendChild(ticks);
    panel.appendChild(list);
    wrap.appendChild(panel);
    rail.appendChild(wrap);
  }

  function removeRail() {
    lastKey = '';
    if (rail && rail.isConnected) rail.remove();
  }

  /* ---------------------------------------------------------- 高亮与跳转 */

  function syncActive() {
    if (!rail || !rail.isConnected || !lastPrompts.length) return;
    var root = getThreadRoot();
    if (!root) return;

    var want = new Map();
    var els = new Map();
    for (var i = 0; i < lastPrompts.length; i++) {
      want.set(lastPrompts[i].tid, i);
      els.set(lastPrompts[i].tid, lastPrompts[i].el);
    }

    var viewportLine = (scrollRoot ? scrollRoot.getBoundingClientRect().top : 0) +
      (scrollRoot ? scrollRoot.clientHeight : innerHeight) * 0.35;
    var activeIdx = 0;
    root.querySelectorAll(TURN_SEL).forEach(function (n) {
      var k = want.get(n.getAttribute('data-turn-key'));
      if (k == null) return;
      if (n.getBoundingClientRect().top <= viewportLine) activeIdx = k;
    });

    rail.querySelectorAll('.cgpt-toc-tick,.cgpt-toc-item').forEach(function (el) {
      var on = +el.getAttribute('data-idx') === activeIdx;
      if (on) el.setAttribute('data-active', ''); else el.removeAttribute('data-active');
    });

    var activeItem = rail.querySelector('.cgpt-toc-item[data-active]');
    if (activeItem) {
      var list = activeItem.closest('.cgpt-toc-list');
      var a = activeItem.getBoundingClientRect(), b = list.getBoundingClientRect();
      if (a.top < b.top || a.bottom > b.bottom) {
        list.scrollTop = activeItem.offsetTop - list.clientHeight / 2;
      }
    }
  }

  var jumpSeq = 0;
  var userScrolled = false;

  function jumpTo(p) {
    var root = getThreadRoot();
    if (!root) return;
    if (!scrollRoot || !scrollRoot.isConnected) scrollRoot = findScrollRoot();
    var el = getTurnEl(p.tid) || p.el;
    if (!el || !scrollRoot) return;
    var seq = ++jumpSeq;
    userScrolled = false;
    scrollToEl(el);

    // 虚拟化重挂载/滚动恢复会把位置拉走：短窗口内多次重申目标；
    // 用户一旦有主动滚动输入（滚轮/触摸/按键）立即放弃。
    [200, 600, 1200, 2000].forEach(function (ms) {
      setTimeout(function () {
        if (seq !== jumpSeq || userScrolled || !scrollRoot || !scrollRoot.isConnected) return;
        var el2 = getTurnEl(p.tid);
        if (!el2) return;
        var y = targetY(el2);
        if (Math.abs(scrollRoot.scrollTop - y) > 40) scrollRoot.scrollTop = y;
      }, ms);
    });
  }

  function targetY(el) {
    return Math.max(0, el.getBoundingClientRect().top - scrollRoot.getBoundingClientRect().top +
      scrollRoot.scrollTop - (headerHeight() + SCROLL_EXTRA));
  }

  // 原生 behavior:'smooth' 会被 ChatGPT 的滚动管理立即取消，短距离用 rAF 补间替代；
  // 长距离直接跳——补间会逼虚拟化器每帧挂载/卸载内容，代价远大于收益。
  function scrollToEl(el) {
    if (!scrollRoot || !scrollRoot.isConnected) return;
    var y = targetY(el);
    var from = scrollRoot.scrollTop, dy = y - from;
    if (Math.abs(dy) < 2 || Math.abs(dy) > 600) {
      scrollRoot.scrollTop = y;
      return;
    }
    var t0 = performance.now(), DUR = 280;
    (function step(now) {
      if (!scrollRoot || !scrollRoot.isConnected || userScrolled) return;
      var t = Math.min(1, (now - t0) / DUR);
      var e = 1 - Math.pow(1 - t, 3);
      scrollRoot.scrollTop = from + dy * e;
      if (t < 1) requestAnimationFrame(step);
    })(t0);
  }

  /* ---------------------------------------------------------------- 调度 */

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 150);
  }

  function onUrlChange() {
    var next = getConversationId();
    if (next === cid) return;
    cid = next;
    textById = new Map();
    scrollRoot = null;
    lastPrompts = [];
    removeRail();
    scheduleScan();
  }

  function init() {
    cid = getConversationId();
    injectStyle();

    // SPA 路由：pushState/replaceState/popstate
    ['pushState', 'replaceState'].forEach(function (fn) {
      var orig = history[fn];
      history[fn] = function () {
        var r = orig.apply(this, arguments);
        setTimeout(onUrlChange, 0);
        return r;
      };
    });
    addEventListener('popstate', onUrlChange);

    // DOM 变化（含原生 TOC 挂载/卸载、新 turn、虚拟化挂载）→ 防抖扫描
    new MutationObserver(scheduleScan).observe(document.documentElement, {
      childList: true, subtree: true
    });

    // 用户主动滚动输入 → 立即放弃进行中的跳转重申
    ['wheel', 'touchstart'].forEach(function (ev) {
      addEventListener(ev, function () { userScrolled = true; }, { capture: true, passive: true });
    });
    addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'PageUp' || k === 'PageDown' ||
          k === 'Home' || k === 'End' || k === ' ') userScrolled = true;
    }, { capture: true });

    // 滚动 → 只做轻量高亮同步（rAF 节流）
    var ticking = false;
    addEventListener('scroll', function () {
      if (ticking || !rail || !rail.isConnected) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        syncActive();
      });
    }, { capture: true, passive: true });

    scheduleScan();
  }

  // document-start 注入时 documentElement 可能尚不存在，等它可用再 init
  if (document.documentElement) init();
  else addEventListener('DOMContentLoaded', init, { once: true });
})();
