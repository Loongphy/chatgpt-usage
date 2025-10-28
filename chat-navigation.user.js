// ==UserScript==
// @name         ChatGPT 对话导航
// @namespace    http://tampermonkey.net/
// @version      4.1
// @description  紧凑导航 + 实时定位；修复边界误判；底部纯箭头按钮；回到顶部/到底部单击即用；禁用面板内双击选中；快捷键 Cmd+↑/↓（Mac）或 Alt+↑/↓（Windows）；修复竞态条件和流式输出检测问题；感谢loongphy佬适配暗色模式（3.0），加入标记点📌功能和收藏夹功能（4.0大更新）;适配左右侧边栏自动跟随（4.1大更新）
// @author       schweigen, loongphy(在3.0版本帮忙加入暗色模式)
// @license      MIT
// @match        https://chatgpt.com/*
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-end
// @downloadURL https://update.greasyfork.org/scripts/546161/ChatGPT%20%E5%AF%B9%E8%AF%9D%E5%AF%BC%E8%88%AA.user.js
// @updateURL https://update.greasyfork.org/scripts/546161/ChatGPT%20%E5%AF%B9%E8%AF%9D%E5%AF%BC%E8%88%AA.meta.js
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = { maxPreviewLength: 12, animation: 250, refreshInterval: 2000, forceRefreshInterval: 10000, anchorOffset: 8 };
  const BOUNDARY_EPS = 28;
  const DEFAULT_FOLLOW_MARGIN = Math.max(CONFIG.anchorOffset || 8, 12);
  const DEBUG = false;
  // 存储键与检查点状态
  const STORE_NS = 'cgpt-quicknav';
  const WIDTH_KEY = `${STORE_NS}:nav-width`;
  const CP_KEY_PREFIX = `${STORE_NS}:cp:`; // + 会话 key
  const CP_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 检查点保留 30 天
  let cpSet = new Set();          // 仅用于快速 membership（遗留）
  let cpMap = new Map();          // pinId -> meta
  // 收藏夹（favorites）
  const FAV_KEY_PREFIX = `${STORE_NS}:fav:`;         // + 会话 key
  const FAV_FILTER_PREFIX = `${STORE_NS}:fav-filter:`; // + 会话 key
  const FAV_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 收藏保留 30 天
  let favSet = new Set();         // 收藏的 key（消息 msgKey 或 图钉 pinId）
  let favMeta = new Map();        // key -> { created }
  let filterFav = false;          // 是否只显示收藏

  // 全局调试函数，用户可在控制台调用
  window.chatGptNavDebug = {
    forceRefresh: () => {
      console.log('ChatGPT Navigation: 手动强制刷新');
      TURN_SELECTOR = null;
      const ui = document.getElementById('cgpt-compact-nav')?._ui;
      if (ui) scheduleRefresh(ui);
      else console.log('导航面板未找到');
    },
    showCurrentSelector: () => {
      console.log('当前使用的选择器:', TURN_SELECTOR || '无');
      console.log('当前对话数量:', qsTurns().length);
    },
    testAllSelectors: () => {
      const originalSelector = TURN_SELECTOR;
      TURN_SELECTOR = null;
      qsTurns(); // 这会触发调试输出
      TURN_SELECTOR = originalSelector;
    },
    getCurrentTurns: () => {
      const turns = qsTurns();
      console.log('当前检测到的对话元素:', turns);
      return turns;
    },
    checkOverlap: () => {
      const panels = document.querySelectorAll('#cgpt-compact-nav');
      const styles = document.querySelectorAll('#cgpt-compact-nav-style');
      console.log(`找到 ${panels.length} 个导航面板`);
      console.log(`找到 ${styles.length} 个样式节点`);
      console.log(`键盘事件已绑定: ${!!window.__cgptKeysBound}`);
      console.log(`正在启动中: ${__cgptBooting}`);
      if (panels.length > 1) {
        console.warn('检测到重叠面板！清理中...');
        panels.forEach((panel, index) => {
          if (index > 0) {
            panel.remove();
            console.log(`已删除重复面板 ${index}`);
          }
        });
      }
      return { panels: panels.length, styles: styles.length, keysBound: !!window.__cgptKeysBound, booting: __cgptBooting };
    },
    testObserver: () => {
      const nav = document.getElementById('cgpt-compact-nav');
      if (!nav || !nav._ui || !nav._ui._mo) {
        console.log('MutationObserver 未找到');
        return false;
      }

      const mo = nav._ui._mo;
      const target = nav._ui._moTarget;
      console.log('MutationObserver 状态:');
      console.log('- 目标容器:', target);
      console.log('- 观察者存在:', !!mo);
      console.log('- 当前对话数量:', qsTurns().length);
      console.log('- 当前选择器:', TURN_SELECTOR || '无');

      // 临时启用DEBUG模式进行测试
      const oldDebug = DEBUG;
      window.DEBUG_TEMP = true;
      console.log('已临时启用DEBUG模式，请尝试发送一条消息，然后查看控制台输出');

      setTimeout(() => {
        window.DEBUG_TEMP = false;
        console.log('DEBUG模式已关闭');
      }, 30000);

      return true;
    }
  };

  GM_registerMenuCommand("重置问题栏位置", resetPanelPosition);
  GM_registerMenuCommand("清理过期检查点（30天）", cleanupExpiredCheckpoints);
  GM_registerMenuCommand("清理无效收藏", cleanupInvalidFavorites);
  function resetPanelPosition() {
    const nav = document.getElementById('cgpt-compact-nav');
    if (nav) {
      nav.style.top = '60px';
      nav.style.right = '10px';
      nav.style.left = 'auto';
      nav.style.bottom = 'auto';
      if (nav._ui && nav._ui.layout && typeof nav._ui.layout.notifyExternalPositionChange === 'function') {
        try { nav._ui.layout.notifyExternalPositionChange(); } catch {}
      }
      const originalBg = nav.style.background;
      const originalOutline = nav.style.outline;
      nav.style.background = 'var(--cgpt-nav-accent-subtle)';
      nav.style.outline = '2px solid var(--cgpt-nav-accent)';
      setTimeout(() => {
        nav.style.background = originalBg;
        nav.style.outline = originalOutline;
      }, 500);
    }
  }
  function cleanupExpiredCheckpoints() {
    try {
      loadCPSet();
      const removed = runCheckpointGC(true);
      const nav = document.getElementById('cgpt-compact-nav');
      if (nav && nav._ui) {
        renderList(nav._ui);
      }
      if (typeof alert === 'function') {
        alert(removed > 0 ? `已清理 ${removed} 条过期检查点（>30天）` : '无过期检查点需要清理');
      } else {
        console.log('清理结果：', removed > 0 ? `清理 ${removed} 条` : '无过期检查点');
      }
    } catch (e) {
      console.error('清理过期检查点失败:', e);
    }
  }

  function cleanupInvalidFavorites() {
    try {
      loadFavSet();
      // 计算有效 key：当前对话项 + 现存的图钉ID
      const valid = new Set();
      try { const base = buildIndex(); base.forEach(i => valid.add(i.key)); } catch {}
      try { loadCPSet(); cpMap.forEach((_, pid) => valid.add(pid)); } catch {}
      const removed = runFavoritesGC(true, valid);
      const nav = document.getElementById('cgpt-compact-nav');
      if (nav && nav._ui) { updateStarBtnState(nav._ui); renderList(nav._ui); }
      if (typeof alert === 'function') {
        alert(removed > 0 ? `已清理 ${removed} 个无效收藏` : '无无效收藏需要清理');
      } else {
        console.log('收藏清理结果：', removed > 0 ? `清理 ${removed} 个` : '无无效收藏');
      }
    } catch (e) {
      console.error('清理无效收藏失败:', e);
    }
  }

  let pending = false, rafId = null, idleId = null;
  let forceRefreshTimer = null;
  let lastTurnCount = 0;
  let TURN_SELECTOR = null;
  let scrollTicking = false;
  let currentActiveId = null;
  let __cgptBooting = false;
  let refreshTimer = 0; // 新的尾随去抖定时器

  function scheduleRefresh(ui, { delay = 80, force = false } = {}) {
    if (force) {
      if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = 0; }
      run();
      return;
    }
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(run, delay);

    function run() {
      refreshTimer = 0;
      pending = false; // 旧标志直接归零，防止误伤
      try {
        const oldCount = cacheIndex.length;
        refreshIndex(ui);
        const newCount = cacheIndex.length;

        // 如果刷新期间 turn 数变化，再来一次"收尾"（防抖窗口内很常见）
        if (newCount !== oldCount) {
          setTimeout(() => {
            refreshIndex(ui);
            scheduleActiveUpdateNow();
          }, 120);
        } else {
          scheduleActiveUpdateNow();
        }
      } catch (e) {
        if (DEBUG || window.DEBUG_TEMP) console.error('scheduleRefresh error:', e);
      }
    }
  }

  function init() {
    if (document.getElementById('cgpt-compact-nav')) return;
    const checkContentLoaded = () => {
      const turns = document.querySelectorAll('article[data-testid^="conversation-turn-"], [data-testid^="conversation-turn-"], div[data-message-id]');
      return turns.length > 0;
    };
    const boot = () => {
      // 二次校验：已有面板或正在启动就直接退出
      if (document.getElementById('cgpt-compact-nav')) {
        if (DEBUG || window.DEBUG_TEMP) console.log('ChatGPT Navigation: 面板已存在，跳过创建');
        return;
      }
      if (__cgptBooting) {
        if (DEBUG || window.DEBUG_TEMP) console.log('ChatGPT Navigation: 正在启动中，跳过重复创建');
        return;
      }

      __cgptBooting = true;
      try {
        if (DEBUG || window.DEBUG_TEMP) console.log('ChatGPT Navigation: 开始创建面板');
        const ui = createPanel();
        wirePanel(ui);
        observeChat(ui);
        bindActiveTracking();
        watchSendEvents(ui); // 新增这一行
        bindAltPin(ui); // 绑定 Option+单击添加📌
        scheduleRefresh(ui);
        if (DEBUG || window.DEBUG_TEMP) console.log('ChatGPT Navigation: 面板创建完成');
      } finally {
        __cgptBooting = false;
      }
    };
    if (checkContentLoaded()) boot();
    else {
      const observer = new MutationObserver(() => {
        if (checkContentLoaded()) { observer.disconnect(); boot(); }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  let currentUrl = location.href;
  function detectUrlChange() {
    if (location.href !== currentUrl) {
      if (DEBUG || window.DEBUG_TEMP) console.log('ChatGPT Navigation: URL变化，清理旧实例', currentUrl, '->', location.href);
      currentUrl = location.href;
      const oldNav = document.getElementById('cgpt-compact-nav');
      if (oldNav) {
        if (oldNav._ui) {
          // 清理定时器
          if (oldNav._ui._forceRefreshTimer) {
            clearInterval(oldNav._ui._forceRefreshTimer);
            if (DEBUG || window.DEBUG_TEMP) console.log('ChatGPT Navigation: 已清理定时器');
          }
          // 断开MutationObserver
          if (oldNav._ui._mo) {
            try {
              oldNav._ui._mo.disconnect();
              if (DEBUG || window.DEBUG_TEMP) console.log('ChatGPT Navigation: 已断开MutationObserver');
            } catch (e) {
              if (DEBUG || window.DEBUG_TEMP) console.log('ChatGPT Navigation: 断开MutationObserver失败', e);
            }
          }
          if (oldNav._ui.layout && typeof oldNav._ui.layout.destroy === 'function') {
            try { oldNav._ui.layout.destroy(); } catch {}
          }
        }
        oldNav.remove();
        if (DEBUG || window.DEBUG_TEMP) console.log('ChatGPT Navigation: 已移除旧面板');
      }
      // 重置"正在启动"标志，避免新页面被卡住
      __cgptBooting = false;
      // 重置键盘事件绑定标志，允许新页面重新绑定
      window.__cgptKeysBound = false;
      lastTurnCount = 0;
      TURN_SELECTOR = null; // 同时重置选择器缓存
      setTimeout(init, 100);
    }
  }
  window.addEventListener('popstate', detectUrlChange);
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  history.pushState = function (...args) { originalPushState.apply(this, args); setTimeout(detectUrlChange, 0); };
  history.replaceState = function (...args) { originalReplaceState.apply(this, args); setTimeout(detectUrlChange, 0); };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  function qsTurns(root = document) {
    if (TURN_SELECTOR) return Array.from(root.querySelectorAll(TURN_SELECTOR));
    const selectors = [
      // 原有选择器
      'article[data-testid^="conversation-turn-"]',
      '[data-testid^="conversation-turn-"]',
      'div[data-message-id]',
      'div[class*="group"][data-testid]',
      // 新增备用选择器
      '[data-testid*="conversation-turn"]',
      '[data-testid*="message-"]',
      'div[class*="turn"]',
      'div[class*="message"]',
      'div[class*="group"] div[data-message-author-role]',
      'div[class*="conversation"] > div',
      '[class*="chat"] > div',
      '[role="presentation"] > div',
      'main div[class*="group"]',
      'main div[data-testid]'
    ];

    if (DEBUG || window.DEBUG_TEMP) {
      console.log('ChatGPT Navigation Debug: 检测对话选择器');
      for (const selector of selectors) {
        const els = root.querySelectorAll(selector);
        console.log(`- ${selector}: ${els.length} 个元素`);
        if (els.length > 0) {
          console.log('  样本元素:', els[0]);
        }
      }
    }

    for (const selector of selectors) {
      const els = root.querySelectorAll(selector);
      if (els.length) {
        TURN_SELECTOR = selector;
        if (DEBUG || window.DEBUG_TEMP) console.log(`ChatGPT Navigation: 使用选择器 ${selector}, 找到 ${els.length} 个对话`);
        return Array.from(els);
      }
    }

    if (DEBUG || window.DEBUG_TEMP) {
      console.log('ChatGPT Navigation Debug: 所有预设选择器都失效，尝试智能检测');
      console.log('页面中的所有可能对话元素:');
      const potentialElements = [
        ...root.querySelectorAll('div[class*="group"]'),
        ...root.querySelectorAll('div[data-message-id]'),
        ...root.querySelectorAll('article'),
        ...root.querySelectorAll('[data-testid]'),
        ...root.querySelectorAll('div[role="presentation"]')
      ];
      console.log('潜在元素数量:', potentialElements.length);
    }

    // 增强的fallback检测
    const fallbackSelectors = [
      'div[class*="group"], div[data-message-id]',
      'div[class*="turn"], div[class*="message"]',
      'main > div > div',
      '[role="presentation"] > div'
    ];

    for (const fallbackSelector of fallbackSelectors) {
      const candidates = [...root.querySelectorAll(fallbackSelector)].filter(el => {
        // 检查是否包含消息相关的内容
        return (
          el.querySelector('div[data-message-author-role]') ||
          el.querySelector('[data-testid*="user"]') ||
          el.querySelector('[data-testid*="assistant"]') ||
          el.querySelector('[data-author]') ||
          el.querySelector('.markdown') ||
          el.querySelector('.prose') ||
          el.querySelector('.whitespace-pre-wrap') ||
          (el.textContent && el.textContent.trim().length > 10)
        );
      });

      if (candidates.length > 0) {
        if (DEBUG || window.DEBUG_TEMP) console.log(`ChatGPT Navigation: Fallback选择器 ${fallbackSelector} 找到 ${candidates.length} 个候选对话`);
        return candidates;
      }
    }

    if (DEBUG) console.log('ChatGPT Navigation: 所有检测方法均失效');
    return [];
  }

  function getTextPreview(el) {
    if (!el) return '';
    const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return '...';
    // 让 CSS 负责根据宽度省略，JS 只做上限裁剪以防极端超长文本
    const HARD_CAP = 600;
    return text.length > HARD_CAP ? text.slice(0, HARD_CAP) : text;
  }

  function buildIndex() {
    const turns = qsTurns();
    if (!turns.length) {
      if (DEBUG || window.DEBUG_TEMP) console.log('ChatGPT Navigation: 没有找到任何对话元素');
      return [];
    }

    if (DEBUG) console.log(`ChatGPT Navigation: 开始分析 ${turns.length} 个对话元素`);

    let u = 0, a = 0;
    const list = [];
    for (let i = 0; i < turns.length; i++) {
      const el = turns[i];
      el.setAttribute('data-cgpt-turn', '1');
      const attrTestId = el.getAttribute('data-testid') || '';

      const isUser = !!(
        el.querySelector('[data-message-author-role="user"]') ||
        el.querySelector('.text-message[data-author="user"]') ||
        attrTestId.includes('user')
      );
      const isAssistant = !!(
        el.querySelector('[data-message-author-role="assistant"]') ||
        el.querySelector('.text-message[data-author="assistant"]') ||
        attrTestId.includes('assistant')
      );

      if (DEBUG && i < 3) {
        console.log(`ChatGPT Navigation Debug - 元素 ${i}:`, {
          element: el,
          testId: attrTestId,
          isUser,
          isAssistant,
          userSelectors: {
            authorRole: !!el.querySelector('[data-message-author-role="user"]'),
            textMessage: !!el.querySelector('.text-message[data-author="user"]'),
            testIdMatch: attrTestId.includes('user')
          },
          assistantSelectors: {
            authorRole: !!el.querySelector('[data-message-author-role="assistant"]'),
            textMessage: !!el.querySelector('.text-message[data-author="assistant"]'),
            testIdMatch: attrTestId.includes('assistant')
          }
        });
      }

      let block = null;
      if (isUser) {
        block = el.querySelector('[data-message-author-role="user"] .whitespace-pre-wrap, [data-message-author-role="user"] div[data-message-content-part], [data-message-author-role="user"] .prose, div[data-message-author-role="user"] p, .text-message[data-author="user"]');
      } else if (isAssistant) {
        block = el.querySelector('.deep-research-result, .border-token-border-sharp .markdown, [data-message-author-role="assistant"] .markdown, [data-message-author-role="assistant"] .prose, [data-message-author-role="assistant"] div[data-message-content-part], div[data-message-author-role="assistant"] p, .text-message[data-author="assistant"]');
      } else {
        if (DEBUG && i < 5) console.log(`ChatGPT Navigation: 元素 ${i} 角色识别失败`);
        continue;
      }

      const preview = getTextPreview(block);
      if (!preview) {
        if (DEBUG && i < 5) console.log(`ChatGPT Navigation: 元素 ${i} 无法提取预览文本`);
        continue;
      }

      if (!el.id) el.id = `cgpt-turn-${i + 1}`;
      const role = isUser ? 'user' : 'assistant';
      const seq = isUser ? ++u : ++a;
      const msgKey = el.getAttribute('data-message-id') || el.getAttribute('data-testid') || el.id;
      list.push({ id: el.id, key: msgKey, idx: i, role, preview, seq });
    }

    if (DEBUG) console.log(`ChatGPT Navigation: 成功识别 ${list.length} 个对话 (用户: ${u}, 助手: ${a})`);
    return list;
  }

  function createPanel() {
    // 样式去重：避免重复插入样式
    const styleId = 'cgpt-compact-nav-style';
    let style = document.getElementById(styleId);
    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
:root {
  --cgpt-nav-font: var(--font-family-default, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif);
  --cgpt-nav-radius: var(--token-radius-md, 6px);
  --cgpt-nav-radius-lg: var(--token-radius-lg, 8px);
  --cgpt-nav-panel-bg: var(--token-main-surface-tertiary, rgba(255,255,255,0.92));
  --cgpt-nav-panel-border: var(--token-border-subtle, rgba(15,23,42,0.08));
  --cgpt-nav-panel-shadow: var(--token-shadow-medium, 0 8px 24px rgba(15,23,42,0.12));
  --cgpt-nav-text-strong: var(--token-text-primary, rgba(17,24,39,0.92));
  --cgpt-nav-text-muted: var(--token-text-tertiary, rgba(71,85,105,0.78));
  --cgpt-nav-scrollbar-thumb: var(--token-scrollbar-thumb, rgba(15,23,42,0.18));
  --cgpt-nav-scrollbar-thumb-hover: var(--token-scrollbar-thumb-hover, rgba(15,23,42,0.3));
  --cgpt-nav-item-bg: var(--token-interactive-surface, rgba(255,255,255,0.85));
  --cgpt-nav-item-hover-bg: var(--token-interactive-surface-hover, rgba(255,255,255,0.95));
  --cgpt-nav-item-shadow: var(--token-shadow-small, 0 1px 2px rgba(15,23,42,0.08));
  --cgpt-nav-border-muted: var(--token-border-subtle, rgba(15,23,42,0.12));
  --cgpt-nav-accent: var(--token-brand-accent, #9333ea);
  --cgpt-nav-accent-subtle: var(--token-brand-accent-soft, rgba(147,51,234,0.12));
  --cgpt-nav-accent-strong: var(--token-brand-accent-strong, rgba(147,51,234,0.28));
  --cgpt-nav-positive: var(--token-text-positive, #00c896);
  --cgpt-nav-info: var(--token-text-info, #2ea5ff);
  --cgpt-nav-footer-bg: var(--token-interactive-surface, rgba(255,255,255,0.92));
  --cgpt-nav-footer-hover: var(--token-interactive-surface-hover, rgba(15,23,42,0.08));
}

@media (prefers-color-scheme: dark) {
  :root {
    --cgpt-nav-panel-bg: var(--token-main-surface-tertiary, rgba(32,33,35,0.92));
    --cgpt-nav-panel-border: var(--token-border-subtle, rgba(148,163,184,0.18));
    --cgpt-nav-panel-shadow: var(--token-shadow-medium, 0 16px 32px rgba(0,0,0,0.4));
    --cgpt-nav-text-strong: var(--token-text-primary, rgba(226,232,240,0.92));
    --cgpt-nav-text-muted: var(--token-text-tertiary, rgba(148,163,184,0.78));
    --cgpt-nav-scrollbar-thumb: var(--token-scrollbar-thumb, rgba(148,163,184,0.2));
    --cgpt-nav-scrollbar-thumb-hover: var(--token-scrollbar-thumb-hover, rgba(148,163,184,0.35));
    --cgpt-nav-item-bg: var(--token-interactive-surface, rgba(46,48,56,0.84));
    --cgpt-nav-item-hover-bg: var(--token-interactive-surface-hover, rgba(63,65,74,0.92));
    --cgpt-nav-item-shadow: var(--token-shadow-small, 0 1px 3px rgba(0,0,0,0.4));
    --cgpt-nav-border-muted: var(--token-border-subtle, rgba(148,163,184,0.25));
    --cgpt-nav-footer-bg: var(--token-interactive-surface, rgba(49,51,60,0.9));
    --cgpt-nav-footer-hover: var(--token-interactive-surface-hover, rgba(255,255,255,0.12));
    --cgpt-nav-accent-subtle: var(--token-brand-accent-soft, rgba(147,51,234,0.2));
    --cgpt-nav-accent-strong: var(--token-brand-accent-strong, rgba(147,51,234,0.45));
  }
}

html[data-theme='dark'] #cgpt-compact-nav,
body[data-theme='dark'] #cgpt-compact-nav { color-scheme: dark; }

html[data-theme='light'] #cgpt-compact-nav,
body[data-theme='light'] #cgpt-compact-nav { color-scheme: light; }

#cgpt-compact-nav { position: fixed; top: 60px; right: 10px; width: var(--cgpt-nav-width, auto); min-width: 80px; max-width: var(--cgpt-nav-width, 210px); z-index: 2147483647 !important; font-family: var(--cgpt-nav-font); font-size: 13px; pointer-events: auto; background: transparent; -webkit-user-select:none; user-select:none; -webkit-tap-highlight-color: transparent; color: var(--cgpt-nav-text-strong); color-scheme: light dark; }
#cgpt-compact-nav * { -webkit-user-select:none; user-select:none; }
.compact-header { display:flex; align-items:center; justify-content:space-between; padding:4px 8px; margin-bottom:4px; background:var(--cgpt-nav-panel-bg); border-radius:var(--cgpt-nav-radius-lg); border:1px solid var(--cgpt-nav-panel-border); pointer-events:auto; cursor:move; box-shadow:var(--cgpt-nav-panel-shadow); min-width:100px; backdrop-filter:saturate(180%) blur(18px); }
.compact-title { font-size:11px; font-weight:600; color:var(--cgpt-nav-text-muted); display:flex; align-items:center; gap:3px; text-transform:uppercase; letter-spacing:.04em; }
.compact-title span { color:var(--cgpt-nav-text-strong); }
.compact-title svg { width:12px; height:12px; opacity:.55; }
.compact-toggle, .compact-refresh { background:var(--cgpt-nav-item-bg); border:1px solid var(--cgpt-nav-border-muted); color:var(--cgpt-nav-text-strong); cursor:pointer; width:clamp(20px, calc(var(--cgpt-nav-width, 210px) / 10), 26px); height:clamp(20px, calc(var(--cgpt-nav-width, 210px) / 10), 26px); display:flex; align-items:center; justify-content:center; border-radius:var(--cgpt-nav-radius); transition:all .2s ease; font-weight:600; line-height:1; box-shadow:var(--cgpt-nav-item-shadow); backdrop-filter:saturate(180%) blur(18px); }
.compact-toggle { font-size:clamp(14px, calc(var(--cgpt-nav-width, 210px) / 14), 18px); }
.compact-refresh { font-size:clamp(12px, calc(var(--cgpt-nav-width, 210px) / 18), 14px); margin-left:4px; }
.compact-toggle:hover, .compact-refresh:hover { border-color:var(--cgpt-nav-accent-subtle); color:var(--cgpt-nav-accent); box-shadow:0 4px 14px rgba(147,51,234,0.12); background:var(--cgpt-nav-item-hover-bg); }
.compact-toggle:active, .compact-refresh:active { transform:scale(.94); }
.toggle-text { display:block; font-family:monospace; font-size:clamp(12px, calc(var(--cgpt-nav-width, 210px) / 14), 16px); }
  .compact-list { max-height:400px; overflow-y:auto; overflow-x:hidden; padding:0; pointer-events:auto; display:flex; flex-direction:column; gap:8px; scrollbar-width:thin; scrollbar-color:var(--cgpt-nav-scrollbar-thumb) transparent; }
.compact-list::-webkit-scrollbar { width:3px; }
.compact-list::-webkit-scrollbar-thumb { background:var(--cgpt-nav-scrollbar-thumb); border-radius:2px; }
.compact-list::-webkit-scrollbar-thumb:hover { background:var(--cgpt-nav-scrollbar-thumb-hover); }
.compact-item { display:block; padding:3px 8px; margin:0; border-radius:var(--cgpt-nav-radius); cursor:pointer; transition:all .16s ease; font-size:12px; line-height:1.4; min-height:20px; white-space:nowrap; overflow:hidden; /* 省略号交给 .compact-text */ pointer-events:auto; background:var(--cgpt-nav-item-bg); box-shadow:var(--cgpt-nav-item-shadow); width:auto; min-width:60px; max-width: calc(var(--cgpt-nav-width, 210px) - 20px); color:var(--cgpt-nav-text-strong); border:1px solid transparent; position:relative; padding-right:26px; }
.compact-item:hover { background:var(--cgpt-nav-item-hover-bg); transform:translateX(2px); box-shadow:0 6px 16px rgba(15,23,42,0.12); }
.compact-item.user { color:var(--cgpt-nav-positive); border-color:var(--cgpt-nav-positive); border-color:color-mix(in srgb, var(--cgpt-nav-positive) 45%, transparent); }
.compact-item.assistant { color:var(--cgpt-nav-info); border-color:var(--cgpt-nav-info); border-color:color-mix(in srgb, var(--cgpt-nav-info) 45%, transparent); }
.compact-item.active { outline:2px solid var(--cgpt-nav-accent); background:var(--cgpt-nav-accent-subtle); box-shadow:0 0 0 1px var(--cgpt-nav-accent-strong) inset, 0 12px 30px rgba(147,51,234,0.15); border-color:var(--cgpt-nav-accent-subtle); transform:translateX(2px); }
.compact-item.pin { color:var(--cgpt-nav-accent); border-color:color-mix(in srgb, var(--cgpt-nav-accent) 45%, transparent); }
.pin-label { font-weight:600; margin-right:4px; }
.compact-text { display:inline-block; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; vertical-align:bottom; }
.compact-number { display:inline-block; margin-right:4px; font-weight:600; color:var(--cgpt-nav-text-muted); font-size:11px; }
.compact-empty { padding:10px; text-align:center; color:var(--cgpt-nav-text-muted); font-size:11px; background:var(--cgpt-nav-panel-bg); border-radius:var(--cgpt-nav-radius-lg); pointer-events:auto; min-height:20px; line-height:1.4; border:1px dashed var(--cgpt-nav-border-muted); }

/* 收藏与锚点 */
  .compact-star { background:var(--cgpt-nav-item-bg); border:1px solid var(--cgpt-nav-border-muted); color:var(--cgpt-nav-text-strong); cursor:pointer; width:clamp(20px, calc(var(--cgpt-nav-width, 210px) / 10), 26px); height:clamp(20px, calc(var(--cgpt-nav-width, 210px) / 10), 26px); display:flex; align-items:center; justify-content:center; border-radius:var(--cgpt-nav-radius); transition:all .2s ease; font-weight:600; line-height:1; box-shadow:var(--cgpt-nav-item-shadow); backdrop-filter:saturate(180%) blur(18px); font-size:clamp(12px, calc(var(--cgpt-nav-width, 210px) / 14), 16px); margin-left:4px; }
  .compact-star:hover { border-color:var(--cgpt-nav-accent-subtle); color:var(--cgpt-nav-accent); box-shadow:0 4px 14px rgba(147,51,234,0.12); background:var(--cgpt-nav-item-hover-bg); }
  .compact-star.active { background:var(--cgpt-nav-accent-subtle); color:var(--cgpt-nav-accent); border-color:var(--cgpt-nav-accent-subtle); }
  .fav-toggle { position:absolute; right:6px; top:2px; border:none; background:transparent; color:var(--cgpt-nav-text-muted); cursor:pointer; font-size:12px; line-height:1; padding:2px; opacity:.7; }
  .fav-toggle:hover { color:var(--cgpt-nav-accent); opacity:1; }
  .fav-toggle.active { color:var(--cgpt-nav-accent); opacity:1; }
/* 锚点占位 */
  .cgpt-pin-anchor { display:inline-block; width:0; height:0; margin:0; padding:0; border:0; outline:0; overflow:visible; vertical-align:middle; }
  .cgpt-pin-anchor::after { content:'📌'; font-size:2.4em; line-height:1; margin-left:4px; opacity:.65; color:var(--cgpt-nav-accent); cursor:pointer; }
  .cgpt-pin-anchor:hover::after { opacity:1; transform:translateY(-1px); }

/* 调整宽度手柄 */
.cgpt-resize-handle { position:absolute; left:-5px; top:0; bottom:0; width:8px; cursor:ew-resize; background:transparent; }
.cgpt-resize-handle::after { content:''; position:absolute; left:2px; top:25%; bottom:25%; width:2px; background: var(--cgpt-nav-border-muted); border-radius:1px; opacity:.6; }

/* 底部导航条 */
.compact-footer { margin-top:6px; display:flex; gap:clamp(3px, calc(var(--cgpt-nav-width, 210px) / 70), 6px); }
.nav-btn { flex:1 1 auto; padding: clamp(4px, calc(var(--cgpt-nav-width, 210px) / 56), 6px) clamp(6px, calc(var(--cgpt-nav-width, 210px) / 35), 8px); font-size: clamp(12px, calc(var(--cgpt-nav-width, 210px) / 14), 14px); border-radius:var(--cgpt-nav-radius-lg); border:1px solid var(--cgpt-nav-border-muted); background:var(--cgpt-nav-footer-bg); cursor:pointer; box-shadow:var(--cgpt-nav-item-shadow); line-height:1; color:var(--cgpt-nav-text-strong); transition:all .18s ease; backdrop-filter:saturate(180%) blur(18px); }
.nav-btn:hover { background:var(--cgpt-nav-footer-hover); transform:translateY(-1px); }
.nav-btn:active { transform: translateY(1px); }

/* 上下箭头按钮 */
.nav-btn.arrow { background:var(--cgpt-nav-accent-subtle); border-color:var(--cgpt-nav-accent-subtle); color:var(--cgpt-nav-accent); font-weight:600; }
.nav-btn.arrow:hover { background:var(--cgpt-nav-accent-strong); border-color:var(--cgpt-nav-accent-strong); color:var(--token-text-on-accent, #ffffff); box-shadow:0 8px 24px rgba(147,51,234,0.25); }

/* 极窄模式布局：(顶)[ ↑ ][ ↓ ](底) */
#cgpt-compact-nav.narrow .compact-footer {
  display: grid;
  grid-template-columns:
    minmax(12px, clamp(14px, calc(var(--cgpt-nav-width, 210px) / 12), 18px))
    1fr 1fr
    minmax(12px, clamp(14px, calc(var(--cgpt-nav-width, 210px) / 12), 18px));
  align-items: stretch;
  gap: clamp(3px, calc(var(--cgpt-nav-width, 210px) / 70), 6px);
}
#cgpt-compact-nav.narrow #cgpt-nav-top,
#cgpt-compact-nav.narrow #cgpt-nav-bottom {
  padding: clamp(4px, calc(var(--cgpt-nav-width, 210px) / 56), 6px) 4px;
  font-size: clamp(12px, calc(var(--cgpt-nav-width, 210px) / 18), 14px);
  justify-self: stretch;
  align-self: stretch;
}
#cgpt-compact-nav.narrow #cgpt-nav-prev,
#cgpt-compact-nav.narrow #cgpt-nav-next {
  width: auto;
  min-width: 34px;
}

/* 移动端 */
@media (max-width: 768px) {
  #cgpt-compact-nav { right:5px; }
  .compact-item { font-size:11px; padding:2px 5px; min-height:18px; }
  .nav-btn { padding:5px 6px; font-size:13px; }
}

.highlight-pulse { animation: pulse 1.5s ease-out; }
@keyframes pulse { 0% { background-color: rgba(255,243,205,0); } 20% { background-color: rgba(168,218,255,0.3); } 100% { background-color: rgba(255,243,205,0); } }
`;
      document.head.appendChild(style);
      if (DEBUG || window.DEBUG_TEMP) console.log('ChatGPT Navigation: 已创建样式');
    } else {
      if (DEBUG || window.DEBUG_TEMP) console.log('ChatGPT Navigation: 样式已存在，跳过创建');
    }

    // 启动前清理多余面板（保险丝）
    const existingPanels = document.querySelectorAll('#cgpt-compact-nav');
    if (existingPanels.length > 0) {
      if (DEBUG || window.DEBUG_TEMP) console.log(`ChatGPT Navigation: 发现 ${existingPanels.length} 个已存在的面板，清理中...`);
      existingPanels.forEach((panel, index) => {
        if (index > 0) { // 保留第一个，删除其他
          panel.remove();
          if (DEBUG || window.DEBUG_TEMP) console.log(`ChatGPT Navigation: 已删除重复面板 ${index}`);
        }
      });
      // 如果已经有面板存在，直接返回现有的
      if (existingPanels.length > 0) {
        const existingNav = existingPanels[0];
        if (existingNav._ui) {
          if (DEBUG || window.DEBUG_TEMP) console.log('ChatGPT Navigation: 返回已存在的面板');
          return existingNav._ui;
        }
      }
    }

    const nav = document.createElement('div');
    nav.id = 'cgpt-compact-nav';
    nav.innerHTML = `
      <div class="compact-header">
        <div style="display: flex; align-items: center; gap: 4px;">
          <button class="compact-toggle" type="button" title="收起/展开"><span class="toggle-text">−</span></button>
          <button class="compact-refresh" type="button" title="刷新对话列表">⟳</button>
          <button class="compact-star" type="button" title="仅显示收藏">☆</button>
        </div>
      </div>
      <div class="compact-list" role="listbox" aria-label="对话项"></div>
      <div class="compact-footer">
        <button class="nav-btn" type="button" id="cgpt-nav-top" title="回到顶部">⤒</button>
        <button class="nav-btn arrow" type="button" id="cgpt-nav-prev" title="上一条（Cmd+↑ / Alt+↑）">↑</button>
        <button class="nav-btn arrow" type="button" id="cgpt-nav-next" title="下一条（Cmd+↓ / Alt+↓）">↓</button>
        <button class="nav-btn" type="button" id="cgpt-nav-bottom" title="回到底部">⤓</button>
      </div>
    `;
    document.body.appendChild(nav);
    let layout = {
      beginUserInteraction: () => {},
      endUserInteraction: () => {},
      notifyExternalPositionChange: () => {},
      scheduleEvaluation: () => {},
      captureManualPositions: () => {},
      destroy: () => {}
    };
    try {
      layout = createLayoutManager(nav) || layout;
    } catch (err) {
      if (DEBUG || window.DEBUG_TEMP) console.error('ChatGPT Navigation: 布局管理器初始化失败', err);
    }
    enableDrag(nav, {
      onDragStart: () => { try { layout.beginUserInteraction(); } catch {} },
      onDragEnd: () => { try { layout.endUserInteraction(); } catch {} }
    });
    enableResize(nav, layout);
    enableResponsiveClasses(nav);
    initCheckpoints(nav);
    applySavedWidth(nav);

    // 禁用面板内双击与文本选中
    nav.addEventListener('dblclick', (e) => { e.preventDefault(); e.stopPropagation(); }, { capture: true });
    nav.addEventListener('selectstart', (e) => { e.preventDefault(); }, { capture: true });
    nav.addEventListener('mousedown', (e) => { if (e.detail > 1) { e.preventDefault(); } }, { capture: true });

    const ui = { nav, layout };
    nav._ui = ui;
    return ui;
  }

  function createLayoutManager(nav) {
    const state = {
      nav,
      destroyed: false,
      userAdjusting: false,
      followLeft: false,
      followRight: false,
      leftMargin: DEFAULT_FOLLOW_MARGIN,
      rightMargin: DEFAULT_FOLLOW_MARGIN,
      manual: { top: 0, left: null, right: null },
      leftEl: null,
      rightEl: null,
      leftObserver: null,
      rightObserver: null,
      mutationObserver: null,
      resizeHandler: null,
      pendingEval: false,
      rafId: 0,
      rightRecheckTimer: 0,
      rightRecheckAttempts: 0,
      rightSavedPosition: null,
      rightFollowLoopId: 0
    };

    function captureManualPositions() {
      try {
        const rect = nav.getBoundingClientRect();
        const comp = window.getComputedStyle(nav);
        const topPx = parseFloat(comp.top);
        const leftPx = comp.left && comp.left !== 'auto' ? parseFloat(comp.left) : null;
        const rightPx = comp.right && comp.right !== 'auto' ? parseFloat(comp.right) : null;
        state.manual = {
          top: Number.isFinite(topPx) ? topPx : rect.top,
          left: Number.isFinite(leftPx) ? leftPx : null,
          right: Number.isFinite(rightPx) ? rightPx : null
        };
      } catch {
        state.manual = { top: 60, left: null, right: 10 };
      }
    }
    captureManualPositions();

    function cancelPending() {
      if (state.rafId) {
        cancelAnimationFrame(state.rafId);
        state.rafId = 0;
      }
      state.pendingEval = false;
    }

    function scheduleEvaluation(reason) {
      if (state.destroyed || state.userAdjusting) return;
      if (state.pendingEval) return;
      state.pendingEval = true;
      state.rafId = requestAnimationFrame(() => {
        state.rafId = 0;
        state.pendingEval = false;
        try { evaluateNow(reason); } catch (err) { if (DEBUG || window.DEBUG_TEMP) console.error('ChatGPT Navigation layout evaluate error:', err); }
      });
    }

    function clearRightRecheck() {
      if (state.rightRecheckTimer) {
        clearTimeout(state.rightRecheckTimer);
        state.rightRecheckTimer = 0;
      }
      state.rightRecheckAttempts = 0;
    }

    function releaseRightFollow() {
      const saved = state.rightSavedPosition || state.manual || null;
      state.followRight = false;
      state.rightSavedPosition = null;
      stopRightFollowLoop();
      if (saved && Number.isFinite(saved.top)) {
        nav.style.top = `${Math.round(saved.top)}px`;
      }
      if (saved) {
        if (Number.isFinite(saved.right)) {
          nav.style.right = `${Math.round(saved.right)}px`;
          nav.style.left = 'auto';
        } else if (Number.isFinite(saved.left)) {
          nav.style.left = `${Math.round(saved.left)}px`;
          nav.style.right = 'auto';
        } else {
          nav.style.right = `${DEFAULT_FOLLOW_MARGIN}px`;
          nav.style.left = 'auto';
        }
      } else {
        nav.style.right = `${DEFAULT_FOLLOW_MARGIN}px`;
        nav.style.left = 'auto';
      }
      captureManualPositions();
    }

    function requestRightRecheck() {
      if (state.rightRecheckTimer) return;
      const attempts = Number.isFinite(state.rightRecheckAttempts) ? state.rightRecheckAttempts : 0;
      const clamped = attempts > 8 ? 8 : attempts;
      const delay = 180 + clamped * 70;
      state.rightRecheckAttempts = attempts + 1;
      state.rightRecheckTimer = window.setTimeout(() => {
        state.rightRecheckTimer = 0;
        scheduleEvaluation('right-recheck');
      }, delay);
    }

    function stopRightFollowLoop() {
      if (state.rightFollowLoopId) {
        cancelAnimationFrame(state.rightFollowLoopId);
        state.rightFollowLoopId = 0;
      }
    }

    function ensureRightFollowLoop() {
      if (state.rightFollowLoopId) return;
      state.rightFollowLoopId = requestAnimationFrame(() => {
        state.rightFollowLoopId = 0;
        scheduleEvaluation('right-loop');
      });
    }

    function beginUserInteraction() {
      if (state.destroyed) return;
      state.userAdjusting = true;
      state.followLeft = false;
      state.followRight = false;
      state.rightSavedPosition = null;
      stopRightFollowLoop();
      cancelPending();
    }

    function endUserInteraction() {
      if (state.destroyed) return;
      state.userAdjusting = false;
      captureManualPositions();
      scheduleEvaluation('user-adjust');
    }

    function notifyExternalPositionChange() {
      if (state.destroyed) return;
      state.followLeft = false;
      state.followRight = false;
      state.rightSavedPosition = null;
      stopRightFollowLoop();
      captureManualPositions();
      scheduleEvaluation('external-position');
    }

    function updateObservedElements() {
      const leftEl = findLeftSidebarElement();
      if (leftEl !== state.leftEl) {
        if (state.leftObserver) {
          try { state.leftObserver.disconnect(); } catch {}
          state.leftObserver = null;
        }
        state.leftEl = leftEl;
        if (leftEl && window.ResizeObserver) {
          try {
            const ro = new ResizeObserver(() => scheduleEvaluation('left-resize'));
            ro.observe(leftEl);
            state.leftObserver = ro;
          } catch {}
        }
      }

      const rightEl = findRightPanelElement();
      if (rightEl !== state.rightEl) {
        if (state.rightObserver) {
          try { state.rightObserver.disconnect(); } catch {}
          state.rightObserver = null;
        }
        state.rightEl = rightEl;
        if (rightEl && window.ResizeObserver) {
          try {
            const ro = new ResizeObserver(() => scheduleEvaluation('right-resize'));
            ro.observe(rightEl);
            state.rightObserver = ro;
          } catch {}
        }
        if (rightEl) {
          state.rightRecheckAttempts = 0;
          requestRightRecheck();
        } else {
          clearRightRecheck();
        }
      }
    }

    function evaluateNow(reason) {
      if (state.destroyed || state.userAdjusting) return;
      updateObservedElements();

      const navRect = nav.getBoundingClientRect();
      try {
        const panel = state.rightEl ? getVisibleRect(state.rightEl, 0) : null;
        if (nav && nav.dataset) {
          nav.dataset.cgptLayout = JSON.stringify({
            t: Date.now(),
            reason,
            followRight: !!state.followRight,
            navRight: navRect ? navRect.right : null,
            panelLeft: panel ? panel.left : null
          });
        }
      } catch {}
      if (!navRect || !Number.isFinite(navRect.left) || navRect.width <= 0) return;

      const leftRect = state.leftEl ? getVisibleRect(state.leftEl, 0.5) : null;
      if (!state.followLeft && leftRect && overlapsLeft(navRect, leftRect)) {
        const gap = navRect.left - leftRect.right;
        state.leftMargin = Number.isFinite(gap) && gap > DEFAULT_FOLLOW_MARGIN ? gap : DEFAULT_FOLLOW_MARGIN;
        state.followLeft = true;
      }

      if (state.followLeft) {
        applyLeftFollow(leftRect, navRect);
        if (state.followRight) state.followRight = false;
        return;
      }

      const rightRect = state.rightEl ? getVisibleRect(state.rightEl, 0.5) : null;
      if (!state.rightEl) {
        if (state.followRight) releaseRightFollow();
        clearRightRecheck();
      } else if (!rightRect) {
        if (state.followRight) releaseRightFollow();
        requestRightRecheck();
      } else {
        clearRightRecheck();
      }
      if (!state.followRight && rightRect && overlapsRight(navRect, rightRect)) {
        if (!state.rightSavedPosition) {
          const manual = state.manual || {};
          state.rightSavedPosition = {
            top: Number.isFinite(manual.top) ? manual.top : navRect.top,
            left: Number.isFinite(manual.left) ? manual.left : null,
            right: Number.isFinite(manual.right) ? manual.right : null
          };
        }
        const gap = rightRect.left - navRect.right;
        state.rightMargin = Number.isFinite(gap) && gap > DEFAULT_FOLLOW_MARGIN ? gap : DEFAULT_FOLLOW_MARGIN;
        state.followRight = true;
      }

      if (state.followRight) {
        if (!state.rightEl || !rightRect) {
          releaseRightFollow();
        } else {
          applyRightFollow(rightRect, navRect);
        }
      }

      if (state.followRight) ensureRightFollowLoop();
      else stopRightFollowLoop();
    }

    function applyLeftFollow(panelRect, cachedNavRect) {
      const rect = cachedNavRect || nav.getBoundingClientRect();
      const navWidth = rect.width || nav.offsetWidth || 210;
      const margin = Number.isFinite(state.leftMargin) ? state.leftMargin : DEFAULT_FOLLOW_MARGIN;
      let targetLeft = margin;
      if (panelRect) targetLeft = panelRect.right + margin;
      const maxLeft = Math.max(0, window.innerWidth - navWidth - DEFAULT_FOLLOW_MARGIN);
      if (targetLeft > maxLeft) targetLeft = maxLeft;
      if (targetLeft < 0) targetLeft = 0;
      const currentLeft = parseFloat(nav.style.left || '');
      if (!Number.isFinite(currentLeft) || Math.abs(currentLeft - targetLeft) > 0.5) {
        nav.style.left = `${Math.round(targetLeft)}px`;
      }
      nav.style.right = 'auto';
      captureManualPositions();
    }

    function applyRightFollow(panelRect, cachedNavRect) {
      const rect = cachedNavRect || nav.getBoundingClientRect();
      const navWidth = rect.width || nav.offsetWidth || 210;
      const margin = Number.isFinite(state.rightMargin) ? state.rightMargin : DEFAULT_FOLLOW_MARGIN;
      let targetRight = margin;
      if (panelRect) {
        const panelWidth = window.innerWidth - panelRect.left;
        targetRight = panelWidth + margin;
      }
      const maxRight = Math.max(DEFAULT_FOLLOW_MARGIN, window.innerWidth - navWidth);
      if (targetRight > maxRight) targetRight = maxRight;
      if (targetRight < DEFAULT_FOLLOW_MARGIN) targetRight = DEFAULT_FOLLOW_MARGIN;
      const currentRight = parseFloat(nav.style.right || '');
      if (!Number.isFinite(currentRight) || Math.abs(currentRight - targetRight) > 0.5) {
        nav.style.right = `${Math.round(targetRight)}px`;
      }
      nav.style.left = 'auto';
      captureManualPositions();
    }

    function destroy() {
      state.destroyed = true;
      cancelPending();
      if (state.leftObserver) { try { state.leftObserver.disconnect(); } catch {} }
      if (state.rightObserver) { try { state.rightObserver.disconnect(); } catch {} }
      if (state.mutationObserver) { try { state.mutationObserver.disconnect(); } catch {} }
      if (state.resizeHandler) { window.removeEventListener('resize', state.resizeHandler); }
      if (state.rightRecheckTimer) {
        clearTimeout(state.rightRecheckTimer);
        state.rightRecheckTimer = 0;
      }
      state.rightRecheckAttempts = 0;
      state.rightSavedPosition = null;
      if (state.rightFollowLoopId) {
        cancelAnimationFrame(state.rightFollowLoopId);
        state.rightFollowLoopId = 0;
      }
      state.leftObserver = null;
      state.rightObserver = null;
      state.mutationObserver = null;
    }

    state.mutationObserver = new MutationObserver(() => scheduleEvaluation('mutation'));
    try { state.mutationObserver.observe(document.body, { childList: true, subtree: true }); } catch {}

    state.resizeHandler = () => scheduleEvaluation('resize');
    window.addEventListener('resize', state.resizeHandler, { passive: true });

    scheduleEvaluation('init');

    return {
      beginUserInteraction,
      endUserInteraction,
      notifyExternalPositionChange,
      scheduleEvaluation,
      captureManualPositions,
      destroy
    };
  }

  function getVisibleRect(el, minSize) {
    if (!el) return null;
    try {
      const rect = el.getBoundingClientRect();
      if (!rect) return null;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return null;
      if ((rect.width || 0) <= minSize && (rect.height || 0) <= minSize) return null;
      return rect;
    } catch { return null; }
  }

  function findLeftSidebarElement() {
    const candidates = [
      document.getElementById('stage-slideover-sidebar'),
      document.querySelector('nav[aria-label="Chat history"]'),
      document.querySelector('[data-testid="chat-history"]')
    ];
    for (const el of candidates) {
      if (el) return el;
    }
    return null;
  }

  function findRightPanelElement() {
    return document.querySelector('section[data-testid="screen-threadFlyOut"]');
  }

  function overlapsLeft(navRect, panelRect) {
    return navRect.left < (panelRect.right - 4);
  }

  function overlapsRight(navRect, panelRect) {
    return navRect.right > (panelRect.left + 4);
  }

  function enableResponsiveClasses(nav) {
    try {
      const ro = new ResizeObserver((entries) => {
        const r = entries[0].contentRect;
        const w = r ? r.width : nav.getBoundingClientRect().width;
        nav.classList.toggle('narrow', w <= 160);
      });
      ro.observe(nav);
      nav._ro = ro;
    } catch {}
  }

  function enableDrag(nav, opts = {}) {
    const header = nav.querySelector('.compact-header');
    const onDragStart = typeof opts.onDragStart === 'function' ? opts.onDragStart : null;
    const onDragMove = typeof opts.onDragMove === 'function' ? opts.onDragMove : null;
    const onDragEnd = typeof opts.onDragEnd === 'function' ? opts.onDragEnd : null;
    let isDragging = false, startX, startY, startRight, startTop;
    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('.compact-toggle, .compact-refresh, .compact-star')) return;
      isDragging = true; startX = e.clientX; startY = e.clientY;
      const rect = nav.getBoundingClientRect();
      startTop = rect.top;
      startRight = Math.max(0, window.innerWidth - rect.right);
      if (onDragStart) {
        try { onDragStart(e); } catch {}
      }
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      const newRight = Math.max(0, startRight - dx);
      nav.style.right = `${newRight}px`;
      nav.style.left = 'auto';
      nav.style.top = `${startTop + dy}px`;
      if (onDragMove) {
        try { onDragMove(e); } catch {}
      }
    });
    document.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      if (onDragEnd) {
        try { onDragEnd(); } catch {}
      }
    });
  }

  // ===== 检查点与宽度调整 =====
  function getConvKey() { try { return location.pathname || 'root'; } catch { return 'root'; } }

  function loadCPSet() {
    try {
      const key = CP_KEY_PREFIX + getConvKey();
      const obj = GM_getValue ? GM_getValue(key, {}) : (JSON.parse(localStorage.getItem(key) || '{}'));
      cpMap = new Map();
      for (const k of Object.keys(obj || {})) {
        const v = obj[k];
        if (v && typeof v === 'object' && v.anchorId && v.msgKey) {
          // 保留新增字段：frac 和 ctx，用于字符级精确还原
          cpMap.set(k, {
            msgKey: v.msgKey,
            anchorId: v.anchorId,
            created: v.created || Date.now(),
            frac: (typeof v.frac === 'number' ? v.frac : undefined),
            ctx: v.ctx || null
          });
        } else {
          // 兼容旧数据：仅时间戳，视为无 anchor 的过期项
          const ts = (typeof v === 'number' && isFinite(v)) ? v : Date.now();
          cpMap.set(k, { msgKey: k, anchorId: null, created: ts });
        }
      }
    } catch {
      cpMap = new Map();
    }
  }

  function saveCPSet() {
    try {
      const key = CP_KEY_PREFIX + getConvKey();
      const obj = {};
      cpMap.forEach((meta, k) => { obj[k] = meta; });
      if (GM_setValue) GM_setValue(key, obj);
      else localStorage.setItem(key, JSON.stringify(obj));
    } catch {}
  }

  // ===== 收藏夹存取 =====
  function getFavKeys() { return FAV_KEY_PREFIX + getConvKey(); }
  function getFavFilterKey() { return FAV_FILTER_PREFIX + getConvKey(); }
  function loadFavSet() {
    try {
      const key = getFavKeys();
      const obj = GM_getValue ? GM_getValue(key, {}) : (JSON.parse(localStorage.getItem(key) || '{}'));
      favSet = new Set();
      favMeta = new Map();
      for (const k of Object.keys(obj || {})) {
        const v = obj[k];
        const created = (v && typeof v === 'object' && typeof v.created === 'number') ? v.created : (typeof v === 'number' ? v : Date.now());
        favSet.add(k);
        favMeta.set(k, { created });
      }
    } catch { favSet = new Set(); favMeta = new Map(); }
  }
  function saveFavSet() {
    try {
      const key = getFavKeys();
      const obj = {};
      for (const k of favSet.values()) {
        const meta = favMeta.get(k) || { created: Date.now() };
        obj[k] = { created: meta.created };
      }
      if (GM_setValue) GM_setValue(key, obj);
      else localStorage.setItem(key, JSON.stringify(obj));
    } catch {}
  }
  function loadFavFilterState() {
    try {
      const k = getFavFilterKey();
      filterFav = GM_getValue ? !!GM_getValue(k, false) : (localStorage.getItem(k) === '1');
    } catch { filterFav = false; }
  }
  function saveFavFilterState() {
    try {
      const k = getFavFilterKey();
      if (GM_setValue) GM_setValue(k, !!filterFav);
      else localStorage.setItem(k, filterFav ? '1' : '0');
    } catch {}
  }
  function toggleFavorite(key) {
    if (!key) return;
    if (!favSet || !(favSet instanceof Set)) loadFavSet();
    if (favSet.has(key)) { favSet.delete(key); favMeta.delete(key); }
    else { favSet.add(key); favMeta.set(key, { created: Date.now() }); }
    saveFavSet();
  }

  // 过滤状态与收藏开关已移除

  function runCheckpointGC(saveAfter = false) {
    let removed = 0;
    const now = Date.now();
    for (const [k, v] of Array.from(cpMap.entries())) {
      const created = (v && typeof v === 'object') ? (v.created || 0) : (typeof v === 'number' ? v : 0);
      if (!created || (now - created) > CP_TTL_MS) {
        cpMap.delete(k);
        removed++;
      }
    }
    if (removed && saveAfter) saveCPSet();
    // 顺带移除已失效图钉的收藏
    let favRemoved = 0;
    try {
      if (favSet && favSet.size) {
        for (const key of Array.from(favSet.values())) {
          if (typeof key === 'string' && key.startsWith('pin-') && !cpMap.has(key)) {
            favSet.delete(key);
            favMeta.delete(key);
            favRemoved++;
          }
        }
        if (favRemoved) saveFavSet();
      }
    } catch {}
    return removed;
  }

  // 星标过滤按钮已移除

  function initCheckpoints(nav) {
    loadCPSet();
    runCheckpointGC(true);
    loadFavSet();
    loadFavFilterState();
    updateStarBtnState({ nav });
  }

  function applySavedWidth(nav) {
    try {
      const w = GM_getValue ? GM_getValue(WIDTH_KEY, 0) : parseInt(localStorage.getItem(WIDTH_KEY) || '0', 10);
      if (w && w >= 100 && w <= 480) {
        nav.style.setProperty('--cgpt-nav-width', `${w}px`);
      } else {
        if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) {
          nav.style.setProperty('--cgpt-nav-width', '160px');
        } else {
          nav.style.setProperty('--cgpt-nav-width', '210px');
        }
      }
    } catch {}
  }

  function saveWidth(px) {
    try {
      if (GM_setValue) GM_setValue(WIDTH_KEY, px);
      else localStorage.setItem(WIDTH_KEY, String(px));
    } catch {}
  }

  function enableResize(nav, layout) {
    const handle = document.createElement('div');
    handle.className = 'cgpt-resize-handle';
    nav.appendChild(handle);

    let startX = 0; let startW = 0; let resizing = false; let startRight = 0;
    const MIN_W = 100, MAX_W = 480;

    const onMove = (e) => {
      if (!resizing) return;
      const dx = e.clientX - startX; // 把手在左侧，向左拖动是负数 -> 增加宽度
      // 基于左侧把手：宽度随dx变化，同时保持右边界不动
      let w = startW - dx; // 向右拖动(正)减小宽度，向左拖动(负)增大宽度
      w = Math.max(MIN_W, Math.min(MAX_W, w));
      const newLeft = startRight - w; // 右边界固定在按下时的位置
      nav.style.left = `${Math.round(newLeft)}px`;
      nav.style.right = 'auto';
      nav.style.setProperty('--cgpt-nav-width', `${Math.round(w)}px`);
    };
    const onUp = (e) => {
      if (!resizing) return;
      resizing = false;
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
      const comp = getComputedStyle(nav);
      const w = parseFloat((comp.getPropertyValue('--cgpt-nav-width') || '').replace('px','')) || nav.getBoundingClientRect().width;
      saveWidth(Math.round(w));
      if (layout && typeof layout.endUserInteraction === 'function') {
        try { layout.endUserInteraction(); } catch {}
      }
    };

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      resizing = true;
      startX = e.clientX;
      const rect = nav.getBoundingClientRect();
      startW = rect.width;
      startRight = rect.right;
      if (layout && typeof layout.beginUserInteraction === 'function') {
        try { layout.beginUserInteraction(); } catch {}
      }
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('mouseup', onUp, true);
    }, true);

    handle.addEventListener('dblclick', (e) => {
      e.preventDefault(); e.stopPropagation();
      const def = (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) ? 160 : 210;
      nav.style.setProperty('--cgpt-nav-width', `${def}px`);
      saveWidth(def);
      if (layout && typeof layout.notifyExternalPositionChange === 'function') {
        try { layout.notifyExternalPositionChange(); } catch {}
      }
    }, true);
  }

  let cacheIndex = [];

  function renderList(ui) {
    const list = ui.nav.querySelector('.compact-list');
    if (!list) return;
    const removed = runCheckpointGC(false);
    if (removed) { saveCPSet(); }
    // 清理已失效的收藏（不再存在的消息或图钉）
    const nextFull = cacheIndex;
    const validKeys = new Set(nextFull.map(i => i.key));
    const favRemoved = runFavoritesGC(false, validKeys);
    if (favRemoved) updateStarBtnState(ui);
    const next = filterFav ? nextFull.filter(it => favSet.has(it.key)) : nextFull;
    if (!next.length) { list.innerHTML = `<div class="compact-empty">${filterFav ? '暂无收藏' : '暂无对话'}</div>`; return; }
    list.innerHTML = '';
    for (const item of next) {
      const node = document.createElement('div');
      const fav = favSet.has(item.key);
      node.className = `compact-item ${item.role} ${fav ? 'has-fav' : ''}`;
      node.dataset.id = item.id;
      node.dataset.key = item.key;
      if (item.role === 'pin') {
        node.classList.add('pin');
        node.title = 'Option+单击删除📌';
        node.innerHTML = `<span class="pin-label">${escapeHtml(item.preview)}</span><button class="fav-toggle ${fav ? 'active' : ''}" type="button" title="收藏/取消收藏">★</button>`;
      } else {
        node.innerHTML = `<span class="compact-number">${item.idx + 1}.</span><span class="compact-text" title="${escapeAttr(item.preview)}">${escapeHtml(item.preview)}</span><button class="fav-toggle ${fav ? 'active' : ''}" type="button" title="收藏/取消收藏">★</button>`;
      }
      node.setAttribute('draggable', 'false');
      list.appendChild(node);
    }
    if (!list._eventBound) {
      list.addEventListener('click', (e) => {
        // 行内收藏切换
        const star = e.target.closest('.fav-toggle');
        if (star) {
          e.stopPropagation();
          const row = star.closest('.compact-item');
          if (row) {
            const key = row.dataset.key;
            toggleFavorite(key);
            updateStarBtnState(ui);
            renderList(ui);
          }
          return;
        }
        const item = e.target.closest('.compact-item');
        if (!item) return;
        // 删除📌：Option+单击在📌行
        if (e.altKey && item.classList.contains('pin')) {
          const pinId = item.dataset.key;
          if (pinId && cpMap.has(pinId)) {
            const meta = cpMap.get(pinId);
            // 尝试移除旧锚点
            try { const old = document.getElementById(meta.anchorId); if (old) old.remove(); } catch {}
            cpMap.delete(pinId);
            if (favSet.has(pinId)) { favSet.delete(pinId); favMeta.delete(pinId); saveFavSet(); updateStarBtnState(ui); }
            saveCPSet();
            renderList(ui);
            return;
          }
        }
        const el = document.getElementById(item.dataset.id);
        if (el) {
          setActiveTurn(item.dataset.id);
          scrollToTurn(el);
        }
      });
      list._eventBound = true;
    }
    scheduleActiveUpdateNow();
  }

  function refreshIndex(ui) {
    const base = buildIndex();
    const next = composeWithPins(base);
    if (DEBUG) console.log('ChatGPT Navigation: turns', next.length, '(含📌)');
    lastTurnCount = next.length;
    cacheIndex = next;
    renderList(ui);
  }

  // 将📌插入到对应消息之后
  function composeWithPins(baseList) {
    try { if (!cpMap || !(cpMap instanceof Map)) loadCPSet(); } catch {}
    const pins = [];
    let needSave = false;
    cpMap.forEach((meta, pinId) => {
      if (!meta || typeof meta !== 'object') return;
      const msgKey = meta.msgKey;
      if (!msgKey) return;
      let anchorId = meta.anchorId;
      if (!anchorId || !document.getElementById(anchorId)) {
        anchorId = resolvePinAnchor(meta);
        if (anchorId) { meta.anchorId = anchorId; needSave = true; }
      }
      if (!anchorId) return; // 无法解析，跳过
      try { const ae = document.getElementById(anchorId); if (ae) ae.setAttribute('data-pin-id', pinId); } catch {}
      const created = meta.created || 0;
      pins.push({ pinId, msgKey, anchorId, created });
    });
    if (needSave) saveCPSet();

    // 按消息分组
    const byMsg = new Map();
    for (const p of pins) {
      if (!byMsg.has(p.msgKey)) byMsg.set(p.msgKey, []);
      byMsg.get(p.msgKey).push(p);
    }

    // 构建合成列表
    const combined = [];
    // 先预计算锚点y用于排序
    const getY = (id) => {
      const el = document.getElementById(id);
      if (!el) return Infinity;
      const r = el.getBoundingClientRect();
      return r ? r.top : Infinity;
    };

    // 全局📌编号
    let pinSeq = 0;
    for (const item of baseList) {
      combined.push(item);
      const arr = byMsg.get(item.key);
      if (!arr || !arr.length) continue;
      arr.sort((a,b) => {
        const ya = getY(a.anchorId), yb = getY(b.anchorId);
        if (ya !== yb) return ya - yb;
        return a.created - b.created;
      });
      for (const p of arr) {
        pinSeq++;
        combined.push({
          id: p.anchorId,
          key: p.pinId,
          parentKey: item.key,
          idx: item.idx, // 用父消息的 idx 保持相邻
          role: 'pin',
          preview: `📌${pinSeq}`,
          seq: pinSeq
        });
      }
    }
    return combined;
  }

  function resolvePinAnchor(meta) {
    try {
      const { msgKey, frac, ctx } = meta;
      const turn = findTurnByKey(msgKey);
      if (!turn) return null;
      const id = `cgpt-pin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;
      const span = document.createElement('span');
      span.id = id;
      span.className = 'cgpt-pin-anchor';

      // 1) 优先：按路径+偏移恢复
      if (ctx && ctx.p != null) {
        const el = resolveElementPath(turn, ctx.p);
        if (el) {
          const r = createCollapsedRangeAtElementOffset(el, ctx.o || 0);
          try {
            r.insertNode(span);
            // 自愈：补齐旧数据缺失的 ctx/frac
            if (!meta.ctx) meta.ctx = { p: ctx.p, o: ctx.o || 0 };
            if (typeof meta.frac !== 'number') {
              const measureEl = getTurnMeasureEl(turn);
              const mrect = measureEl.getBoundingClientRect();
              const sr = span.getBoundingClientRect();
              const h = Math.max(1, mrect.height || 1);
              meta.frac = h ? Math.max(0, Math.min(1, (sr.top - mrect.top) / h)) : 0.0;
            }
            return id;
          } catch {}
        }
      }

      // 2) 其次：按 frac 在内容容器内恢复
      const measureEl = getTurnMeasureEl(turn);
      const mrect = measureEl.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, typeof frac === 'number' ? frac : 0.0));
      const targetY = mrect.top + f * Math.max(1, mrect.height);
      const targetX = mrect.left + Math.max(4, mrect.width * 0.5);
      const r2 = findNearestCharRange(measureEl, targetX, targetY) || findNearestCharRange(turn, targetX, targetY);
      if (r2) {
        try {
          r2.insertNode(span);
          // 自愈：为缺失信息的旧数据补齐 ctx/frac
          meta.frac = f;
          try { meta.ctx = extractRangeInfo(r2, turn) || meta.ctx || null; } catch {}
          return id;
        } catch {}
      }

      // 3) 最后兜底
      const target = findNodeAtYWithin(turn, targetY) || findTurnAnchor(turn) || turn;
      try {
        target.parentNode?.insertBefore(span, target);
        // 兜底也尽量记录一个 frac 值
        try {
          const sr = span.getBoundingClientRect();
          const h = Math.max(1, mrect.height || 1);
          meta.frac = h ? Math.max(0, Math.min(1, (sr.top - mrect.top) / h)) : (typeof meta.frac === 'number' ? meta.frac : 0.0);
        } catch {}
        return id;
      } catch {}
      try { turn.appendChild(span); return id; } catch {}
    } catch {}
    return null;
  }

  function findTurnByKey(key) {
    const turns = qsTurns();
    for (const t of turns) {
      const k = t.getAttribute('data-message-id') || t.getAttribute('data-testid') || t.id;
      if (k === key) return t;
    }
    return null;
  }

  function findNodeAtYWithin(root, y) {
    const blocks = root.querySelectorAll('p,li,pre,code,blockquote,h1,h2,h3,h4,h5,h6, .markdown > *, .prose > *');
    let best = null, bestDist = Infinity;
    for (const el of blocks) {
      if (!root.contains(el)) continue;
      const r = el.getBoundingClientRect();
      if (!r || r.height === 0) continue;
      const cy = r.top + r.height / 2;
      const d = Math.abs(cy - y);
      if (d < bestDist) { bestDist = d; best = el; }
    }
    return best;
  }

  function getScrollRoot(start) {
    let el = start || null;
    while (el && el !== document.documentElement && el !== document.body) {
      const s = getComputedStyle(el);
      if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el;
      el = el.parentElement;
    }
    const doc = document.scrollingElement || document.documentElement;
    const candidates = [
      document.querySelector('[data-testid="conversation-turns"]')?.parentElement,
      document.querySelector('main[role="main"]'),
      doc
    ];
    for (const c of candidates) {
      if (!c) continue;
      const s = getComputedStyle(c);
      if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && c.scrollHeight > c.clientHeight + 1) return c;
    }
    return doc;
  }

  function getFixedHeaderHeight() {
    const h = document.querySelector('header, [data-testid="top-nav"]');
    if (!h) return 0;
    const r = h.getBoundingClientRect();
    return Math.max(0, r.height) + 12;
  }

  function findTurnAnchor(root) {
    if (!root) return null;
    if (root.classList && root.classList.contains('cgpt-pin-anchor')) return root;
    const selectors = [
      '[data-message-author-role] .whitespace-pre-wrap',
      '[data-message-content-part]',
      '.deep-research-result .markdown',
      '.border-token-border-sharp .markdown',
      '[data-message-author-role] .markdown',
      '[data-message-author-role] .prose',
      '.text-message',
      'article .markdown',
      '.prose p',
      'p','li','pre','code','blockquote'
    ];
    for (const s of selectors) {
      const n = root.querySelector(s);
      if (n && n.offsetParent !== null && n.offsetHeight > 0) return n;
    }
    return root;
  }

  function scrollToTurn(el) {
    const anchor = findTurnAnchor(el) || el;
    const margin = Math.max(0, getFixedHeaderHeight());
    try {
      anchor.style.scrollMarginTop = margin + 'px';
      requestAnimationFrame(() => {
        anchor.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'smooth' });
        postScrollNudge(el);
      });
    } catch {
      const scroller = getScrollRoot(anchor);
      const scRect = scroller.getBoundingClientRect ? scroller.getBoundingClientRect() : { top: 0 };
      const isWindow = (scroller === document.documentElement || scroller === document.body);
      const base = isWindow ? window.scrollY : scroller.scrollTop;
      const top = base + anchor.getBoundingClientRect().top - scRect.top - margin;
      if (isWindow) window.scrollTo({ top, behavior: 'smooth' });
      else scroller.scrollTo({ top, behavior: 'smooth' });
      postScrollNudge(el);
    }
    el.classList.add('highlight-pulse');
    anchor.classList.add('highlight-pulse');
    setTimeout(() => { el.classList.remove('highlight-pulse'); anchor.classList.remove('highlight-pulse'); }, 1600);
  }

  function postScrollNudge(targetEl) {
    let tries = 0;
    const step = () => {
      tries++;
      const y = getAnchorY();
      const r = targetEl.getBoundingClientRect();
      const diff = r.top - y;
      if (diff > 1 && tries <= 6) {
        const scroller = getScrollRoot(targetEl);
        const isWindow = (scroller === document.documentElement || scroller === document.body);
        if (isWindow) window.scrollBy(0, diff + 1);
        else scroller.scrollBy({ top: diff + 1 });
        requestAnimationFrame(step);
      } else {
        scheduleActiveUpdateNow();
      }
    };
    requestAnimationFrame(step);
  }

  function wirePanel(ui) {
    const toggleBtn = ui.nav.querySelector('.compact-toggle');
    const refreshBtn = ui.nav.querySelector('.compact-refresh');
    const starBtn = ui.nav.querySelector('.compact-star');

    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const list = ui.nav.querySelector('.compact-list');
        const toggleText = toggleBtn.querySelector('.toggle-text');
        const isHidden = list.getAttribute('data-hidden') === '1';
        if (isHidden) {
          list.style.visibility = 'visible'; list.style.height = ''; list.style.overflow = '';
          list.setAttribute('data-hidden', '0'); toggleText.textContent = '−';
        } else {
          list.style.visibility = 'hidden'; list.style.height = '0'; list.style.overflow = 'hidden';
          list.setAttribute('data-hidden', '1'); toggleText.textContent = '+';
        }
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', (e) => {
        if (e.shiftKey) {
          // Shift+点击 = 强制重新扫描
          if (DEBUG || window.DEBUG_TEMP) console.log('ChatGPT Navigation: 强制重新扫描 (清除缓存选择器)');
          TURN_SELECTOR = null; // 重置选择器缓存
          const originalBg = refreshBtn.style.background;
          const originalColor = refreshBtn.style.color;
          refreshBtn.style.background = 'var(--cgpt-nav-accent-subtle)';
          refreshBtn.style.color = 'var(--cgpt-nav-accent)';
          setTimeout(() => {
            refreshBtn.style.background = originalBg;
            refreshBtn.style.color = originalColor;
          }, 300);
        }
        scheduleRefresh(ui);
      });

      // 添加右键菜单功能
      refreshBtn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (DEBUG || window.DEBUG_TEMP) console.log('ChatGPT Navigation: 右键强制重新扫描');
        TURN_SELECTOR = null;
        const originalBg = refreshBtn.style.background;
        const originalColor = refreshBtn.style.color;
        refreshBtn.style.background = 'var(--cgpt-nav-accent-subtle)';
        refreshBtn.style.color = 'var(--cgpt-nav-accent)';
        setTimeout(() => {
          refreshBtn.style.background = originalBg;
          refreshBtn.style.color = originalColor;
        }, 300);
        scheduleRefresh(ui);
      });

      // 更新提示文本
      refreshBtn.title = "刷新对话列表 (Shift+点击 或 右键 = 强制重新扫描)";
    }

    // 收藏过滤按钮
    if (starBtn) {
      starBtn.addEventListener('click', () => {
        filterFav = !filterFav;
        saveFavFilterState();
        updateStarBtnState(ui);
        renderList(ui);
      });
      updateStarBtnState(ui);
    }


    // 底部按钮
    const prevBtn = ui.nav.querySelector('#cgpt-nav-prev');
    const nextBtn = ui.nav.querySelector('#cgpt-nav-next');
    const topBtn  = ui.nav.querySelector('#cgpt-nav-top');
    const bottomBtn = ui.nav.querySelector('#cgpt-nav-bottom');

    if (prevBtn) prevBtn.addEventListener('click', () => jumpActiveBy(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => jumpActiveBy(+1));
    if (topBtn) topBtn.addEventListener('click', () => jumpToEdge('top'));
    if (bottomBtn) bottomBtn.addEventListener('click', () => jumpToEdge('bottom'));

    // 键盘事件只绑定一次：避免重复绑定
    if (!window.__cgptKeysBound) {
      const onKeydown = (e) => {
        const t = e.target;
        const tag = t && t.tagName;
        const isEditable = t && ((tag === 'INPUT') || (tag === 'TEXTAREA') || (tag === 'SELECT') || (t.isContentEditable));

        // Cmd+↑ / Cmd+↓（Mac, metaKey）
        if (!isEditable && e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          jumpActiveBy(e.key === 'ArrowDown' ? +1 : -1);
          e.preventDefault();
          return;
        }

        // Alt+↑ / Alt+↓（Windows/Linux 常用）
        if (!isEditable && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          jumpActiveBy(e.key === 'ArrowDown' ? +1 : -1);
          e.preventDefault();
          return;
        }
        // Alt+/ 面板显隐
        if (e.altKey && e.key === '/') {
          const list = ui.nav.querySelector('.compact-list');
          const toggleText = ui.nav.querySelector('.compact-toggle .toggle-text');
          const isHidden = list.getAttribute('data-hidden') === '1';
          if (isHidden) { list.style.visibility = 'visible'; list.style.height = ''; list.style.overflow = ''; list.setAttribute('data-hidden', '0'); if (toggleText) toggleText.textContent = '−'; }
          else { list.style.visibility = 'hidden'; list.style.height = '0'; list.style.overflow = 'hidden'; list.setAttribute('data-hidden', '1'); if (toggleText) toggleText.textContent = '+'; }
          e.preventDefault();
        }
      };

      document.addEventListener('keydown', onKeydown, { passive: false });
      window.__cgptKeysBound = true;
      if (DEBUG || window.DEBUG_TEMP) console.log('ChatGPT Navigation: 已绑定键盘事件');
    } else {
      if (DEBUG || window.DEBUG_TEMP) console.log('ChatGPT Navigation: 键盘事件已存在，跳过绑定');
    }
  }

  function updateStarBtnState(ui) {
    try {
      const starBtn = ui.nav.querySelector('.compact-star');
      if (!starBtn) return;
      const count = favSet ? favSet.size : 0;
      starBtn.classList.toggle('active', !!filterFav);
      starBtn.textContent = filterFav ? '★' : '☆';
      starBtn.title = (filterFav ? '显示全部（当前仅收藏）' : '仅显示收藏') + (count ? `（${count}）` : '');
    } catch {}
  }

  // 移除不存在于 validKeys 的收藏，返回移除数量
  function runFavoritesGC(saveAfter = false, validKeys = null, onlyPins = false) {
    try {
      if (!favSet || !(favSet instanceof Set) || favSet.size === 0) return 0;
      const valid = validKeys instanceof Set ? validKeys : new Set();
      // 如果没提供 validKeys，就尽量构造一个
      if (!(validKeys instanceof Set)) {
        try { const base = buildIndex(); base.forEach(i => valid.add(i.key)); } catch {}
        try { loadCPSet(); cpMap.forEach((_, pid) => valid.add(pid)); } catch {}
      }
      let removed = 0;
      const now = Date.now();
      for (const k of Array.from(favSet.values())) {
        if (onlyPins && !(typeof k === 'string' && k.startsWith('pin-'))) continue;
        const meta = favMeta.get(k) || { created: 0 };
        if (!valid.has(k) || !meta.created || (now - meta.created) > FAV_TTL_MS) { favSet.delete(k); favMeta.delete(k); removed++; }
      }
      if (removed && saveAfter) saveFavSet();
      return removed;
    } catch { return 0; }
  }

  // 改为不依赖缓存索引，单击立即滚动
  function jumpToEdge(which) {
    const listNow = cacheIndex;
    if (listNow && listNow.length) {
      const targetItem = which === 'top' ? listNow[0] : listNow[listNow.length - 1];
      const el = document.getElementById(targetItem.id) || qsTurns()[targetItem.idx] || null;
      if (el) {
        if (!el.id) el.id = `cgpt-turn-edge-${which}`;
        setActiveTurn(el.id);
        scrollToTurn(el);
        return;
      }
    }
    const sc = getScrollRoot(document.body);
    const isWindow = (sc === document.documentElement || sc === document.body || sc === (document.scrollingElement || document.documentElement));
    const top = which === 'top' ? 0 : Math.max(0, (isWindow ? document.body.scrollHeight : sc.scrollHeight) - (isWindow ? window.innerHeight : sc.clientHeight));
    if (isWindow) window.scrollTo({ top, behavior: 'smooth' });
    else sc.scrollTo({ top, behavior: 'smooth' });
    scheduleActiveUpdateNow();
  }

  function getTurnsContainer() {
    const nodes = qsTurns();
    if (!nodes.length) {
      // 如果没有找到对话节点，尝试找到可能的对话容器
      const potentialContainers = [
        document.querySelector('[data-testid="conversation-turns"]'),
        document.querySelector('main[role="main"]'),
        document.querySelector('main'),
        document.querySelector('[role="main"]'),
        document.querySelector('div[class*="conversation"]'),
        document.querySelector('div[class*="chat"]'),
        document.body
      ].filter(Boolean);

      if (DEBUG && potentialContainers.length > 1) {
        console.log('ChatGPT Navigation: 没有找到对话，使用备用容器:', potentialContainers[0]);
      }

      return potentialContainers[0] || document.body;
    }

    // 找到包含所有对话节点的最小公共父元素
    let a = nodes[0];
    while (a) {
      if (nodes.every(n => a.contains(n))) {
        if (DEBUG || window.DEBUG_TEMP) console.log('ChatGPT Navigation: 对话容器:', a);
        return a;
      }
      a = a.parentElement;
    }

    return document.body;
  }

  function observeChat(ui) {
    const target = document.body; // 用稳定祖先，避免容器被重建后失联
    const mo = new MutationObserver((muts) => {
      // 只要涉及消息区域的变更，就触发去抖刷新
      for (const mut of muts) {
        const t = mut.target && mut.target.nodeType === 1 ? mut.target : null;
        if (!t) continue;

        // 尽量廉价地判断：在主区域/turn/markdown/消息块内的任何变更都算
        if (
          t.closest('[data-testid="conversation-turns"]') ||
          t.closest('[data-message-author-role]') ||
          t.closest('[data-testid*="conversation-turn"]') ||
          t.closest('[data-message-id]') ||
          t.closest('.markdown') || t.closest('.prose')
        ) {
          // 避免 selector 过期：每次真正刷新前，清掉缓存
          TURN_SELECTOR = null;
          scheduleRefresh(ui, { delay: 80 });
          return;
        }
      }
    });

    mo.observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-message-author-role', 'data-testid', 'data-message-id', 'class']
    });

    ui._mo = mo;
    ui._moTarget = target;

    // 定期兜底（10s 一次，别等 30s）
    if (forceRefreshTimer) clearInterval(forceRefreshTimer);
    forceRefreshTimer = setInterval(() => {
      TURN_SELECTOR = null;
      scheduleRefresh(ui, { force: true });
    }, 10000);
    ui._forceRefreshTimer = forceRefreshTimer;
  }

  function bindActiveTracking() {
    document.addEventListener('scroll', onAnyScroll, { passive: true, capture: true });
    window.addEventListener('resize', onAnyScroll, { passive: true });
    scheduleActiveUpdateNow();
  }

  // 绑定 Option+单击 添加📌
  function bindAltPin(ui) {
    if (window.__cgptPinBound) return;
    const onClick = (e) => {
      try {
        if (!e.altKey || e.button !== 0) return;
        const nt = e.target;
        if (!nt) return;
        if (nt.closest && nt.closest('#cgpt-compact-nav')) return; // 忽略在面板内
        // 若点击在内容中的📌图标上，则删除该📌
        const anc = nt.closest && nt.closest('.cgpt-pin-anchor');
        if (anc) {
          let pid = anc.getAttribute('data-pin-id') || '';
          if (!pid) {
            // 兼容：从 cpMap 反查
            for (const [k, v] of Array.from(cpMap.entries())) {
              if (v && v.anchorId === anc.id) { pid = k; break; }
            }
          }
          if (pid && cpMap.has(pid)) {
            cpMap.delete(pid);
            try { anc.remove(); } catch {}
            if (favSet.has(pid)) { favSet.delete(pid); favMeta.delete(pid); saveFavSet(); updateStarBtnState(ui); }
            saveCPSet();
            scheduleRefresh(ui);
            e.preventDefault();
            e.stopPropagation();
            return;
          }
        }
        e.preventDefault();
        e.stopPropagation();
        // 找到所属消息
        const turn = findTurnFromNode(nt);
        if (!turn) return;
        const msgKey = turn.getAttribute('data-message-id') || turn.getAttribute('data-testid') || turn.id;
        if (!msgKey) return;

        // 在点击位置插入隐形锚点
        const anchor = insertPinAnchorAtPoint(e.clientX, e.clientY, turn);
        if (!anchor) return;

        // 保存📌
        const pinId = `pin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;
        const meta = { msgKey, anchorId: anchor.id, frac: anchor.frac, created: Date.now(), ctx: anchor.ctx || null };
        try { if (!cpMap || !(cpMap instanceof Map)) loadCPSet(); } catch {}
        cpMap.set(pinId, meta);
        try { const ae = document.getElementById(meta.anchorId); if (ae) ae.setAttribute('data-pin-id', pinId); } catch {}
        saveCPSet();
        runCheckpointGC(true);
        scheduleRefresh(ui);
      } catch (err) {
        if (DEBUG || window.DEBUG_TEMP) console.error('添加📌失败:', err);
      }
    };
    document.addEventListener('click', onClick, true);
    window.__cgptPinBound = true;
  }

  function findTurnFromNode(node) {
    if (!node || node.nodeType !== 1) node = node?.parentElement || null;
    if (!node) return null;
    let el = node.closest('[data-cgpt-turn="1"]');
    if (el) return el;
    // 兜底：尝试已知选择器
    el = node.closest('article[data-testid^="conversation-turn-"],[data-testid^="conversation-turn-"],div[data-message-id],div[class*="group"][data-testid]');
    return el;
  }

  function caretRangeFromPoint(x, y) {
    if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
    const pos = document.caretPositionFromPoint ? document.caretPositionFromPoint(x, y) : null;
    if (!pos) return null;
    const r = document.createRange();
    try { r.setStart(pos.offsetNode, pos.offset); } catch { return null; }
    r.collapse(true);
    return r;
  }

  function getElementsFromPoint(x, y) {
    const arr = (document.elementsFromPoint ? document.elementsFromPoint(x, y) : []);
    return Array.isArray(arr) ? arr : [];
  }

  function deepestDescendantAtPointWithin(turnEl, x, y) {
    const stack = getElementsFromPoint(x, y);
    for (const el of stack) {
      if (!el || el.id === 'cgpt-compact-nav') continue;
      if (turnEl.contains(el)) return el;
    }
    return null;
  }

  function findNearestCharRange(container, x, y) {
    try {
      const tw = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode: node => {
          if (!node || !node.nodeValue) return NodeFilter.FILTER_REJECT;
          if (!node.nodeValue.trim()) return NodeFilter.FILTER_SKIP;
          return NodeFilter.FILTER_ACCEPT;
        }
      });

      let best = null; // {node, offset, dist}
      let nodesChecked = 0;
      const maxNodes = 200;

      while (tw.nextNode() && nodesChecked < maxNodes) {
        const node = tw.currentNode;
        nodesChecked++;
        const len = node.nodeValue.length;
        if (!len) continue;
        const step = Math.max(1, Math.ceil(len / 64)); // 粗取样
        const range = document.createRange();
        for (let i = 0; i < len; i += step) {
          range.setStart(node, i);
          range.setEnd(node, Math.min(len, i + 1));
          const r = range.getBoundingClientRect();
          if (!r || !isFinite(r.top) || r.width === 0 && r.height === 0) continue;
          const cx = Math.max(r.left, Math.min(x, r.right));
          const cy = Math.max(r.top, Math.min(y, r.bottom));
          const dx = cx - x, dy = cy - y;
          const dist = dx * dx + dy * dy;
          if (!best || dist < best.dist) best = { node, offset: i, dist };
        }
        // 精细化：在最佳附近逐字符搜索
        if (best && best.node === node) {
          const i0 = Math.max(0, best.offset - step * 2);
          const i1 = Math.min(len, best.offset + step * 2);
          for (let i = i0; i < i1; i++) {
            range.setStart(node, i);
            range.setEnd(node, Math.min(len, i + 1));
            const r = range.getBoundingClientRect();
            if (!r || (!r.width && !r.height)) continue;
            const cx = Math.max(r.left, Math.min(x, r.right));
            const cy = Math.max(r.top, Math.min(y, r.bottom));
            const dx = cx - x, dy = cy - y;
            const dist = dx * dx + dy * dy;
            if (dist < best.dist) best = { node, offset: i, dist };
          }
        }
      }

      if (best) {
        const res = document.createRange();
        res.setStart(best.node, best.offset);
        res.collapse(true);
        return res;
      }
    } catch {}
    return null;
  }

  function insertPinAnchorAtPoint(x, y, turnEl) {
    const range = caretRangeFromPoint(x, y);
    const id = `cgpt-pin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;
    const span = document.createElement('span');
    span.id = id;
    span.className = 'cgpt-pin-anchor';
    let frac = 0.0;
    const measureEl = getTurnMeasureEl(turnEl);
    const rect = measureEl.getBoundingClientRect();
    if (rect && rect.height > 0) {
      frac = Math.max(0, Math.min(1, (y - rect.top) / rect.height));
    }
    let usedRange = null;
    try {
      if (range && turnEl.contains(range.startContainer)) {
        usedRange = range;
      }
    } catch {}
    // 改进：在点击点下的最深元素中寻找最近字符
    const deep = deepestDescendantAtPointWithin(turnEl, x, y) || turnEl;
    const r2 = usedRange ? null : (findNearestCharRange(deep, x, y) || findNearestCharRange(turnEl, x, y));
    if (r2) usedRange = r2;
    if (usedRange) {
      try {
        const info = extractRangeInfo(usedRange, turnEl);
        usedRange.insertNode(span);
        return { id, frac, ctx: info };
      } catch {}
    }
    // 退化：插入到消息内容靠前位置
    const anchorTarget = findTurnAnchor(turnEl) || turnEl;
    try { anchorTarget.parentNode?.insertBefore(span, anchorTarget); return { id, frac, ctx: null }; } catch {}
    try { turnEl.appendChild(span); return { id, frac, ctx: null }; } catch {}
    return null;
  }

  function getTurnMeasureEl(turnEl) {
    const sels = [
      '[data-message-author-role] .markdown',
      '[data-message-author-role] .prose',
      '.deep-research-result .markdown',
      '.border-token-border-sharp .markdown',
      '.text-message',
      'article .markdown',
      '.prose',
      '[data-message-content-part]'
    ];
    let best = null, bestH = 0;
    for (const s of sels) {
      const list = turnEl.querySelectorAll(s);
      for (const el of list) {
        const h = el.getBoundingClientRect().height;
        if (h > bestH) { bestH = h; best = el; }
      }
    }
    return best || turnEl;
  }

  function extractRangeInfo(range, turnEl) {
    try {
      const start = range.startContainer;
      const parentEl = (start.nodeType === 3 ? start.parentElement : start.closest('*'));
      if (!parentEl || !turnEl.contains(parentEl)) return null;
      const path = buildElementPath(turnEl, parentEl);
      const offset = computeElementTextOffset(parentEl, range.startContainer, range.startOffset);
      return { p: path, o: offset };
    } catch { return null; }
  }

  function buildElementPath(base, el) {
    const parts = [];
    let cur = el;
    while (cur && cur !== base) {
      const parent = cur.parentElement;
      if (!parent) break;
      let idx = 0, sib = cur;
      while ((sib = sib.previousElementSibling)) idx++;
      parts.push(idx);
      cur = parent;
    }
    parts.push(0); // base marker (not used)
    return parts.reverse().join('/');
  }

  function resolveElementPath(base, pathStr) {
    try {
      if (!pathStr) return null;
      const parts = pathStr.split('/').map(n => parseInt(n, 10));
      let cur = base;
      for (let i = 1; i < parts.length; i++) { // skip base marker
        const idx = parts[i];
        cur = cur && cur.children ? cur.children[idx] : null;
        if (!cur) return null;
      }
      return cur;
    } catch { return null; }
  }

  function computeElementTextOffset(el, node, off) {
    // compute char offset within element text by summing text node lengths before target node
    let total = 0;
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    while (tw.nextNode()) {
      const n = tw.currentNode;
      if (n === node) { total += Math.max(0, Math.min(off, n.nodeValue ? n.nodeValue.length : 0)); break; }
      total += n.nodeValue ? n.nodeValue.length : 0;
    }
    return total;
  }

  function createCollapsedRangeAtElementOffset(el, ofs) {
    const r = document.createRange();
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let remain = Math.max(0, ofs);
    while (tw.nextNode()) {
      const n = tw.currentNode;
      const len = n.nodeValue ? n.nodeValue.length : 0;
      if (remain <= len) {
        r.setStart(n, remain);
        r.collapse(true);
        return r;
      }
      remain -= len;
    }
    // fallback: place at end of element
    r.selectNodeContents(el);
    r.collapse(false);
    return r;
  }

  function startBurstRefresh(ui, ms = 6000, step = 160) {
    const end = Date.now() + ms;
    const STOP_BTN = '[data-testid="stop-button"]'; // 生成中按钮
    const tick = () => {
      scheduleRefresh(ui, { force: true });
      if (Date.now() < end && document.querySelector(STOP_BTN)) {
        setTimeout(tick, step);
      }
    };
    tick();
  }

  function watchSendEvents(ui) {
    // 点击发送按钮
    document.addEventListener('click', (e) => {
      if (e.target && e.target.closest && e.target.closest('[data-testid="send-button"]')) {
        if (DEBUG || window.DEBUG_TEMP) console.log('ChatGPT Navigation: 检测到发送按钮点击，启动突发刷新');
        startBurstRefresh(ui);
      }
    }, true);

    // ⌘/Ctrl + Enter 发送
    document.addEventListener('keydown', (e) => {
      const t = e.target;
      if (!t) return;
      const isTextarea = t.tagName === 'TEXTAREA' || t.isContentEditable;
      if (isTextarea && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        if (DEBUG || window.DEBUG_TEMP) console.log('ChatGPT Navigation: 检测到快捷键发送，启动突发刷新');
        startBurstRefresh(ui);
      }
    }, true);

    // 回到前台时强制跑一次
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        if (DEBUG || window.DEBUG_TEMP) console.log('ChatGPT Navigation: 页面重新可见，强制刷新');
        scheduleRefresh(ui, { force: true });
      }
    });
  }

  function onAnyScroll() {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
      updateActiveFromAnchor();
      scrollTicking = false;
    });
  }

  function scheduleActiveUpdateNow() { requestAnimationFrame(updateActiveFromAnchor); }

  function getAnchorY() {
    const h = getFixedHeaderHeight();
    return Math.max(0, Math.min(window.innerHeight - 20, h + CONFIG.anchorOffset));
  }

  function updateActiveFromAnchor() {
    if (!cacheIndex.length) return;
    const y = getAnchorY();
    const xs = [Math.floor(window.innerWidth * 0.40), Math.floor(window.innerWidth * 0.60)];
    let activeEl = null;

    for (const x of xs) {
      const stack = (document.elementsFromPoint ? document.elementsFromPoint(x, y) : []);
      if (!stack || !stack.length) continue;
      for (const el of stack) {
        if (!el) continue;
        if (el.id === 'cgpt-compact-nav' || (el.closest && el.closest('#cgpt-compact-nav'))) continue;
        const t = el.closest && el.closest('[data-cgpt-turn="1"]');
        if (t) { activeEl = t; break; }
      }
      if (activeEl) break;
    }

    const nearNext = findNearNextTop(y, BOUNDARY_EPS);
    if (nearNext) activeEl = nearNext;

    if (!activeEl) {
      const turns = qsTurns();
      for (const t of turns) { const r = t.getBoundingClientRect(); if (r.bottom >= y) { activeEl = t; break; } }
      if (!activeEl && turns.length) activeEl = turns[0];
    }

    if (activeEl) setActiveTurn(activeEl.id);
  }

  function findNearNextTop(y, eps) {
    for (const item of cacheIndex) {
      const el = document.getElementById(item.id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const d = r.top - y;
      if (d >= 0 && d <= eps) return el;
      if (r.top > y + eps) break;
    }
    return null;
  }

  function setActiveTurn(id) {
    if (!id || currentActiveId === id) return;
    currentActiveId = id;
    const list = document.querySelector('#cgpt-compact-nav .compact-list');
    if (!list) return;
    list.querySelectorAll('.compact-item.active').forEach(n => n.classList.remove('active'));
    const n = list.querySelector(`.compact-item[data-id="${id}"]`);
    if (n) {
      n.classList.add('active');
      const r = n.getBoundingClientRect();
      const lr = list.getBoundingClientRect();
      if (r.top < lr.top) list.scrollTop += (r.top - lr.top - 4);
      else if (r.bottom > lr.bottom) list.scrollTop += (r.bottom - lr.bottom + 4);
    }
  }

  function jumpActiveBy(delta) {
    const listNow = cacheIndex;
    if (!listNow.length) return;
    let idx = listNow.findIndex(x => x.id === currentActiveId);
    if (idx < 0) {
      updateActiveFromAnchor();
      idx = listNow.findIndex(x => x.id === currentActiveId);
      if (idx < 0) idx = 0;
    }
    const nextIdx = Math.max(0, Math.min(listNow.length - 1, idx + delta));
    const id = listNow[nextIdx].id;
    const el = document.getElementById(id);
    if (el) { setActiveTurn(id); scrollToTurn(el); }
  }

  function escapeHtml(s) { return (s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

  window.requestIdleCallback ||= (cb, opt = {}) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 }), opt.timeout || 1);
  window.cancelIdleCallback ||= (id) => clearTimeout(id);
})();
