#!/usr/bin/env node
/**
 * hba-uigen MCP server — hand-written MCP stdio JSON-RPC 2.0, zero dependencies.
 *
 * Wire format (MCP stdio transport): newline-delimited JSON-RPC 2.0 messages
 * on stdin/stdout. Nothing else is ever written to stdout (diagnostics go to
 * stderr).
 *
 * Methods implemented:
 *   initialize / notifications/initialized / ping
 *   tools/list / tools/call
 *       uigen_generate      — multi-screen prototype (sidecar first, built-in demo fallback)
 *       uigen_list_versions — history (FR-2-7)
 *       uigen_get_version   — full record incl. HTML/JSX/Vue artifacts (FR-2-3)
 *       uigen_export        — write artifacts to a directory (FR-2-8)
 *       uigen_import_dir    — import local *.html directory (FR-2-6)
 *   resources/list / resources/read / resources/subscribe / resources/unsubscribe
 *       ui://hba-uigen/panel.html   (text/html;profile=mcp-app)  — the panel UI
 *       ui://hba-uigen/bridge.js    (text/javascript)            — panel bridge adapter
 *       ui://hba-uigen/state.json   (application/json)           — live version index
 *
 * Generation emits notifications/progress (when the caller passes
 * params._meta.progressToken) and notifications/message logs.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_NAME = "hba-uigen";
const SERVER_VERSION = "0.1.0";
const PANEL_URI = `ui://${SERVER_NAME}/panel.html`;
const BRIDGE_URI = `ui://${SERVER_NAME}/bridge.js`;
const STATE_URI = `ui://${SERVER_NAME}/state.json`;
const HTML_MIME = "text/html;profile=mcp-app";
const PROTOCOL_FALLBACK = "2025-06-18";

// ---------------------------------------------------------------------------
// store — shared layout with sidecar/uigen_sidecar.py
//   <storeDir>/versions.json          index: { versions: [...newest last], seq }
//   <storeDir>/<versionId>/meta.json  full record (artifacts inline)
//   <storeDir>/<versionId>/screens/   s1.html / s1.jsx / s1.vue per screen
// ---------------------------------------------------------------------------

function storeDir() {
  const dir = process.env.UIGEN_STORE_DIR && process.env.UIGEN_STORE_DIR.trim();
  return path.resolve(dir || path.join(process.cwd(), ".hba", "uigen"));
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

function readIndex() {
  const file = path.join(storeDir(), "versions.json");
  try {
    const idx = JSON.parse(fs.readFileSync(file, "utf8"));
    if (idx && Array.isArray(idx.versions)) return idx;
  } catch {
    /* first run */
  }
  return { versions: [], seq: 0 };
}

function writeIndex(idx) {
  ensureDir(storeDir());
  fs.writeFileSync(path.join(storeDir(), "versions.json"), JSON.stringify(idx, null, 2), "utf8");
}

function newVersionId(idx) {
  const ts = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  idx.seq = (idx.seq || 0) + 1;
  return `v${ts}-${String(idx.seq).padStart(3, "0")}`;
}

function saveVersion(record) {
  const idx = readIndex();
  const id = record.id || newVersionId(idx);
  const full = { ...record, id };
  const vdir = ensureDir(path.join(storeDir(), id));
  const sdir = ensureDir(path.join(vdir, "screens"));
  for (const s of full.screens || []) {
    fs.writeFileSync(path.join(sdir, `${s.id}.html`), s.html || "", "utf8");
    fs.writeFileSync(path.join(sdir, `${s.id}.jsx`), s.jsx || "", "utf8");
    fs.writeFileSync(path.join(sdir, `${s.id}.vue`), s.vue || "", "utf8");
  }
  fs.writeFileSync(path.join(vdir, "meta.json"), JSON.stringify(full, null, 2), "utf8");
  idx.versions = idx.versions.filter((v) => v.id !== id);
  idx.versions.push({
    id,
    createdAt: full.createdAt,
    prompt: full.prompt,
    format: full.format,
    screenCount: (full.screens || []).length,
    source: full.source || "generate",
  });
  writeIndex(idx);
  return full;
}

function listVersions(limit = 20) {
  const idx = readIndex();
  return [...idx.versions].reverse().slice(0, Math.max(1, limit | 0 || 20));
}

function getVersion(versionId) {
  const meta = path.join(storeDir(), versionId, "meta.json");
  try {
    return JSON.parse(fs.readFileSync(meta, "utf8"));
  } catch {
    return null;
  }
}

function exportVersion(versionId, targetDir) {
  const rec = getVersion(versionId);
  if (!rec) return { ok: false, error: `version not found: ${versionId}` };
  const dest = ensureDir(path.resolve(targetDir || path.join(storeDir(), versionId, "export")));
  const files = [];
  for (const s of rec.screens || []) {
    for (const [ext, body] of [["html", s.html], ["jsx", s.jsx], ["vue", s.vue]]) {
      if (typeof body !== "string" || !body.trim()) continue;
      const name = `${s.id}-${sanitizeName(s.name || s.id)}.${ext}`;
      fs.writeFileSync(path.join(dest, name), body, "utf8");
      files.push({ name, bytes: Buffer.byteLength(body, "utf8") });
    }
  }
  const manifest = {
    versionId,
    prompt: rec.prompt,
    format: rec.format,
    createdAt: rec.createdAt,
    screens: (rec.screens || []).map((s) => ({ id: s.id, name: s.name })),
    files: files.map((f) => f.name),
  };
  fs.writeFileSync(path.join(dest, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  files.push({ name: "manifest.json", bytes: Buffer.byteLength(JSON.stringify(manifest, null, 2), "utf8") });
  return { ok: true, versionId, targetDir: dest, files };
}

function sanitizeName(n) {
  return String(n).replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40) || "screen";
}

function importDir(dir) {
  const src = path.resolve(dir);
  let entries;
  try {
    entries = fs.readdirSync(src, { withFileTypes: true });
  } catch (e) {
    return { ok: false, error: `cannot read dir ${src}: ${e.message}` };
  }
  const htmlFiles = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".html"))
    .map((e) => e.name)
    .sort();
  if (!htmlFiles.length) return { ok: false, error: `no *.html files in ${src}` };
  const screens = htmlFiles.map((name, i) => {
    const html = fs.readFileSync(path.join(src, name), "utf8");
    const stem = name.replace(/\.html?$/i, "");
    return {
      id: `s${i + 1}`,
      name: stem.slice(0, 20),
      html,
      jsx: importedWrapper("jsx", stem, html),
      vue: importedWrapper("vue", stem, html),
      hotspots: [],
    };
  });
  const rec = saveVersion({
    prompt: `(导入自 ${src})`,
    format: "html",
    createdAt: new Date().toISOString(),
    screens,
    source: "import_dir",
  });
  return {
    ok: true,
    versionId: rec.id,
    imported: screens.length,
    dir: src,
    screens: screens.map((s) => ({ id: s.id, name: s.name })),
  };
}

function importedWrapper(kind, stem, html) {
  const banner = `/* imported from ${stem}.html — original markup embedded below */\n`;
  if (kind === "jsx") {
    return (
      `${banner}export default function ${toIdent(stem)}() {\n` +
      `  // Original HTML kept for reference; port to JSX as needed.\n` +
      `  /*\n${html.replace(/\*\//g, "* /").slice(0, 20000)}\n  */\n` +
      `  return <div data-imported="${stem}" />;\n}\n`
    );
  }
  return (
    `<template>\n  <!-- imported from ${stem}.html -->\n  <div data-imported="${stem}" />\n</template>\n\n` +
    `<script>\n${banner}export default {\n  name: "${toIdent(stem)}"\n};\n</script>\n`
  );
}

function toIdent(s) {
  const cleaned = String(s).replace(/[^A-Za-z0-9_$]/g, "") || "ImportedScreen";
  return /^[0-9]/.test(cleaned) ? `Screen${cleaned}` : cleaned;
}

// ---------------------------------------------------------------------------
// built-in demo generator — behaviour mirrored by sidecar/uigen_sidecar.py.
// Produces N mobile screens (390x844) with tab-bar hotspots plus the three
// artifacts (html / jsx / vue) so the panel can switch formats (FR-2-3).
// ---------------------------------------------------------------------------

const SCREEN_NAMES = ["首页", "列表页", "详情页", "个人中心", "设置页", "搜索页", "消息页", "订单页", "登录页", "结果页"];

function demoGenerate(prompt, format, screenCount, onScreen) {
  const count = Math.min(10, Math.max(1, screenCount || 3));
  const fmt = ["html", "jsx", "vue"].includes(format) ? format : "html";
  const title = String(prompt || "").trim().slice(0, 12) || "UI 原型";
  const shortPrompt = String(prompt || "").trim().slice(0, 40);
  const screens = [];
  const tabs = Math.min(count, 5);
  for (let i = 0; i < count; i++) {
    const id = `s${i + 1}`;
    const name = SCREEN_NAMES[i % SCREEN_NAMES.length];
    const hotspots = [];
    for (let j = 0; j < tabs; j++) {
      hotspots.push({
        to: `s${j + 1}`,
        label: SCREEN_NAMES[j % SCREEN_NAMES.length],
        x: Math.round((j * 390) / tabs),
        y: 774,
        w: Math.floor(390 / tabs),
        h: 70,
      });
    }
    screens.push({
      id,
      name,
      html: demoHtml(i, title, shortPrompt, hotspots),
      jsx: demoJsx(i, title, shortPrompt),
      vue: demoVue(i, title, shortPrompt),
      hotspots,
    });
    if (onScreen) onScreen(i + 1, count);
  }
  return {
    id: "",
    prompt: String(prompt || ""),
    format: fmt,
    createdAt: new Date().toISOString(),
    screens,
    source: "demo",
  };
}

function demoCards(i) {
  return [
    { t: "快速上手", d: "三步完成配置，立即体验核心流程。" },
    { t: "核心功能", d: `围绕「${["浏览", "管理", "设置", "发现"][i % 4]}」场景打磨的关键能力。` },
    { t: "帮助与支持", d: "常见问题与在线客服入口。" },
  ];
}

function demoHtml(i, title, prompt, hotspots) {
  const name = SCREEN_NAMES[i % SCREEN_NAMES.length];
  const cards = demoCards(i)
    .map((c) => `      <div class="card"><h2>${c.t}</h2><p>${c.d}</p></div>`)
    .join("\n");
  const tabsHtml = (hotspots || [])
    .map((h) => `      <a class="tab${h.to === `s${i + 1}` ? " on" : ""}" data-uigen-goto="${h.to}">${h.label}</a>`)
    .join("\n");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=390, initial-scale=1">
  <title>${name} · ${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; }
    body { width: 390px; min-height: 844px; font-family: system-ui, sans-serif; background: #f5f6f8; color: #1f2329; }
    .app-bar { height: 56px; display: flex; align-items: center; padding: 0 16px; background: #2b6cb0; color: #fff; font-size: 17px; font-weight: 600; }
    main { padding: 16px; padding-bottom: 96px; }
    h1 { font-size: 22px; margin-bottom: 6px; }
    .sub { font-size: 12px; color: #6b7280; margin-bottom: 16px; }
    .card { background: #fff; border-radius: 10px; padding: 14px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    .card h2 { font-size: 15px; margin-bottom: 6px; }
    .card p { font-size: 13px; color: #4b5563; line-height: 1.6; }
    .tab-bar { position: fixed; left: 0; bottom: 0; width: 390px; height: 70px; display: flex; background: #fff; border-top: 1px solid #e5e7eb; }
    .tab { flex: 1; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #6b7280; text-decoration: none; }
    .tab.on { color: #2b6cb0; font-weight: 600; }
  </style>
</head>
<body>
  <header class="app-bar">${title}</header>
  <main>
    <h1>${name}</h1>
    <p class="sub">uigen 演示生成 · 需求：${prompt || "(空)"}</p>
${cards}
  </main>
  <nav class="tab-bar">
${tabsHtml}
  </nav>
  <script type="application/json" id="uigen-hotspots">${JSON.stringify(hotspots || [])}</script>
</body>
</html>
`;
}

function demoJsx(i, title, prompt) {
  const name = SCREEN_NAMES[i % SCREEN_NAMES.length];
  const cards = demoCards(i)
    .map((c) => `        <div className="card"><h2>${c.t}</h2><p>${c.d}</p></div>`)
    .join("\n");
  return `// uigen demo artifact — screen ${i + 1}: ${name}
export default function Screen${i + 1}() {
  return (
    <div className="phone" style={{ width: 390, minHeight: 844 }}>
      <header className="app-bar">${title}</header>
      <main>
        <h1>${name}</h1>
        <p className="sub">uigen 演示生成 · 需求：${prompt || "(空)"}</p>
${cards}
      </main>
      <nav className="tab-bar">{/* hotspots: see ui state */}</nav>
    </div>
  );
}
`;
}

function demoVue(i, title, prompt) {
  const name = SCREEN_NAMES[i % SCREEN_NAMES.length];
  const cards = demoCards(i)
    .map((c) => `      <div class="card"><h2>${c.t}</h2><p>${c.d}</p></div>`)
    .join("\n");
  return `<template>
  <div class="phone">
    <header class="app-bar">${title}</header>
    <main>
      <h1>${name}</h1>
      <p class="sub">uigen 演示生成 · 需求：${prompt || "(空)"}</p>
${cards}
    </main>
    <nav class="tab-bar"><!-- hotspots: see ui state --></nav>
  </div>
</template>

<script>
// uigen demo artifact — screen ${i + 1}: ${name}
export default {
  name: "Screen${i + 1}"
};
</script>

<style scoped>
.phone { width: 390px; min-height: 844px; font-family: system-ui, sans-serif; }
</style>
`;
}

// ---------------------------------------------------------------------------
// sidecar delegation (Python) — best effort, falls back to the demo generator.
// ---------------------------------------------------------------------------

function sidecarPath() {
  const env = process.env.UIGEN_SIDECAR && process.env.UIGEN_SIDECAR.trim();
  if (env) return path.resolve(env);
  return path.resolve(__dirname, "..", "..", "sidecar", "uigen_sidecar.py");
}

function pythonCandidates() {
  if (process.env.UIGEN_PYTHON && process.env.UIGEN_PYTHON.trim()) return [process.env.UIGEN_PYTHON.trim()];
  return process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];
}

function runSidecar(subcmd, payload, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const script = sidecarPath();
    if (!fs.existsSync(script)) return resolve(null);
    const candidates = pythonCandidates();
    let idx = 0;
    const tryNext = () => {
      if (idx >= candidates.length) return resolve(null);
      const bin = candidates[idx++];
      let child;
      try {
        child = spawn(bin, [script, subcmd], {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, HBA_ROOT: process.env.HBA_ROOT || "", PYTHONIOENCODING: "utf-8" },
        });
      } catch {
        return tryNext();
      }
      let out = "";
      let err = "";
      const timer = setTimeout(() => {
        try { child.kill(); } catch { /* ignore */ }
        resolve(null);
      }, timeoutMs);
      child.stdout.on("data", (d) => { out += d; });
      child.stderr.on("data", (d) => { err += d; });
      child.on("error", () => { clearTimeout(timer); tryNext(); });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          log("info", `sidecar ${subcmd} exited ${code}, falling back: ${err.slice(0, 200)}`);
          return tryNext();
        }
        try {
          resolve(JSON.parse(out));
        } catch {
          resolve(null);
        }
      });
      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    };
    tryNext();
  });
}

// ---------------------------------------------------------------------------
// JSON-RPC plumbing
// ---------------------------------------------------------------------------

const subscribers = new Set();
let progressToken = null;

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function notify(method, params) {
  send({ jsonrpc: "2.0", method, params });
}

function log(level, data) {
  try {
    notify("notifications/message", { level, data });
  } catch { /* never break the loop */ }
}

function progress(progress, total, message) {
  if (progressToken === null || progressToken === undefined) return;
  notify("notifications/progress", { progressToken, progress, total, message });
}

function notifyStateUpdated() {
  if (subscribers.has(STATE_URI)) notify("notifications/resources/updated", { uri: STATE_URI });
}

const TOOLS = [
  {
    name: "uigen_generate",
    description:
      "Generate a multi-screen UI prototype (FR-2-1) from a requirement prompt. Returns N mobile screens (390x844) each with HTML/JSX/Vue artifacts (FR-2-3) and tab-bar jump hotspots (FR-2-2). Saves a history version (FR-2-7).",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Requirement text describing the app to prototype." },
        format: { type: "string", enum: ["html", "jsx", "vue"], default: "html", description: "Primary artifact format (all three are generated)." },
        screenCount: { type: "integer", minimum: 1, maximum: 10, default: 3, description: "Number of screens to generate." },
      },
      required: ["prompt"],
    },
  },
  {
    name: "uigen_list_versions",
    description: "List saved prototype history versions (newest first) — FR-2-7.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
    },
  },
  {
    name: "uigen_get_version",
    description: "Get one history version with its full screens and HTML/JSX/Vue artifacts.",
    inputSchema: {
      type: "object",
      properties: { versionId: { type: "string", description: "Version id from uigen_list_versions." } },
      required: ["versionId"],
    },
  },
  {
    name: "uigen_export",
    description: "Export a version's artifacts (*.html/*.jsx/*.vue + manifest.json) to a directory — FR-2-8.",
    inputSchema: {
      type: "object",
      properties: {
        versionId: { type: "string", description: "Version id to export." },
        targetDir: { type: "string", description: "Destination directory (default: store/<versionId>/export)." },
      },
      required: ["versionId"],
    },
  },
  {
    name: "uigen_import_dir",
    description: "Import a local directory of *.html prototypes as a new history version — FR-2-6.",
    inputSchema: {
      type: "object",
      properties: { dir: { type: "string", description: "Directory containing *.html files." } },
      required: ["dir"],
    },
  },
];

const RESOURCES = [
  { uri: PANEL_URI, name: "panel.html", mimeType: HTML_MIME, description: "UI prototype panel (mcp-app surface)." },
  { uri: BRIDGE_URI, name: "bridge.js", mimeType: "text/javascript", description: "Panel <-> host MCP bridge adapter layer." },
  { uri: STATE_URI, name: "state.json", mimeType: "application/json", description: "Live version index for the panel." },
];

function readResourceFile(name) {
  return fs.readFileSync(path.join(__dirname, "ui", name), "utf8");
}

// ---------------------------------------------------------------------------
// tools/call handlers
// ---------------------------------------------------------------------------

async function toolGenerate(args) {
  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  if (!prompt) return { ok: false, error: "prompt is required" };
  const format = ["html", "jsx", "vue"].includes(args.format) ? args.format : "html";
  const screenCount = Math.min(10, Math.max(1, parseInt(args.screenCount, 10) || 3));
  const total = screenCount + 2;
  progress(0, total, "准备生成");
  let record = null;
  let engine = "demo";
  if (!process.env.UIGEN_FORCE_DEMO) {
    const res = await runSidecar("generate", { prompt, format, screenCount }, Number(process.env.UIGEN_SIDECAR_TIMEOUT || 20000));
    if (res && res.ok && Array.isArray(res.screens) && res.screens.length) {
      record = res;
      engine = "sidecar";
    }
  }
  if (!record) {
    record = demoGenerate(prompt, format, screenCount, (done, n) => {
      progress(done, total, `生成屏幕 ${done}/${n}`);
    });
    engine = process.env.UIGEN_FORCE_DEMO ? "demo(forced)" : "demo(fallback)";
  } else {
    progress(screenCount, total, `sidecar 生成 ${screenCount} 屏完成`);
  }
  progress(total - 1, total, "写入版本存储");
  // The sidecar persists its own version; only persist here when we generated
  // locally. Both writers share the same store dir (UIGEN_STORE_DIR passes
  // through the child env).
  const persistedId = record.id || record.versionId || "";
  const saved = persistedId ? { ...record, id: persistedId } : saveVersion({ ...record, format, prompt });
  progress(total, total, "完成");
  log("info", `uigen_generate: engine=${engine} version=${saved.id} screens=${saved.screens.length}`);
  notifyStateUpdated();
  return {
    ok: true,
    engine,
    versionId: saved.id,
    prompt: saved.prompt,
    format: saved.format,
    screenCount: saved.screens.length,
    screens: saved.screens.map((s) => ({
      id: s.id,
      name: s.name,
      html: s.html,
      jsx: s.jsx,
      vue: s.vue,
      hotspots: s.hotspots || [],
    })),
  };
}

async function toolListVersions(args) {
  return { ok: true, versions: listVersions(Number(args.limit) || 20) };
}

async function toolGetVersion(args) {
  const rec = getVersion(String(args.versionId || ""));
  if (!rec) return { ok: false, error: `version not found: ${args.versionId}` };
  return { ok: true, version: rec };
}

async function toolExport(args) {
  return exportVersion(String(args.versionId || ""), args.targetDir);
}

async function toolImportDir(args) {
  const res = importDir(String(args.dir || ""));
  if (res.ok) notifyStateUpdated();
  return res;
}

const TOOL_HANDLERS = {
  uigen_generate: toolGenerate,
  uigen_list_versions: toolListVersions,
  uigen_get_version: toolGetVersion,
  uigen_export: toolExport,
  uigen_import_dir: toolImportDir,
};

async function handleToolsCall(params, id) {
  const name = params && params.name;
  const handler = TOOL_HANDLERS[name];
  if (!handler) {
    inFlight -= 1;
    maybeExit();
    return replyError(id, -32602, `unknown tool: ${name}`);
  }
  const meta = (params && params._meta) || {};
  progressToken = meta.progressToken !== undefined ? meta.progressToken : null;
  try {
    const result = await handler((params && params.arguments) || {});
    reply(id, {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
      isError: result && result.ok === false,
    });
  } catch (e) {
    reply(id, {
      content: [{ type: "text", text: `tool failed: ${e.message}` }],
      isError: true,
    });
  } finally {
    progressToken = null;
    inFlight -= 1;
    maybeExit();
  }
}

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

function handleRequest(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case "initialize": {
      const wanted = params && params.protocolVersion;
      reply(id, {
        protocolVersion: typeof wanted === "string" ? wanted : PROTOCOL_FALLBACK,
        capabilities: { tools: {}, resources: { subscribe: true, listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });
      break;
    }
    case "ping":
      reply(id, {});
      break;
    case "tools/list":
      reply(id, {
        tools: TOOLS.map((t) => ({
          ...t,
          _meta: {
            ui: {
              resourceUri: PANEL_URI,
              surface: "hba-uigen",
              visibility: ["model", "app"],
            },
          },
        })),
      });
      break;
    case "tools/call":
      inFlight += 1;
      handleToolsCall(params, id);
      break;
    case "resources/list":
      reply(id, { resources: RESOURCES });
      break;
    case "resources/read": {
      const uri = params && params.uri;
      if (uri === PANEL_URI) {
        reply(id, { contents: [{ uri, mimeType: HTML_MIME, text: readResourceFile("panel.html") }] });
      } else if (uri === BRIDGE_URI) {
        reply(id, { contents: [{ uri, mimeType: "text/javascript", text: readResourceFile("bridge.js") }] });
      } else if (uri === STATE_URI) {
        reply(id, {
          contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ versions: listVersions(50) }, null, 2) }],
        });
      } else {
        replyError(id, -32002, `resource not found: ${uri}`);
      }
      break;
    }
    case "resources/subscribe":
      if (params && params.uri) subscribers.add(params.uri);
      reply(id, {});
      break;
    case "resources/unsubscribe":
      if (params && params.uri) subscribers.delete(params.uri);
      reply(id, {});
      break;
    default:
      replyError(id, -32601, `method not found: ${method}`);
  }
}

function handleNotification(msg) {
  switch (msg.method) {
    case "notifications/initialized":
    case "notifications/cancelled":
      break;
    default:
      break; // ignore unknown notifications
  }
}

function handleLine(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
    return;
  }
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    send({ jsonrpc: "2.0", id: msg && msg.id !== undefined ? msg.id : null, error: { code: -32600, message: "invalid request" } });
    return;
  }
  if (msg.id === undefined || msg.id === null) {
    handleNotification(msg);
  } else {
    try {
      handleRequest(msg);
    } catch (e) {
      replyError(msg.id, -32603, `internal error: ${e.message}`);
    }
  }
}

let buffer = "";
let inFlight = 0;
let stdinClosed = false;

function maybeExit() {
  if (stdinClosed && inFlight <= 0) process.exit(0);
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).replace(/\r$/, "").trim();
    buffer = buffer.slice(idx + 1);
    if (line) handleLine(line);
  }
});
process.stdin.on("end", () => {
  stdinClosed = true;
  maybeExit();
});
process.stdin.on("error", () => process.exit(0));
