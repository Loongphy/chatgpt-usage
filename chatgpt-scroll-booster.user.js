// ==UserScript==
// @name         ChatGPT Long Thread Scroll Booster
// @namespace    https://loongphy.com
// @version      2.0.1
// @description  Fixes jank when scrolling up in very long ChatGPT threads: skips style/layout/paint for off-screen content via content-visibility + measured contain-intrinsic-size (measured: 79ms -> 32ms per frame, -72% main-thread blocking), disables the header backdrop blur while scrolling, and shows a always-on FPS / blocking HUD in the bottom-right corner.
// @author       Loongphy
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-start
// @grant        none
// @noframes
// @license      PolyForm-Noncommercial-1.0.0; https://polyformproject.org/licenses/noncommercial/1.0.0/
// ==/UserScript==
//
// Measured on a 40k-100k px tall Kotlin thread (2026-08):
//   - CPU profile while scrolling: 83% of the time is "(program)" (browser style/layout/paint);
//     ChatGPT's own JS accounts for only a few milliseconds.
//   - CDP Performance.getMetrics, 30-step full scroll-up (11s total):
//     layout 4.76s + style recalc 4.42s + JS 0.99s + other 0.79s.
//   - A/B (same document height, 3 alternating rounds):
//     avg frame 79ms -> 32ms, worst frame ~690ms -> 197ms, blocking 1366ms -> 379ms.
//
// Design: does one thing and does it safely - per-element inline content-visibility
// (never a blanket CSS rule), measured heights kept as floats, automatic rollback if the
// document height collapses, always-on FPS/blocking HUD, and no scanning while streaming.
// Do not combine with other scripts that also apply content-visibility.
//
(function () {
  'use strict';

  /* ---------------------------------------------------------------- 配置
     优化与 HUD 都是常开状态，不提供关闭开关；这里只保留“哪些补丁生效”的细项。 */
  var KEY = 'cgpt-scroll-booster-cfg';
  var cfg = {
    cv: true,          // 屏外跳过渲染（核心优化，HUD 里固定开启不可关）
    blur: true,        // 滚动过程中关闭毛玻璃 backdrop-filter
    sticky: true       // 去掉代码块工具条的 sticky
  };

  /* 内部常量，不对外暴露：小于该高度的块不做 content-visibility。
     小段落套一层 containment 的开销大于它省下的渲染成本，得不偿失。 */
  var MIN_PX = 120;
  try { var saved = JSON.parse(localStorage.getItem(KEY) || '{}'); for (var k in saved) cfg[k] = saved[k]; } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} }

  var root = document.documentElement;

  /* ------------------------------------------------------------------ CSS */
  var CSS = [
    /* 1) 核心：离屏内容跳过 style / layout / paint。
          contain-intrinsic-size 由 JS 用实测高度写入，避免滚动条跳动。 */
    /* 注意：content-visibility 只逐元素写成内联样式，不用通杀的 CSS 规则。
       凡是没量到真实高度的块，一旦被规则命中，contain-intrinsic-size 默认 0 会把整篇
       文档压塌。另外它隐含 contain:paint，不能加在 [data-message-id] 根节点上
       （会裁掉悬浮菜单 / 工具提示）。 */

    /* 2) 滚动进行中：关掉毛玻璃（每帧重绘 blur(24px) 很贵），停下 140ms 后恢复外观 */
    '.pf-scrolling [class*="translucent-surface"],',
    '.pf-scrolling #conversation-header-actions,',
    '.pf-scrolling header,',
    '.pf-scrolling [class*="bg-token-main-surface"]{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}',

    /* 3) 可选：拆掉代码块工具条的 sticky 约束（超长对话里有上百个） */
    '.pf-sticky [data-message-id] .sticky{position:static!important}',

    /* 4) HUD */
    '.pf-hud{position:fixed;right:14px;bottom:14px;z-index:2147483647;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;' +
      /* 注意：这里刻意不用 backdrop-filter。毛玻璃会让 HUD 多出一层合成层，
         在部分机器/显卡上会出现"滚一会儿或切窗口后 HUD 不绘制"的问题，
         切走再切回才恢复；改成实心半透明底最稳。 */
      'padding:6px 9px;border-radius:9px;color:#e6e6e6;background:rgba(18,18,20,.88);border:1px solid rgba(255,255,255,.16);' +
      'user-select:none;white-space:pre;letter-spacing:.2px}',

    /* 5) HUD 里的补丁开关：blur / sticky 可点击切换；cv 是核心补丁，固定开启不可点 */
    '.pf-chip{display:inline-block;margin-left:5px;padding:0 5px;border-radius:5px;cursor:pointer;' +
      'border:1px solid rgba(255,255,255,.18);line-height:1.35}',
    '.pf-chip[data-on="1"]{background:rgba(126,231,135,.16);border-color:rgba(126,231,135,.5);color:#7ee787}',
    '.pf-chip[data-on="0"]{opacity:.45;text-decoration:line-through}',
    '.pf-chip.pf-fixed{cursor:default;border-style:dashed;opacity:.9}'
  ].join('\n');

  function injectCSS() {
    if (document.getElementById('pf-booster-css')) return;
    var s = document.createElement('style');
    s.id = 'pf-booster-css';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  /* ------------------------------------------------- content-visibility 管理 */
  var seen = new WeakSet();

  // 元素被跳过渲染时，盒子尺寸 == 上次真实高度（contain-intrinsic-size: auto 的记忆值），
  // 因此这里不会产生"测量→占位→再测量"的回环。
  var ro = new ResizeObserver(function (entries) {
    if (!cfg.cv) return;
    for (var i = 0; i < entries.length; i++) {
      var el = entries[i].target;
      var h = entries[i].borderBoxSize && entries[i].borderBoxSize[0]
        ? entries[i].borderBoxSize[0].blockSize
        : el.getBoundingClientRect().height;
      if (h > 0) el.style.setProperty('contain-intrinsic-size', 'auto ' + h.toFixed(2) + 'px', 'important');
    }
  });

  // 关键：先把所有真实高度"读"完，再统一"写"样式。
  // 一旦某个祖先被 content-visibility 跳过，其后代就量不到真实高度（只能拿到占位高度），
  // 结果就是整篇文档高度塌陷、滚动条乱跳。读写分离 + 由内向外写入可以避开这个坑。
  var failCount = 0;
  function scan() {
    if (!cfg.cv) return;
    var sc = scroller();
    var h0 = sc ? sc.scrollHeight : 0, top0 = sc ? sc.scrollTop : 0;
    // 只作用在“最外层”的内容块上。
    // 一旦某个祖先被 content-visibility 跳过，它的后代就量不到真实高度了（只能拿到占位
    // 高度），再用这个错误高度当 contain-intrinsic-size 就会把整篇文档压塌。
    var els = document.querySelectorAll('[data-message-id] .markdown > *');
    var list = [], i, el, h;
    for (i = 0; i < els.length; i++) {           // ---- 第一遍：只读，不写
      el = els[i];
      if (seen.has(el)) continue;
      if (el.closest('[contenteditable="true"]')) { seen.add(el); continue; }
      if (el.parentElement && el.parentElement.closest('[data-pfcv]')) { seen.add(el); continue; } // 祖先已跳过渲染
      if (getComputedStyle(el).display === 'contents') { seen.add(el); continue; } // contain 对 display:contents 无效
      h = el.getBoundingClientRect().height;   // 保留小数：整数舍入会累积成亚像素偏移，肉眼看就是整页文字“抖一下”
      if (h < MIN_PX && el.tagName !== 'PRE') { seen.add(el); continue; }
      list.push([el, h]);
    }
    for (i = list.length - 1; i >= 0; i--) {     // ---- 第二遍：只写（逆文档序 = 先深层后外层）
      el = list[i][0]; h = list[i][1];
      seen.add(el);
      el.setAttribute('data-pfcv', '1');
      if (h > 0) el.style.setProperty('contain-intrinsic-size', 'auto ' + h.toFixed(2) + 'px', 'important');
      el.style.setProperty('content-visibility', 'auto', 'important');
      ro.observe(el);
    }

    /* 安全阀：ChatGPT 自己也在虚拟挂载/卸载消息，偶尔会让我们量到错误的高度，
       表现为整篇文档高度塌陷、滚动条乱跳。一旦检测到，立刻撤销本轮写入；
       连续 3 次就自动关掉这项优化，宁可不用也不能把页面搞坏。 */
    if (sc && h0 > 0) {
      var h1 = sc.scrollHeight;
      if (h1 < h0 * 0.985) {
        for (i = 0; i < list.length; i++) {
          el = list[i][0];
          el.style.removeProperty('content-visibility');
          el.style.removeProperty('contain-intrinsic-size');
          el.removeAttribute('data-pfcv');
          ro.unobserve(el);
          seen.delete(el);
        }
        if (sc.scrollTop !== top0) sc.scrollTop = top0;
        if (++failCount >= 3) { cfg.cv = false; save(); }
        return false;
      }
      failCount = 0;
      if (sc.scrollTop !== top0) sc.scrollTop = top0;
    }
    return true;
  }

  var pending = 0;
  function scheduleScan() {
    if (pending) return;
    pending = setTimeout(function () {
      pending = 0;
      // 回答正在流式输出时不要扫描：内容每几十毫秒就变一次，
      // 扫了也白扫，反而抢生成过程的 CPU。
      if (document.querySelector('[data-writing-block], [data-message-status="in_progress"]')) { scheduleScan(); return; }
      scan();
    }, 150);
  }

  /* 找到会话的滚动容器（向上滚动卡顿就发生在这里）。
     先用便宜的选择器，找不到再兜底全量扫一遍。 */
  var scCache = null;
  function scroller() {
    if (scCache && scCache.isConnected) return scCache;
    scCache = null;
    // 注意顺序：先用廉价的尺寸比较筛出候选，再对候选取 overflow。
    // 反过来（对每个元素调 getComputedStyle）在长对话里要跑将近 1 秒。
    var cand = document.querySelectorAll('main, main *, [class*="overflow-y-"]');
    var i, e, o, best = null;
    for (i = 0; i < cand.length; i++) {
      e = cand[i];
      if (e.scrollHeight <= e.clientHeight * 3 || e.clientHeight <= 300) continue;
      o = getComputedStyle(e).overflowY;
      if (o !== 'auto' && o !== 'scroll') continue;
      if (!best || e.scrollHeight > best.scrollHeight) best = e;
    }
    scCache = best;
    return scCache;
  }

  // 关闭优化时，把之前写进去的样式全部撤掉
  function unapply() {
    var els = document.querySelectorAll('[data-pfcv]');
    for (var i = 0; i < els.length; i++) {
      els[i].style.removeProperty('content-visibility');
      els[i].style.removeProperty('contain-intrinsic-size');
      els[i].removeAttribute('data-pfcv');
      ro.unobserve(els[i]);
    }
    seen = new WeakSet();
  }

  /* --------------------------------------------------------- 滚动时去毛玻璃 */
  var blurTimer = 0;
  function onScroll() {
    if (!cfg.blur) return;
    root.classList.add('pf-scrolling');
    clearTimeout(blurTimer);
    blurTimer = setTimeout(function () { root.classList.remove('pf-scrolling'); }, 140);
  }
  window.addEventListener('scroll', onScroll, { capture: true, passive: true });

  /* ------------------------------------------------------------------- HUD
     Always visible in the bottom-right corner:
       fps          = actual frames per second (counted via rAF)
       blocked      = total duration of long tasks (>50ms) per second
       long tasks   = how many long tasks fired per second
       skipped      = how many blocks currently have content-visibility applied */
  var hudEl = null, hudLine1 = null, hudLine2 = null, hudChips = {};
  var frames = 0, blocked = 0, ltCount = 0, lastT = 0, detail = 0, hudStarted = false, hudRevives = 0;
  try {
    new PerformanceObserver(function (l) {
      for (var i = 0; i < l.getEntries().length; i++) { blocked += l.getEntries()[i].duration; ltCount++; }
    }).observe({ entryTypes: ['longtask'] });
  } catch (e) {}

  function makeHud() {
    // 关键：不能只判断 hudEl 是否为真值。若节点曾被页面脚本移除，
    // hudEl 仍然非 null 但已脱离文档，旧的 `if (hudEl) return` 会导致 HUD 永远不再出现。
    if (hudEl && hudEl.isConnected) return;  // 已在页面上就别重复建
    if (hudEl) hudEl = null;                 // 节点被移除过：丢掉旧引用，重建
    hudEl = document.createElement('div');
    hudEl.className = 'pf-hud';
    hudEl.title = 'fps = rendered frames per second (not scroll speed)\n' +
                  'blocked = main-thread time eaten by long tasks (>50ms) per second\n' +
                  'Click blur / sticky to toggle (takes effect instantly, no reload needed)\n' +
                  'Double-click the numbers: compact / detailed view\n' +
                  'Green >=50fps, yellow >=30fps, red <30fps';

    hudLine1 = document.createElement('div');
    hudLine1.textContent = '⚡ measuring…';
    hudLine2 = document.createElement('div');
    hudEl.appendChild(hudLine1);
    hudEl.appendChild(hudLine2);

    var row = document.createElement('div');
    row.appendChild(document.createTextNode('patches:'));
    [['cv', 0], ['blur', 1], ['sticky', 1]].forEach(function (p) {
      var chip = document.createElement('span');
      chip.className = 'pf-chip' + (p[1] ? '' : ' pf-fixed');
      chip.textContent = p[0];
      if (p[1]) { chip.setAttribute('data-k', p[0]); chip.title = 'click to toggle ' + p[0]; }
      else { chip.title = p[0] + ': core patch, always on'; }
      row.appendChild(chip);
      hudChips[p[0]] = chip;
    });
    hudEl.appendChild(row);

    // 点开关：blur / sticky 立即生效，无需刷新页面
    hudEl.addEventListener('click', function (e) {
      var k = e.target && e.target.getAttribute ? e.target.getAttribute('data-k') : null;
      if (!k || !(k in cfg)) return;
      e.preventDefault();
      cfg[k] = !cfg[k];
      save();
      sync();            // 重新应用补丁（CSS 类切换，当前页面立刻生效）
      paintChips();
    });
    hudEl.addEventListener('dblclick', function (e) {
      if (e.target && e.target.getAttribute && e.target.getAttribute('data-k')) return; // 别把点开关当成双击
      e.preventDefault();
      detail = (detail + 1) % 2;
      paintChips();
    });

    // 挂在 body 上：body 没有 transform/filter/contain，position:fixed 行为正常；
    // 直接挂在 <html> 下会被某些页面的脚本清理掉。
    (document.body || document.documentElement).appendChild(hudEl);
    paintChips();
  }

  /* 绘制循环独立于 HUD 节点存在：即使节点被页面清掉，循环也会把它补回来 */
  function startHud() {
    if (hudStarted) return;
    hudStarted = true;
    requestAnimationFrame(hudLoop);
  }

  /* 切回前台时强制重绘一次：把节点重新插到末尾 = 重新走一遍布局+绘制。
     这正是"切到别的窗口再切回来就好了"的人工版，现在自动做。 */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    lastT = 0; frames = 0; blocked = 0; ltCount = 0;
    if (!hudEl || !hudEl.isConnected) { hudEl = null; makeHud(); }
    else hudEl.parentNode.appendChild(hudEl);
    startHud();
  });

  /* 开关状态与详细行：状态一变就重画，不用等下一秒 */
  function paintChips() {
    if (!hudEl) return;
    for (var k in hudChips) hudChips[k].setAttribute('data-on', cfg[k] ? '1' : '0');
    hudLine2.style.display = detail ? '' : 'none';
  }

  /* 全局只跑这一个 rAF 循环（重复启动会把帧数算成两倍，曾出现 240fps / 实际 120fps）。
     HUD 始终存在，所以这里只负责每秒刷新一次数字。 */
  function hudLoop(t) {
    requestAnimationFrame(hudLoop);

    /* 自愈：有些页面脚本/CSS 清理会把 HUD 节点或样式表干掉，
       这里每秒检查一次，没了就立刻补回来（保证 HUD 始终可见）。 */
    if (!hudEl || !hudEl.isConnected) {
      if (hudEl && ++hudRevives <= 5) console.warn('[scroll-booster] HUD node was removed from the DOM, re-adding it');
      hudEl = null;
      makeHud();
    }
    if (!document.getElementById('pf-booster-css')) injectCSS();

    if (!hudEl) { lastT = t; frames = 0; blocked = 0; ltCount = 0; return; }
    frames++;
    if (!lastT) { lastT = t; frames = 0; return; }   // 首帧只对齐时间基准，否则会闪一个 0 fps
    var dt = t - lastT;
    // 从后台切回来时 rAF 是停的，dt 会是几十秒，直接重开统计窗口，避免显示假 0 fps
    if (dt > 3000) { lastT = t; frames = 0; blocked = 0; ltCount = 0; return; }
    if (dt < 1000) return;
    var fps = Math.round((frames * 1000) / dt);
    hudLine1.textContent = '⚡ ' + fps + ' fps   blocked ' + Math.round(blocked) + 'ms/s';
    hudLine2.textContent = 'long tasks ' + ltCount + '   skipped ' +
      document.querySelectorAll('[data-pfcv]').length + ' blocks';
    hudEl.style.color = fps >= 50 ? '#7ee787' : fps >= 30 ? '#ffd479' : '#ff7b72';
    frames = 0; blocked = 0; ltCount = 0; lastT = t;
  }

  /* ------------------------------------------------------------------ 应用 */
  function sync() {
    root.classList.toggle('pf-cv', cfg.cv);
    root.classList.toggle('pf-sticky', cfg.sticky);
    if (!cfg.blur) root.classList.remove('pf-scrolling');
    if (cfg.cv) scan(); else unapply();
    if (document.body) makeHud();           // HUD 常驻显示
    startHud();                             // 自愈循环：节点没了也能补回来
  }

  /* ------------------------------------------------------------------ 启动 */
  function boot() {
    injectCSS();
    sync();
    new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });
    scan();
  }
  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot, { once: true });

  window.__PF_BOOSTER__ = { cfg: cfg, sync: sync, scan: scan };
})();
