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
 *
 * This adapter exposes the minimal interface required by the migration:
 *    callTool(name, args)        -> Promise<structuredContent>
 *    onResourceUpdate(cb)        -> subscribe to resource updates
 *    onProgress(cb)              -> subscribe to generation progress
 *    connect()                   -> Promise<"mcp" | "standalone">
 *
 * If no host answers (opened outside ZCode, or during integration bring-up),
 * the bridge degrades to a local in-page demo backend so the panel stays fully
 * usable. Integration-phase verification notes live in README.md.
 */
(function (global) {
  "use strict";

  var PROTOCOL_VERSION = "2025-06-18";
  var CLIENT_INFO = { name: "hba-uigen-panel", version: "0.1.0" };
  var APP_INFO = { name: "hba-uigen", version: "0.1.0" };

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
    var versions = [];
    var seq = 0;

    function save(rec) {
      seq += 1;
      var id = rec.id || ("v" + String(seq).padStart(3, "0") + "-local");
      rec = Object.assign({}, rec, { id: id });
      versions = versions.filter(function (v) { return v.id !== id; });
      versions.push({
        id: id,
        createdAt: rec.createdAt,
        prompt: rec.prompt,
        format: rec.format,
        screenCount: (rec.screens || []).length,
        source: rec.source || "generate"
      });
      rec._index = versions[versions.length - 1];
      rec._full = true;
      store[id] = rec;
      return rec;
    }
    var store = {};

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
                var screens = demoScreens(prompt, format, count);
                if (emitProgress) {
                  for (var i = 0; i < count; i++) emitProgress({ progress: i + 1, total: count + 2, message: "生成屏幕 " + (i + 1) + "/" + count });
                }
                var rec = save({
                  prompt: prompt,
                  format: format,
                  createdAt: new Date().toISOString(),
                  screens: screens,
                  source: "demo-local"
                });
                if (emitProgress) emitProgress({ progress: count + 2, total: count + 2, message: "完成" });
                resolve({
                  ok: true,
                  engine: "demo(panel-local)",
                  versionId: rec.id,
                  prompt: rec.prompt,
                  format: rec.format,
                  screenCount: screens.length,
                  screens: screens
                });
              } else if (name === "uigen_list_versions") {
                var limit = Math.max(1, parseInt(args && args.limit, 10) || 20);
                resolve({ ok: true, versions: versions.slice().reverse().slice(0, limit) });
              } else if (name === "uigen_get_version") {
                var rec2 = store[String((args && args.versionId) || "")];
                if (!rec2) return reject(new Error("version not found: " + (args && args.versionId)));
                resolve({ ok: true, version: rec2 });
              } else if (name === "uigen_export") {
                var rec3 = store[String((args && args.versionId) || "")];
                if (!rec3) return reject(new Error("version not found: " + (args && args.versionId)));
                var files = [];
                (rec3.screens || []).forEach(function (s) {
                  ["html", "jsx", "vue"].forEach(function (ext) {
                    if (s[ext] && String(s[ext]).trim()) files.push({ name: s.id + "-" + s.name + "." + ext, bytes: String(s[ext]).length });
                  });
                });
                resolve({ ok: true, versionId: rec3.id, targetDir: "(panel-local, 未写盘)", files: files });
              } else if (name === "uigen_import_dir") {
                reject(new Error("panel-local 模式不支持目录导入,请在 ZCode 宿主内使用"));
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
    var backend = localBackend();
    var connected = false;

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

      connect: function () {
        return new Promise(function (resolve) {
          if (global.parent && global.parent !== global) {
            global.addEventListener("message", onMessage);
            var timeoutMs = options.connectTimeoutMs || 2500;
            sendRequest("initialize", {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: {},
              clientInfo: CLIENT_INFO
            }, timeoutMs).then(function (initResult) {
              connected = true;
              mode = "mcp";
              sendNotification("notifications/initialized", {});
              // custom post-init handshake seen in the pdf-plugin bundle
              sendRequest("ui/initialize", {
                appInfo: APP_INFO,
                appCapabilities: { tools: {}, displayModes: ["inline", "fullscreen"] },
                protocolVersion: (initResult && initResult.protocolVersion) || PROTOCOL_VERSION
              }, timeoutMs).catch(function () { /* optional, tolerate older hosts */ });
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

  var api = { create: createUiGenBridge, version: "0.1.0" };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.UiGenBridge = api;
})(typeof window !== "undefined" ? window : globalThis);
