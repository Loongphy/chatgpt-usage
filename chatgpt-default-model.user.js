// ==UserScript==
// @name         ChatGPT 默认模型 GPT-6 High
// @namespace    local.chatgpt.default-model
// @version      1.1.1
// @description  让 chatgpt.com 新会话默认选中 GPT-6 High（绕过 workspace_model_policy 的 prefer_policy 强制默认）
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
//
// 原理（对当前版本的逆向结论）：
// - 新会话的模型不是读"上次选择"，而是 POST /backend-api/conversation/init
//   的响应里服务端下发的 default_model_slug（工作区策略 selection.model）。
//   该工作区策略为 {model:"gpt-6", thinking_effort:null} + prefer_policy，
//   所以每次新会话都被强制为 GPT-6 Instant，前端怎么存 last-used 都没用。
// - 本脚本在 document-start 改写 conversation/init 的请求与响应：
//     请求  requested_default_model -> 目标模型
//     响应  default_model_slug / intended_default_model_slug -> 目标模型
//   再写入 oai-tpp-model-settings cookie 提供 thinkingEffort 兜底，
//   使得 composer seed 出 {slug:gpt-6-thinking, thinkingEffort:extended}。
// - 之后发送消息时，前端自然把 model & thinking_effort 放进
//   /backend-api/f/conversation 请求，无需再改发送请求。
// - 实测：gpt-6-thinking + extended 对应的实际后端 slug 为 gpt-6.1-sol-wm
//   （"Sol" 是 GPT-6.1 的内部代号；High/Medium 只是 effort 档位，非不同模型）。
// - effort 的 seed 取自 /backend-api/models 响应的
//   workspace_model_policy.selection.thinking_effort（prefer_policy 优先于
//   cookie last-used）。不改写它时 slug=gpt-6-thinking + effort=null 会被
//   前端解析为 standard（Medium）。所以本脚本同时改写 models 响应。
//
// 变更：
//   1.1.1 修复默认档位只到 Medium：补改 /backend-api/models 响应中
//         workspace_model_policy.selection 与 default_model_slug。
//   1.1.0 补充 slug->后端模型的实测映射注释；首次验证通过版本。
//   1.0.0 初版。

(function () {
  'use strict';

  // ====== 可配置项 ======
  // 常用档位（picker 的 Power 滑条对应关系）：
  //   Instant -> {model_slug:"<m>-instant"}            effort: null
  //   Medium  -> {model_slug:"<m>-thinking"}           effort: "standard"
  //   High    -> {model_slug:"<m>-thinking"}           effort: "extended"
  // 可选模型：gpt-6 / gpt-5-6 / gpt-5-5（把 "-" 换成对应前缀）
  var MODEL_SLUG = 'gpt-6-thinking';   // 目标模型 slug
  var THINKING_EFFORT = 'extended';    // min|standard|extended|xhigh|max|ultra|zero
  // =====================

  var w = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  var COOKIE = 'oai-tpp-model-settings';

  // 1) 写入持久化 cookie，提供 lastUsed + effort 兜底（seed 会读它）
  try {
    var cfg = {
      modelSettings: { defaultModelSlug: null, lastUsedModelSlug: MODEL_SLUG },
      thinkingEffort: THINKING_EFFORT,
      lastStartedModelConfig: { modelSlug: MODEL_SLUG, thinkingEffort: THINKING_EFFORT },
      selectionMode: 'model'
    };
    document.cookie = COOKIE + '=' + encodeURIComponent(JSON.stringify(cfg)) +
      '; path=/; max-age=2592000; SameSite=Lax';
  } catch (e) {}

  function isInit(url) {
    return /\/backend-api\/conversation\/init/.test(url);
  }

  function isModels(url) {
    return /\/backend-api\/models[?/]/.test(url);
  }

  function rewriteInitResponse(resp) {
    return resp.clone().json().then(function (j) {
      if (j && typeof j === 'object') {
        if ('default_model_slug' in j) j.default_model_slug = MODEL_SLUG;
        if ('intended_default_model_slug' in j) j.intended_default_model_slug = MODEL_SLUG;
      }
      return new Response(JSON.stringify(j), {
        status: resp.status,
        statusText: resp.statusText,
        headers: resp.headers
      });
    }).catch(function () { return resp; });
  }

  function rewriteModelsResponse(resp) {
    return resp.clone().json().then(function (j) {
      if (j && typeof j === 'object') {
        var wp = j.workspace_model_policy;
        if (wp && wp.selection) {
          wp.selection.model = MODEL_SLUG;
          wp.selection.thinking_effort = THINKING_EFFORT;
        }
        if ('default_model_slug' in j) j.default_model_slug = MODEL_SLUG;
      }
      return new Response(JSON.stringify(j), {
        status: resp.status,
        statusText: resp.statusText,
        headers: resp.headers
      });
    }).catch(function () { return resp; });
  }

  function patchBody(body) {
    try {
      var j = JSON.parse(body);
      j.requested_default_model = MODEL_SLUG;
      j.thinking_effort = THINKING_EFFORT;
      return JSON.stringify(j);
    } catch (e) { return body; }
  }

  var origFetch = w.fetch.bind(w);
  w.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';

    if (isInit(url)) {
      // 改请求体里的 requested_default_model
      if (init && typeof init.body === 'string') {
        init = Object.assign({}, init, { body: patchBody(init.body) });
      } else if (typeof Request !== 'undefined' && input instanceof Request) {
        // input 是 Request 且没有显式 init.body
        if (!(init && init.body)) {
          var done = input.clone().text().then(function (t) {
            var req = new Request(input, { body: patchBody(t) });
            return origFetch(req).then(function (r) { return rewriteInitResponse(r); });
          });
          return done.catch(function () { return origFetch(input, init); });
        }
      }
      return origFetch(input, init).then(function (r) { return rewriteInitResponse(r); });
    }
    if (isModels(url)) {
      return origFetch(input, init).then(function (r) { return rewriteModelsResponse(r); });
    }
    return origFetch(input, init);
  };
})();
