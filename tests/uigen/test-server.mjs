/**
 * test-server.mjs — end-to-end test of plugins/hba-uigen/server.mjs over a
 * real MCP stdio JSON-RPC 2.0 pipe. Zero dependencies (node:test).
 *
 * 0.3.0: 磁盘即真源 —— 无版本概念。断言围绕 screens/ + index.json:
 *   generate 直接写盘;list/get/save/delete_screen 管理单屏;
 *   export/import_dir 语义为 screens 目录;canvas 布局不变。
 *
 * Run:  node --test tests/uigen/test-server.mjs
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const SERVER = path.join(ROOT, "plugins", "hba-uigen", "server.mjs");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uigen-server-test-"));
const storeDir = path.join(tmpRoot, "store");
const exportDir = path.join(tmpRoot, "export");
const importDir = path.join(tmpRoot, "import");
fs.mkdirSync(storeDir, { recursive: true });

// ---------------------------------------------------------------------------
// minimal MCP stdio client
// ---------------------------------------------------------------------------
class McpClient {
  constructor() {
    this.child = spawn(process.execPath, [SERVER], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        UIGEN_STORE_DIR: storeDir,
        UIGEN_FORCE_DEMO: "1", // deterministic demo mode for tests
      },
    });
    this.pending = new Map();
    this.notifications = [];
    this.stderr = "";
    this.nextId = 1;
    this.child.stderr.on("data", (d) => { this.stderr += d; });
    let buf = "";
    this.child.stdout.on("data", (d) => {
      buf += d;
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id !== undefined && msg.id !== null && (msg.result !== undefined || msg.error !== undefined)) {
          const entry = this.pending.get(msg.id);
          if (entry) { this.pending.delete(msg.id); entry.resolve(msg); }
        } else if (typeof msg.method === "string") {
          this.notifications.push(msg);
        }
      }
    });
  }

  request(method, params, timeoutMs = 10000) {
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, params: params || {} };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (msg) => { clearTimeout(timer); resolve(msg); },
        reject,
      });
      this.child.stdin.write(JSON.stringify(payload) + "\n");
    });
  }

  notify(method, params) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params: params || {} }) + "\n");
  }

  callTool(name, args, extraParams = {}) {
    return this.request("tools/call", { name, arguments: args, ...extraParams });
  }

  close() {
    try { this.child.stdin.end(); } catch { /* already closed */ }
    try { this.child.kill(); } catch { /* already dead */ }
  }
}

const client = new McpClient();
after(() => {
  client.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// helpers over the on-disk layout
const screensDirOnDisk = () => path.join(storeDir, "screens");
const indexOnDisk = () => JSON.parse(fs.readFileSync(path.join(storeDir, "index.json"), "utf8"));

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

test("initialize handshake", async () => {
  const msg = await client.request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test-client", version: "0.0.1" },
  });
  assert.equal(msg.jsonrpc, "2.0");
  assert.equal(msg.result.protocolVersion, "2025-06-18");
  assert.equal(msg.result.serverInfo.name, "hba-uigen");
  assert.equal(msg.result.serverInfo.version, "0.3.0");
  assert.ok(msg.result.capabilities.tools, "capabilities.tools declared");
  assert.ok(msg.result.capabilities.resources, "capabilities.resources declared");
  client.notify("notifications/initialized", {});
});

test("tools/list exposes the 9 screens-era tools with schemas", async () => {
  const msg = await client.request("tools/list", {});
  const tools = msg.result.tools;
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "uigen_canvas_get",
    "uigen_canvas_save",
    "uigen_delete_screen",
    "uigen_export",
    "uigen_generate",
    "uigen_get_screen",
    "uigen_import_dir",
    "uigen_list_screens",
    "uigen_save_screen",
  ]);
  // 版本时代工具必须退场
  assert.ok(!names.includes("uigen_list_versions"));
  assert.ok(!names.includes("uigen_get_version"));
  for (const t of tools) {
    assert.equal(t.inputSchema.type, "object", `${t.name} inputSchema is an object schema`);
    assert.ok(t.description && t.description.length > 5, `${t.name} has a description`);
    assert.ok(t._meta && t._meta.ui && t._meta.ui.resourceUri === "ui://hba-uigen/panel.html", `${t.name} carries _meta.ui`);
  }
  const gen = tools.find((t) => t.name === "uigen_generate");
  assert.deepEqual(gen.inputSchema.required, ["prompt"]);
  assert.deepEqual(gen.inputSchema.properties.format.enum, ["html", "jsx", "vue"]);
  assert.equal(gen.inputSchema.properties.screenCount.minimum, 1);
  assert.equal(gen.inputSchema.properties.screenCount.maximum, 10);
  const get = tools.find((t) => t.name === "uigen_get_screen");
  assert.deepEqual(get.inputSchema.required, ["id"]);
  const del = tools.find((t) => t.name === "uigen_delete_screen");
  assert.deepEqual(del.inputSchema.required, ["id"]);
  const save = tools.find((t) => t.name === "uigen_save_screen");
  assert.deepEqual(save.inputSchema.required, ["name"]);
  const imp = tools.find((t) => t.name === "uigen_import_dir");
  assert.deepEqual(imp.inputSchema.required, ["dir"]);
  const canvas = tools.find((t) => t.name === "uigen_canvas_save");
  assert.equal(canvas.inputSchema.properties.layoutJson.type, "object");
});

test("uigen_generate writes screens/ + index.json directly (disk is truth)", async () => {
  const before = client.notifications.filter((n) => n.method === "notifications/progress").length;
  const msg = await client.callTool(
    "uigen_generate",
    { prompt: "社区图书馆借阅 App,含首页推荐、图书列表、详情页与个人中心", format: "html", screenCount: 3 },
    { _meta: { progressToken: "test-token-1" } }
  );
  assert.equal(msg.result.isError, false);
  const res = msg.result.structuredContent;
  assert.ok(res, "structuredContent present");
  assert.equal(res.ok, true);
  assert.match(String(res.engine), /^demo/);
  assert.equal(res.screenCount, 3);
  assert.equal(res.screens.length, 3);
  // 0.3.0:不再有版本字段
  assert.ok(!("versionId" in res), "no versionId in generate result");
  for (const s of res.screens) {
    assert.ok(s.id && s.name, `screen ${s.id} has id and name`);
    assert.ok(s.html.includes("<!doctype html>"), `${s.id}.html is a full document`);
    assert.ok(s.html.includes("width=390"), `${s.id}.html targets the 390px viewport`);
    assert.ok(s.jsx.includes("export default"), `${s.id}.jsx is a component`);
    assert.ok(s.vue.includes("<template>") && s.vue.includes("export default"), `${s.id}.vue is an SFC`);
    assert.ok(Array.isArray(s.hotspots) && s.hotspots.length >= 1, `${s.id} has jump hotspots`);
    for (const h of s.hotspots) {
      assert.ok(h.to && typeof h.x === "number" && typeof h.w === "number", `${s.id} hotspot is geometric`);
    }
    // 磁盘布局:screens/<id>.html(+同名 .jsx/.vue 邻放)
    for (const ext of ["html", "jsx", "vue"]) {
      const f = path.join(screensDirOnDisk(), `${s.id}.${ext}`);
      assert.ok(fs.existsSync(f), `${s.id}.${ext} written to screens/`);
    }
  }
  // index.json 清单
  const idx = indexOnDisk();
  assert.equal(idx.version, 1);
  assert.ok(idx.updatedAt, "index.json updatedAt stamped");
  assert.equal(idx.screens.length, 3);
  assert.deepEqual(idx.screens.map((e) => e.id), ["s1", "s2", "s3"]);
  assert.deepEqual(idx.screens.map((e) => e.order), [0, 1, 2]);
  for (const e of idx.screens) {
    assert.ok(e.name, "entry has name");
    assert.equal(e.files.html, `${e.id}.html`, "entry files map points at html artifact");
    assert.ok(Array.isArray(e.hotspots), "entry has hotspots");
    assert.ok(e.updatedAt, "entry updatedAt stamped");
  }
  // 不再有 versions.json / 版本目录
  assert.ok(!fs.existsSync(path.join(storeDir, "versions.json")), "no versions.json anymore");
  const dirs = fs.readdirSync(storeDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  assert.deepEqual(dirs.map((d) => d.name), ["screens"], "only screens/ dir at store root");
  const progressAfter = client.notifications.filter(
    (n) => n.method === "notifications/progress" && n.params.progressToken === "test-token-1"
  );
  assert.ok(progressAfter.length >= 3, `progress notifications emitted (got ${progressAfter.length})`);
  assert.ok(progressAfter.every((n) => typeof n.params.message === "string"), "progress carries messages");
});

test("uigen_list_screens returns the manifest in order", async () => {
  const msg = await client.callTool("uigen_list_screens", { limit: 10 });
  const res = msg.result.structuredContent;
  assert.equal(res.ok, true);
  assert.ok(Array.isArray(res.screens));
  assert.equal(res.screens.length, 3);
  assert.deepEqual(res.screens.map((s) => s.id), ["s1", "s2", "s3"], "ordered by order field");
  for (const s of res.screens) {
    assert.ok(s.name && s.files && s.files.html, `${s.id} manifest entry complete`);
    assert.ok(!("html" in s) && !("jsx" in s), "manifest entries are lightweight (no artifacts)");
  }
  assert.ok(res.updatedAt, "manifest updatedAt reported");
});

test("uigen_get_screen returns full artifacts of one screen", async () => {
  const msg = await client.callTool("uigen_get_screen", { id: "s1" });
  const res = msg.result.structuredContent;
  assert.equal(res.ok, true);
  assert.equal(res.screen.id, "s1");
  assert.ok(res.screen.html.length > 200, "html artifact read from disk");
  assert.ok(res.screen.jsx.includes("export default"), "jsx artifact read from disk");
  assert.ok(res.screen.vue.includes("<template>"), "vue artifact read from disk");
  assert.ok(Array.isArray(res.screen.hotspots), "hotspots from manifest");
  const missing = await client.callTool("uigen_get_screen", { id: "nope" });
  assert.equal(missing.result.structuredContent.ok, false);
  assert.equal(missing.result.isError, true);
});

test("uigen_save_screen creates, renames and edits on disk (FR-2 close)", async () => {
  // 新建(不带 id,服务端分配)
  const created = await client.callTool("uigen_save_screen", { name: "关于页", html: "<!doctype html><html><body>关于</body></html>" });
  const cRes = created.result.structuredContent;
  assert.equal(cRes.ok, true);
  const newId = cRes.screen.id;
  assert.ok(newId && newId !== "s1", `server assigned a free id (${newId})`);
  assert.equal(cRes.screen.name, "关于页");
  assert.ok(fs.existsSync(path.join(screensDirOnDisk(), `${newId}.html`)), "new screen html on disk");
  assert.ok(indexOnDisk().screens.some((e) => e.id === newId), "new entry in index.json");

  // 带 id 新建(面板显式指定)
  const explicit = await client.callTool("uigen_save_screen", { id: "panel-add-1", name: "面板新建", html: "<html></html>" });
  assert.equal(explicit.result.structuredContent.ok, true);
  assert.equal(explicit.result.structuredContent.screen.id, "panel-add-1");
  assert.ok(fs.existsSync(path.join(screensDirOnDisk(), "panel-add-1.html")));

  // 重命名 = 落盘到 index.json 条目
  const renamed = await client.callTool("uigen_save_screen", { id: "s1", name: "首页(改)" });
  assert.equal(renamed.result.structuredContent.ok, true);
  assert.equal(renamed.result.structuredContent.screen.name, "首页(改)");
  assert.equal(indexOnDisk().screens.find((e) => e.id === "s1").name, "首页(改)", "rename persisted in index.json");
  // 重命名不清产物
  assert.ok(fs.readFileSync(path.join(screensDirOnDisk(), "s1.html"), "utf8").includes("<!doctype html>"), "artifacts survive rename");

  // 产物编辑:只给 html,jsx/vue 保留
  const edited = await client.callTool("uigen_save_screen", { id: "s1", name: "首页(改)", html: "<!doctype html><html><body>编辑后</body></html>" });
  assert.equal(edited.result.structuredContent.ok, true);
  const onDisk = fs.readFileSync(path.join(screensDirOnDisk(), "s1.html"), "utf8");
  assert.ok(onDisk.includes("编辑后"), "html edit written to disk");
  assert.ok(fs.existsSync(path.join(screensDirOnDisk(), "s1.jsx")), "sibling jsx kept when not patched");

  // order 落盘
  const reordered = await client.callTool("uigen_save_screen", { id: "s2", name: "列表页", order: 99 });
  assert.equal(reordered.result.structuredContent.screen.order, 99);
  assert.equal(indexOnDisk().screens.find((e) => e.id === "s2").order, 99, "order persisted");

  // 缺 name 被拒
  const bad = await client.callTool("uigen_save_screen", { id: "s3" });
  assert.equal(bad.result.structuredContent.ok, false);
  assert.equal(bad.result.isError, true);
});

test("uigen_delete_screen removes files + manifest entry", async () => {
  const msg = await client.callTool("uigen_delete_screen", { id: "panel-add-1" });
  const res = msg.result.structuredContent;
  assert.equal(res.ok, true);
  assert.equal(res.deleted, "panel-add-1");
  assert.ok(!fs.existsSync(path.join(screensDirOnDisk(), "panel-add-1.html")), "html removed from disk");
  assert.ok(!indexOnDisk().screens.some((e) => e.id === "panel-add-1"), "entry removed from index.json");
  const missing = await client.callTool("uigen_delete_screen", { id: "ghost" });
  assert.equal(missing.result.structuredContent.ok, false);
  assert.equal(missing.result.isError, true);
});

test("uigen_export copies the on-disk screens to a directory (FR-2-8)", async () => {
  const msg = await client.callTool("uigen_export", { targetDir: exportDir });
  const res = msg.result.structuredContent;
  assert.equal(res.ok, true);
  assert.equal(res.targetDir, path.resolve(exportDir));
  const names = res.files.map((f) => f.name);
  assert.ok(names.includes("manifest.json"), "manifest written");
  // 产物集合以 index.json 的 files 映射为准(html 必有,jsx/vue 视屏而定)
  const idxNow = indexOnDisk();
  const expectHtml = idxNow.screens.length;
  const expectJsx = idxNow.screens.filter((e) => e.files.jsx).length;
  const expectVue = idxNow.screens.filter((e) => e.files.vue).length;
  assert.equal(names.filter((n) => n.endsWith(".html")).length, expectHtml, "one html per screen");
  assert.equal(names.filter((n) => n.endsWith(".jsx")).length, expectJsx, "jsx exported where present");
  assert.equal(names.filter((n) => n.endsWith(".vue")).length, expectVue, "vue exported where present");
  for (const f of res.files) {
    const p = path.join(exportDir, f.name);
    assert.ok(fs.existsSync(p), `${f.name} exists on disk`);
    assert.equal(fs.statSync(p).size, f.bytes, `${f.name} size matches`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(exportDir, "manifest.json"), "utf8"));
  assert.ok(Array.isArray(manifest.screens) && manifest.screens.length === res.screens, "manifest lists screens");
  assert.ok(!("versionId" in manifest), "manifest has no versionId (0.3.0)");
});

test("uigen_import_dir imports local html prototypes into screens/ (FR-2-6)", async () => {
  fs.mkdirSync(importDir, { recursive: true });
  fs.writeFileSync(path.join(importDir, "login.html"), "<!doctype html><html><body>登录</body></html>");
  fs.writeFileSync(path.join(importDir, "home.html"), "<!doctype html><html><body>首页</body></html>");
  fs.writeFileSync(path.join(importDir, "notes.txt"), "not html");
  const beforeCount = indexOnDisk().screens.length;
  const msg = await client.callTool("uigen_import_dir", { dir: importDir });
  const res = msg.result.structuredContent;
  assert.equal(res.ok, true);
  assert.equal(res.imported, 2);
  assert.ok(!("versionId" in res), "import result has no versionId (0.3.0)");
  assert.deepEqual(res.screens.map((s) => s.name).sort(), ["home", "login"]);
  // 导入 = 追加到磁盘清单(既有屏保留)
  const idx = indexOnDisk();
  assert.equal(idx.screens.length, beforeCount + 2, "existing screens kept, imports appended");
  for (const s of res.screens) {
    assert.ok(fs.existsSync(path.join(screensDirOnDisk(), `${s.id}.html`)), `${s.id}.html imported to screens/`);
  }
  const got = await client.callTool("uigen_get_screen", { id: res.screens[0].id });
  assert.ok(got.result.structuredContent.screen.html.includes("<html>"), "imported artifact readable");
});

test("tools/call uigen_canvas_save / uigen_canvas_get persist workspace layout", async () => {
  // 未保存时:layout 为 null,但 workspace 信息始终可用
  const initial = await client.callTool("uigen_canvas_get", {});
  const initRes = initial.result.structuredContent;
  assert.equal(initRes.ok, true);
  assert.equal(initRes.layout, null, "no layout saved yet");
  assert.ok(initRes.workspace && typeof initRes.workspace.root === "string", "workspace root reported");
  assert.ok(initRes.workspace.name, "workspace name reported");

  // 非法入参被拒绝
  const bad = await client.callTool("uigen_canvas_save", { layoutJson: "nope" });
  assert.equal(bad.result.structuredContent.ok, false);
  assert.equal(bad.result.isError, true);

  // 正常保存 → 读回一致,且落在 <store>/canvas-layout.json(screen 无关)
  const layout = {
    version: 1,
    zoom: 0.9,
    grid: true,
    viewport: 390,
    sidebarCollapsed: false,
    cards: { s1: { x: 40, y: 80, w: 260 }, s2: { x: 360, y: 80, w: 260 } },
  };
  const save = await client.callTool("uigen_canvas_save", { layoutJson: layout });
  const saveRes = save.result.structuredContent;
  assert.equal(saveRes.ok, true);
  assert.ok(saveRes.updatedAt, "updatedAt stamped");
  assert.ok(saveRes.bytes > 0, "byte size reported");
  assert.equal(saveRes.file, path.join(storeDir, "canvas-layout.json"));
  assert.ok(fs.existsSync(saveRes.file), "canvas-layout.json written");
  const onDisk = JSON.parse(fs.readFileSync(saveRes.file, "utf8"));
  assert.deepEqual(onDisk.layout, layout, "layout persisted verbatim");

  const got = await client.callTool("uigen_canvas_get", {});
  const gotRes = got.result.structuredContent;
  assert.equal(gotRes.ok, true);
  assert.deepEqual(gotRes.layout, layout, "saved layout read back");
  assert.ok(gotRes.updatedAt, "updatedAt returned");
});

test("resources/list and resources/read serve the panel (mcp-app profile)", async () => {
  const list = await client.request("resources/list", {});
  const panel = list.result.resources.find((r) => r.uri === "ui://hba-uigen/panel.html");
  assert.ok(panel, "panel resource declared");
  assert.equal(panel.mimeType, "text/html;profile=mcp-app");
  assert.ok(list.result.resources.some((r) => r.uri === "ui://hba-uigen/state.json"), "state resource declared");

  const read = await client.request("resources/read", { uri: "ui://hba-uigen/panel.html" });
  const content = read.result.contents[0];
  assert.equal(content.uri, "ui://hba-uigen/panel.html");
  assert.equal(content.mimeType, "text/html;profile=mcp-app");
  const html = content.text;
  assert.ok(html.includes("390"), "panel references the 390px preview");
  assert.ok(html.includes('id="screen-canvas"'), "multi-screen canvas DOM present");
  assert.ok(html.includes('id="canvas-grid"'), "canvas grid DOM present");
  assert.ok(html.includes('id="preview-frame"'), "preview iframe DOM present");
  assert.ok(html.includes("uigen_generate"), "panel calls uigen_generate");
  assert.ok(html.includes("uigen_save_screen"), "panel persists screen edits");
  assert.ok(html.includes("uigen_list_screens"), "panel reads the screens manifest");
  assert.ok(html.includes("uigen_canvas_save"), "panel persists canvas layout");
  assert.ok(html.includes("UiGenBridge"), "bridge layer embedded");
  // 0.3.0:面板不再有版本下拉/版本工具
  assert.ok(!html.includes("uigen_list_versions"), "panel no longer calls uigen_list_versions");
  assert.ok(!html.includes("uigen_get_version"), "panel no longer calls uigen_get_version");
  assert.ok(!html.includes('id="btn-versions"'), "version dropdown removed from the top bar");

  const missing = await client.request("resources/read", { uri: "ui://hba-uigen/nope.html" });
  assert.equal(missing.error.code, -32002, "unknown resource rejected");
});

test("state.json resource mirrors the screens index", async () => {
  const read = await client.request("resources/read", { uri: "ui://hba-uigen/state.json" });
  const state = JSON.parse(read.result.contents[0].text);
  assert.ok(Array.isArray(state.screens), "state carries screens array");
  assert.ok(state.screens.length >= 3, "state mirrors current manifest");
  assert.ok(state.screens.every((s) => s.id && s.name), "state entries have id+name");
  assert.ok(!("versions" in state), "no versions in state (0.3.0)");
});

test("resources/subscribe gets state.json updates after generation", async () => {
  await client.request("resources/subscribe", { uri: "ui://hba-uigen/state.json" });
  const before = client.notifications.filter((n) => n.method === "notifications/resources/updated").length;
  await client.callTool("uigen_generate", { prompt: "订阅测试", screenCount: 1 });
  const afterCount = client.notifications.filter((n) => n.method === "notifications/resources/updated").length;
  assert.ok(afterCount > before, "resources/updated notification pushed to subscriber");
  // 生成整体替换清单:旧屏文件被清掉
  const idx = indexOnDisk();
  assert.equal(idx.screens.length, 1, "regeneration replaces the manifest");
  const files = fs.readdirSync(screensDirOnDisk());
  assert.deepEqual(files.sort(), ["s1.html", "s1.jsx", "s1.vue"], "stale screen files removed on regenerate");
});

test("unknown method and unknown tool produce JSON-RPC errors", async () => {
  const m = await client.request("no/such/method", {});
  assert.equal(m.error.code, -32601);
  const t = await client.callTool("no_such_tool", {});
  assert.equal(t.error.code, -32602);
  const legacy = await client.callTool("uigen_list_versions", {});
  assert.equal(legacy.error.code, -32602, "retired version tool is unknown");
});
