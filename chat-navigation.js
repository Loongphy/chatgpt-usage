// ==UserScript==
// @name         ChatGPT 对话导航
// @namespace    http://tampermonkey.net/
// @version      2.9
// @description  紧凑导航 + 实时定位；修复边界误判；底部纯箭头按钮；回到顶部/到底部单击即用；禁用面板内双击选中；快捷键 Cmd+↑/↓（Mac）或 Alt+↑/↓（Windows）；修复竞态条件和流式输出检测问题。
// @author       schweigen, loongphy (modified)
// @license      MIT
// @match        https://chatgpt.com/*
// @match        https://chatgpt.com/?model=*
// @match        https://chatgpt.com/?temporary-chat=*
// @match        https://chatgpt.com/c/*
// @match        https://chatgpt.com/g/*
// @match        https://chatgpt.com/share/*
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
  const DEBUG = false;

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
  function resetPanelPosition() {
    const nav = document.getElementById('cgpt-compact-nav');
    if (nav) {
      nav.style.top = '60px';
      nav.style.right = '10px';
      nav.style.left = 'auto';
      nav.style.bottom = 'auto';
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
    let width = 0, result = '';
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const charWidth = /[\u4e00-\u9fa5]/.test(char) ? 2 : 1;
      if (width + charWidth > CONFIG.maxPreviewLength) { result += '…'; break; }
      result += char; width += charWidth;
    }
    return result || text.slice(0, CONFIG.maxPreviewLength) || '...';
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
      list.push({ id: el.id, idx: i, role, preview, seq });
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
  --cgpt-nav-positive: var(--token-text-positive, #10a37f);
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

#cgpt-compact-nav { position: fixed; top: 60px; right: 10px; width: auto; min-width: 80px; max-width: 210px; z-index: 2147483647 !important; font-family: var(--cgpt-nav-font); font-size: 13px; pointer-events: auto; background: transparent; -webkit-user-select:none; user-select:none; -webkit-tap-highlight-color: transparent; color: var(--cgpt-nav-text-strong); color-scheme: light dark; }
#cgpt-compact-nav * { -webkit-user-select:none; user-select:none; }
.compact-header { display:flex; align-items:center; justify-content:space-between; padding:4px 8px; margin-bottom:4px; background:var(--cgpt-nav-panel-bg); border-radius:var(--cgpt-nav-radius-lg); border:1px solid var(--cgpt-nav-panel-border); pointer-events:auto; cursor:move; box-shadow:var(--cgpt-nav-panel-shadow); min-width:100px; backdrop-filter:saturate(180%) blur(18px); }
.compact-title { font-size:11px; font-weight:600; color:var(--cgpt-nav-text-muted); display:flex; align-items:center; gap:3px; text-transform:uppercase; letter-spacing:.04em; }
.compact-title span { color:var(--cgpt-nav-text-strong); }
.compact-title svg { width:12px; height:12px; opacity:.55; }
.compact-toggle, .compact-refresh { background:var(--cgpt-nav-item-bg); border:1px solid var(--cgpt-nav-border-muted); color:var(--cgpt-nav-text-strong); cursor:pointer; width:26px; height:26px; display:flex; align-items:center; justify-content:center; border-radius:var(--cgpt-nav-radius); transition:all .2s ease; font-weight:600; line-height:1; box-shadow:var(--cgpt-nav-item-shadow); backdrop-filter:saturate(180%) blur(18px); }
.compact-toggle { font-size:18px; }
.compact-refresh { font-size:14px; margin-left:4px; }
.compact-toggle:hover, .compact-refresh:hover { border-color:var(--cgpt-nav-accent-subtle); color:var(--cgpt-nav-accent); box-shadow:0 4px 14px rgba(147,51,234,0.12); background:var(--cgpt-nav-item-hover-bg); }
.compact-toggle:active, .compact-refresh:active { transform:scale(.94); }
.toggle-text { display:block; font-family:monospace; font-size:16px; }
.compact-list { max-height:400px; overflow-y:auto; overflow-x:hidden; padding:0; pointer-events:auto; display:flex; flex-direction:column; gap:8px; scrollbar-width:thin; scrollbar-color:var(--cgpt-nav-scrollbar-thumb) transparent; }
.compact-list::-webkit-scrollbar { width:3px; }
.compact-list::-webkit-scrollbar-thumb { background:var(--cgpt-nav-scrollbar-thumb); border-radius:2px; }
.compact-list::-webkit-scrollbar-thumb:hover { background:var(--cgpt-nav-scrollbar-thumb-hover); }
.compact-item { display:block; padding:3px 8px; margin:0; border-radius:var(--cgpt-nav-radius); cursor:pointer; transition:all .16s ease; font-size:12px; line-height:1.4; min-height:20px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; pointer-events:auto; background:var(--cgpt-nav-item-bg); box-shadow:var(--cgpt-nav-item-shadow); width:auto; min-width:60px; max-width:190px; color:var(--cgpt-nav-text-strong); border:1px solid transparent; }
.compact-item:hover { background:var(--cgpt-nav-item-hover-bg); transform:translateX(2px); box-shadow:0 6px 16px rgba(15,23,42,0.12); }
.compact-item.user { color:var(--cgpt-nav-positive); border-color:var(--cgpt-nav-positive); border-color:color-mix(in srgb, var(--cgpt-nav-positive) 45%, transparent); }
.compact-item.assistant { color:var(--cgpt-nav-info); border-color:var(--cgpt-nav-info); border-color:color-mix(in srgb, var(--cgpt-nav-info) 45%, transparent); }
.compact-item.active { outline:2px solid var(--cgpt-nav-accent); background:var(--cgpt-nav-accent-subtle); box-shadow:0 0 0 1px var(--cgpt-nav-accent-strong) inset, 0 12px 30px rgba(147,51,234,0.15); border-color:var(--cgpt-nav-accent-subtle); transform:translateX(2px); }
.compact-text { display:inline-block; }
.compact-number { display:inline-block; margin-right:4px; font-weight:600; color:var(--cgpt-nav-text-muted); font-size:11px; }
.compact-empty { padding:10px; text-align:center; color:var(--cgpt-nav-text-muted); font-size:11px; background:var(--cgpt-nav-panel-bg); border-radius:var(--cgpt-nav-radius-lg); pointer-events:auto; min-height:20px; line-height:1.4; border:1px dashed var(--cgpt-nav-border-muted); }

/* 底部导航条 */
.compact-footer { margin-top:6px; display:flex; gap:6px; }
.nav-btn { flex:1 1 auto; padding:6px 8px; font-size:14px; border-radius:var(--cgpt-nav-radius-lg); border:1px solid var(--cgpt-nav-border-muted); background:var(--cgpt-nav-footer-bg); cursor:pointer; box-shadow:var(--cgpt-nav-item-shadow); line-height:1; color:var(--cgpt-nav-text-strong); transition:all .18s ease; backdrop-filter:saturate(180%) blur(18px); }
.nav-btn:hover { background:var(--cgpt-nav-footer-hover); transform:translateY(-1px); }
.nav-btn:active { transform: translateY(1px); }

/* 上下箭头按钮 */
.nav-btn.arrow { background:var(--cgpt-nav-accent-subtle); border-color:var(--cgpt-nav-accent-subtle); color:var(--cgpt-nav-accent); font-weight:600; }
.nav-btn.arrow:hover { background:var(--cgpt-nav-accent-strong); border-color:var(--cgpt-nav-accent-strong); color:var(--token-text-on-accent, #ffffff); box-shadow:0 8px 24px rgba(147,51,234,0.25); }

/* 移动端 */
@media (max-width: 768px) {
  #cgpt-compact-nav { right:5px; max-width:160px; }
  .compact-item { font-size:11px; padding:2px 5px; min-height:18px; }
  .nav-btn { padding:5px 6px; font-size:13px; }
}

.highlight-pulse { animation: pulse 1.5s ease-out; }
@keyframes pulse { 0% { background-color: rgba(255,243,205,0); } 20% { background-color: rgba(255,243,205,1); background-color: color-mix(in srgb, var(--cgpt-nav-accent) 18%, rgba(255,243,205,0.9)); } 100% { background-color: rgba(255,243,205,0); } }
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
        </div>
        <div class="compact-title" aria-live="polite" aria-atomic="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
          </svg>
          <span>问题栏</span>
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
    enableDrag(nav);

    // 禁用面板内双击与文本选中
    nav.addEventListener('dblclick', (e) => { e.preventDefault(); e.stopPropagation(); }, { capture: true });
    nav.addEventListener('selectstart', (e) => { e.preventDefault(); }, { capture: true });
    nav.addEventListener('mousedown', (e) => { if (e.detail > 1) { e.preventDefault(); } }, { capture: true });

    nav._ui = { nav };
    return { nav };
  }

  function enableDrag(nav) {
    const header = nav.querySelector('.compact-header');
    let isDragging = false, startX, startY, startLeft, startTop;
    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('.compact-toggle')) return;
      isDragging = true; startX = e.clientX; startY = e.clientY;
      const rect = nav.getBoundingClientRect(); startLeft = rect.left; startTop = rect.top; e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      nav.style.left = `${startLeft + dx}px`; nav.style.top = `${startTop + dy}px`; nav.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => { isDragging = false; });
  }

  let cacheIndex = [];

  function renderList(ui) {
    const list = ui.nav.querySelector('.compact-list');
    if (!list) return;
    const next = cacheIndex;
    if (!next.length) { list.innerHTML = `<div class="compact-empty">暂无对话</div>`; return; }
    list.innerHTML = '';
    for (const item of next) {
      const node = document.createElement('div');
      node.className = `compact-item ${item.role}`;
      node.dataset.id = item.id;
      node.innerHTML = `<span class="compact-number">${item.idx + 1}.</span><span class="compact-text" title="${escapeAttr(item.preview)}">${escapeHtml(item.preview)}</span>`;
      node.setAttribute('draggable', 'false');
      list.appendChild(node);
    }
    if (!list._eventBound) {
      list.addEventListener('click', (e) => {
        const item = e.target.closest('.compact-item');
        if (!item) return;
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
    const next = buildIndex();
    if (DEBUG) console.log('ChatGPT Navigation: turns', next.length);
    lastTurnCount = next.length;
    cacheIndex = next;
    renderList(ui);
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

  // 改为不依赖缓存索引，单击立即滚动
  function jumpToEdge(which) {
    const turns = qsTurns();
    if (turns && turns.length) {
      const el = which === 'top' ? turns[0] : turns[turns.length - 1];
      if (!el.id) el.id = `cgpt-turn-edge-${which}`;
      setActiveTurn(el.id);
      scrollToTurn(el);
      return;
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
    if (!cacheIndex.length) return;
    let idx = cacheIndex.findIndex(x => x.id === currentActiveId);
    if (idx < 0) {
      updateActiveFromAnchor();
      idx = cacheIndex.findIndex(x => x.id === currentActiveId);
      if (idx < 0) idx = 0;
    }
    const nextIdx = Math.max(0, Math.min(cacheIndex.length - 1, idx + delta));
    const id = cacheIndex[nextIdx].id;
    const el = document.getElementById(id);
    if (el) { setActiveTurn(id); scrollToTurn(el); }
  }

  function escapeHtml(s) { return (s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

  window.requestIdleCallback ||= (cb, opt = {}) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 }), opt.timeout || 1);
  window.cancelIdleCallback ||= (id) => clearTimeout(id);
})();
