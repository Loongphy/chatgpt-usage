// ==UserScript==
// @name         GPTShortCuts
// @namespace    https://chatgpt.com/
// @version      0.1.0
// @description  快速插入常用语到ChatGPT输入框
// @author       Steve5wutongyu6&Codex，loongphy for dark mode
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @grant        none
// @downloadURL https://github.com/Steve5wutongyu6/GPTShortcuts/raw/refs/heads/main/gpt-shortcuts.user.js
// ==/UserScript==

(function () {
    'use strict';
  
    const STORAGE_KEY = 'gpt-shortcuts-config';
  
    const DEFAULT_GROUPS = [
      {
        name: 'PUA',
        phrases: ['think hard about this and deeper websearch', 'think hard about this']
      },
      {
        name: '提醒',
        phrases: ['请在回答中使用中文。', '请简洁地回答。', '请给出要点列表。']
      }
    ];
  
    const createElement = (tag, options = {}) => {
      const el = document.createElement(tag);
      if (options.className) el.className = options.className;
      if (options.text) el.textContent = options.text;
      if (options.html) el.innerHTML = options.html;
      if (options.attrs) {
        Object.entries(options.attrs).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            el.setAttribute(key, value);
          }
        });
      }
      return el;
    };
  
    const loadConfig = () => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) {
          return DEFAULT_GROUPS.map(group => ({
            name: group.name,
            phrases: group.phrases.slice()
          }));
        }
        const parsed = JSON.parse(stored);
        if (!Array.isArray(parsed)) {
          throw new Error('Invalid config');
        }
        const normalized = parsed
          .filter(group => group && typeof group === 'object')
          .map(group => {
            const name = typeof group.name === 'string' ? group.name.trim() : '';
            const phrases = Array.isArray(group.phrases)
              ? group.phrases
                  .filter(item => typeof item === 'string')
                  .map(item => item.trim())
                  .filter(Boolean)
              : [];
            return name
              ? {
                  name,
                  phrases
                }
              : null;
          })
          .filter(Boolean);
  
        return normalized.length
          ? normalized
          : DEFAULT_GROUPS.map(group => ({
              name: group.name,
              phrases: group.phrases.slice()
            }));
      } catch (err) {
        console.warn('[GPTShortCuts] 读取配置失败，恢复默认值。', err);
        return DEFAULT_GROUPS.map(group => ({
          name: group.name,
          phrases: group.phrases.slice()
        }));
      }
    };
  
    const saveConfig = (groups) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
      } catch (err) {
        console.warn('[GPTShortCuts] 保存配置失败', err);
      }
    };
  
    const ensureGlobalStyles = () => {
      if (document.head.querySelector('#gpt-shortcuts-global-styles')) {
        return;
      }
      const style = document.createElement('style');
      style.id = 'gpt-shortcuts-global-styles';
      style.textContent = `
        .gpt-shortcuts-toggle {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          height: 36px;
          padding: 0 14px;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          transition: opacity 0.2s ease;
          background: none;
          color: inherit;
        }
        .gpt-shortcuts-toggle:focus-visible {
          outline: 2px solid rgba(59, 130, 246, 0.6);
          outline-offset: 2px;
        }
        .gpt-shortcuts-toggle-label {
          pointer-events: none;
        }
        .gpt-shortcuts-toggle-icon {
          width: 16px;
          height: 16px;
          transition: transform 0.2s ease;
        }
        .gpt-shortcuts-toggle[data-collapsed="false"] .gpt-shortcuts-toggle-icon {
          transform: rotate(180deg);
        }
      `;
      document.head.appendChild(style);
    };
  
    const cleanupLegacyComposerToggles = (controls) => {
      if (!controls) return;
  
      const legacySelectors = [
        '.gpt-shortcuts-inline-toggle',
        '.gpt-shortcuts-toggle-legacy',
        '[data-gpt-shortcuts-inline-toggle]',
        '[data-gpt-shortcuts-toggle="legacy"]'
      ];
      legacySelectors.forEach((selector) => {
        controls.querySelectorAll(selector).forEach((node) => node.remove());
      });
  
      Array.from(controls.querySelectorAll('button')).forEach((button) => {
        const text = button.textContent?.trim();
        if (!text) return;
        if (text.includes('收起常用语') || text.includes('快捷常用语')) {
          button.remove();
        }
      });
    };
  
    const ensureComposerToggle = (form) => {
      if (!form) return null;
      const speechContainer = form.querySelector('[data-testid="composer-speech-button-container"]');
      const controls = speechContainer?.parentElement || form.querySelector('[class*="[grid-area:trailing]"]');
      if (!controls) return null;
      cleanupLegacyComposerToggles(controls);
      const existingToggles = Array.from(controls.querySelectorAll('.gpt-shortcuts-toggle'));
      if (existingToggles.length > 1) {
        existingToggles.slice(1).forEach((button) => button.remove());
      }
      let toggleButton = controls.querySelector('.gpt-shortcuts-toggle');
      if (toggleButton) {
        return toggleButton;
      }
  
      toggleButton = createElement('button', {
        className: 'gpt-shortcuts-toggle composer-secondary-button-color hover:opacity-80',
        attrs: {
          type: 'button',
          'data-gpt-shortcuts-toggle': 'true',
          'aria-label': '折叠常用语菜单',
          'aria-expanded': 'true'
        }
      });
  
      const label = createElement('span', {
        className: 'gpt-shortcuts-toggle-label',
        text: '常用语'
      });
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('width', '16');
      icon.setAttribute('height', '16');
      icon.setAttribute('viewBox', '0 0 16 16');
      icon.setAttribute('fill', 'currentColor');
      icon.setAttribute('aria-hidden', 'true');
      icon.classList.add('gpt-shortcuts-toggle-icon');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute(
        'd',
        'M4.47067 6.19509C4.73037 5.93539 5.15238 5.93539 5.41208 6.19509L7.99996 8.78297L10.5878 6.19509C10.8475 5.93539 11.2695 5.93539 11.5292 6.19509C11.7889 6.45479 11.7889 6.8768 11.5292 7.1365L8.47067 10.1951C8.21097 10.4548 7.78896 10.4548 7.52926 10.1951L4.47067 7.1365C4.21097 6.8768 4.21097 6.45479 4.47067 6.19509Z'
      );
      icon.append(path);
  
      toggleButton.append(label, icon);
  
      if (speechContainer) {
        controls.insertBefore(toggleButton, speechContainer);
      } else {
        controls.appendChild(toggleButton);
      }
      return toggleButton;
    };
  
    const ensureShortcutContainer = () => {
      const threadBottom = document.querySelector('#thread-bottom form');
      if (!threadBottom) return null;
  
      ensureGlobalStyles();
  
      let container = document.querySelector('.gpt-shortcuts-container');
      if (container && container.__gptShortcutsElements) {
        container.__gptShortcutsElements.form = threadBottom;
        return container.__gptShortcutsElements;
      }
      if (container) {
        container.remove();
      }
  
      container = createElement('div', { className: 'gpt-shortcuts-container' });
      const shadow = container.attachShadow({ mode: 'open' });
  
      const style = document.createElement('style');
      style.textContent = `
        :host {
          font-family: var(--font-sans, "Helvetica Neue", Helvetica, Arial, sans-serif);
          color: rgba(25, 28, 27, 0.9);
          --shortcut-surface: rgba(248, 250, 247, 0.95);
          --shortcut-border: rgba(0, 0, 0, 0.1);
          --shortcut-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.3), 0 1px 4px rgba(0, 0, 0, 0.08);
          --shortcut-title-color: rgba(25, 28, 27, 0.9);
          --shortcut-input-bg: rgba(255, 255, 255, 0.92);
          --shortcut-input-border: rgba(209, 213, 219, 0.5);
          --shortcut-input-focus: rgba(16, 163, 127, 0.45);
          --shortcut-chip-bg: rgba(16, 163, 127, 0.14);
          --shortcut-chip-hover-bg: rgba(16, 163, 127, 0.22);
          --shortcut-chip-color: rgb(16, 163, 127);
          --shortcut-manage-bg: rgba(220, 38, 38, 0.08);
          --shortcut-manage-hover: rgba(220, 38, 38, 0.15);
          --shortcut-manage-color: rgb(220, 38, 38);
          --shortcut-action-bg: rgba(255, 255, 255, 0.92);
          --shortcut-action-border: rgba(209, 213, 219, 0.4);
          --shortcut-action-hover: rgba(16, 163, 127, 0.12);
          --shortcut-action-primary-color: rgb(16, 163, 127);
          --shortcut-action-primary-border: rgba(16, 163, 127, 0.35);
          --shortcut-action-primary-bg: rgba(16, 163, 127, 0.1);
          --shortcut-action-primary-hover: rgba(16, 163, 127, 0.18);
          --shortcut-action-danger-color: rgb(220, 38, 38);
          --shortcut-action-danger-border: rgba(220, 38, 38, 0.25);
          --shortcut-action-danger-bg: rgba(220, 38, 38, 0.08);
          --shortcut-action-danger-hover: rgba(220, 38, 38, 0.15);
          --shortcut-manage-description: rgba(68, 72, 70, 0.85);
          --shortcut-phrase-bg: rgba(236, 238, 236, 0.45);
          --shortcut-empty-color: rgba(68, 72, 70, 0.9);
          --shortcut-delete-color: rgba(220, 38, 38, 0.9);
          --shortcut-delete-hover: rgba(248, 113, 113, 0.25);
          --shortcut-scrollbar-track: transparent;
          --shortcut-scrollbar-thumb: rgba(148, 163, 184, 0.6);
        }
        :host-context(.dark) {
          color: rgba(225, 227, 224, 0.9);
          --shortcut-surface: rgba(52, 53, 65, 0.72);
          --shortcut-border: rgba(255, 255, 255, 0.1);
          --shortcut-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05), 0 1px 4px rgba(0, 0, 0, 0.4);
          --shortcut-title-color: rgba(225, 227, 224, 0.9);
          --shortcut-input-bg: rgba(68, 70, 84, 0.7);
          --shortcut-input-border: rgba(255, 255, 255, 0.15);
          --shortcut-input-focus: rgba(16, 163, 127, 0.45);
          --shortcut-chip-bg: rgba(16, 163, 127, 0.28);
          --shortcut-chip-hover-bg: rgba(16, 163, 127, 0.36);
          --shortcut-chip-color: rgba(225, 227, 224, 0.95);
          --shortcut-manage-bg: rgba(239, 68, 68, 0.28);
          --shortcut-manage-hover: rgba(248, 113, 113, 0.4);
          --shortcut-manage-color: rgba(254, 226, 226, 0.95);
          --shortcut-action-bg: rgba(52, 53, 65, 0.85);
          --shortcut-action-border: rgba(255, 255, 255, 0.1);
          --shortcut-action-hover: rgba(16, 163, 127, 0.28);
          --shortcut-action-primary-color: rgba(225, 227, 224, 0.95);
          --shortcut-action-primary-border: rgba(16, 163, 127, 0.45);
          --shortcut-action-primary-bg: rgba(16, 163, 127, 0.32);
          --shortcut-action-primary-hover: rgba(16, 163, 127, 0.42);
          --shortcut-action-danger-color: rgba(254, 202, 202, 0.95);
          --shortcut-action-danger-border: rgba(248, 113, 113, 0.45);
          --shortcut-action-danger-bg: rgba(239, 68, 68, 0.32);
          --shortcut-action-danger-hover: rgba(248, 113, 113, 0.45);
          --shortcut-manage-description: rgba(196, 199, 196, 0.82);
          --shortcut-phrase-bg: rgba(68, 70, 84, 0.55);
          --shortcut-empty-color: rgba(196, 199, 196, 0.75);
          --shortcut-delete-color: rgba(248, 113, 113, 0.95);
          --shortcut-delete-hover: rgba(248, 113, 113, 0.2);
          --shortcut-scrollbar-thumb: rgba(148, 163, 184, 0.65);
        }
        .shortcuts-wrapper {
          display: grid;
          grid-template-rows: auto 1fr;
          gap: 8px;
          padding: 8px 12px 12px;
          background: var(--shortcut-surface);
          border-radius: 16px;
          border: 1px solid var(--shortcut-border);
          box-shadow: var(--shortcut-shadow);
          color: inherit;
          backdrop-filter: blur(4px);
        }
        .shortcuts-wrapper.collapsed {
          display: none;
        }
        .shortcuts-title {
          font-size: 14px;
          font-weight: 600;
          color: var(--shortcut-title-color);
        }
        .shortcuts-content {
          display: grid;
          grid-template-rows: auto 1fr auto;
          gap: 6px;
        }
        .shortcuts-header {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .group-select {
          flex: 1 1 auto;
          min-width: 150px;
          padding: 4px 10px;
          border-radius: 8px;
          border: 1px solid var(--shortcut-input-border);
          background: var(--shortcut-input-bg);
          color: inherit;
          font-size: 14px;
        }
        .group-select:focus {
          outline: 2px solid var(--shortcut-input-focus);
          outline-offset: 1px;
        }
        .shortcut-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          max-height: 110px;
          overflow-y: auto;
          padding-right: 4px;
        }
        .shortcut-list::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .shortcut-list::-webkit-scrollbar-track {
          background: var(--shortcut-scrollbar-track);
        }
        .shortcut-list::-webkit-scrollbar-thumb {
          background: var(--shortcut-scrollbar-thumb);
          border-radius: 999px;
        }
        .shortcut-button {
          display: inline-flex;
          align-items: flex-start;
          justify-content: flex-start;
          gap: 6px;
          padding: 4px 12px;
          border-radius: 8px;
          border: 1px solid transparent;
          background: var(--shortcut-chip-bg);
          color: var(--shortcut-chip-color);
          cursor: pointer;
          font-size: 13px;
          text-align: left;
          line-height: 1.4;
          transition: background 0.2s ease, transform 0.1s ease;
        }
        .shortcut-button:hover {
          background: var(--shortcut-chip-hover-bg);
          transform: translateY(-1px);
        }
        .shortcut-button.manage-mode {
          background: var(--shortcut-manage-bg);
          color: var(--shortcut-manage-color);
        }
        .shortcut-button.manage-mode:hover {
          background: var(--shortcut-manage-hover);
        }
        .actions {
          display: flex;
          gap: 6px;
        }
        .action-btn {
          padding: 4px 10px;
          border-radius: 8px;
          border: 1px solid var(--shortcut-action-border);
          background: var(--shortcut-action-bg);
          font-size: 12px;
          cursor: pointer;
          transition: background 0.2s ease;
          color: inherit;
        }
        .action-btn:hover {
          background: var(--shortcut-action-hover);
        }
        .action-btn.primary {
          color: var(--shortcut-action-primary-color);
          border-color: var(--shortcut-action-primary-border);
          background: var(--shortcut-action-primary-bg);
        }
        .action-btn.primary:hover {
          background: var(--shortcut-action-primary-hover);
        }
        .action-btn.danger {
          color: var(--shortcut-action-danger-color);
          border-color: var(--shortcut-action-danger-border);
          background: var(--shortcut-action-danger-bg);
        }
        .action-btn.danger:hover {
          background: var(--shortcut-action-danger-hover);
        }
        .manage-panel {
          border-top: 1px solid var(--shortcut-border);
          margin-top: 6px;
          padding-top: 8px;
          display: none;
          flex-direction: column;
          gap: 8px;
          font-size: 13px;
        }
        .manage-panel.visible {
          display: flex;
        }
        .manage-description {
          font-size: 12px;
          color: var(--shortcut-manage-description);
        }
        .manage-panel label {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .manage-panel input {
          padding: 4px 8px;
          border-radius: 8px;
          border: 1px solid var(--shortcut-input-border);
          background: var(--shortcut-input-bg);
          font-size: 13px;
          color: inherit;
        }
        .manage-panel input:focus {
          outline: 2px solid var(--shortcut-input-focus);
          outline-offset: 1px;
        }
        .manage-actions {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }
        .manage-panel-phrases {
          display: flex;
          flex-direction: column;
          gap: 6px;
          max-height: 140px;
          overflow-y: auto;
          padding-right: 4px;
        }
        .manage-panel-phrases::-webkit-scrollbar {
          width: 6px;
        }
        .manage-panel-phrases::-webkit-scrollbar-track {
          background: var(--shortcut-scrollbar-track);
        }
        .manage-panel-phrases::-webkit-scrollbar-thumb {
          background: var(--shortcut-scrollbar-thumb);
          border-radius: 999px;
        }
        .phrase-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          padding: 4px 8px;
          border-radius: 8px;
          background: var(--shortcut-phrase-bg);
        }
        .phrase-item span {
          flex: 1 1 auto;
          word-break: break-word;
        }
        .delete-btn {
          background: none;
          border: none;
          color: var(--shortcut-delete-color);
          cursor: pointer;
          font-size: 12px;
          padding: 2px 4px;
          border-radius: 8px;
          white-space: nowrap;
          width: 44px;
          text-align: center;
        }
        .delete-btn:hover {
          background: var(--shortcut-delete-hover);
        }
        .shortcut-empty {
          font-size: 13px;
          color: var(--shortcut-empty-color);
          padding: 8px 0;
        }
      `;
  
      const wrapper = createElement('div', { className: 'shortcuts-wrapper' });
      const title = createElement('div', { className: 'shortcuts-title', text: '常用语' });
      const content = createElement('div', { className: 'shortcuts-content' });
      const header = createElement('div', { className: 'shortcuts-header' });
      const groupSelect = createElement('select', { className: 'group-select', attrs: { title: '选择常用语分组' } });
      const actions = createElement('div', { className: 'actions' });
      const manageBtn = createElement('button', { className: 'action-btn', text: '管理常用语' });
      const addGroupBtn = createElement('button', { className: 'action-btn', text: '新增分组' });
      const shortcutList = createElement('div', { className: 'shortcut-list' });
      const managePanel = createElement('div', { className: 'manage-panel' });
  
      actions.append(manageBtn, addGroupBtn);
      header.append(groupSelect, actions);
      content.append(header, shortcutList, managePanel);
      wrapper.append(title, content);
  
      shadow.append(style, wrapper);
      threadBottom.parentElement.insertBefore(container, threadBottom);
  
      const elements = {
        host: container,
        shadow,
        wrapper,
        content,
        groupSelect,
        shortcutList,
        manageBtn,
        addGroupBtn,
        managePanel,
        form: threadBottom,
        toggleButton: null
      };
  
      container.__gptShortcutsElements = elements;
  
      return elements;
    };
  
    const insertText = (text) => {
      const editable = document.querySelector('#prompt-textarea');
      const fallback = document.querySelector('textarea[name="prompt-textarea"]');
  
      if (editable) {
        editable.focus();
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editable);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
        const success = document.execCommand('insertText', false, text);
        if (!success) {
          editable.textContent += text;
          const inputEvt = new InputEvent('input', { bubbles: true, data: text });
          editable.dispatchEvent(inputEvt);
        }
        editable.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
  
      if (fallback) {
        fallback.focus();
        const start = fallback.selectionStart || fallback.value.length;
        const end = fallback.selectionEnd || fallback.value.length;
        const value = fallback.value;
        fallback.value = value.slice(0, start) + text + value.slice(end);
        const caret = start + text.length;
        fallback.selectionStart = fallback.selectionEnd = caret;
        fallback.dispatchEvent(new Event('input', { bubbles: true }));
      }
    };
  
    const renderGroupOptions = (groupSelect, groups, activeIndex) => {
      groupSelect.innerHTML = '';
      groups.forEach((group, index) => {
        const option = createElement('option', { text: group.name });
        option.value = String(index);
        if (index === activeIndex) option.selected = true;
        groupSelect.append(option);
      });
    };
  
    const renderShortcuts = (shortcutList, groups, activeIndex, manageMode, handleDelete) => {
      shortcutList.innerHTML = '';
      const group = groups[activeIndex];
      if (!group) return;
  
      if (!group.phrases.length) {
        const empty = createElement('div', {
          className: 'shortcut-empty',
          text: manageMode
            ? '暂无常用语，使用下方表单添加。'
            : '暂无常用语，点击“管理常用语”进行添加。'
        });
        shortcutList.append(empty);
        return;
      }
  
      group.phrases.forEach((phrase, phraseIndex) => {
        const button = createElement('button', {
          className: `shortcut-button${manageMode ? ' manage-mode' : ''}`,
          text: phrase
        });
        button.type = 'button';
        if (manageMode) {
          button.addEventListener('click', () => handleDelete(phraseIndex));
        } else {
          button.addEventListener('click', () => insertText(phrase));
        }
        shortcutList.append(button);
      });
    };
  
    const renderManagePanel = (managePanel, groups, activeIndex, setState) => {
      managePanel.innerHTML = '';
      const group = groups[activeIndex];
      if (!group) return;
  
      const description = createElement('div', {
        className: 'manage-description',
        text: `当前分组：${group.name}`
      });
  
      const phraseRow = createElement('div', { className: 'manage-actions' });
      const phraseInput = createElement('input', {
        attrs: {
          type: 'text',
          placeholder: '输入新的常用语内容'
        }
      });
      const addPhraseBtn = createElement('button', {
        className: 'action-btn primary',
        text: '添加常用语'
      });
      addPhraseBtn.type = 'button';
  
      addPhraseBtn.addEventListener('click', () => {
        const value = phraseInput.value.trim();
        if (!value) return;
        const newGroups = groups.map(groupItem => ({
          ...groupItem,
          phrases: groupItem.phrases.slice()
        }));
        newGroups[activeIndex].phrases.push(value);
        setState({ groups: newGroups });
        phraseInput.value = '';
      });
  
      phraseRow.append(phraseInput, addPhraseBtn);
  
      if (groups.length > 1) {
        const deleteGroupBtn = createElement('button', {
          className: 'action-btn danger',
          text: '删除当前分组'
        });
        deleteGroupBtn.type = 'button';
        deleteGroupBtn.addEventListener('click', () => {
          if (!confirm(`确定删除分组“${group.name}”及其中的常用语吗？`)) {
            return;
          }
          const newGroups = groups
            .map(groupItem => ({
              ...groupItem,
              phrases: groupItem.phrases.slice()
            }));
          newGroups.splice(activeIndex, 1);
          const nextIndex = Math.min(newGroups.length - 1, activeIndex);
          setState({ groups: newGroups, activeIndex: Math.max(0, nextIndex) });
        });
        phraseRow.append(deleteGroupBtn);
      }
  
      const phrasesContainer = createElement('div', { className: 'manage-panel-phrases' });
      if (!group.phrases.length) {
        const empty = createElement('div', {
          className: 'shortcut-empty',
          text: '当前分组暂无常用语。'
        });
        phrasesContainer.append(empty);
      } else {
        group.phrases.forEach((phrase, index) => {
          const row = createElement('div', { className: 'phrase-item' });
          const textSpan = createElement('span', { text: phrase });
          const deleteBtn = createElement('button', { className: 'delete-btn', text: '删除' });
          deleteBtn.type = 'button';
          deleteBtn.addEventListener('click', () => {
            const newGroups = groups.map(groupItem => ({
              ...groupItem,
              phrases: groupItem.phrases.slice()
            }));
            newGroups[activeIndex].phrases.splice(index, 1);
            setState({ groups: newGroups });
          });
          row.append(textSpan, deleteBtn);
          phrasesContainer.append(row);
        });
      }
  
      managePanel.append(description, phraseRow, phrasesContainer);
    };
  
    const render = (state, elements, setState) => {
      const { groups, activeIndex, manageMode, collapsed } = state;
      const { groupSelect, shortcutList, manageBtn, managePanel, wrapper } = elements;
  
      renderGroupOptions(groupSelect, groups, activeIndex);
      renderShortcuts(shortcutList, groups, activeIndex, manageMode, (phraseIndex) => {
        const newGroups = groups.map(group => ({ ...group, phrases: group.phrases.slice() }));
        newGroups[activeIndex].phrases.splice(phraseIndex, 1);
        setState({ groups: newGroups });
      });
      manageBtn.textContent = manageMode ? '退出管理' : '管理常用语';
      managePanel.classList.toggle('visible', manageMode && !collapsed);
      if (manageMode && !collapsed) {
        renderManagePanel(managePanel, groups, activeIndex, setState);
      } else {
        managePanel.innerHTML = '';
      }
      wrapper.classList.toggle('collapsed', collapsed);
  
      const toggleButton = ensureComposerToggle(elements.form);
      if (toggleButton) {
        if (!toggleButton.__gptShortcutsBound) {
          toggleButton.addEventListener('click', () => {
            setState(prev => ({
              collapsed: !prev.collapsed,
              manageMode: prev.collapsed ? prev.manageMode : false
            }));
          });
          toggleButton.__gptShortcutsBound = true;
        }
        toggleButton.dataset.collapsed = collapsed ? 'true' : 'false';
        toggleButton.setAttribute('aria-label', collapsed ? '展开常用语菜单' : '折叠常用语菜单');
        toggleButton.setAttribute('aria-expanded', String(!collapsed));
        toggleButton.setAttribute('title', collapsed ? '展开常用语菜单' : '折叠常用语菜单');
        const labelEl = toggleButton.querySelector('.gpt-shortcuts-toggle-label');
        if (labelEl) {
          labelEl.textContent = '常用语';
        }
        elements.toggleButton = toggleButton;
      }
    };
  
    const main = () => {
      const elements = ensureShortcutContainer();
      if (!elements) return false;
  
      let state = {
        groups: loadConfig(),
        activeIndex: 0,
        manageMode: false,
        collapsed: false
      };
  
      const setState = (updates) => {
        const partial =
          typeof updates === 'function'
            ? updates(state) || {}
            : updates;
        if (!partial || typeof partial !== 'object') {
          return;
        }
        const nextState = { ...state, ...partial };
        state = nextState;
        if (Object.prototype.hasOwnProperty.call(partial, 'groups')) {
          saveConfig(nextState.groups);
        }
        render(nextState, elements, setState);
      };
  
      const { groupSelect, manageBtn, addGroupBtn } = elements;
  
      groupSelect.addEventListener('change', (event) => {
        const value = Number(event.target.value);
        if (!Number.isNaN(value)) {
          setState({ activeIndex: value });
        }
      });
  
      manageBtn.addEventListener('click', () => {
        setState(prev => ({ manageMode: !prev.manageMode }));
      });
  
      addGroupBtn.addEventListener('click', () => {
        const name = prompt('请输入新的分组名称');
        if (!name) return;
        const trimmed = name.trim();
        if (!trimmed) return;
        const exists = state.groups.some(group => group.name === trimmed);
        if (exists) {
          alert('该分组已存在');
          return;
        }
        const newGroups = state.groups.concat({ name: trimmed, phrases: [] });
        setState(() => ({ groups: newGroups, activeIndex: newGroups.length - 1 }));
      });
  
      const observer = new MutationObserver(() => {
        const hostConnected = document.body.contains(elements.host);
        const toggleConnected = !elements.toggleButton || document.body.contains(elements.toggleButton);
        if (!hostConnected || !toggleConnected) {
          observer.disconnect();
          main();
        }
      });
  
      observer.observe(document.body, { childList: true, subtree: true });
  
      render(state, elements, setState);
  
      return true;
    };
  
    const init = () => {
      const success = main();
      if (success) return;
      const observer = new MutationObserver(() => {
        if (main()) {
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    };
  
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  })();
  
  