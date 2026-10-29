/*!
 * UiGenBridge — panel <-> host MCP bridge adapter for the hba-uigen panel.
 *
 * Protocol (reverse-engineered from the official ZCode pdf-plugin):
 *  - The panel runs as an mcp-app iframe ("text/html;profile=mcp-app").
 *  - It is an MCP *client*: newline-free JSON-RPC 2.0 envelopes are exchanged
 *    with the host over window.parent.postMessage(msg, "*") and the window
 *    "message" event (see pdf-plugin dist/ui bundle: transport constructor
 *    `new ...Transport(window.parent, window.parent)`).
 *  - Handshake: MCP "initialize" -> "notifications/initialized" -> custom
 *    request "ui/initialize" { appInfo, appCapabilities, protocolVersion }.
 *  - "tools/call" reaches the plugin MCP server declared in
 *    plugin.json ui.surfaces[].server ("hba-uigen").
 *  - "notifications/progress" carries generation progress
 *    (params: { progressToken, progress, total, message }).
 *  - "notifications/resources/updated" carries resource change pushes
 *    (host-side ops pluginUi.resourceUpdated / pluginUi.resourceListChanged).
 *  - "ui/notifications/host-context-changed" carries partial host context
 *    increments (may contain only { theme: "light" | "dark" }); the initial
 *    theme also rides in the ui/initialize response's hostContext.
 *
 * This adapter exposes the minimal interface required by the migration:
 *    callTool(name, args)        -> Promise<structuredContent>
 *    onResourceUpdate(cb)        -> subscribe to resource updates
 *    onProgress(cb)              -> subscribe to generation progress
 *    onThemeChange(cb)           -> subscribe to host theme changes (ctx.theme)
 *    connect()                   -> Promise<"mcp" | "standalone">
 *
 * If no host answers (opened outside ZCode, or during integration bring-up),
 * the bridge degrades to a local in-page demo backend so the panel stays fully
 * usable. Integration-phase verification notes live in README.md.
 */
(function (global) {
  "use strict";

  var PROTOCOL_VERSION = "2025-06-18";
  var UI_PROTOCOL_VERSION = "2026-01-26";
  var CLIENT_INFO = { name: "hba-uigen-panel", version: "0.3.0" };
  var APP_INFO = { name: "hba-uigen", version: "0.3.0" };

  // -------------------------------------------------------------------------
  // local demo backend — compact mirror of server.mjs / uigen_sidecar.py demo
  // -------------------------------------------------------------------------
  var DEMO_NAMES = ["首页", "列表页", "详情页", "个人中心", "设置页", "搜索页", "消息页", "订单页", "登录页", "结果页"];

  function demoScreens(prompt, format, count) {
    var title = String(prompt || "").trim().slice(0, 12) || "UI 原型";
    var short = String(prompt || "").trim().slice(0, 40);
    var tabs = Math.min(count, 5);
    var screens = [];
    for (var i = 0; i < count; i++) {
      var hotspots = [];
      for (var j = 0; j < tabs; j++) {
        hotspots.push({
          to: "s" + (j + 1),
          label: DEMO_NAMES[j % DEMO_NAMES.length],
          x: Math.round((j * 390) / tabs),
          y: 774,
          w: Math.floor(390 / tabs),
          h: 70
        });
      }
      screens.push({
        id: "s" + (i + 1),
        name: DEMO_NAMES[i % DEMO_NAMES.length],
        html: demoHtml(i, title, short, hotspots),
        jsx: demoJsx(i, title, short),
        vue: demoVue(i, title, short),
        hotspots: hotspots
      });
    }
    return screens;
  }

  function demoHtml(i, title, prompt, hotspots) {
    var name = DEMO_NAMES[i % DEMO_NAMES.length];
    var cards = [
      { t: "快速上手", d: "三步完成配置，立即体验核心流程。" },
      { t: "核心功能", d: "围绕「" + ["浏览", "管理", "设置", "发现"][i % 4] + "」场景设计的关键能力。" },
      { t: "帮助与支持", d: "常见问题与在线客服入口。" }
    ].map(function (c) {
      return '      <div class="card"><h2>' + c.t + "</h2><p>" + c.d + "</p></div>";
    }).join("\n");
    var tabsHtml = (hotspots || []).map(function (h) {
      return '      <a class="tab' + (h.to === "s" + (i + 1) ? " on" : "") + '" data-uigen-goto="' + h.to + '">' + h.label + "</a>";
    }).join("\n");
    return "<!doctype html>\n<html lang=\"zh-CN\">\n<head>\n  <meta charset=\"utf-8\">\n" +
      "  <meta name=\"viewport\" content=\"width=390, initial-scale=1\">\n" +
      "  <title>" + name + " · " + title + "</title>\n" +
      "  <style>\n    * { box-sizing: border-box; margin: 0; }\n" +
      "    body { width: 390px; min-height: 844px; font-family: system-ui, sans-serif; background: #f5f6f8; color: #1f2329; }\n" +
      "    .app-bar { height: 56px; display: flex; align-items: center; padding: 0 16px; background: #2b6cb0; color: #fff; font-size: 17px; font-weight: 600; }\n" +
      "    main { padding: 16px; padding-bottom: 96px; }\n    h1 { font-size: 22px; margin-bottom: 6px; }\n" +
      "    .sub { font-size: 12px; color: #6b7280; margin-bottom: 16px; }\n" +
      "    .card { background: #fff; border-radius: 10px; padding: 14px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }\n" +
      "    .card h2 { font-size: 15px; margin-bottom: 6px; }\n    .card p { font-size: 13px; color: #4b5563; line-height: 1.6; }\n" +
      "    .tab-bar { position: fixed; left: 0; bottom: 0; width: 390px; height: 70px; display: flex; background: #fff; border-top: 1px solid #e5e7eb; }\n" +
      "    .tab { flex: 1; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #6b7280; text-decoration: none; }\n" +
      "    .tab.on { color: #2b6cb0; font-weight: 600; }\n  </style>\n</head>\n<body>\n" +
      '  <header class="app-bar">' + title + "</header>\n  <main>\n    <h1>" + name + "</h1>\n" +
      '    <p class="sub">uigen 演示生成 · 需求：' + (prompt || "(空)") + "</p>\n" + cards + "\n  </main>\n" +
      '  <nav class="tab-bar">\n' + tabsHtml + "\n  </nav>\n" +
      '  \x3cscript type="application/json" id="uigen-hotspots">' + JSON.stringify(hotspots || []) + "\x3c/script>\n</body>\n</html>\n";
  }

  function demoJsx(i, title, prompt) {
    var name = DEMO_NAMES[i % DEMO_NAMES.length];
    var cards = [
      { t: "快速上手", d: "三步完成配置，立即体验核心流程。" },
      { t: "核心功能", d: "围绕「" + ["浏览", "管理", "设置", "发现"][i % 4] + "」场景设计的关键能力。" },
      { t: "帮助与支持", d: "常见问题与在线客服入口。" }
    ].map(function (c) {
      return '        <div className="card"><h2>' + c.t + "</h2><p>" + c.d + "</p></div>";
    }).join("\n");
    return "// uigen demo artifact — screen " + (i + 1) + ": " + name + "\nexport default function Screen" + (i + 1) + "() {\n  return (\n" +
      '    <div className="phone" style={{ width: 390, minHeight: 844 }}>\n' +
      '      <header className="app-bar">' + title + "</header>\n      <main>\n        <h1>" + name + "</h1>\n" +
      '        <p className="sub">uigen 演示生成 · 需求：' + (prompt || "(空)") + "</p>\n" + cards +
      '\n      </main>\n      <nav className="tab-bar">{/* hotspots: see ui state */}</nav>\n    </div>\n  );\n}\n';
  }

  function demoVue(i, title, prompt) {
    var name = DEMO_NAMES[i % DEMO_NAMES.length];
    var cards = [
      { t: "快速上手", d: "三步完成配置，立即体验核心流程。" },
      { t: "核心功能", d: "围绕「" + ["浏览", "管理", "设置", "发现"][i % 4] + "」场景设计的关键能力。" },
      { t: "帮助与支持", d: "常见问题与在线客服入口。" }
    ].map(function (c) {
      return '      <div class="card"><h2>' + c.t + "</h2><p>" + c.d + "</p></div>";
    }).join("\n");
    return "<template>\n  <div class=\"phone\">\n    <header class=\"app-bar\">" + title + "</header>\n    <main>\n      <h1>" + name + "</h1>\n" +
      '      <p class="sub">uigen 演示生成 · 需求：' + (prompt || "(空)") + "</p>\n" + cards +
      "\n    </main>\n    <nav class=\"tab-bar\"><!-- hotspots: see ui state --></nav>\n  </div>\n</template>\n\n\x3cscript>\n" +
      "// uigen demo artifact — screen " + (i + 1) + ": " + name + "\nexport default {\n  name: \"Screen" + (i + 1) + "\"\n};\n\x3c/script>\n\n" +
      "<style scoped>\n.phone { width: 390px; min-height: 844px; font-family: system-ui, sans-serif; }\n</style>\n";
  }

  function localBackend() {
    // 磁盘即真源的内存镜像(0.3.0):screens 清单 + 产物,无版本概念。
    var screens = [];      // [{id,name,html,jsx,vue,hotspots,order}]
    var canvasLayout = null;

    function entryOf(s) {
      return { id: s.id, name: s.name, files: { html: s.id + ".html" }, hotspots: s.hotspots || [], order: s.order || 0, updatedAt: "" };
    }
    function nextId() {
      var n = screens.length + 1;
      var used = {};
      screens.forEach(function (s) { used[s.id] = true; });
      while (used["s" + n]) n += 1;
      return "s" + n;
    }

    return {
      callTool: function (name, args, emitProgress) {
        return new Promise(function (resolve, reject) {
          setTimeout(function () {
            try {
              if (name === "uigen_generate") {
                var prompt = String((args && args.prompt) || "").trim();
                if (!prompt) return reject(new Error("prompt is required"));
                var format = (args && args.format) || "html";
                var count = Math.min(10, Math.max(1, parseInt(args && args.screenCount, 10) || 3));
                if (emitProgress) emitProgress({ progress: 0, total: count + 2, message: "准备生成(本地演示)" });
                screens = demoScreens(prompt, format, count).map(function (s, i) { s.order = i; return s; });
                if (emitProgress) {
                  for (var i = 0; i < count; i++) emitProgress({ progress: i + 1, total: count + 2, message: "生成屏幕 " + (i + 1) + "/" + count });
                }
                if (emitProgress) emitProgress({ progress: count + 2, total: count + 2, message: "完成" });
                resolve({
                  ok: true,
                  engine: "demo(panel-local)",
                  prompt: prompt,
                  format: format,
                  screenCount: screens.length,
                  screens: screens.map(function (s) { return { id: s.id, name: s.name, html: s.html, jsx: s.jsx, vue: s.vue, hotspots: s.hotspots || [] }; })
                });
              } else if (name === "uigen_list_screens") {
                var limit = Math.max(1, parseInt(args && args.limit, 10) || 100);
                resolve({ ok: true, screens: screens.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); }).slice(0, limit).map(entryOf), updatedAt: "" });
              } else if (name === "uigen_get_screen") {
                var gid = String((args && args.id) || "");
                var found = null;
                screens.forEach(function (s) { if (s.id === gid) found = s; });
                if (!found) return reject(new Error("screen not found: " + gid));
                resolve({ ok: true, screen: { id: found.id, name: found.name, order: found.order || 0, hotspots: found.hotspots || [], files: { html: found.id + ".html" }, updatedAt: "", html: found.html, jsx: found.jsx || "", vue: found.vue || "" } });
              } else if (name === "uigen_save_screen") {
                var name2 = String((args && args.name) || "").trim();
                if (!name2) return reject(new Error("name is required"));
                var sid = String((args && args.id) || "").trim();
                var target = null;
                screens.forEach(function (s) { if (s.id === sid) target = s; });
                if (sid && !target) {
                  target = { id: sid, name: name2, html: "", jsx: "", vue: "", hotspots: [], order: screens.length };
                  screens.push(target);
                } else if (!sid) {
                  target = { id: nextId(), name: name2, html: "", jsx: "", vue: "", hotspots: [], order: screens.length };
                  screens.push(target);
                }
                target.name = name2;
                if (args && typeof args.html === "string") target.html = args.html;
                if (args && typeof args.jsx === "string") target.jsx = args.jsx;
                if (args && typeof args.vue === "string") target.vue = args.vue;
                if (args && Array.isArray(args.hotspots)) target.hotspots = args.hotspots;
                if (args && typeof args.order === "number") target.order = args.order;
                resolve({ ok: true, screen: entryOf(target) });
              } else if (name === "uigen_delete_screen") {
                var did = String((args && args.id) || "");
                var at = -1;
                screens.forEach(function (s, i) { if (s.id === did) at = i; });
                if (at < 0) return reject(new Error("screen not found: " + did));
                screens.splice(at, 1);
                resolve({ ok: true, deleted: did });
              } else if (name === "uigen_export") {
                var files = [];
                screens.forEach(function (s) {
                  ["html", "jsx", "vue"].forEach(function (ext) {
                    if (s[ext] && String(s[ext]).trim()) files.push({ name: s.id + "-" + s.name + "." + ext, bytes: String(s[ext]).length });
                  });
                });
                resolve({ ok: true, targetDir: "(panel-local, 未写盘)", screens: screens.length, files: files });
              } else if (name === "uigen_import_dir") {
                reject(new Error("panel-local 模式不支持目录导入,请在 ZCode 宿主内使用"));
              } else if (name === "uigen_canvas_save") {
                var layout = args && args.layoutJson;
                if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
                  return reject(new Error("layoutJson must be an object"));
                }
                canvasLayout = layout;
                resolve({ ok: true, updatedAt: new Date().toISOString(), bytes: 0, file: "(panel-local, 未写盘)" });
              } else if (name === "uigen_canvas_get") {
                resolve({ ok: true, layout: canvasLayout, updatedAt: "", workspace: null });
              } else {
                reject(new Error("unknown tool: " + name));
              }
            } catch (e) {
              reject(e);
            }
          }, 30);
        });
      }
    };
  }

  // -------------------------------------------------------------------------
  // bridge
  // -------------------------------------------------------------------------
  function createUiGenBridge(options) {
    options = options || {};
    var mode = "unknown";
    var pending = new Map();
    var seq = 0;
    var resourceCbs = [];
    var progressCbs = [];
    var themeCbs = [];
    var backend = localBackend();
    var connected = false;

    function emitTheme(ctx) {
      if (!ctx || !ctx.theme) return;
      themeCbs.forEach(function (cb) { try { cb(ctx); } catch (e) { /* cb error */ } });
    }

    function post(msg) {
      var target = global.parent && global.parent !== global ? global.parent : null;
      if (!target) return false;
      try {
        target.postMessage(msg, "*");
        return true;
      } catch (e) {
        return false;
      }
    }

    function sendRequest(method, params, timeoutMs) {
      return new Promise(function (resolve, reject) {
        seq += 1;
        var id = seq;
        var timer = setTimeout(function () {
          pending.delete(id);
          reject(new Error("bridge timeout: " + method));
        }, timeoutMs || options.requestTimeoutMs || 15000);
        pending.set(id, {
          resolve: function (v) { clearTimeout(timer); resolve(v); },
          reject: function (e) { clearTimeout(timer); reject(e); }
        });
        if (!post({ jsonrpc: "2.0", id: id, method: method, params: params || {} })) {
          clearTimeout(timer);
          pending.delete(id);
          reject(new Error("no host window"));
        }
      });
    }

    function sendNotification(method, params) {
      post({ jsonrpc: "2.0", method: method, params: params || {} });
    }

    function onMessage(ev) {
      var msg = ev && ev.data;
      if (!msg || msg.jsonrpc !== "2.0") return;
      if (msg.id !== undefined && msg.id !== null && (msg.result !== undefined || msg.error !== undefined)) {
        var entry = pending.get(msg.id);
        if (!entry) return;
        pending.delete(msg.id);
        if (msg.error) entry.reject(new Error(msg.error.message || "bridge error"));
        else entry.resolve(msg.result);
        return;
      }
      if (typeof msg.method === "string") {
        if (msg.method === "notifications/progress" && msg.params) {
          progressCbs.forEach(function (cb) { try { cb(msg.params); } catch (e) { /* cb error */ } });
        } else if (
          msg.method === "notifications/resources/updated" ||
          msg.method === "notifications/resources/list_changed"
        ) {
          resourceCbs.forEach(function (cb) { try { cb(msg.params || {}); } catch (e) { /* cb error */ } });
        } else if (msg.method === "pluginUi.resourceUpdated" || (msg.params && msg.params.op === "pluginUi.resourceUpdated")) {
          resourceCbs.forEach(function (cb) { try { cb(msg.params || {}); } catch (e) { /* cb error */ } });
        } else if (msg.method === "ui/notifications/host-context-changed") {
          // params 是部分上下文增量,主题切换时可能只含 { theme }
          emitTheme(msg.params || {});
        }
      }
    }

    function extractResult(raw) {
      if (raw && raw.structuredContent !== undefined) return raw.structuredContent;
      if (raw && Array.isArray(raw.content)) {
        for (var i = 0; i < raw.content.length; i++) {
          if (raw.content[i].type === "text") {
            try { return JSON.parse(raw.content[i].text); } catch (e) { /* keep raw */ }
          }
        }
      }
      return raw;
    }

    var bridge = {
      get mode() { return mode; },
      onResourceUpdate: function (cb) { if (typeof cb === "function") resourceCbs.push(cb); },
      onProgress: function (cb) { if (typeof cb === "function") progressCbs.push(cb); },
      onThemeChange: function (cb) { if (typeof cb === "function") themeCbs.push(cb); },

      connect: function () {
        return new Promise(function (resolve) {
          if (global.parent && global.parent !== global) {
            global.addEventListener("message", onMessage);
            var timeoutMs = options.connectTimeoutMs || 10000;
            // The view<->host channel does NOT speak MCP "initialize" (the host
            // replies "Method not found"); the handshake is exactly: ui/initialize
            // request (UI protocol 2026-01-26) -> ui/notifications/initialized.
            sendRequest("ui/initialize", {
              appInfo: APP_INFO,
              appCapabilities: { tools: { listChanged: false }, availableDisplayModes: ["inline"] },
              protocolVersion: UI_PROTOCOL_VERSION
            }, timeoutMs).then(function (result) {
              sendNotification("ui/notifications/initialized", {});
              connected = true;
              mode = "mcp";
              // 初始主题在 ui/initialize 响应的 hostContext 里,先分发一次
              emitTheme((result && result.hostContext) || {});
              resolve(mode);
            }).catch(function () {
              mode = "standalone";
              resolve(mode);
            });
          } else {
            mode = "standalone";
            resolve(mode);
          }
        });
      },

      callTool: function (name, args) {
        if (mode === "mcp" && connected) {
          var token = "uigen-" + (++seq);
          return sendRequest("tools/call", {
            name: name,
            arguments: args || {},
            _meta: { progressToken: token }
          }).then(extractResult);
        }
        return backend.callTool(name, args || {}, function (p) {
          progressCbs.forEach(function (cb) { try { cb(p); } catch (e) { /* cb error */ } });
        });
      },

      // low-level escape hatch (integration bring-up / diagnostics)
      request: sendRequest,
      notify: sendNotification
    };
    return bridge;
  }

  var api = { create: createUiGenBridge, version: "0.3.0" };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.UiGenBridge = api;
})(typeof window !== "undefined" ? window : globalThis);
