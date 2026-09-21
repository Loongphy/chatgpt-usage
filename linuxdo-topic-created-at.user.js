// ==UserScript==
// @name         linux.do 发帖时间列
// @namespace    https://loongphy.com
// @version      1.1.0
// @description  Add a "created-at" column to linux.do topic lists (homepage, /tag/*, categories, suggested topics). Discourse list pages only show last activity; this script captures each topic's created_at from the list JSON (fetch/XHR hook at document-start) and injects an extra column before "活动".
// @author       loongphy
// @license      MIT
// @icon64       https://www.google.com/s2/favicons?sz=64&domain=linux.do
// @match        https://linux.do/*
// @grant        none
// @noframes
// @run-at       document-start
// @downloadURL  https://github.com/Loongphy/chatgpt-usage/raw/refs/heads/main/linuxdo-topic-created-at.user.js
// ==/UserScript==
//
// Discourse 的话题列表（linux.do 首页、/tag/*、/c/* 等）只有"活动"列（最后回复时间），
// 主题的创建时间只存在于列表 JSON 里（/latest.json、/tag/*.json 的 topic_list.topics[].created_at）。
//   - document-start 拦截页面的 fetch / XHR，收集 id -> created_at：.json 列表/单帖响应 +
//     message-bus 长轮询（实时插入列表的新主题只出现在轮询载荷里），并写 localStorage 缓存兜底。
//   - 给每张 .topic-list 表在"活动"列前注入"发帖"列；表头与单元格都补。
//   - SPA 路由切换、无限滚动、Ember 重渲染导致的行增删，由 MutationObserver + 低频轮询兜底补齐。
//
(function () {
  'use strict';

  /* ---------------------------------------------------------------- 配置 */

  var LS_KEY = 'linuxdo-topic-created-at'; // localStorage 缓存键
  var MAX_CACHE = 4000;                    // 缓存条数上限，超出按写入顺序丢最旧的
  var COL_CLASS = 'topic-created-at';      // 注入列的类名（兼作去重标记）
  var COL_LABEL = '发帖';

  /* ---------------------------------------------------------------- 数据 */

  var createdMap = new Map(); // topicId(字符串) -> created_at（ISO 字符串）

  try {
    var saved = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    for (var i = 0; i < saved.length; i++) createdMap.set(saved[i][0], saved[i][1]);
    while (createdMap.size > MAX_CACHE) createdMap.delete(createdMap.keys().next().value);
  } catch (e) { /* 缓存损坏就当没有 */ }

  var saveTimer = 0;
  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = 0;
      try { localStorage.setItem(LS_KEY, JSON.stringify(Array.from(createdMap))); } catch (e) { /* 写不进就算了 */ }
    }, 2000);
  }

  function putCreated(id, iso) {
    var key = String(id);
    if (createdMap.has(key)) return;
    createdMap.set(key, iso);
    while (createdMap.size > MAX_CACHE) createdMap.delete(createdMap.keys().next().value);
    scheduleSave();
    scheduleSweep();
  }

  // 从任意 Discourse JSON 响应里捞创建时间：
  //   列表响应取 topic_list.topics[]；单帖响应（/t/{id}.json）顶层有 id + created_at；
  //   message-bus 长轮询是 [["/latest", topicJSON], ...] 数组，新主题实时插入列表时数据只在这里。
  function harvest(data) {
    if (!data || typeof data !== 'object') return;
    var topics = data.topic_list && data.topic_list.topics;
    if (Array.isArray(topics)) {
      for (var i = 0; i < topics.length; i++) {
        var t = topics[i];
        if (t && t.id != null && t.created_at) putCreated(t.id, t.created_at);
      }
      return;
    }
    if (Array.isArray(data)) {
      for (var k = 0; k < data.length; k++) {
        var msg = data[k];
        if (Array.isArray(msg) && msg[1] && typeof msg[1] === 'object') harvest(msg[1]);
      }
      return;
    }
    // post_stream（单帖响应）或 posters（列表序列化）作主题特征，避免误收其他带 id/created_at 的对象
    if (data.id != null && data.created_at && data.slug &&
        (data.post_stream || Array.isArray(data.posters))) putCreated(data.id, data.created_at);
  }

  /* ----------------------------------------------------- 拦截 fetch / XHR */

  // .json 覆盖 Discourse API；message-bus 长轮询（跨域 CDN 域名）承载实时插入的新主题
  function isApiUrl(url) {
    return typeof url === 'string' && (/\.json(\?|#|$)/.test(url) || /message-bus\/.+\/poll/.test(url));
  }

  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input) {
      var promise = origFetch.apply(this, arguments);
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (isApiUrl(url)) {
          promise.then(function (res) {
            try { res.clone().json().then(harvest, function () {}); } catch (e) { /* ignore */ }
          }, function () {});
        }
      } catch (e) { /* 拦截绝不影响页面本身 */ }
      return promise;
    };
  }

  var XHR = XMLHttpRequest.prototype;
  var origOpen = XHR.open;
  var origSend = XHR.send;
  XHR.open = function (method, url) {
    this.__ldApiUrl = isApiUrl(url);
    return origOpen.apply(this, arguments);
  };
  XHR.send = function () {
    var xhr = this;
    if (xhr.__ldApiUrl) {
      xhr.addEventListener('load', function () {
        try {
          if (xhr.responseType === 'json') harvest(xhr.response);
          else if (xhr.responseType === '' || xhr.responseType === 'text') harvest(JSON.parse(xhr.responseText));
        } catch (e) { /* ignore */ }
      });
    }
    return origSend.apply(this, arguments);
  };

  /* ---------------------------------------------------------------- 渲染 */

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // 与"活动"列同风格的紧凑显示：今天只给时刻，昨天/前天/一周内给相对天数，更早给日期
  function fmtShort(d) {
    var now = new Date();
    var dayMs = 86400000;
    var dayOf = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
    var diffDays = Math.round((dayOf(now) - dayOf(d)) / dayMs); // 按自然日计算，跨月/跨年也对
    if (diffDays <= 0) return pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (diffDays === 1) return '昨天';
    if (diffDays === 2) return '前天';
    if (diffDays < 7) return diffDays + '天前';
    if (d.getFullYear() === now.getFullYear()) return pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function fmtFull(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function injectStyle() {
    var style = document.createElement('style');
    style.textContent =
      'table.topic-list th.' + COL_CLASS + '{text-align:right;white-space:nowrap;}' +
      'table.topic-list td.' + COL_CLASS + '{text-align:right;white-space:nowrap;font-size:.93em;color:var(--primary-medium,#919191);}';
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureHeader(table) {
    var headRow = table.tHead && table.tHead.querySelector('tr');
    if (!headRow || headRow.querySelector('th.' + COL_CLASS)) return;
    var th = document.createElement('th');
    th.className = 'topic-list-data num ' + COL_CLASS;
    th.setAttribute('scope', 'col');
    th.textContent = COL_LABEL;
    headRow.insertBefore(th, headRow.querySelector('th.activity')); // 无活动列时第二个参数为 null，追加到末尾
  }

  function sweep() {
    var tables = document.querySelectorAll('table.topic-list');
    if (!tables.length) return;

    for (var i = 0; i < tables.length; i++) ensureHeader(tables[i]);

    var rows = document.querySelectorAll('tr.topic-list-item[data-topic-id]');
    for (var j = 0; j < rows.length; j++) {
      var row = rows[j];
      var id = row.getAttribute('data-topic-id');

      var td = row.querySelector('td.' + COL_CLASS);
      if (!td) {
        td = document.createElement('td');
        td.className = 'topic-list-data num ' + COL_CLASS;
        var anchor = row.querySelector('td.activity');
        if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(td, anchor);
        else row.appendChild(td);
      }
      if (td.dataset.filled === id) continue; // 已按该主题填充过

      var created = createdMap.get(id);
      if (!created) continue;
      var ts = Date.parse(created);
      if (!isFinite(ts)) continue;

      var d = new Date(ts);
      td.textContent = fmtShort(d);
      td.title = fmtFull(d);
      td.dataset.filled = id;
    }
  }

  /* ---------------------------------------------------------------- 启动 */

  var sweepScheduled = false;
  function scheduleSweep() {
    if (sweepScheduled) return;
    sweepScheduled = true;
    setTimeout(function () { sweepScheduled = false; sweep(); }, 120);
  }

  function start() {
    injectStyle();
    sweep();
    // Ember 重渲染 / SPA 路由 / 无限滚动的行增删都靠观察补齐，轮询只作兜底
    new MutationObserver(scheduleSweep).observe(document.body, { childList: true, subtree: true });
    setInterval(sweep, 1500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
