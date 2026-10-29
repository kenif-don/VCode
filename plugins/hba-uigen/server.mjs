#!/usr/bin/env node
/**
 * hba-uigen MCP server — hand-written MCP stdio JSON-RPC 2.0, zero dependencies.
 *
 * Wire format (MCP stdio transport): newline-delimited JSON-RPC 2.0 messages
 * on stdin/stdout. Nothing else is ever written to stdout (diagnostics go to
 * stderr).
 *
 * Data model (0.3.0): 磁盘即真源 —— 无版本概念。工作区内固定布局:
 *   <storeDir>/screens/<screenId>.html   主产物(同名 .jsx / .vue 邻放)
 *   <storeDir>/index.json                清单 { version, updatedAt, screens: [...] }
 *   <storeDir>/canvas-layout.json        画布布局(版本无关,沿用)
 *   storeDir = $UIGEN_STORE_DIR or <cwd>/.hba/uigen
 * 旧的 versions.json / <versionId>/ 目录(vXXX-*)不再读取。
 *
 * Methods implemented:
 *   initialize / notifications/initialized / ping
 *   tools/list / tools/call
 *       uigen_generate      — multi-screen prototype, writes screens/ + index.json
 *       uigen_list_screens  — screen manifest (id/name/order/hotspots/files)
 *       uigen_get_screen    — one screen with full HTML/JSX/Vue artifacts
 *       uigen_save_screen   — create/update a screen on disk (rename included)
 *       uigen_delete_screen — delete screen files + manifest entry
 *       uigen_export        — copy screens to a directory (FR-2-8)
 *       uigen_import_dir    — import local *.html into screens/ (FR-2-6)
 *       uigen_canvas_save   — persist workspace-level canvas layout
 *       uigen_canvas_get    — read canvas layout + bound workspace info
 *   resources/list / resources/read / resources/subscribe / resources/unsubscribe
 *       ui://hba-uigen/panel.html   (text/html;profile=mcp-app)  — the panel UI
 *       ui://hba-uigen/bridge.js    (text/javascript)            — panel bridge adapter
 *       ui://hba-uigen/state.json   (application/json)           — screens index
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
const SERVER_VERSION = "0.3.0";
const PANEL_URI = `ui://${SERVER_NAME}/panel.html`;
const BRIDGE_URI = `ui://${SERVER_NAME}/bridge.js`;
const STATE_URI = `ui://${SERVER_NAME}/state.json`;
const HTML_MIME = "text/html;profile=mcp-app";
const PROTOCOL_FALLBACK = "2025-06-18";

// ---------------------------------------------------------------------------
// store — 磁盘即真源(与 sidecar/uigen_sidecar.py 共享同一布局)
//   <storeDir>/screens/<screenId>.html|.jsx|.vue
//   <storeDir>/index.json  { version: 1, updatedAt, screens: [entry...] }
//   entry = { id, name, files: {html[,jsx,vue]}, hotspots, order, updatedAt }
// ---------------------------------------------------------------------------

function storeDir() {
  const dir = process.env.UIGEN_STORE_DIR && process.env.UIGEN_STORE_DIR.trim();
  return path.resolve(dir || path.join(process.cwd(), ".hba", "uigen"));
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

function screensDir() {
  return ensureDir(path.join(storeDir(), "screens"));
}

function indexFile() {
  return path.join(storeDir(), "index.json");
}

function readIndex() {
  try {
    const idx = JSON.parse(fs.readFileSync(indexFile(), "utf8"));
    if (idx && Array.isArray(idx.screens)) return idx;
  } catch {
    /* first run */
  }
  return { version: 1, updatedAt: "", screens: [] };
}

function writeIndex(idx) {
  ensureDir(storeDir());
  idx.updatedAt = new Date().toISOString();
  fs.writeFileSync(indexFile(), JSON.stringify(idx, null, 2), "utf8");
}

function sanitizeName(n) {
  return String(n).replace(/[\/:*?"<>|\s]+/g, "_").slice(0, 40) || "screen";
}

function sanitizeId(id) {
  return String(id).replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 64);
}

function nowIso() {
  return new Date().toISOString();
}

/** 写一个屏幕的产物文件(html 必写;jsx/vue 非空才写),返回 files 映射。 */
function writeScreenFiles(screen) {
  const dir = screensDir();
  const files = {};
  fs.writeFileSync(path.join(dir, `${screen.id}.html`), screen.html || "", "utf8");
  files.html = `${screen.id}.html`;
  for (const ext of ["jsx", "vue"]) {
    const body = screen[ext];
    if (typeof body === "string" && body.trim()) {
      fs.writeFileSync(path.join(dir, `${screen.id}.${ext}`), body, "utf8");
      files[ext] = `${screen.id}.${ext}`;
    }
  }
  return files;
}

function removeScreenFiles(id) {
  for (const ext of ["html", "jsx", "vue"]) {
    try {
      fs.rmSync(path.join(storeDir(), "screens", `${id}.${ext}`), { force: true });
    } catch {
      /* already gone */
    }
  }
}

function publicEntry(e) {
  return { id: e.id, name: e.name, files: e.files || {}, hotspots: e.hotspots || [], order: e.order, updatedAt: e.updatedAt || "" };
}

/**
 * 生成落盘(整体替换):写 screens/,清掉本次未再生成的旧屏文件,
 * index.json 整体换成新清单。
 */
function persistGenerated(screens) {
  const idx = readIndex();
  const keepIds = new Set(screens.map((s) => s.id));
  for (const e of idx.screens) {
    if (!keepIds.has(e.id)) removeScreenFiles(e.id);
  }
  const entries = screens.map((s, i) => ({
    id: s.id,
    name: s.name || s.id,
    files: writeScreenFiles(s),
    hotspots: Array.isArray(s.hotspots) ? s.hotspots : [],
    order: i,
    updatedAt: nowIso(),
  }));
  writeIndex({ version: 1, updatedAt: "", screens: entries });
  return entries;
}

function listScreenEntries(limit) {
  const idx = readIndex();
  const sorted = [...idx.screens].sort((a, b) => (a.order || 0) - (b.order || 0));
  const n = Math.max(1, parseInt(limit, 10) || 100);
  return sorted.slice(0, n);
}

function readScreenFile(fname) {
  if (!fname) return "";
  try {
    return fs.readFileSync(path.join(storeDir(), "screens", fname), "utf8");
  } catch {
    return "";
  }
}

function getScreenRecord(id) {
  const idx = readIndex();
  const entry = idx.screens.find((e) => e.id === id);
  if (!entry) return null;
  return {
    id: entry.id,
    name: entry.name,
    order: entry.order,
    hotspots: entry.hotspots || [],
    files: entry.files || {},
    updatedAt: entry.updatedAt || "",
    html: readScreenFile(entry.files && entry.files.html),
    jsx: readScreenFile(entry.files && entry.files.jsx),
    vue: readScreenFile(entry.files && entry.files.vue),
  };
}

function nextScreenId(idx) {
  const used = new Set(idx.screens.map((e) => e.id));
  let n = idx.screens.length + 1;
  let id = `s${n}`;
  while (used.has(id)) {
    n += 1;
    id = `s${n}`;
  }
  return id;
}

function exportScreens(targetDir) {
  const idx = readIndex();
  const dest = ensureDir(path.resolve(targetDir || path.join(storeDir(), "export")));
  const files = [];
  for (const e of idx.screens) {
    for (const [ext, fname] of Object.entries(e.files || {})) {
      const src = path.join(storeDir(), "screens", fname);
      if (!fs.existsSync(src)) continue;
      const body = fs.readFileSync(src, "utf8");
      const name = `${e.id}-${sanitizeName(e.name || e.id)}.${ext}`;
      fs.writeFileSync(path.join(dest, name), body, "utf8");
      files.push({ name, bytes: Buffer.byteLength(body, "utf8") });
    }
  }
  const manifest = {
    exportedAt: nowIso(),
    screens: idx.screens.map(publicEntry),
    files: files.map((f) => f.name),
  };
  const manifestText = JSON.stringify(manifest, null, 2);
  fs.writeFileSync(path.join(dest, "manifest.json"), manifestText, "utf8");
  files.push({ name: "manifest.json", bytes: Buffer.byteLength(manifestText, "utf8") });
  return { ok: true, targetDir: dest, screens: idx.screens.length, files };
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
  const idx = readIndex();
  const made = [];
  htmlFiles.forEach((fname, i) => {
    const html = fs.readFileSync(path.join(src, fname), "utf8");
    const stem = fname.replace(/\.html?$/i, "");
    let id = sanitizeId(stem) || `import-${i + 1}`;
    let n = 2;
    while (idx.screens.some((e) => e.id === id)) {
      id = `${sanitizeId(stem) || `import-${i + 1}`}-${n++}`;
    }
    const files = writeScreenFiles({ id, html, jsx: importedWrapper("jsx", stem, html), vue: importedWrapper("vue", stem, html) });
    const entry = {
      id,
      name: stem.slice(0, 20),
      files,
      hotspots: [],
      order: idx.screens.length + i,
      updatedAt: nowIso(),
    };
    idx.screens.push(entry);
    made.push({ id, name: entry.name });
  });
  writeIndex(idx);
  return { ok: true, imported: made.length, dir: src, screens: made };
}
// ---------------------------------------------------------------------------
// canvas layout — workspace-level (screen-independent) card layout persisted
// to <storeDir>/canvas-layout.json (unchanged from 0.2.x).
// ---------------------------------------------------------------------------

function canvasLayoutFile() {
  return path.join(storeDir(), "canvas-layout.json");
}

function readCanvasLayout() {
  try {
    const raw = JSON.parse(fs.readFileSync(canvasLayoutFile(), "utf8"));
    if (raw && typeof raw === "object" && raw.layout && typeof raw.layout === "object") {
      return { layout: raw.layout, updatedAt: raw.updatedAt || "" };
    }
  } catch {
    /* first run */
  }
  return { layout: null, updatedAt: "" };
}

function workspaceInfo() {
  const root = (process.env.ZCODE_WORKSPACE_ROOT && process.env.ZCODE_WORKSPACE_ROOT.trim()) || process.cwd();
  return { root, name: path.basename(root) || root };
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
// The sidecar writes the same disk layout (screens/ + index.json) itself, so
// when it succeeds the server does NOT persist again (persisted flag).
// ---------------------------------------------------------------------------

function sidecarPath() {
  const env = process.env.UIGEN_SIDECAR && process.env.UIGEN_SIDECAR.trim();
  if (env) return path.resolve(env);
  // 部署形态:sidecar 可能随插件放在 <pluginRoot>/sidecar/(与 server.mjs 同级);
  // 仓库开发形态:位于 <repo>/sidecar/uigen_sidecar.py(../../sidecar)。
  const beside = path.resolve(__dirname, "sidecar", "uigen_sidecar.py");
  if (fs.existsSync(beside)) return beside;
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

// ---------------------------------------------------------------------------
// tools
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "uigen_generate",
    description:
      "Generate a multi-screen UI prototype (FR-2-1) from a requirement prompt and write it straight to the workspace disk (<storeDir>/screens/*.html + index.json; disk is the source of truth, no versioning). Returns N mobile screens (390x844) each with HTML/JSX/Vue artifacts (FR-2-3) and tab-bar jump hotspots (FR-2-2).",
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
    name: "uigen_list_screens",
    description: "List the screen manifest currently on disk (id, name, order, hotspots, files) — newest generation replaces the previous set.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 200, default: 100 } },
    },
  },
  {
    name: "uigen_get_screen",
    description: "Read one screen from disk with its full HTML/JSX/Vue artifacts.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Screen id from uigen_list_screens (e.g. s1)." } },
      required: ["id"],
    },
  },
  {
    name: "uigen_save_screen",
    description:
      "Create or update one screen on disk (screens/<id>.html + same-name .jsx/.vue) and its index.json entry. Supports create (omit id), rename (id + name), and artifact edits (html/jsx/vue). Pass hotspots/order to persist jump geometry and ordering.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Screen id; omit to create a new one (server assigns s<N>)." },
        name: { type: "string", description: "Display name (also used for export file naming)." },
        html: { type: "string", description: "HTML artifact (main artifact, written to screens/<id>.html)." },
        jsx: { type: "string", description: "JSX artifact (written to screens/<id>.jsx when non-empty)." },
        vue: { type: "string", description: "Vue artifact (written to screens/<id>.vue when non-empty)." },
        hotspots: { type: "array", description: "Jump hotspots [{to,label,x,y,w,h}]." },
        order: { type: "integer", description: "Sort order in the manifest (ascending)." },
      },
      required: ["name"],
    },
  },
  {
    name: "uigen_delete_screen",
    description: "Delete a screen from disk (screens/<id>.html/.jsx/.vue) and remove it from index.json.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Screen id to delete." } },
      required: ["id"],
    },
  },
  {
    name: "uigen_export",
    description: "Export the current on-disk screens (*.html/*.jsx/*.vue + manifest.json) to a directory — FR-2-8.",
    inputSchema: {
      type: "object",
      properties: {
        targetDir: { type: "string", description: "Destination directory (default: <storeDir>/export)." },
      },
    },
  },
  {
    name: "uigen_import_dir",
    description: "Import a local directory of *.html prototypes into the on-disk screens store (FR-2-6). Existing screens are kept; imported files get free ids.",
    inputSchema: {
      type: "object",
      properties: { dir: { type: "string", description: "Directory containing *.html files." } },
      required: ["dir"],
    },
  },
  {
    name: "uigen_canvas_save",
    description:
      "Persist the workspace-level canvas layout (card positions/sizes, zoom, grid, viewport preset, sidebar state) to <workspace>/.hba/uigen/canvas-layout.json. Screen-independent: applies across generations.",
    inputSchema: {
      type: "object",
      properties: {
        layoutJson: {
          type: "object",
          description:
            'Layout object, e.g. { version, zoom, grid, viewport, sidebarCollapsed, cards: { "<screenId>": { x, y, w } } }.',
        },
      },
      required: ["layoutJson"],
    },
  },
  {
    name: "uigen_canvas_get",
    description:
      "Read the workspace-level canvas layout saved by uigen_canvas_save (null when never saved). Also reports the bound ZCode workspace { root, name } for the panel header.",
    inputSchema: { type: "object", properties: {} },
  },
];

const RESOURCES = [
  { uri: PANEL_URI, name: "panel.html", mimeType: HTML_MIME, description: "UI prototype panel (mcp-app surface)." },
  { uri: BRIDGE_URI, name: "bridge.js", mimeType: "text/javascript", description: "Panel <-> host MCP bridge adapter layer." },
  { uri: STATE_URI, name: "state.json", mimeType: "application/json", description: "Live screens index for the panel." },
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
  let persistedBySidecar = false;
  if (!process.env.UIGEN_FORCE_DEMO) {
    const res = await runSidecar("generate", { prompt, format, screenCount }, Number(process.env.UIGEN_SIDECAR_TIMEOUT || 20000));
    if (res && res.ok && Array.isArray(res.screens) && res.screens.length) {
      record = res;
      engine = "sidecar";
      // sidecar 已直接写盘(screens/ + index.json),服务端不再重复落盘
      persistedBySidecar = true;
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
  progress(total - 1, total, "写入 screens/ 与 index.json");
  if (!persistedBySidecar) persistGenerated(record.screens);
  progress(total, total, "完成");
  log("info", `uigen_generate: engine=${engine} screens=${record.screens.length} (disk is source of truth)`);
  notifyStateUpdated();
  return {
    ok: true,
    engine,
    prompt: record.prompt,
    format: record.format,
    screenCount: record.screens.length,
    screens: record.screens.map((s) => ({
      id: s.id,
      name: s.name,
      html: s.html,
      jsx: s.jsx,
      vue: s.vue,
      hotspots: s.hotspots || [],
    })),
  };
}

async function toolListScreens(args) {
  return { ok: true, screens: listScreenEntries(args.limit).map(publicEntry), updatedAt: readIndex().updatedAt || "" };
}

async function toolGetScreen(args) {
  const id = String(args.id || "");
  const rec = getScreenRecord(id);
  if (!rec) return { ok: false, error: `screen not found: ${id}` };
  return { ok: true, screen: rec };
}

async function toolSaveScreen(args) {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  if (!name) return { ok: false, error: "name is required" };
  const idx = readIndex();
  let id = args.id !== undefined && args.id !== null && String(args.id).trim() !== ""
    ? sanitizeId(String(args.id))
    : "";
  let entry = id ? idx.screens.find((e) => e.id === id) : null;
  if (id && !entry) {
    // 带 id 新建(面板显式指定 id,例如本地新建页)
    entry = { id, name, files: {}, hotspots: [], order: idx.screens.length, updatedAt: "" };
    idx.screens.push(entry);
  } else if (!id) {
    id = nextScreenId(idx);
    entry = { id, name, files: {}, hotspots: [], order: idx.screens.length, updatedAt: "" };
    idx.screens.push(entry);
  }
  entry.name = name;
  // 产物:给了哪个字段就写哪个;html 缺省时空串也写(主产物必须存在)
  const patch = {};
  if (typeof args.html === "string") patch.html = args.html;
  if (typeof args.jsx === "string") patch.jsx = args.jsx;
  if (typeof args.vue === "string") patch.vue = args.vue;
  const merged = {
    id,
    html: typeof patch.html === "string" ? patch.html : readScreenFile(entry.files && entry.files.html),
    jsx: typeof patch.jsx === "string" ? patch.jsx : readScreenFile(entry.files && entry.files.jsx),
    vue: typeof patch.vue === "string" ? patch.vue : readScreenFile(entry.files && entry.files.vue),
  };
  entry.files = writeScreenFiles(merged);
  if (Array.isArray(args.hotspots)) entry.hotspots = args.hotspots;
  if (typeof args.order === "number" && isFinite(args.order)) entry.order = args.order;
  entry.updatedAt = nowIso();
  writeIndex(idx);
  notifyStateUpdated();
  return { ok: true, screen: publicEntry(entry) };
}

async function toolDeleteScreen(args) {
  const id = sanitizeId(String(args.id || ""));
  if (!id) return { ok: false, error: "id is required" };
  const idx = readIndex();
  const at = idx.screens.findIndex((e) => e.id === id);
  if (at < 0) return { ok: false, error: `screen not found: ${id}` };
  removeScreenFiles(id);
  idx.screens.splice(at, 1);
  writeIndex(idx);
  notifyStateUpdated();
  return { ok: true, deleted: id };
}

async function toolExport(args) {
  const res = exportScreens(args.targetDir ? String(args.targetDir) : "");
  if (res.ok) notifyStateUpdated();
  return res;
}

async function toolImportDir(args) {
  const res = importDir(String(args.dir || ""));
  if (res.ok) notifyStateUpdated();
  return res;
}

async function toolCanvasSave(args) {
  const layout = args.layoutJson;
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
    return { ok: false, error: "layoutJson must be an object" };
  }
  let serialized;
  try {
    serialized = JSON.stringify(layout);
  } catch (e) {
    return { ok: false, error: `layoutJson is not serializable: ${e.message}` };
  }
  ensureDir(storeDir());
  const updatedAt = new Date().toISOString();
  const record = { layout, updatedAt, bytes: Buffer.byteLength(serialized, "utf8") };
  fs.writeFileSync(canvasLayoutFile(), JSON.stringify(record, null, 2), "utf8");
  return { ok: true, updatedAt, bytes: record.bytes, file: canvasLayoutFile() };
}

async function toolCanvasGet() {
  const { layout, updatedAt } = readCanvasLayout();
  return { ok: true, layout, updatedAt, workspace: workspaceInfo() };
}

const TOOL_HANDLERS = {
  uigen_generate: toolGenerate,
  uigen_list_screens: toolListScreens,
  uigen_get_screen: toolGetScreen,
  uigen_save_screen: toolSaveScreen,
  uigen_delete_screen: toolDeleteScreen,
  uigen_export: toolExport,
  uigen_import_dir: toolImportDir,
  uigen_canvas_save: toolCanvasSave,
  uigen_canvas_get: toolCanvasGet,
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
          contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ screens: listScreenEntries(200).map(publicEntry) }, null, 2) }],
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

// ── Plugin-host contract ─────────────────────────────────────────────────
// Built-in plugins launch via `__zcode-plugin-host`, which imports this module
// and awaits main() (see apps/zcode-cli plugin-host-command.ts). The stdio
// loop above is registered on import; main() keeps the host awaiting until
// stdio closes. Direct `node server.mjs` usage is unchanged.
export function main() {
  return new Promise((resolveMain) => {
    process.stdin.on("end", resolveMain);
    process.stdin.on("close", resolveMain);
    process.stdin.on("error", resolveMain);
  });
}
