// ==UserScript==
// @name         chatgpt model selection
// @namespace    https://loongphy.com
// @version      1.3.4
// @description  Globally override model and thinking_effort on chatgpt.com
// @author       loongphy
// @match        https://chatgpt.com/*
// @icon         https://chatgpt.com/favicon.ico
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-start
// ==/UserScript==

(function () {
    "use strict";

    // ================================================================
    //  Config
    // ================================================================
    const K_MODEL = "model";
    const K_EFFORT = "effort";

    function getModel() {
        return GM_getValue(K_MODEL, "thinking");
    }
    function getEffort() {
        return GM_getValue(K_EFFORT, "extended");
    }
    function saveModel(v) {
        GM_setValue(K_MODEL, v);
    }
    function saveEffort(v) {
        GM_setValue(K_EFFORT, v);
    }

    // ================================================================
    //  Patch body for conversation requests
    // ================================================================
    function isConv(url) {
        return (
            typeof url === "string" &&
            url.includes("/backend-api/f/conversation")
        );
    }

    function patchBody(bodyStr) {
        const data = JSON.parse(bodyStr);
        const m = getModel();
        if (m === "thinking") {
            data.model = "gpt-5-5-thinking";
            data.thinking_effort = getEffort();
        } else {
            data.model = "gpt-5-5";
            delete data.thinking_effort;
        }
        return JSON.stringify(data);
    }

    // ================================================================
    //  Fetch interceptor — hooks all references
    // ================================================================
    function hookFetch(scope) {
        if (!scope || !scope.fetch) return;
        const orig = scope.fetch;
        scope.fetch = function (input, init) {
            const url = typeof input === "string" ? input : input?.url;
            if (
                isConv(url) &&
                init?.method === "POST" &&
                typeof init.body === "string"
            ) {
                try {
                    return orig.call(scope, input, {
                        ...init,
                        body: patchBody(init.body),
                    });
                } catch (_) {}
            }
            return orig.call(scope, input, init);
        };
    }

    hookFetch(unsafeWindow || window);
    hookFetch(globalThis);
    hookFetch(self);

    // Re-hook in case framework replaces window.fetch after boot
    setInterval(function () {
        const w = unsafeWindow || window;
        const cur = w.fetch;
        if (cur !== w._cmsFetch) {
            hookFetch(w);
            w._cmsFetch = w.fetch;
        }
    }, 2000);

    // ================================================================
    //  XHR interceptor
    // ================================================================
    var XHR = (unsafeWindow || window).XMLHttpRequest;
    if (XHR) {
        var proto = XHR.prototype;
        var origOpen = proto.open;
        var origSend = proto.send;

        proto.open = function (method, url) {
            this._cmsUrl = typeof url === "string" ? url : String(url);
            return origOpen.apply(this, arguments);
        };

        proto.send = function (body) {
            if (isConv(this._cmsUrl) && typeof body === "string") {
                try {
                    return origSend.call(this, patchBody(body));
                } catch (_) {}
            }
            return origSend.apply(this, arguments);
        };
    }

    // ================================================================
    //  Settings panel
    // ================================================================
    function openSettings() {
        var old = document.getElementById("cms-ui");
        if (old) old.remove();

        var model = getModel();
        var effort = getEffort();
        var isDark = document.documentElement.classList.contains("dark");

        var t = isDark
            ? {
                  bg: "#353535",
                  fg: "#e5ebfa",
                  fg2: "#9198a1",
                  fg3: "#656c76",
                  hover: "rgba(255,255,255,0.1)",
                  pill: "rgba(255,255,255,0.06)",
                  pillActive: "rgba(255,255,255,0.12)",
                  shadow: "rgba(0,0,0,0.32) 0 8px 16px 0, rgba(255,255,255,0.15) 0 0 0 0.5px inset",
                  accent: "#7ab7ff",
                  btnText: "#0d0d0d",
              }
            : {
                  bg: "#fff",
                  fg: "#0d0d0d",
                  fg2: "#5d5d5d",
                  fg3: "#8f8f8f",
                  hover: "rgba(0,0,0,0.06)",
                  pill: "rgba(0,0,0,0.04)",
                  pillActive: "#fff",
                  shadow: "rgba(0,0,0,0.12) 0 8px 24px 0, rgba(0,0,0,0.05) 0 0 0 0.5px inset",
                  accent: "#2964aa",
                  btnText: "#fff",
              };

        var font =
            '"HarmonyOS Sans SC", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

        function make(tag, css, kids) {
            var el = document.createElement(tag);
            if (css) Object.assign(el.style, css);
            if (kids)
                kids.forEach(function (k) {
                    el.appendChild(
                        typeof k === "string" ? document.createTextNode(k) : k,
                    );
                });
            return el;
        }

        function lbl(text) {
            return make(
                "div",
                {
                    fontSize: "13px",
                    fontWeight: "500",
                    color: t.fg2,
                    marginBottom: "8px",
                },
                [text],
            );
        }

        function pills(opts, cur, cb) {
            var c = make("div", {
                display: "flex",
                gap: "4px",
                background: t.pill,
                borderRadius: "10px",
                padding: "3px",
                marginBottom: "16px",
            });
            var bg = isDark ? t.pillActive : "#fff";
            var btns = [];
            opts.forEach(function (_a) {
                var label = _a.label,
                    value = _a.value;
                var act = value === cur;
                var b = make(
                    "button",
                    {
                        flex: "1",
                        padding: "6px 12px",
                        border: "none",
                        borderRadius: "8px",
                        background: act ? bg : "transparent",
                        color: act ? t.fg : t.fg2,
                        fontSize: "13px",
                        fontWeight: act ? "500" : "400",
                        cursor: "pointer",
                        transition: "all 0.12s",
                    },
                    [label],
                );
                b.addEventListener("click", function () {
                    btns.forEach(function (x) {
                        x.style.background = "transparent";
                        x.style.color = t.fg2;
                        x.style.fontWeight = "400";
                    });
                    b.style.background = bg;
                    b.style.color = t.fg;
                    b.style.fontWeight = "500";
                    cb(value);
                });
                c.appendChild(b);
                btns.push(b);
            });
            return c;
        }

        var overlay = make("div", {
            position: "fixed",
            inset: "0",
            zIndex: "999999",
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: font,
        });
        overlay.id = "cms-ui";
        overlay.addEventListener("click", function (e) {
            if (e.target === overlay) overlay.remove();
        });

        var panel = make("div", {
            background: t.bg,
            borderRadius: "16px",
            boxShadow: t.shadow,
            padding: "20px",
            minWidth: "320px",
            maxWidth: "380px",
            color: t.fg,
            fontSize: "14px",
            lineHeight: "1.5",
        });
        panel.addEventListener("click", function (e) {
            e.stopPropagation();
        });

        // header
        panel.appendChild(
            make(
                "div",
                {
                    fontSize: "16px",
                    fontWeight: "600",
                    marginBottom: "16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                },
                [
                    make("span", {}, ["Model Override"]),
                    (function () {
                        var b = make(
                            "button",
                            {
                                background: "none",
                                border: "none",
                                color: t.fg2,
                                fontSize: "18px",
                                cursor: "pointer",
                                padding: "2px 6px",
                                borderRadius: "6px",
                                lineHeight: "1",
                            },
                            ["✕"],
                        );
                        b.addEventListener("mouseenter", function () {
                            b.style.background = t.hover;
                        });
                        b.addEventListener("mouseleave", function () {
                            b.style.background = "none";
                        });
                        b.addEventListener("click", function () {
                            overlay.remove();
                        });
                        return b;
                    })(),
                ],
            ),
        );

        // model type
        panel.appendChild(lbl("Model"));
        var curModel = model;
        panel.appendChild(
            pills(
                [
                    { label: "Instant", value: "instant" },
                    { label: "Thinking", value: "thinking" },
                ],
                curModel,
                function (v) {
                    curModel = v;
                    toggleEffort();
                },
            ),
        );

        // thinking effort
        var effortWrap = make("div", {});
        effortWrap.appendChild(lbl("Thinking Effort"));
        var curEffort = effort;
        effortWrap.appendChild(
            pills(
                [
                    { label: "Standard", value: "standard" },
                    { label: "Extended", value: "extended" },
                ],
                curEffort,
                function (v) {
                    curEffort = v;
                },
            ),
        );
        panel.appendChild(effortWrap);

        function toggleEffort() {
            effortWrap.style.display =
                curModel === "thinking" ? "block" : "none";
        }
        toggleEffort();

        // save
        var saveBtn = make(
            "button",
            {
                width: "100%",
                marginTop: "16px",
                padding: "10px",
                border: "none",
                borderRadius: "10px",
                background: t.accent,
                color: t.btnText,
                fontSize: "14px",
                fontWeight: "600",
                cursor: "pointer",
                transition: "opacity 0.12s",
            },
            ["Save"],
        );
        saveBtn.addEventListener("mouseenter", function () {
            saveBtn.style.opacity = "0.85";
        });
        saveBtn.addEventListener("mouseleave", function () {
            saveBtn.style.opacity = "1";
        });
        saveBtn.addEventListener("click", function () {
            saveModel(curModel);
            saveEffort(curEffort);
            overlay.remove();
        });
        panel.appendChild(saveBtn);

        overlay.appendChild(panel);
        document.documentElement.appendChild(overlay);
    }

    GM_registerMenuCommand("⚙️ Model Override Settings", openSettings);
})();
