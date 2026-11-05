/**
 * test-server.mjs — end-to-end test of plugins/hba-uigen/server.mjs over a
 * real MCP stdio JSON-RPC 2.0 pipe. Zero dependencies (node:test).
 *
 * 0.3.x 原型库浏览器 —— 磁盘即真源,root 恒为工作区根(面板死绑当前项目,
 * 无"更换目录"概念,启动即可扫,无需绑定)。断言围绕:
 *   启动即扫工作区根 → 扫描建树(目录=模块、html/jsx/tsx/vue=页面)
 *   → list/rescan 对账 → 单页 get/save/delete(重命名 id 变化、路径安全);
 *   技能库:启动播种 16 个 seed、CRUD、重启播种保留用户 is_active;
 *   YAML 往返与对账对齐走导出的纯函数(子进程 import server.mjs 验证);
 *   canvas 布局持久化(无 ui 绑定字段,旧数据读到即忽略);resources 面照常;
 *   本地预览 HTTP(uigen_preview_url:注入拾取脚本、页面原 script 不剥、
 *   静态资源、../ 逃逸 403、404、仅 GET)与 uigen_move_page(文件/目录移动
 *   id 变化、子树跟随、循环/同名冲突/不存在/非目录 parent 拒绝)。
 *
 * Run:  node tests/uigen/test-server.mjs   (等价: node --test tests/uigen/test-server.mjs)
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const SERVER = path.join(ROOT, "plugins", "hba-uigen", "server.mjs");
const SEED_DIR = path.join(ROOT, "plugins", "hba-uigen", "skills", "seed");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uigen-server-test-"));
const storeDir = path.join(tmpRoot, "store");
const wsDir = path.join(tmpRoot, "ws");
fs.mkdirSync(storeDir, { recursive: true });
fs.mkdirSync(wsDir, { recursive: true });

// ---------------------------------------------------------------------------
// 扫描 fixture —— 在任何扫描发生前建好(扩展名白名单 / 剪枝 / 超大文件 /
// 空目录 / 层级 / 隐藏文件不剪 都在这棵树里)
// ---------------------------------------------------------------------------
const writeFixture = (rel, data) => {
  const p = path.join(wsDir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
};
const HTML = (tag) => `<!doctype html><html><body>${tag}</body></html>\n`;

writeFixture("home.html", HTML("home"));
writeFixture("about.htm", HTML("about"));
writeFixture("notes.txt", "not a page — 白名单外静默忽略");
writeFixture(".hidden.html", HTML("hidden-file")); // 隐藏文件不剪
writeFixture(".config/x.html", HTML("hidden-dir")); // 隐藏目录剪掉
writeFixture("node_modules/lib.html", HTML("dep")); // 剪枝目录
writeFixture("big/oversized.html", Buffer.alloc(500 * 1024 + 1, 0x61)); // >500KB 跳过
fs.mkdirSync(path.join(wsDir, "emptydir"), { recursive: true }); // 空目录也算 module
writeFixture("app/login.html", HTML("login"));
writeFixture("app/register.tsx", "export default function Register() { return null; }\n");
writeFixture("app/.git/x.html", HTML("vcs")); // 剪枝目录
writeFixture("app/sub/deep.vue", "<template><div>deep</div></template>\n");

// seed 元信息(从 seed 文件原文抽 id / is_active,断言与播种结果对齐)
const seedFiles = fs.readdirSync(SEED_DIR).filter((n) => n.endsWith(".yaml")).sort();
const seedMeta = seedFiles.map((f) => {
  const text = fs.readFileSync(path.join(SEED_DIR, f), "utf8");
  const id = /^id:\s*(\S+)/m.exec(text);
  return { file: f, id: id && id[1], active: /is_active:\s*true/.test(text) };
});
assert.equal(seedFiles.length, 16, "fixture: 16 seed files present");
assert.ok(
  seedMeta.every((m) => m.id),
  "fixture: every seed declares an id"
);

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
        ZCODE_WORKSPACE_ROOT: wsDir,
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

  async initialize() {
    const msg = await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test-client", version: "0.0.1" },
    });
    this.notify("notifications/initialized", {});
    return msg;
  }

  close() {
    try { this.child.stdin.end(); } catch { /* already closed */ }
    try { this.child.kill(); } catch { /* already dead */ }
  }
}

const clients = [];
function spawnClient() {
  const c = new McpClient();
  clients.push(c);
  return c;
}

const client = spawnClient();
after(() => {
  for (const c of clients) c.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// helpers over the on-disk layout
const indexOnDisk = () => JSON.parse(fs.readFileSync(path.join(storeDir, "index.json"), "utf8"));
const canvasOnDisk = () => JSON.parse(fs.readFileSync(path.join(storeDir, "canvas-layout.json"), "utf8"));
const skillFile = (id) => path.join(storeDir, "skills", `${id}.yaml`);

/** 深度优先在树里找节点。 */
function findNode(tree, id) {
  for (const n of tree) {
    if (n.id === id) return n;
    const hit = findNode(n.children || [], id);
    if (hit) return hit;
  }
  return null;
}

/** 原始 HTTP GET:fetch 会把路径里的 .. 归一化掉,逃逸用例必须发原始请求行。 */
function rawGet(origin, rawPath) {
  return new Promise((resolve, reject) => {
    const u = new URL(origin);
    const req = http.request(
      { host: u.hostname, port: Number(u.port), path: rawPath, method: "GET" },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (d) => { body += d; });
        res.on("end", () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// tests —— 顺序即状态机:握手 → 工具面 → 播种 → 技能 CRUD → 重启播种语义
// → YAML 往返/对账对齐 → 启动即扫工作区根 → 扫描断言 → 对账 → 单页读写删
// → 编码回退 → canvas → resources → 错误面
// ---------------------------------------------------------------------------

test("initialize handshake", async () => {
  const msg = await client.initialize();
  assert.equal(msg.jsonrpc, "2.0");
  assert.equal(msg.result.protocolVersion, "2025-06-18");
  assert.equal(msg.result.serverInfo.name, "hba-uigen");
  assert.equal(msg.result.serverInfo.version, "0.3.0");
  assert.ok(msg.result.capabilities.tools, "capabilities.tools declared");
  assert.ok(msg.result.capabilities.resources, "capabilities.resources declared");
});

test("tools/list exposes the 13 prototype-library tools with schemas", async () => {
  const msg = await client.request("tools/list", {});
  const tools = msg.result.tools;
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "uigen_canvas_get",
    "uigen_canvas_save",
    "uigen_delete_page",
    "uigen_delete_skill",
    "uigen_get_page",
    "uigen_get_skill",
    "uigen_list_pages",
    "uigen_list_skills",
    "uigen_move_page",
    "uigen_preview_url",
    "uigen_rescan",
    "uigen_save_page",
    "uigen_save_skill",
  ]);
  // 生成/导入导出/目录绑定时代工具必须退场
  for (const gone of [
    "uigen_generate",
    "uigen_export",
    "uigen_import_dir",
    "uigen_list_screens",
    "uigen_save_screen",
    "uigen_delete_screen",
    "uigen_set_root",
    "uigen_browse_dirs",
  ]) {
    assert.ok(!names.includes(gone), `${gone} retired`);
  }
  for (const t of tools) {
    assert.equal(t.inputSchema.type, "object", `${t.name} inputSchema is an object schema`);
    assert.ok(t.description && t.description.length > 5, `${t.name} has a description`);
    assert.ok(t._meta && t._meta.ui && t._meta.ui.resourceUri === "ui://hba-uigen/panel.html", `${t.name} carries _meta.ui`);
  }
  const req = (n) => tools.find((t) => t.name === n).inputSchema.required || [];
  assert.deepEqual(req("uigen_get_page"), ["id"]);
  assert.deepEqual(req("uigen_save_page"), ["id"]);
  assert.deepEqual(req("uigen_delete_page"), ["id"]);
  assert.deepEqual(req("uigen_get_skill"), ["id"]);
  assert.deepEqual(req("uigen_delete_skill"), ["id"]);
  assert.deepEqual(req("uigen_save_skill"), ["name", "description", "instructions"]);
  assert.deepEqual(req("uigen_canvas_save"), ["layoutJson"]);
  assert.deepEqual(req("uigen_preview_url"), ["id"]);
  assert.deepEqual(req("uigen_move_page"), ["id", "parent"]);
  assert.deepEqual(req("uigen_list_pages"), []);
  assert.deepEqual(req("uigen_list_skills"), []);
  const save = tools.find((t) => t.name === "uigen_save_page").inputSchema.properties;
  assert.ok(save.content && save.name, "save_page exposes content + name");
  const del = tools.find((t) => t.name === "uigen_delete_page").inputSchema.properties;
  assert.equal(del.recursive.type, "boolean");
  const ls = tools.find((t) => t.name === "uigen_list_skills").inputSchema.properties;
  assert.equal(ls.includeInactive.type, "boolean");
});

test("startup seeding writes all 16 HBA skills into <store>/skills/", async () => {
  const files = fs.readdirSync(path.join(storeDir, "skills")).filter((n) => n.endsWith(".yaml"));
  assert.equal(files.length, 16, "16 skill YAML files on disk after startup");

  const all = await client.callTool("uigen_list_skills", { includeInactive: true });
  const allRes = all.result.structuredContent;
  assert.equal(allRes.ok, true);
  assert.equal(allRes.skills.length, 16, "includeInactive returns every seeded skill");
  // 排序:sort_order 升序
  const orders = allRes.skills.map((s) => s.sort_order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b), "sort_order ascending");

  // is_active 逐个与 seed 原文一致(motion 等 false 的播种首次写入按 seed 值)
  for (const meta of seedMeta) {
    const rec = allRes.skills.find((s) => s.id === meta.id);
    assert.ok(rec, `${meta.id} present`);
    assert.equal(rec.is_active, meta.active, `${meta.id} is_active matches seed (${meta.active})`);
    assert.ok(rec.name && rec.description && rec.instructions, `${meta.id} has name/description/instructions`);
  }

  const active = await client.callTool("uigen_list_skills", {});
  const actRes = active.result.structuredContent;
  assert.equal(actRes.ok, true);
  assert.equal(
    actRes.skills.length,
    seedMeta.filter((m) => m.active).length,
    "default list = active-only (AI consumption)"
  );
  assert.ok(actRes.skills.every((s) => s.is_active === true), "default list never leaks inactive skills");
  assert.ok(
    !actRes.skills.some((s) => s.id === "skill-motion"),
    "motion (is_active:false in seed) excluded by default"
  );
});

test("skill CRUD: slug ids, instructions on disk, validation", async () => {
  // 新建 → id = skill-<slug>
  const created = await client.callTool("uigen_save_skill", {
    name: "Test Skill One",
    description: "d1",
    instructions: "line one\nline two",
  });
  const cRes = created.result.structuredContent;
  assert.equal(cRes.ok, true);
  assert.equal(cRes.id, "skill-test-skill-one");
  assert.ok(fs.existsSync(skillFile("skill-test-skill-one")), "skill YAML written");
  // instructions 落盘:块标量 + 正文都在文件里
  const onDisk = fs.readFileSync(skillFile("skill-test-skill-one"), "utf8");
  assert.ok(onDisk.includes("instructions: |"), "instructions serialized as block scalar");
  assert.ok(onDisk.includes("line one") && onDisk.includes("line two"), "instructions body on disk");

  const got = await client.callTool("uigen_get_skill", { id: "skill-test-skill-one" });
  const gRes = got.result.structuredContent;
  assert.equal(gRes.ok, true);
  assert.equal(gRes.instructions, "line one\nline two");
  assert.equal(gRes.description, "d1");
  assert.equal(gRes.is_active, true, "new skill defaults to active");

  // 同名再建 → 冲突加序号
  const dup = await client.callTool("uigen_save_skill", {
    name: "Test Skill One",
    description: "d1",
    instructions: "again",
  });
  assert.equal(dup.result.structuredContent.id, "skill-test-skill-one-2");

  // 更新:带 id 不换 id,只改给的字段
  const updated = await client.callTool("uigen_save_skill", {
    id: "skill-test-skill-one",
    name: "Test Skill One",
    description: "d2",
    instructions: "do more things",
  });
  assert.equal(updated.result.structuredContent.id, "skill-test-skill-one");
  const afterUpdate = await client.callTool("uigen_get_skill", { id: "skill-test-skill-one" });
  assert.equal(afterUpdate.result.structuredContent.description, "d2");
  assert.equal(afterUpdate.result.structuredContent.sort_order, 0, "omitted sort_order keeps stored value");

  // instructions 必填非空
  const empty = await client.callTool("uigen_save_skill", {
    name: "No Body",
    description: "x",
    instructions: "   ",
  });
  assert.equal(empty.result.structuredContent.ok, false);
  assert.equal(empty.result.isError, true);

  // 不存在的 id → 更新被拒
  const ghost = await client.callTool("uigen_save_skill", {
    id: "skill-ghost",
    name: "Ghost",
    description: "x",
    instructions: "x",
  });
  assert.equal(ghost.result.structuredContent.ok, false);

  // 删除 → 文件没了,get 拒绝
  const del = await client.callTool("uigen_delete_skill", { id: "skill-test-skill-one-2" });
  assert.equal(del.result.structuredContent.ok, true);
  assert.equal(del.result.structuredContent.deleted, "skill-test-skill-one-2");
  assert.ok(!fs.existsSync(skillFile("skill-test-skill-one-2")), "skill YAML removed");
  const gone = await client.callTool("uigen_get_skill", { id: "skill-test-skill-one-2" });
  assert.equal(gone.result.structuredContent.ok, false);
  const missing = await client.callTool("uigen_delete_skill", { id: "skill-ghost" });
  assert.equal(missing.result.structuredContent.ok, false);

  const all = await client.callTool("uigen_list_skills", { includeInactive: true });
  assert.equal(all.result.structuredContent.skills.length, 17, "16 seeds + 1 user skill");
});

test("restart re-seed: content fields revert to seed, user is_active survives", async () => {
  // 用户改掉内置技能的 is_active 与内容字段
  const hacked = await client.callTool("uigen_save_skill", {
    id: "skill-a11y",
    name: "Hacked A11y",
    description: "hacked",
    instructions: "hacked instructions",
    is_active: false,
  });
  assert.equal(hacked.result.structuredContent.ok, true);

  // 重启(新 server 进程 = 重新播种)
  const c2 = spawnClient();
  await c2.initialize();

  const all2 = await c2.callTool("uigen_list_skills", { includeInactive: true });
  const all2Res = all2.result.structuredContent;
  assert.equal(all2Res.skills.length, 17, "16 seeds + user skill survive restart");
  const a11y = all2Res.skills.find((s) => s.id === "skill-a11y");
  assert.ok(a11y, "seed skill resurrected/updated");
  assert.equal(a11y.is_active, false, "user-toggled is_active survives re-seeding");
  assert.equal(a11y.name, "WCAG 2.1 Accessibility", "content fields reverted to seed values");
  assert.notEqual(a11y.description, "hacked", "user content edit reverted by seed");
  assert.ok(a11y.instructions.startsWith("Ensure WCAG"), "instructions reverted to seed body");

  // 用户自建技能不被播种动
  const userSkill = all2Res.skills.find((s) => s.id === "skill-test-skill-one");
  assert.ok(userSkill, "user-created skill kept across restart");
  assert.equal(userSkill.description, "d2", "user skill content untouched by seeding");

  const act2 = await c2.callTool("uigen_list_skills", {});
  const act2Res = act2.result.structuredContent;
  const act2Expected = all2Res.skills.filter((s) => s.is_active === true);
  assert.deepEqual(
    act2Res.skills.map((s) => s.id).sort(),
    act2Expected.map((s) => s.id).sort(),
    "default list = active subset of includeInactive"
  );
  assert.equal(act2Res.skills.length, act2Expected.length);
  assert.ok(!act2Res.skills.some((s) => s.id === "skill-a11y"), "inactive seed skill hidden by default");

  // 内置技能删除后,下次播种复活(HBA 语义)
  const del = await c2.callTool("uigen_delete_skill", { id: "skill-a11y" });
  assert.equal(del.result.structuredContent.ok, true);
  const afterDel = await c2.callTool("uigen_list_skills", { includeInactive: true });
  assert.equal(afterDel.result.structuredContent.skills.length, 16);
  assert.ok(!afterDel.result.structuredContent.skills.some((s) => s.id === "skill-a11y"));

  const c3 = spawnClient();
  await c3.initialize();
  const all3 = await c3.callTool("uigen_list_skills", { includeInactive: true });
  const a11yBack = all3.result.structuredContent.skills.find((s) => s.id === "skill-a11y");
  assert.ok(a11yBack, "deleted seed skill re-seeded on restart");
  assert.equal(a11yBack.is_active, true, "fresh seed write uses the seed is_active value");
  const act3 = await c3.callTool("uigen_list_skills", {});
  const act3Expected = all3.result.structuredContent.skills.filter((s) => s.is_active === true);
  assert.deepEqual(
    act3.result.structuredContent.skills.map((s) => s.id).sort(),
    act3Expected.map((s) => s.id).sort(),
    "active count restored to seed baseline + user skills"
  );
  c2.close();
  c3.close();
});

test("YAML round-trip on 16 seeds + alignIndexEntries (pure functions)", async () => {
  // 子进程 import server.mjs,直接调导出的纯函数(不走 stdio RPC)
  const script = `
import fs from "node:fs";
import path from "node:path";
const m = await import(${JSON.stringify(pathToFileURL(SERVER).href)});
const seedDir = ${JSON.stringify(SEED_DIR)};
const out = { files: [], alignKeep: null, alignDrop: null };
for (const f of fs.readdirSync(seedDir).filter((n) => n.endsWith(".yaml")).sort()) {
  const text = fs.readFileSync(path.join(seedDir, f), "utf8");
  const a = m.parseYaml(text);
  const b = m.parseYaml(m.serializeYaml(a));
  out.files.push({
    f,
    roundtrip: JSON.stringify(a) === JSON.stringify(b),
    nonEmpty: !!(a.name && a.description && a.instructions),
    keys: Object.keys(a).length,
  });
}
// 扫描有错误 → 本轮没见到的旧条目保留;无错误 → 完整对齐
out.alignKeep = m
  .alignIndexEntries([{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "c" }], true)
  .map((e) => e.id);
out.alignDrop = m
  .alignIndexEntries([{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "c" }], false)
  .map((e) => e.id);
process.stdout.write(JSON.stringify(out));
process.exit(0);
`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, UIGEN_STORE_DIR: storeDir, ZCODE_WORKSPACE_ROOT: wsDir },
  });
  const killTimer = setTimeout(() => child.kill(), 20000);
  killTimer.unref?.();
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { err += d; });
  const code = await new Promise((resolve) => child.on("close", resolve));
  assert.equal(code, 0, `helper child failed: ${err}`);
  const res = JSON.parse(out);

  assert.equal(res.files.length, 16, "all 16 seeds parsed");
  for (const f of res.files) {
    assert.ok(f.roundtrip, `${f.f}: parse → serialize → parse stable`);
    assert.ok(f.nonEmpty, `${f.f}: name/description/instructions non-empty`);
    assert.equal(f.keys, 11, `${f.f}: full skill record (11 fields)`);
  }
  // 对账对齐:错误轮保留旧条目,干净轮完整对齐
  assert.deepEqual(res.alignKeep, ["b", "c", "a"]);
  assert.deepEqual(res.alignDrop, ["b", "c"]);
});

test("workspace root is the prototype root — scanned on demand, no binding", async () => {
  // 启动即扫:root 恒为工作区根,无需 set_root / 任何绑定步骤
  const msg = await client.callTool("uigen_list_pages", {});
  const res = msg.result.structuredContent;
  assert.equal(res.ok, true);
  assert.equal(res.root, path.resolve(wsDir), "root is always the workspace root");
  assert.ok(Array.isArray(res.tree) && res.tree.length > 0, "tree present without any binding");
  assert.deepEqual(res.stats, { modules: 4, pages: 6, skipped: 1 }, "full fixture scanned immediately");

  // rescan 同样直指工作区根
  const rescan = await client.callTool("uigen_rescan", {});
  const rr = rescan.result.structuredContent;
  assert.equal(rr.ok, true);
  assert.equal(rr.root, path.resolve(wsDir), "rescan targets the workspace root too");
  assert.deepEqual(rr.stats, { modules: 4, pages: 6, skipped: 1 });

  // 首次 canvas_get:只有布局与工作区信息,没有绑定字段
  const init = await client.callTool("uigen_canvas_get", {});
  const initRes = init.result.structuredContent;
  assert.equal(initRes.ok, true);
  assert.equal(initRes.layout, null, "no layout saved yet");
  assert.ok(!("ui" in initRes), "no ui/rootDir binding field on canvas_get");
  assert.equal(initRes.workspace.root, path.resolve(wsDir), "workspace root reported");
  assert.ok(initRes.workspace.name, "workspace name reported");
});

test("scan: extension whitelist, pruning, size cap, empty module, tree shape", async () => {
  const msg = await client.callTool("uigen_list_pages", {});
  const res = msg.result.structuredContent;
  assert.equal(res.ok, true);
  assert.equal(res.root, path.resolve(wsDir));

  // 根层:子目录(字典序)在前,页面文件在后;.hidden.html 保留、notes.txt 忽略
  assert.deepEqual(
    res.tree.map((n) => n.id),
    ["app", "big", "emptydir", ".hidden.html", "about.htm", "home.html"],
    "root children: dirs first (lexicographic), then whitelisted pages"
  );
  // 层级:app → [sub 模块, login, register];sub → deep.vue
  const app = findNode(res.tree, "app");
  assert.ok(app && app.type === "module");
  assert.deepEqual(
    app.children.map((n) => n.id),
    ["app/sub", "app/login.html", "app/register.tsx"],
    "children keep their root-relative ids"
  );
  const sub = findNode(res.tree, "app/sub");
  assert.equal(sub.type, "module");
  assert.deepEqual(sub.children.map((n) => n.id), ["app/sub/deep.vue"]);
  // 空目录也是 module
  const empty = findNode(res.tree, "emptydir");
  assert.ok(empty && empty.type === "module");
  assert.deepEqual(empty.children, []);
  // 剪枝:node_modules / .git / 点目录不进树
  const ids = [];
  const collect = (nodes) => {
    for (const n of nodes) {
      ids.push(n.id);
      collect(n.children || []);
    }
  };
  collect(res.tree);
  assert.ok(ids.every((id) => !id.includes("node_modules") && !id.includes(".git") && !id.startsWith(".config")), "pruned dirs absent");
  assert.ok(!ids.includes("big/oversized.html"), ">500KB file skipped");
  assert.ok(ids.includes(".hidden.html"), "hidden file kept (only dirs are pruned)");
  // framework 映射
  assert.equal(findNode(res.tree, "home.html").framework, "html_tailwind");
  assert.equal(findNode(res.tree, "about.htm").framework, "html_tailwind");
  assert.equal(findNode(res.tree, "app/register.tsx").framework, "react_tailwind");
  assert.equal(findNode(res.tree, "app/sub/deep.vue").framework, "vue_tailwind");
  assert.equal(findNode(res.tree, "app").framework, "", "modules have no framework");
  // 节点形状
  const home = findNode(res.tree, "home.html");
  assert.deepEqual(Object.keys(home).sort(), ["children", "framework", "id", "name", "type"]);
  assert.equal(home.type, "page");
  assert.equal(home.name, "home", "page name = stem without extension");
  // stats
  assert.deepEqual(res.stats, { modules: 4, pages: 6, skipped: 1 });
  // index.json = 列表缓存:{root, entries:[{id,name,type,framework,updatedAt}]}
  const idx = indexOnDisk();
  assert.deepEqual(Object.keys(idx).sort(), ["entries", "root", "updatedAt"]);
  assert.equal(idx.root, "");
  assert.equal(idx.entries.length, 10, "4 modules + 6 pages cached");
  for (const e of idx.entries) {
    assert.deepEqual(Object.keys(e).sort(), ["framework", "id", "name", "type", "updatedAt"]);
    assert.ok(e.updatedAt, "entry updatedAt stamped");
  }
});

test("reconcile: page deleted on disk drops from cache", async () => {
  const before = indexOnDisk().entries;
  assert.ok(before.some((e) => e.id === "home.html"), "home.html cached before delete");
  fs.rmSync(path.join(wsDir, "home.html"));
  const msg = await client.callTool("uigen_rescan", {});
  const res = msg.result.structuredContent;
  assert.equal(res.ok, true);
  assert.ok(!findNode(res.tree, "home.html"), "tree drops the deleted page");
  const idx = indexOnDisk();
  assert.ok(!idx.entries.some((e) => e.id === "home.html"), "cache drops the deleted page");
  assert.equal(idx.entries.length, 9);
  assert.deepEqual(res.stats, { modules: 4, pages: 5, skipped: 1 });
  // 隐藏文件仍在
  assert.ok(findNode(res.tree, ".hidden.html"));
});

test("save/get/delete page: create, rename id changes, module ops, path safety", async () => {
  // 新建页(无 content → 占位骨架),父目录顺带成为模块
  const created = await client.callTool("uigen_save_page", { id: "newpage/landing.html" });
  const cr = created.result.structuredContent;
  assert.equal(cr.ok, true);
  assert.equal(cr.id, "newpage/landing.html");
  const landingAbs = path.join(wsDir, "newpage", "landing.html");
  assert.ok(fs.existsSync(landingAbs), "page file created with parent dirs");
  const placeholder = fs.readFileSync(landingAbs, "utf8");
  assert.ok(placeholder.includes("<!doctype html>"), "placeholder is a full document");
  assert.ok(placeholder.includes("<body>"), "placeholder has a body");

  const got = await client.callTool("uigen_get_page", { id: "newpage/landing.html" });
  const g = got.result.structuredContent;
  assert.equal(g.ok, true);
  assert.equal(g.type, "page");
  assert.equal(g.framework, "html_tailwind");
  assert.equal(g.name, "landing");
  assert.equal(g.content, placeholder, "content read back from disk");

  // 树里:newpage 成为模块,页面挂在下面
  let list = await client.callTool("uigen_list_pages", {});
  const np = findNode(list.result.structuredContent.tree, "newpage");
  assert.ok(np && np.type === "module", "implicit parent dir becomes a module");
  assert.deepEqual(np.children.map((c) => c.id), ["newpage/landing.html"]);
  assert.ok(indexOnDisk().entries.some((e) => e.id === "newpage/landing.html"), "cache updated after save");

  // 新建模块
  const mod = await client.callTool("uigen_save_page", { id: "empty-created" });
  assert.equal(mod.result.structuredContent.ok, true);
  assert.ok(fs.existsSync(path.join(wsDir, "empty-created")), "module dir created");
  const modGet = await client.callTool("uigen_get_page", { id: "empty-created" });
  assert.equal(modGet.result.structuredContent.type, "module");
  assert.equal(modGet.result.structuredContent.content, null, "modules have no content");

  // 重命名页:返回新 id,旧文件消失,stem 换、扩展名保留
  const renamed = await client.callTool("uigen_save_page", { id: "newpage/landing.html", name: "start" });
  assert.equal(renamed.result.structuredContent.id, "newpage/start.html");
  assert.ok(!fs.existsSync(landingAbs), "old file gone after rename");
  assert.ok(fs.existsSync(path.join(wsDir, "newpage", "start.html")));
  // name 带扩展名也不重复拼接
  const renamed2 = await client.callTool("uigen_save_page", { id: "newpage/start.html", name: "home2.html" });
  assert.equal(renamed2.result.structuredContent.id, "newpage/home2.html");
  assert.ok(fs.existsSync(path.join(wsDir, "newpage", "home2.html")));

  // 重命名模块:目录改名,子页面 id 跟着目录走(下次扫描即对齐)
  const modRenamed = await client.callTool("uigen_save_page", { id: "newpage", name: "content" });
  assert.equal(modRenamed.result.structuredContent.id, "content");
  assert.ok(fs.existsSync(path.join(wsDir, "content")), "module dir renamed");
  assert.ok(!fs.existsSync(path.join(wsDir, "newpage")));
  list = await client.callTool("uigen_list_pages", {});
  const tree = list.result.structuredContent.tree;
  assert.ok(!findNode(tree, "newpage"), "old module id gone from tree");
  const contentMod = findNode(tree, "content");
  assert.deepEqual(contentMod.children.map((c) => c.id), ["content/home2.html"], "child ids follow the renamed module");

  // 非空模块:无 recursive 报错,recursive:true 才删
  const withfile = path.join(wsDir, "withfile");
  fs.mkdirSync(withfile, { recursive: true });
  fs.writeFileSync(path.join(withfile, "x.html"), HTML("x"));
  const noRec = await client.callTool("uigen_delete_page", { id: "withfile" });
  assert.equal(noRec.result.structuredContent.ok, false);
  assert.equal(noRec.result.isError, true);
  assert.match(noRec.result.structuredContent.error, /recursive/);
  assert.ok(fs.existsSync(withfile), "module kept when recursive missing");
  const withRec = await client.callTool("uigen_delete_page", { id: "withfile", recursive: true });
  assert.equal(withRec.result.structuredContent.ok, true);
  assert.ok(!fs.existsSync(withfile), "module removed with recursive:true");

  // 路径安全:`..` 与绝对路径一律拒绝
  for (const badId of ["../evil.html", "..\\evil.html", "/evil.html", "C:/evil.html", ""]) {
    const esc = await client.callTool("uigen_save_page", { id: badId });
    assert.equal(esc.result.structuredContent.ok, false, `save rejects ${JSON.stringify(badId)}`);
    assert.equal(esc.result.isError, true);
    const escDel = await client.callTool("uigen_delete_page", { id: badId });
    assert.equal(escDel.result.structuredContent.ok, false, `delete rejects ${JSON.stringify(badId)}`);
    const escGet = await client.callTool("uigen_get_page", { id: badId });
    assert.equal(escGet.result.structuredContent.ok, false, `get rejects ${JSON.stringify(badId)}`);
  }
  assert.ok(!fs.existsSync(path.join(tmpRoot, "evil.html")), "no escape file written");

  // content 更新与"改名撞已存在文件"报错
  const p1 = await client.callTool("uigen_save_page", { id: "p1.html", content: "<p>hi</p>" });
  assert.equal(p1.result.structuredContent.ok, true);
  assert.equal(fs.readFileSync(path.join(wsDir, "p1.html"), "utf8"), "<p>hi</p>");
  await client.callTool("uigen_save_page", { id: "p2.html", content: "<p>two</p>" });
  const clash = await client.callTool("uigen_save_page", { id: "p1.html", name: "p2" });
  assert.equal(clash.result.structuredContent.ok, false);
  assert.match(clash.result.structuredContent.error, /already exists/);
  const p1edit = await client.callTool("uigen_save_page", { id: "p1.html", content: "<p>bye</p>" });
  assert.equal(p1edit.result.structuredContent.id, "p1.html");
  assert.equal(fs.readFileSync(path.join(wsDir, "p1.html"), "utf8"), "<p>bye</p>");

  // 删除页:文件与缓存一起消失;不存在的 id 报错
  const del = await client.callTool("uigen_delete_page", { id: "content/home2.html" });
  assert.equal(del.result.structuredContent.ok, true);
  assert.equal(del.result.structuredContent.deleted, "content/home2.html");
  assert.ok(!fs.existsSync(path.join(wsDir, "content", "home2.html")));
  const delAgain = await client.callTool("uigen_delete_page", { id: "content/home2.html" });
  assert.equal(delAgain.result.structuredContent.ok, false);
  const delGhost = await client.callTool("uigen_delete_page", { id: "never-existed.html" });
  assert.equal(delGhost.result.structuredContent.ok, false);
  list = await client.callTool("uigen_list_pages", {});
  assert.ok(!findNode(list.result.structuredContent.tree, "content/home2.html"), "cache dropped the deleted page");
});

test("uigen_get_page falls back to latin-1 when utf-8 decode fails", async () => {
  // 0xE9 单字节在 UTF-8 里非法 → 回退 latin-1(é),不产生 U+FFFD
  fs.writeFileSync(path.join(wsDir, "enc.html"), Buffer.from([0x68, 0x69, 0xe9]));
  const got = await client.callTool("uigen_get_page", { id: "enc.html" });
  const g = got.result.structuredContent;
  assert.equal(g.ok, true);
  assert.equal(g.content, "hié");
  assert.ok(!g.content.includes("�"), "no replacement chars");
});

test("uigen_canvas_save / uigen_canvas_get persist layout (no ui binding)", async () => {
  // 历史数据兼容:旧记录里的 ui(rootDir 绑定字段)读到即忽略
  fs.writeFileSync(
    path.join(storeDir, "canvas-layout.json"),
    JSON.stringify({ layout: null, ui: { rootDir: "app" }, updatedAt: "2026-01-01T00:00:00.000Z", bytes: 0 })
  );
  const legacy = await client.callTool("uigen_canvas_get", {});
  const legacyRes = legacy.result.structuredContent;
  assert.equal(legacyRes.layout, null, "legacy layout respected");
  assert.ok(!("ui" in legacyRes), "legacy ui.rootDir ignored on read");

  // 正常保存 / 读回
  const layout = { version: 1, zoom: 0.9, grid: true, viewport: 390, sidebarCollapsed: false };
  const save = await client.callTool("uigen_canvas_save", { layoutJson: layout });
  const sRes = save.result.structuredContent;
  assert.equal(sRes.ok, true);
  assert.ok(sRes.updatedAt && sRes.bytes > 0, "updatedAt + bytes reported");
  assert.equal(sRes.file, path.join(storeDir, "canvas-layout.json"));
  assert.ok(!("ui" in sRes), "save result carries no ui field");
  let got = await client.callTool("uigen_canvas_get", {});
  assert.deepEqual(got.result.structuredContent.layout, layout, "layout persisted verbatim");
  assert.ok(!("ui" in got.result.structuredContent), "canvas_get carries no ui field");

  // 历史调用方仍带 ui 的 layoutJson:ui 被剥掉,不进 layout 也不落盘
  const saveUi = await client.callTool("uigen_canvas_save", {
    layoutJson: { version: 2, zoom: 0.8, ui: { rootDir: "app" } },
  });
  assert.equal(saveUi.result.structuredContent.ok, true);
  const onDisk = canvasOnDisk();
  assert.deepEqual(onDisk.layout, { version: 2, zoom: 0.8 }, "ui stripped from layout body");
  assert.ok(!("ui" in onDisk), "record rewritten without the legacy ui field");
  got = await client.callTool("uigen_canvas_get", {});
  assert.deepEqual(got.result.structuredContent.layout, { version: 2, zoom: 0.8 });

  // 非法入参被拒绝
  const bad = await client.callTool("uigen_canvas_save", { layoutJson: "nope" });
  assert.equal(bad.result.structuredContent.ok, false);
  assert.equal(bad.result.isError, true);
});

test("resources/list and resources/read serve panel, bridge and state tree", async () => {
  const list = await client.request("resources/list", {});
  const panel = list.result.resources.find((r) => r.uri === "ui://hba-uigen/panel.html");
  assert.ok(panel, "panel resource declared");
  assert.equal(panel.mimeType, "text/html;profile=mcp-app");
  assert.ok(list.result.resources.some((r) => r.uri === "ui://hba-uigen/bridge.js"), "bridge resource declared");
  assert.ok(list.result.resources.some((r) => r.uri === "ui://hba-uigen/state.json"), "state resource declared");

  const read = await client.request("resources/read", { uri: "ui://hba-uigen/panel.html" });
  const content = read.result.contents[0];
  assert.equal(content.mimeType, "text/html;profile=mcp-app");
  assert.ok(content.text.length > 0, "panel html served");

  // 资源级 CSP 声明:宿主 frame-src 缺省 'none',面板预览 iframe 必须靠
  // _meta.ui.csp.frameDomains 放行本地预览服务(精确 origin,与 preview_url 同端口)。
  const pv = await client.callTool("uigen_preview_url", { id: "app/login.html" });
  const pvRes = pv.result.structuredContent;
  assert.equal(pvRes && pvRes.ok, true, `preview_url ok: ${JSON.stringify(pvRes)}`);
  const previewOrigin = new URL(pvRes.url).origin;
  const frameDomains = content._meta?.ui?.csp?.frameDomains;
  assert.ok(Array.isArray(frameDomains) && frameDomains.length === 1, "frameDomains declared");
  assert.equal(frameDomains[0], previewOrigin, "frameDomains matches the preview origin");
  assert.match(frameDomains[0], /^http:\/\/127\.0\.0\.1:\d+$/, "loopback http origin with explicit port");

  const bridge = await client.request("resources/read", { uri: "ui://hba-uigen/bridge.js" });
  assert.ok(bridge.result.contents[0].text.length > 0, "bridge js served");

  // state.json = 原型树快照 { root, tree, stats }
  const stateRead = await client.request("resources/read", { uri: "ui://hba-uigen/state.json" });
  const state = JSON.parse(stateRead.result.contents[0].text);
  assert.equal(state.root, path.resolve(wsDir));
  assert.ok(Array.isArray(state.tree) && state.tree.length > 0, "state carries the tree");
  assert.equal(typeof state.stats.modules, "number");
  assert.equal(typeof state.stats.pages, "number");
  assert.equal(typeof state.stats.skipped, "number");

  const missing = await client.request("resources/read", { uri: "ui://hba-uigen/nope.html" });
  assert.equal(missing.error.code, -32002, "unknown resource rejected");
});

test("resources/subscribe gets state.json updates after page writes", async () => {
  await client.request("resources/subscribe", { uri: "ui://hba-uigen/state.json" });
  const before = client.notifications.filter((n) => n.method === "notifications/resources/updated").length;
  const save = await client.callTool("uigen_save_page", { id: "notify-test.html" });
  assert.equal(save.result.structuredContent.ok, true);
  const afterCount = client.notifications.filter((n) => n.method === "notifications/resources/updated").length;
  assert.ok(afterCount > before, "resources/updated notification pushed to subscriber");
  const del = await client.callTool("uigen_delete_page", { id: "notify-test.html" });
  assert.equal(del.result.structuredContent.ok, true);
});

test("unknown method, unknown tool and retired tools produce JSON-RPC errors", async () => {
  const m = await client.request("no/such/method", {});
  assert.equal(m.error.code, -32601);
  const t = await client.callTool("no_such_tool", {});
  assert.equal(t.error.code, -32602);
  for (const retired of [
    "uigen_generate",
    "uigen_export",
    "uigen_import_dir",
    "uigen_list_screens",
    "uigen_save_screen",
    "uigen_list_versions",
    "uigen_set_root",
    "uigen_browse_dirs",
  ]) {
    const r = await client.callTool(retired, {});
    assert.equal(r.error.code, -32602, `${retired} is unknown`);
  }
});

test("uigen_preview_url serves injected HTML over a local read-only HTTP server", async () => {
  // 带 Tailwind CDN script 的原型页 —— 旧 srcdoc+剥 script 方案会把它剥掉,
  // <style type="text/tailwindcss"> 没运行时不生效,样式全丢
  writeFixture(
    "tw.html",
    [
      "<!doctype html>",
      '<html lang="zh-CN"><head><meta charset="utf-8"><title>tw</title>',
      '<script src="https://cdn.tailwindcss.com"></script>',
      "</head>",
      '<body><h1 class="text-2xl">hi</h1></body>',
      "</html>",
      "",
    ].join("\n")
  );
  writeFixture("assets/logo.txt", "LOGO-BYTES");

  const got = await client.callTool("uigen_preview_url", { id: "tw.html" });
  const r = got.result.structuredContent;
  assert.equal(r.ok, true);
  assert.match(r.url, /^http:\/\/127\.0\.0\.1:\d+\/__uigen_preview__\/tw\.html$/);
  // 重复调用返回同一 url(进程内单实例、端口固定)
  const again = await client.callTool("uigen_preview_url", { id: "tw.html" });
  assert.equal(again.result.structuredContent.url, r.url);

  // 页面可 fetch:原 script 未被剥 + 注入拾取脚本 + screenId/screenName 常量
  const res = await fetch(r.url);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/html/);
  const html = await res.text();
  assert.ok(html.includes('<script src="https://cdn.tailwindcss.com"></script>'), "tailwind CDN script kept");
  assert.ok(html.includes("hba-uigen-preview-pick"), "pick script injected");
  assert.ok(html.includes('var HBA_PREVIEW_SCREEN_ID = "tw.html"'), "screenId constant injected");
  assert.ok(html.includes('var HBA_PREVIEW_SCREEN_NAME = "tw"'), "screenName constant injected");
  assert.ok(html.includes('"setPickMode"'), "pick script listens for setPickMode");
  assert.ok(html.indexOf("hba-uigen-preview-pick") < html.lastIndexOf("</body"), "injected before </body>");
  assert.ok(html.indexOf("hba-uigen-preview-pick") > html.indexOf("cdn.tailwindcss.com"), "page scripts untouched");

  // 静态资源:/assets/... 原样命中(mime 粗分)
  const origin = new URL(r.url).origin;
  const asset = await fetch(new URL("/assets/logo.txt", origin));
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get("content-type") || "", /text\/plain/);
  assert.equal(await asset.text(), "LOGO-BYTES");

  // 路径逃逸 → 403(fetch 归一化 ..,用原始请求行发)
  const esc = await rawGet(origin, "/../secret.txt");
  assert.equal(esc.status, 403);
  const escPreview = await rawGet(origin, "/__uigen_preview__/../../secret.html");
  assert.equal(escPreview.status, 403);

  // 不存在 → 404;仅 GET
  const missing = await fetch(new URL("/no-such-404.html", origin));
  assert.equal(missing.status, 404);
  const postRes = await fetch(r.url, { method: "POST" });
  assert.equal(postRes.status, 405);

  // 工具错误面:不存在的 id / 目录
  const ghost = await client.callTool("uigen_preview_url", { id: "never-existed.html" });
  assert.equal(ghost.result.structuredContent.ok, false);
  const dir = await client.callTool("uigen_preview_url", { id: "assets" });
  assert.equal(dir.result.structuredContent.ok, false);
});

test("uigen_move_page moves files and directories, rejects cycles and conflicts", async () => {
  // 夹具:mv/a 带子树;mv/b/page.html 用来撞同名冲突
  writeFixture("mv/a/page.html", HTML("page"));
  writeFixture("mv/a/sub/child.html", HTML("child"));
  writeFixture("mv/b/page.html", HTML("bpage"));
  await client.callTool("uigen_rescan", {});
  await client.request("resources/subscribe", { uri: "ui://hba-uigen/state.json" });
  const notifCount = () =>
    client.notifications.filter((n) => n.method === "notifications/resources/updated").length;
  const notifBefore = notifCount();

  // 文件移进 root:id 变化、文件落新位、旧位消失、树/缓存/通知同步
  const mvFile = await client.callTool("uigen_move_page", { id: "mv/a/page.html", parent: "" });
  const mvf = mvFile.result.structuredContent;
  assert.equal(mvf.ok, true);
  assert.equal(mvf.id, "page.html");
  assert.ok(fs.existsSync(path.join(wsDir, "page.html")), "file landed at root");
  assert.ok(!fs.existsSync(path.join(wsDir, "mv", "a", "page.html")), "old file gone");
  const tree1 = (await client.callTool("uigen_list_pages", {})).result.structuredContent.tree;
  assert.ok(findNode(tree1, "page.html"), "moved page appears in tree");
  assert.ok(!findNode(tree1, "mv/a/page.html"), "old id gone from tree");
  assert.ok(indexOnDisk().entries.some((e) => e.id === "page.html"), "index reconciled");
  assert.ok(notifCount() > notifBefore, "state update pushed after move");

  // 目录移动:整棵子树跟随
  const mvDir = await client.callTool("uigen_move_page", { id: "mv/a", parent: "" });
  assert.equal(mvDir.result.structuredContent.id, "a");
  assert.ok(fs.existsSync(path.join(wsDir, "a", "sub", "child.html")), "subtree moved along");
  assert.ok(!fs.existsSync(path.join(wsDir, "mv", "a")), "old module dir gone");

  // 同名冲突拒绝(目标处已有 page.html)
  const conflict = await client.callTool("uigen_move_page", { id: "page.html", parent: "mv/b" });
  assert.equal(conflict.result.structuredContent.ok, false);
  assert.match(conflict.result.structuredContent.error, /already exists/);
  assert.ok(fs.existsSync(path.join(wsDir, "page.html")), "file kept after conflict");

  // 移进指定目录(非 root):id 带上目标前缀
  const mvInto = await client.callTool("uigen_move_page", { id: "page.html", parent: "a" });
  assert.equal(mvInto.result.structuredContent.id, "a/page.html");
  assert.ok(fs.existsSync(path.join(wsDir, "a", "page.html")));

  // 循环:目录移进自己 / 自己的子孙
  const selfMove = await client.callTool("uigen_move_page", { id: "a", parent: "a" });
  assert.equal(selfMove.result.structuredContent.ok, false);
  assert.match(selfMove.result.structuredContent.error, /itself/);
  const intoChild = await client.callTool("uigen_move_page", { id: "a", parent: "a/sub" });
  assert.equal(intoChild.result.structuredContent.ok, false);
  assert.ok(fs.existsSync(path.join(wsDir, "a", "sub", "child.html")), "subtree intact after cycle rejection");

  // parent 指向文件 / 不存在的目录;id 不存在
  const fileParent = await client.callTool("uigen_move_page", { id: "a", parent: "mv/b/page.html" });
  assert.equal(fileParent.result.structuredContent.ok, false);
  assert.match(fileParent.result.structuredContent.error, /not a directory/);
  const ghostParent = await client.callTool("uigen_move_page", { id: "a", parent: "no-such-dir" });
  assert.equal(ghostParent.result.structuredContent.ok, false);
  const ghostId = await client.callTool("uigen_move_page", { id: "no-such.html", parent: "" });
  assert.equal(ghostId.result.structuredContent.ok, false);

  // 路径逃逸:id 与 parent 都拒绝
  for (const bad of [
    { id: "../evil.html", parent: "" },
    { id: "a", parent: "../.." },
    { id: "a", parent: "/etc" },
  ]) {
    const esc = await client.callTool("uigen_move_page", bad);
    assert.equal(esc.result.structuredContent.ok, false, `move rejects ${JSON.stringify(bad)}`);
  }
  assert.ok(!fs.existsSync(path.join(tmpRoot, "evil.html")), "no escape file moved");
});
