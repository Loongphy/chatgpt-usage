// ==UserScript==
// @name         ChatGPT Theme
// @namespace    https://loongphy.com
// @version      0.1.0
// @description  ChatGPT 主题
// @author       Loongphy
// @license      PolyForm-Noncommercial-1.0.0; https://polyformproject.org/licenses/noncommercial/1.0.0/
// @icon64       https://www.google.com/s2/favicons?sz=64&domain=chatgpt.com
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @run-at       document-start
// ==/UserScript==

(function () {
    "use strict";

    // ============================================================
    // GitHub Dark Default 配色（提取自 https://github.com 实际 CSS 变量）
    //   --bgColor-default:  #0d1117   主背景
    //   --bgColor-muted:    #151b23   次要背景
    //   --bgColor-inset:    #010409   内嵌背景（最深）
    //   --bgColor-disabled: #212830   禁用背景
    //   --fgColor-default:  #f0f6fc   主文字
    //   --fgColor-muted:    #9198a1   次要文字
    //   --fgColor-disabled: #656c76   第三文字
    // ============================================================
    const DEFAULTS = {
        dark: {
            bgPrimary: "#282d3e",
            bgSecondary: "#151b23",
            bgTertiary: "#212830",
            mainSurfacePrimary: "#282d3e",
            mainSurfaceSecondary: "#151b23",
            mainSurfaceTertiary: "#212830",
            messageSurface: "#151b23",
            composerSurface: "#151b23",
            composerSurfacePrimary: "#282d3e",
            sidebarSurface: "#0d1117",
            sidebarSurfacePrimary: "#0d1117",
            sidebarSurfaceSecondary: "#151b23",
            sidebarSurfaceTertiary: "#212830",
            bgElevatedPrimary: "#161b22",
            bgElevatedSecondary: "#0d1117",
            bgSecondarySurface: "#151b23",
            textPrimary: "#e5ebfa",
            textSecondary: "#9198a1",
            textTertiary: "#656c76",
        },
        light: {
            bgPrimary: "",
            bgSecondary: "",
            bgTertiary: "",
            mainSurfacePrimary: "",
            mainSurfaceSecondary: "",
            mainSurfaceTertiary: "",
            messageSurface: "",
            composerSurface: "",
            composerSurfacePrimary: "",
            sidebarSurface: "",
            sidebarSurfacePrimary: "",
            sidebarSurfaceSecondary: "",
            sidebarSurfaceTertiary: "",
            bgElevatedPrimary: "",
            bgElevatedSecondary: "",
            bgSecondarySurface: "",
            textPrimary: "",
            textSecondary: "",
            textTertiary: "",
        },
    };

    // CSS 变量名映射
    const VAR_MAP = {
        bgPrimary: "--bg-primary",
        bgSecondary: "--bg-secondary",
        bgTertiary: "--bg-tertiary",
        mainSurfacePrimary: "--main-surface-primary",
        mainSurfaceSecondary: "--main-surface-secondary",
        mainSurfaceTertiary: "--main-surface-tertiary",
        messageSurface: "--message-surface",
        composerSurface: "--composer-surface",
        composerSurfacePrimary: "--composer-surface-primary",
        sidebarSurface: "--sidebar-surface",
        sidebarSurfacePrimary: "--sidebar-surface-primary",
        sidebarSurfaceSecondary: "--sidebar-surface-secondary",
        sidebarSurfaceTertiary: "--sidebar-surface-tertiary",
        bgElevatedPrimary: "--bg-elevated-primary",
        bgElevatedSecondary: "--bg-elevated-secondary",
        bgSecondarySurface: "--bg-secondary-surface",
        textPrimary: "--text-primary",
        textSecondary: "--text-secondary",
        textTertiary: "--text-tertiary",
    };

    // 中文标签 & 默认颜色提示
    const LABELS = {
        bgPrimary: { label: "页面底色 / Header", hint: "#0d1117 / #ffffff" },
        bgSecondary: { label: "次要背景色", hint: "#151b23 / #e8e8e8" },
        bgTertiary: { label: "第三背景色", hint: "#212830 / #f3f3f3" },
        mainSurfacePrimary: {
            label: "★ 主界面背景",
            hint: "#282d3e / #ffffff",
        },
        mainSurfaceSecondary: {
            label: "界面次要色",
            hint: "#151b23 / #f7f7f7",
        },
        mainSurfaceTertiary: { label: "界面第三色", hint: "#212830 / #f1f1f1" },
        messageSurface: {
            label: "消息气泡背景",
            hint: "#151b23 / transparent",
        },
        composerSurface: { label: "输入框背景", hint: "#151b23 / transparent" },
        composerSurfacePrimary: {
            label: "输入框主色",
            hint: "#0d1117 / #ffffff",
        },
        sidebarSurface: { label: "侧边栏背景", hint: "#010409 / #ffffff" },
        sidebarSurfacePrimary: {
            label: "侧边栏主色",
            hint: "#010409 / #ffffff",
        },
        sidebarSurfaceSecondary: {
            label: "侧边栏次要色",
            hint: "#0d1117 / #f9f9f9",
        },
        sidebarSurfaceTertiary: {
            label: "侧边栏第三色",
            hint: "#151b23 / #f3f3f3",
        },
        bgElevatedPrimary: { label: "浮层主背景", hint: "#161b22 / #ffffff" },
        bgElevatedSecondary: {
            label: "浮层次要背景",
            hint: "#0d1117 / #f9f9f9",
        },
        bgSecondarySurface: {
            label: "次要表面背景",
            hint: "#151b23 / #f9f9f9",
        },
        textPrimary: { label: "主要文字色", hint: "#e5ebfa / #0d0d0d" },
        textSecondary: { label: "次要文字色", hint: "#9198a1 / #5d5d5d" },
        textTertiary: { label: "第三文字色", hint: "#656c76 / #8f8f8f" },
    };

    // ============================================================
    // 存储（带内存缓存，避免频繁 GM_getValue）
    // ============================================================
    let configCache = null;

    function loadConfig() {
        try {
            const raw = GM_getValue("chatgpt_bg_config", "{}");
            const parsed = JSON.parse(raw);
            return {
                server_oled_theme: parsed.server_oled_theme === true,
                dark: { ...DEFAULTS.dark, ...(parsed.dark || {}) },
                light: { ...DEFAULTS.light, ...(parsed.light || {}) },
            };
        } catch {
            return {
                server_oled_theme: false,
                ...JSON.parse(JSON.stringify(DEFAULTS)),
            };
        }
    }

    function getConfig(forceReload) {
        if (!configCache || forceReload) {
            configCache = loadConfig();
        }
        return configCache;
    }

    function setConfig(config) {
        configCache = config;
        GM_setValue(
            "chatgpt_bg_config",
            JSON.stringify({
                server_oled_theme: config.server_oled_theme,
                dark: config.dark,
                light: config.light,
            }),
        );
    }

    // ============================================================
    // 样式注入（使用 !important 确保覆盖 .dark[data-oled] 等规则）
    // ============================================================
    function buildStyle(config) {
        const isDark = document.documentElement.classList.contains("dark");
        const theme = isDark ? config.dark : config.light;
        const vars = Object.entries(VAR_MAP)
            .filter(([key]) => theme[key])
            .map(([key, cssVar]) => `  ${cssVar}: ${theme[key]} !important;`)
            .join("\n");
        if (!vars) return "";
        return `:root {\n${vars}\n}`;
    }

    let styleEl = null;
    let lastCss = "";

    function applyStyle(config) {
        const css = buildStyle(config);

        // 缓存：CSS 未变则跳过 DOM 写入
        if (css === lastCss) return;
        lastCss = css;

        if (styleEl) {
            if (css) styleEl.textContent = css;
            else {
                styleEl.remove();
                styleEl = null;
            }
            return;
        }
        if (!css) return;
        styleEl = document.createElement("style");
        styleEl.id = "chatgpt-bg-customizer-style";
        styleEl.textContent = css;
        // 同等优先级下后出现的规则胜出，appendChild 到末尾即可
        const target = document.head || document.documentElement;
        target.appendChild(styleEl);
    }

    function refreshStyle() {
        const config = getConfig();
        applyStyle(config);
        applyOledSetting(config);
    }

    // ============================================================
    // 监听 class 变化（仅在 dark/light 切换时刷新，避免无差别触发）
    // ============================================================
    let observer = null;
    let lastIsDark = false;
    let refreshQueued = false;

    function scheduleRefreshStyle() {
        if (refreshQueued) return;
        refreshQueued = true;
        requestAnimationFrame(() => {
            refreshQueued = false;
            refreshStyle();
        });
    }

    function startObserver() {
        if (observer) observer.disconnect();
        // 记录当前主题状态
        lastIsDark =
            document.documentElement?.classList.contains("dark") ?? false;

        observer = new MutationObserver(() => {
            if (!document.documentElement) return;
            const nowIsDark =
                document.documentElement.classList.contains("dark");
            if (nowIsDark !== lastIsDark) {
                lastIsDark = nowIsDark;
                scheduleRefreshStyle();
            }
        });

        if (document.documentElement) {
            observer.observe(document.documentElement, {
                attributes: true,
                attributeFilter: ["class"],
            });
        } else {
            const ready = () => {
                if (document.documentElement) {
                    observer.observe(document.documentElement, {
                        attributes: true,
                        attributeFilter: ["class"],
                    });
                } else {
                    requestAnimationFrame(ready);
                }
            };
            ready();
        }
    }

    // ============================================================
    // 设置面板
    // ============================================================
    let panelEl = null;

    function openPanel() {
        if (panelEl && document.body.contains(panelEl)) return;
        panelEl = null;
        const config = getConfig();

        const container = document.createElement("div");
        container.id = "chatgpt-bg-panel";

        // 面板样式
        const style = document.createElement("style");
        style.textContent = `
            #chatgpt-bg-panel {
                position: fixed !important;
                top: 0 !important; left: 0 !important;
                width: 100% !important; height: 100% !important;
                z-index: 999999 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                background: rgba(0,0,0,0.55) !important;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif !important;
                font-size: 14px !important;
                line-height: 1.5 !important;
                color: #e8e8e8 !important;
                margin: 0 !important;
                padding: 0 !important;
                border: none !important;
            }
            #chatgpt-bg-panel * {
                box-sizing: border-box;
            }
            #chatgpt-bg-panel-inner {
                background: #2a2a2a;
                border: 1px solid #404040;
                border-radius: 16px;
                width: 680px;
                max-width: 92vw;
                max-height: 88vh;
                display: flex;
                flex-direction: column;
                box-shadow: 0 24px 80px rgba(0,0,0,0.6);
                overflow: hidden;
            }
            #chatgpt-bg-panel-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 14px 20px;
                border-bottom: 1px solid #404040;
                font-weight: 600;
                font-size: 16px;
                color: #fff;
                flex-shrink: 0;
            }
            #chatgpt-bg-panel-header span { display: flex; align-items: center; gap: 8px; }
            #chatgpt-bg-close {
                background: none; border: none;
                color: #999; font-size: 20px; cursor: pointer;
                padding: 2px 8px; border-radius: 6px;
                line-height: 1;
            }
            #chatgpt-bg-close:hover { background: #3a3a3a; color: #fff; }
            #chatgpt-bg-panel-body {
                padding: 16px 20px 20px;
                overflow-y: auto;
                flex: 1;
            }
            #chatgpt-bg-tabs {
                display: flex;
                gap: 8px;
                margin-bottom: 16px;
            }
            .chatgpt-bg-tab {
                flex: 1;
                padding: 9px 16px;
                border: 1px solid #404040;
                background: transparent;
                color: #aaa;
                border-radius: 10px;
                cursor: pointer;
                font-size: 14px;
                font-weight: 500;
                transition: all 0.2s;
                text-align: center;
            }
            .chatgpt-bg-tab.active {
                background: #3a3a3a;
                color: #fff;
                border-color: #666;
            }
            .chatgpt-bg-tab:hover:not(.active) { background: #333; }
            #chatgpt-bg-indicator {
                font-size: 12px;
                color: #888;
                margin-bottom: 12px;
                padding: 6px 10px;
                background: #222;
                border-radius: 8px;
                display: flex;
                align-items: center;
                gap: 6px;
            }
            #chatgpt-bg-indicator .dot {
                display: inline-block;
                width: 8px; height: 8px;
                border-radius: 50%;
            }
            #chatgpt-bg-indicator .dot.dark-dot { background: #000; border: 1px solid #555; }
            #chatgpt-bg-indicator .dot.light-dot { background: #fff; border: 1px solid #555; }
            #chatgpt-bg-theme-content {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 10px;
            }
            .chatgpt-bg-field {
                display: flex;
                flex-direction: column;
                gap: 3px;
            }
            .chatgpt-bg-field label {
                font-size: 12px;
                color: #aaa;
                font-weight: 500;
            }
            .chatgpt-bg-field .input-row {
                display: flex;
                gap: 6px;
                align-items: center;
            }
            .chatgpt-bg-field input[type="text"] {
                flex: 1;
                padding: 6px 10px;
                border: 1px solid #404040;
                border-radius: 8px;
                background: #1a1a1a;
                color: #e8e8e8;
                font-size: 13px;
                font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
                outline: none;
                transition: border-color 0.2s;
                width: 100%;
                box-sizing: border-box;
                min-width: 0;
            }
            .chatgpt-bg-field input[type="text"]:focus {
                border-color: #66b5ff;
            }
            .chatgpt-bg-field input[type="text"]::placeholder {
                color: #666;
                font-size: 11px;
            }
            .chatgpt-bg-field input[type="color"] {
                width: 32px;
                height: 32px;
                padding: 0;
                border: 1px solid #404040;
                border-radius: 8px;
                cursor: pointer;
                background: none;
                flex-shrink: 0;
            }
            .chatgpt-bg-field input[type="color"]::-webkit-color-swatch-wrapper {
                padding: 2px;
            }
            .chatgpt-bg-field input[type="color"]::-webkit-color-swatch {
                border: none;
                border-radius: 5px;
            }
            #chatgpt-bg-oled-toggle {
                border-top: 1px solid #404040;
                padding: 12px 0;
                margin-top: 12px;
            }
            #chatgpt-bg-oled-toggle label {
                display: flex;
                align-items: center;
                gap: 10px;
                cursor: pointer;
                font-size: 13px;
                color: #ccc;
            }
            #chatgpt-bg-oled-toggle input[type="checkbox"] {
                width: 18px;
                height: 18px;
                cursor: pointer;
                accent-color: #66b5ff;
            }
            #chatgpt-bg-actions {
                display: flex;
                gap: 8px;
                justify-content: flex-end;
                border-top: 1px solid #404040;
                padding-top: 16px;
                margin-top: 12px;
                flex-shrink: 0;
            }
            #chatgpt-bg-actions button {
                padding: 8px 20px;
                border-radius: 8px;
                border: 1px solid #404040;
                cursor: pointer;
                font-size: 14px;
                font-weight: 500;
                transition: all 0.2s;
            }
            #chatgpt-bg-reset { background: transparent; color: #aaa; }
            #chatgpt-bg-reset:hover { background: #333; }
            #chatgpt-bg-reset-all { background: transparent; color: #888; }
            #chatgpt-bg-reset-all:hover { background: #331111; color: #ff6666; }
            #chatgpt-bg-apply {
                background: #66b5ff;
                color: #000;
                border-color: transparent;
            }
            #chatgpt-bg-apply:hover { opacity: 0.85; }
        `;

        const isDark = document.documentElement.classList.contains("dark");

        container.innerHTML = `
            <div id="chatgpt-bg-panel-inner">
                <div id="chatgpt-bg-panel-header">
                    <span>🎨 ChatGPT 背景色自定义</span>
                    <button id="chatgpt-bg-close">✕</button>
                </div>
                <div id="chatgpt-bg-panel-body">
                    <div id="chatgpt-bg-tabs">
                        <button class="chatgpt-bg-tab active" data-theme="dark">🌙 深色模式</button>
                        <button class="chatgpt-bg-tab" data-theme="light">☀️ 浅色模式</button>
                    </div>
                    <div id="chatgpt-bg-indicator">
                        <span class="dot ${isDark ? "dark-dot" : "light-dot"}"></span>
                        当前页面：<strong>${isDark ? "深色模式 (dark)" : "浅色模式 (light)"}</strong>
                        ${isDark ? "— 以下编辑的是深色模式颜色" : "— 以下编辑的是浅色模式颜色"}
                    </div>
                    <div id="chatgpt-bg-theme-content"></div>
                    <div id="chatgpt-bg-oled-toggle">
                        <label>
                            <input type="checkbox" id="chatgpt-bg-oled-checkbox" ${config.server_oled_theme ? "checked" : ""}>
                            <span>🌙 服务端 OLED 主题</span>
                        </label>
                    </div>
                    <div id="chatgpt-bg-actions">
                        <button id="chatgpt-bg-reset-all">🔄 重置全部配置</button>
                        <button id="chatgpt-bg-reset">↩️ 重置当前主题</button>
                        <button id="chatgpt-bg-apply">✅ 应用</button>
                    </div>
                </div>
            </div>
        `;

        container.appendChild(style);
        panelEl = container;
        document.body.appendChild(container);
        panelEl = container;

        // ---- 状态 ----
        let currentTheme = "dark";

        // ---- 渲染字段 ----
        function renderFields(theme) {
            const content = container.querySelector(
                "#chatgpt-bg-theme-content",
            );
            const cfg = config[theme];
            content.innerHTML = "";
            for (const [key, meta] of Object.entries(LABELS)) {
                const field = document.createElement("div");
                field.className = "chatgpt-bg-field";

                const label = document.createElement("label");
                label.textContent = meta.label;

                const row = document.createElement("div");
                row.className = "input-row";

                const textInput = document.createElement("input");
                textInput.type = "text";
                textInput.dataset.key = key;
                textInput.dataset.theme = theme;
                textInput.placeholder = meta.hint;
                textInput.value = cfg[key] || "";

                const colorInput = document.createElement("input");
                colorInput.type = "color";
                colorInput.dataset.key = key;
                colorInput.dataset.theme = theme;
                // 从已有值解析颜色
                const existingColor = cfg[key] || "";
                const hexMatch = existingColor.match(/#[0-9a-fA-F]{6}/);
                colorInput.value = hexMatch
                    ? hexMatch[0]
                    : theme === "dark"
                      ? "#212121"
                      : "#ffffff";

                // 双向同步
                textInput.addEventListener("input", () => {
                    const hex = textInput.value.match(/#[0-9a-fA-F]{6}/);
                    if (hex) colorInput.value = hex[0];
                });
                colorInput.addEventListener("input", () => {
                    // 颜色选择器的值是纯 #rrggbb，保留原有 alpha 部分
                    const oldVal = textInput.value;
                    const alphaMatch = oldVal.match(/(\d+(\.\d+)?%?)\)?$/);
                    textInput.value =
                        colorInput.value + (alphaMatch ? alphaMatch[0] : "");
                });

                row.appendChild(textInput);
                row.appendChild(colorInput);
                field.appendChild(label);
                field.appendChild(row);
                content.appendChild(field);
            }
        }

        // ---- 事件绑定 ----
        container
            .querySelector("#chatgpt-bg-close")
            .addEventListener("click", () => {
                panelEl.remove();
                panelEl = null;
            });

        container.addEventListener("click", (e) => {
            if (e.target === container) {
                panelEl.remove();
                panelEl = null;
            }
        });

        // Tab 切换
        const tabs = container.querySelectorAll(".chatgpt-bg-tab");
        tabs.forEach((tab) => {
            tab.addEventListener("click", () => {
                tabs.forEach((t) => t.classList.remove("active"));
                tab.classList.add("active");
                currentTheme = tab.dataset.theme;
                renderFields(currentTheme);
            });
        });

        // 应用
        container
            .querySelector("#chatgpt-bg-apply")
            .addEventListener("click", () => {
                const fields = container.querySelectorAll(
                    '#chatgpt-bg-theme-content input[type="text"]',
                );
                fields.forEach((input) => {
                    const theme = input.dataset.theme;
                    const key = input.dataset.key;
                    const val = input.value.trim();
                    config[theme][key] = val;
                });
                // OLED 开关
                config.server_oled_theme = container.querySelector(
                    "#chatgpt-bg-oled-checkbox",
                ).checked;
                setConfig(config);
                refreshStyle();
                panelEl.remove();
                panelEl = null;
            });

        // 重置当前主题
        container
            .querySelector("#chatgpt-bg-reset")
            .addEventListener("click", () => {
                config[currentTheme] = { ...DEFAULTS[currentTheme] };
                renderFields(currentTheme);
            });

        // 重置全部
        container
            .querySelector("#chatgpt-bg-reset-all")
            .addEventListener("click", () => {
                config.dark = { ...DEFAULTS.dark };
                config.light = { ...DEFAULTS.light };
                config.server_oled_theme = false;
                container.querySelector("#chatgpt-bg-oled-checkbox").checked =
                    false;
                renderFields(currentTheme);
            });

        // 初始渲染
        renderFields("dark");
    }

    // ============================================================
    // 浮动按钮（防重复注入）
    // ============================================================
    function addFloatingButton() {
        if (document.getElementById("chatgpt-bg-toggle-btn")) return;

        const btn = document.createElement("div");
        btn.id = "chatgpt-bg-toggle-btn";
        btn.title = "自定义 ChatGPT 背景色";
        btn.textContent = "🎨";
        btn.addEventListener("click", openPanel);
        document.body.appendChild(btn);

        if (!document.getElementById("chatgpt-bg-toggle-style")) {
            const style = document.createElement("style");
            style.id = "chatgpt-bg-toggle-style";
            style.textContent = `
                #chatgpt-bg-toggle-btn {
                    position: fixed;
                    bottom: 24px;
                    right: 24px;
                    z-index: 99999;
                    width: 44px;
                    height: 44px;
                    border-radius: 50%;
                    background: rgba(40,40,40,0.85);
                    border: 1px solid rgba(255,255,255,0.12);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    font-size: 22px;
                    box-shadow: 0 2px 12px rgba(0,0,0,0.4);
                    transition: transform 0.2s, box-shadow 0.2s;
                    user-select: none;
                    backdrop-filter: blur(12px);
                    -webkit-backdrop-filter: blur(12px);
                }
                #chatgpt-bg-toggle-btn:hover {
                    transform: scale(1.1) translateY(-2px);
                    box-shadow: 0 6px 24px rgba(0,0,0,0.5);
                }
            `;
            document.head.appendChild(style);
        }
    }

    // ============================================================
    // 菜单命令
    // ============================================================
    GM_registerMenuCommand("🎨 打开背景色设置面板", openPanel);
    GM_registerMenuCommand("🔄 重置所有颜色配置", () => {
        const empty = {
            server_oled_theme: false,
            ...JSON.parse(JSON.stringify(DEFAULTS)),
        };
        setConfig(empty);
        refreshStyle();
    });

    // ============================================================
    // OLED 关闭逻辑
    // ============================================================
    let oledObserver = null;

    function applyOledSetting(config) {
        const html = document.documentElement;
        if (!html) return;

        if (!config.server_oled_theme) {
            if (html.hasAttribute("data-oled")) {
                html.removeAttribute("data-oled");
            }
            // 监视是否被 ChatGPT 重新加上
            if (!oledObserver) {
                oledObserver = new MutationObserver(() => {
                    if (html.hasAttribute("data-oled")) {
                        html.removeAttribute("data-oled");
                    }
                });
                oledObserver.observe(html, {
                    attributes: true,
                    attributeFilter: ["data-oled"],
                });
            }
        } else {
            if (oledObserver) {
                oledObserver.disconnect();
                oledObserver = null;
            }
        }
    }

    // ============================================================
    // 初始化：分两阶段
    //   阶段 1 (document-start) — 尽早注入背景样式，减少闪烁
    //   阶段 2 (DOMContentLoaded) — 添加浮动按钮等 UI
    // ============================================================
    function initEarly() {
        if (!document.documentElement) {
            requestAnimationFrame(initEarly);
            return;
        }
        const config = getConfig(true);
        applyStyle(config);
        applyOledSetting(config);
        startObserver();
    }

    function initUI() {
        if (document.body) {
            addFloatingButton();
        } else {
            document.addEventListener(
                "DOMContentLoaded",
                () => addFloatingButton(),
                { once: true },
            );
        }
    }

    initEarly();
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initUI, { once: true });
    } else {
        initUI();
    }
})();
