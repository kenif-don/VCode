#!/usr/bin/env node
/**
 * hba-uigen MCP server — hand-written MCP stdio JSON-RPC 2.0, zero dependencies.
 *
 * Wire format (MCP stdio transport): newline-delimited JSON-RPC 2.0 messages
 * on stdin/stdout. Nothing else is ever written to stdout (diagnostics go to
 * stderr).
 *
 * Data model —— HBA 原版原型库浏览器(磁盘即真源,无版本概念):
 *   原型根恒 = 工作区根($ZCODE_WORKSPACE_ROOT 或 cwd)—— 面板死绑当前工作区,
 *   无"更换目录"概念,启动即可扫,无需绑定;
 *   页面/模块 id = 相对工作区根的 posix 路径(login/register.html;模块=目录相对路径)
 *   <storeDir>/index.json 仅作列表缓存 { root, entries:[{id,name,type,framework,updatedAt}] }
 *     —— 每次 list/rescan/save/delete 后重扫对账更新;本轮扫描有错误时保留
 *        缓存里"本轮没见到"的旧条目(防读目录失败被误判成磁盘删除)
 *   <storeDir>/skills/<id>.yaml 技能库 —— 启动时从 <plugin>/skills/seed/*.yaml 播种,
 *     语义照抄 HBA seed.py:seed 有 store 缺→写入;两边都有→内容字段用 seed 覆盖、
 *     is_active/scope 保留 store 值(用户启停不被冲掉);store 有 seed 缺→不动
 *   storeDir = $UIGEN_STORE_DIR or <cwd>/.hba/uigen
 *
 * 预览架构 —— 本地只读 HTTP + 服务端注入拾取脚本(非 srcdoc):
 *   面板预览不再用 iframe.srcdoc + 剥 <script>(会把 Tailwind CDN 等页面自身
 *   的 <script> 一起剥掉,<style type="text/tailwindcss"> 没运行时不生效,样式全丢)。
 *   改为 iframe 导航到本进程内置的只读 HTTP 服务(127.0.0.1、随机端口、懒启动、
 *   仅 GET):页面在自己的 http 源里正常跑自己的 JS,相对/根相对资源路径自然解析。
 *   跨源 iframe 父页无法直连 DOM → 元素选取由服务端在 </body> 前注入拾取脚本,
 *   经 postMessage 把元素快照回传面板;快照口径与 panel.html 的
 *   buildElementReference/domPath/elementCssSelector 逐字一致。
 *
 * Methods implemented:
 *   initialize / notifications/initialized / ping
 *   tools/list / tools/call
 *       uigen_rescan       — rescan + reconcile the workspace root
 *       uigen_list_pages   — module/page tree (scan-reconciled cache)
 *       uigen_get_page     — one page/module (pages carry content)
 *       uigen_save_page    — create/update/rename a page file or module dir
 *       uigen_delete_page  — delete a page file / module directory
 *       uigen_preview_url  — local read-only preview URL (lazy 127.0.0.1 HTTP server)
 *       uigen_move_page    — move a page/module into another directory (tree drag)
 *       uigen_list_skills  — skill library (active-only by default)
 *       uigen_get_skill    — one full skill record
 *       uigen_save_skill   — create/update a skill YAML
 *       uigen_delete_skill — delete a skill YAML
 *       uigen_canvas_save  — persist workspace-level canvas layout
 *       uigen_canvas_get   — read canvas layout + workspace info
 *   resources/list / resources/read / resources/subscribe / resources/unsubscribe
 *       ui://hba-uigen/panel.html   (text/html;profile=mcp-app)  — the panel UI
 *       ui://hba-uigen/bridge.js    (text/javascript)            — panel bridge adapter
 *       ui://hba-uigen/state.json   (application/json)           — {root,tree,stats}
 *
 * 测试钩子:parseYaml / serializeYaml / alignIndexEntries 导出为纯函数,
 * 供 tests/uigen/test-server.mjs 做 YAML 往返与对账对齐验证。
 */

import fs from "node:fs";
import http from "node:http";
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
// 扫描常量 —— 照抄 HBA app/ui_gen/services/reconcile.py 的口径
// ---------------------------------------------------------------------------

// 单文件上限:更大的文件跳过并计入 skipped,不让整轮扫描失败。
const MAX_FILE_BYTES = 500 * 1024;

// 扫描时恒剪枝的目录名(机器生成 / VCS 内部),另有"任何以 . 开头的目录"规则。
const PRUNED_DIR_NAMES = new Set(["node_modules", ".git", ".hg", ".svn"]);

// 扩展名 → framework 映射(小写比较;隐藏文件不剪,只剪目录)。
const EXTENSION_FRAMEWORKS = {
  ".html": "html_tailwind",
  ".htm": "html_tailwind",
  ".jsx": "react_tailwind",
  ".tsx": "react_tailwind",
  ".vue": "vue_tailwind",
};

// 新建页面的缺省占位骨架 —— 完整 HTML 文档,预览 iframe 直接能渲染。
const PLACEHOLDER_HTML = [
  "<!doctype html>",
  '<html lang="zh-CN">',
  "<head>",
  '  <meta charset="utf-8">',
  '  <meta name="viewport" content="width=device-width, initial-scale=1">',
  "  <title></title>",
  "</head>",
  "<body>",
  "</body>",
  "</html>",
  "",
].join("\n");

// 技能 YAML 顶层字段顺序 —— 与 HBA skills/seed/*.yaml 逐字一致,序列化按此落盘。
const SKILL_FIELD_ORDER = [
  "id",
  "name",
  "description",
  "category",
  "scope",
  "is_active",
  "sort_order",
  "instructions",
  "examples",
  "parameters",
  "param_values",
];

// ---------------------------------------------------------------------------
// store —— 磁盘即真源
//   <storeDir>/index.json           列表缓存(见文件头)
//   <storeDir>/canvas-layout.json   画布布局(原型根恒为工作区根,无绑定字段)
//   <storeDir>/skills/<id>.yaml     技能库
//   storeDir = $UIGEN_STORE_DIR or <cwd>/.hba/uigen
// ---------------------------------------------------------------------------

function storeDir() {
  const dir = process.env.UIGEN_STORE_DIR && process.env.UIGEN_STORE_DIR.trim();
  return path.resolve(dir || path.join(process.cwd(), ".hba", "uigen"));
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

function indexFile() {
  return path.join(storeDir(), "index.json");
}

function readIndex() {
  try {
    const idx = JSON.parse(fs.readFileSync(indexFile(), "utf8"));
    if (idx && Array.isArray(idx.entries)) {
      return {
        root: typeof idx.root === "string" ? idx.root : null,
        entries: idx.entries,
        updatedAt: idx.updatedAt || "",
      };
    }
  } catch {
    /* first run */
  }
  return { root: null, entries: [], updatedAt: "" };
}

function writeIndex(idx) {
  ensureDir(storeDir());
  idx.updatedAt = new Date().toISOString();
  fs.writeFileSync(indexFile(), JSON.stringify(idx, null, 2), "utf8");
}

function nowIso() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// 工作区 / 原型根
// ---------------------------------------------------------------------------

function workspaceRoot() {
  const raw = process.env.ZCODE_WORKSPACE_ROOT && process.env.ZCODE_WORKSPACE_ROOT.trim();
  return path.resolve(raw || process.cwd());
}

/** 绝对路径 → 存盘形态:工作区内 = 相对工作区的 posix 形式(根 = 空串);工作区外 = 绝对路径。 */
function toStoreForm(abs) {
  const rel = path.relative(workspaceRoot(), abs);
  if (!rel) return ""; // 工作区根本身
  if (path.isAbsolute(rel)) return abs; // 跨盘符
  if (rel === ".." || rel.startsWith(`..${path.sep}`)) return abs; // 工作区外
  return rel.split(path.sep).join("/");
}

/** target 是否落在 base 之内(base 自身算"之内")。 */
function isWithin(base, target) {
  const rel = path.relative(base, target);
  if (path.isAbsolute(rel)) return false; // 跨盘符
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`));
}

/**
 * 校验原型内 id 并解析成绝对路径 —— 路径安全:id 解析后必须仍在 root 内
 * (挡 `..` 逃逸与绝对路径),且不能就是 root 自己。
 */
function resolveInRoot(rootAbs, rawId) {
  const id = String(rawId === undefined || rawId === null ? "" : rawId).replace(/\\/g, "/").trim();
  if (!id) return { ok: false, error: "id is required" };
  if (id.startsWith("/") || /^[A-Za-z]:/.test(id)) {
    return { ok: false, error: `id must be relative to the prototype root: ${rawId}` };
  }
  const abs = path.resolve(rootAbs, ...id.split("/"));
  const rel = path.relative(rootAbs, abs);
  if (!rel) return { ok: false, error: "id must not be the prototype root itself" };
  if (path.isAbsolute(rel) || rel === ".." || rel.startsWith(`..${path.sep}`)) {
    return { ok: false, error: `id escapes the prototype root: ${rawId}` };
  }
  return { ok: true, abs, id: rel.split(path.sep).join("/") };
}

/** 读文件文本:utf-8(fatal)失败回退 latin-1,绝不因编码炸掉读取。 */
function readTextFile(abs) {
  const buf = fs.readFileSync(abs);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return buf.toString("latin1");
  }
}

// ---------------------------------------------------------------------------
// canvas layout —— workspace-level 布局,持久化到 <storeDir>/canvas-layout.json。
// 记录形态 { layout, updatedAt, bytes };历史记录里残留的 ui(rootDir 绑定字段)
// 读到即忽略,下次保存整个记录重写时自然清掉。
// ---------------------------------------------------------------------------

function canvasLayoutFile() {
  return path.join(storeDir(), "canvas-layout.json");
}

function readCanvasLayout() {
  try {
    const raw = JSON.parse(fs.readFileSync(canvasLayoutFile(), "utf8"));
    if (raw && typeof raw === "object") {
      return {
        layout: raw.layout && typeof raw.layout === "object" ? raw.layout : null,
        updatedAt: raw.updatedAt || "",
      };
    }
  } catch {
    /* first run */
  }
  return { layout: null, updatedAt: "" };
}

function writeCanvasRecord(layout) {
  ensureDir(storeDir());
  const updatedAt = nowIso();
  const serialized = JSON.stringify(layout);
  const record = {
    layout,
    updatedAt,
    bytes: Buffer.byteLength(serialized, "utf8"),
  };
  fs.writeFileSync(canvasLayoutFile(), JSON.stringify(record, null, 2), "utf8");
  return record;
}

/** 原型根恒 = 工作区根(面板死绑当前项目,无换绑概念)。 */
function rootAbsPath() {
  return workspaceRoot();
}

function workspaceInfo() {
  const root = workspaceRoot();
  return { root, name: path.basename(root) || root };
}

// ---------------------------------------------------------------------------
// 扫描 / 对账 —— 照抄 HBA reconcile.py 精神的 Node 实现
// ---------------------------------------------------------------------------

function isPrunedDir(name) {
  return PRUNED_DIR_NAMES.has(name) || name.startsWith(".");
}

function sortByName(a, b) {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * 遍历原型根一次 → { entries, skipped, errors }。
 *
 * 规则(与 HBA _scan_tree 对齐):
 * - 扩展名白名单 .html/.htm/.jsx/.tsx/.vue(小写比较);framework 见映射表;
 * - 剪枝 node_modules/.git/.hg/.svn 与任何 . 开头的目录(隐藏文件不剪);
 * - 单文件 >500KB / stat 失败 → skipped;白名单外的文件静默忽略;
 * - symlink 逃出 root 的:目录不进、文件计入 skipped;链到目录的只建模块行
 *   不跟进(对齐 os.walk followlinks=False,同时防链接环);
 * - dirnames / filenames 均排序,每个目录先发子目录(模块)再发文件(页面),
 *   再递归子目录 → 父先子后、每层字典序的稳定顺序;
 * - 目录 = module 行(空目录也算);文件 = page 行,根下文件无父模块;
 * - readdir 失败只记 errors 并放弃该子树,不中断整轮扫描(供对账判"部分扫描")。
 */
function scanTree(rootAbs) {
  const entries = [];
  const skipped = [];
  const errors = [];
  const relOf = (abs) => path.relative(rootAbs, abs).split(path.sep).join("/");

  const walk = (dirAbs) => {
    let dirents;
    try {
      dirents = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch (e) {
      errors.push(`${relOf(dirAbs) || "."}: ${e.message}`);
      return;
    }

    const dirEntries = [];
    const fileEntries = [];
    for (const d of dirents) {
      const full = path.join(dirAbs, d.name);
      if (d.isSymbolicLink()) {
        let target;
        let st;
        try {
          target = fs.realpathSync(full);
          st = fs.statSync(full);
        } catch {
          // 断链:白名单扩展名计 skipped,其余忽略
          if (EXTENSION_FRAMEWORKS[path.posix.extname(d.name).toLowerCase()]) skipped.push(relOf(full));
          continue;
        }
        if (!isWithin(rootAbs, target)) {
          // 逃出根的符号链接:目录不进、文件跳过
          if (EXTENSION_FRAMEWORKS[path.posix.extname(d.name).toLowerCase()]) skipped.push(relOf(full));
          continue;
        }
        if (st.isDirectory()) dirEntries.push({ name: d.name, full, descend: false });
        else if (st.isFile()) fileEntries.push({ name: d.name, full, link: true });
        continue;
      }
      if (d.isDirectory()) {
        if (!isPrunedDir(d.name)) dirEntries.push({ name: d.name, full, descend: true });
        continue;
      }
      if (d.isFile()) fileEntries.push({ name: d.name, full, link: false });
    }
    dirEntries.sort(sortByName);
    fileEntries.sort(sortByName);

    // ① 子目录 → module 行(空目录也算模块)
    for (const de of dirEntries) {
      entries.push({ id: relOf(de.full), name: de.name, type: "module", framework: "" });
    }
    // ② 文件 → page 行(name = 不带扩展名的 stem,与 HBA Screen.name 口径一致)
    for (const fe of fileEntries) {
      const ext = path.posix.extname(fe.name).toLowerCase();
      const framework = EXTENSION_FRAMEWORKS[ext];
      if (!framework) continue; // 白名单外静默忽略
      const rel = relOf(fe.full);
      let st;
      try {
        st = fs.statSync(fe.full);
      } catch {
        skipped.push(rel);
        continue;
      }
      if (st.size > MAX_FILE_BYTES) {
        skipped.push(rel);
        continue;
      }
      entries.push({
        id: rel,
        name: fe.name.slice(0, fe.name.length - ext.length),
        type: "page",
        framework,
      });
    }
    // ③ 递归(普通子目录跟进;链接目录不跟进)
    for (const de of dirEntries) {
      if (de.descend) walk(de.full);
    }
  };

  walk(rootAbs);
  return { entries, skipped, errors };
}

/**
 * 缓存对齐(纯函数,导出供测试):本轮扫描结果覆盖 index.json;
 * 扫描有错误时,缓存里"本轮没见到"的旧条目保留 —— 部分扫描绝不能被
 * 读成"磁盘上那些文件没了"。无错误时完整对齐(磁盘删了的从缓存删)。
 */
function alignIndexEntries(oldEntries, scannedEntries, hadErrors) {
  if (!hadErrors) return scannedEntries;
  const seen = new Set(scannedEntries.map((e) => e.id));
  return scannedEntries.concat(oldEntries.filter((e) => !seen.has(e.id)));
}

/**
 * 全量重扫 + 对账:扫描 → 对齐缓存 → 写 index.json,返回 { entries, stats }。
 * entries 顺序即扫描序(父先子后、每层字典序),树直接由它组装。
 */
function reconcile(rootAbs) {
  const scan = scanTree(rootAbs);
  const prev = readIndex();
  const storeRoot = toStoreForm(rootAbs);
  // 缓存 root 与当前工作区不符(换了项目跑)→ 旧缓存整份丢弃,防串数据。
  const sameRoot = prev.root === storeRoot;
  const prevEntries = sameRoot ? prev.entries : [];
  const merged = alignIndexEntries(prevEntries, scan.entries, scan.errors.length > 0);

  const prevById = new Map(prevEntries.map((e) => [e.id, e]));
  const now = nowIso();
  const entries = merged.map((e) => {
    const old = prevById.get(e.id);
    // 同 id 同型同 framework → 沿用旧 updatedAt(缓存稳定,不无谓刷新)
    const updatedAt = old && old.type === e.type && old.framework === e.framework ? old.updatedAt : now;
    return { id: e.id, name: e.name, type: e.type, framework: e.framework, updatedAt };
  });

  writeIndex({ root: storeRoot, entries });
  const stats = {
    modules: entries.reduce((n, e) => n + (e.type === "module" ? 1 : 0), 0),
    pages: entries.reduce((n, e) => n + (e.type === "page" ? 1 : 0), 0),
    skipped: scan.skipped.length,
  };
  return { entries, stats, errors: scan.errors };
}

/**
 * 平铺 entries → 树:由相对路径直接挂 children(目录链 = 模块嵌套),
 * 同层保持扫描序;父不在缓存里的孤儿提根,保证不丢行。
 */
function buildTree(entries) {
  const nodes = entries.map((e) => ({
    id: e.id,
    name: e.name,
    type: e.type,
    framework: e.framework,
    children: [],
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const roots = [];
  for (const n of nodes) {
    const slash = n.id.lastIndexOf("/");
    const parentRel = slash > 0 ? n.id.slice(0, slash) : "";
    const parent = parentRel ? byId.get(parentRel) : null;
    if (parent && parent.type === "module") parent.children.push(n);
    else roots.push(n);
  }
  return roots;
}

/** 列表口径快照:直接扫工作区根(启动即可用,无需任何绑定)。 */
function snapshotState() {
  const rootAbs = rootAbsPath();
  const r = reconcile(rootAbs);
  return { root: rootAbs, tree: buildTree(r.entries), stats: r.stats };
}

// ---------------------------------------------------------------------------
// 最小 YAML 子集 —— 零依赖自写,只覆盖技能库需要的形态:
//   顶层标量键值 / 单双引号串(双引号支持 \uXXXX 等转义)/ bool / int /
//   `key: |`(及 |- |+)块标量 / 空 [] 与 {} / 嵌套空值下的块序列与块映射。
// 解析失败由调用方 console.error 跳过,绝不炸掉启动。
// ---------------------------------------------------------------------------

function parseDoubleQuoted(s, line) {
  let out = "";
  let i = 1;
  while (i < s.length) {
    const c = s[i];
    if (c === '"') return { value: out, rest: s.slice(i + 1) };
    if (c === "\\") {
      const n = s[i + 1];
      if (n === undefined) throw new Error(`unterminated escape: ${line}`);
      if (n === "u") {
        const hex = s.slice(i + 2, i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error(`bad \\u escape: ${line}`);
        out += String.fromCharCode(parseInt(hex, 16));
        i += 6;
        continue;
      }
      const map = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\", "0": "\0", "/": "/", b: "\b", f: "\f" };
      if (!(n in map)) throw new Error(`bad escape \\${n}: ${line}`);
      out += map[n];
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  throw new Error(`unterminated double-quoted string: ${line}`);
}

function parseSingleQuoted(s, line) {
  let out = "";
  let i = 1;
  while (i < s.length) {
    if (s[i] === "'") {
      if (s[i + 1] === "'") {
        out += "'";
        i += 2;
        continue;
      }
      return { value: out, rest: s.slice(i + 1) };
    }
    out += s[i];
    i += 1;
  }
  throw new Error(`unterminated single-quoted string: ${line}`);
}

function parseScalar(v, line) {
  if (v.startsWith('"')) return parseDoubleQuoted(v, line).value;
  if (v.startsWith("'")) return parseSingleQuoted(v, line).value;
  if (v === "[]") return [];
  if (v === "{}") return {};
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null" || v === "~") return null;
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v);
  if (v.startsWith("#")) return null; // 纯注释值
  // plain scalar 行尾注释(` #` 起)剥掉 —— 与 YAML 注释规则一致
  const hash = v.search(/\s#/);
  return hash >= 0 ? v.slice(0, hash).trimEnd() : v;
}

function parseYaml(text) {
  const lines = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const obj = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) {
      i += 1;
      continue;
    }
    if (/^\s/.test(line)) {
      // 顶层之外的游离缩进行(块标量已在内部消费)—— 不认识就跳过
      i += 1;
      continue;
    }
    const m = /^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/.exec(line);
    if (!m) throw new Error(`unsupported top-level line: ${line}`);
    const key = m[1];
    const v = m[2].trim();
    i += 1;

    let value;
    const bm = /^\|([-+]?)(?:\s+#.*)?$/.exec(v);
    if (bm) {
      // 块标量:后续"空行或缩进行"都属于内容;缩进取首个非空行。
      const chomp = bm[1];
      const block = [];
      let indent = -1;
      while (i < lines.length) {
        const l = lines[i];
        if (l.trim() === "") {
          block.push("");
          i += 1;
          continue;
        }
        const ind = l.match(/^ */)[0].length;
        if (ind === 0) break;
        if (indent < 0) indent = ind;
        if (ind < indent) break;
        block.push(l.slice(indent));
        i += 1;
      }
      while (block.length && block[0] === "") block.shift();
      if (chomp !== "+") {
        while (block.length && block[block.length - 1] === "") block.pop();
      }
      if (chomp === "-") value = block.join("\n");
      else value = block.length ? block.join("\n") + "\n" : "";
    } else if (v === "") {
      // 空值 → 看下文是块序列 / 块映射,还是真 null
      let j = i;
      while (j < lines.length && lines[j].trim() === "") j += 1;
      const next = j < lines.length ? lines[j] : "";
      if (next && /^\s/.test(next) && /^\s*-\s/.test(next)) {
        const arr = [];
        let seqIndent = -1;
        while (i < lines.length) {
          const l = lines[i];
          if (l.trim() === "") {
            i += 1;
            continue;
          }
          const ind = l.match(/^ */)[0].length;
          if (ind === 0) break;
          if (seqIndent < 0) seqIndent = ind;
          if (ind !== seqIndent) break;
          const sm = /^-\s+(.*)$/.exec(l.slice(seqIndent));
          if (!sm) break;
          arr.push(parseScalar(sm[1].trim(), l));
          i += 1;
        }
        value = arr;
      } else if (next && /^\s/.test(next)) {
        const sub = {};
        let subIndent = -1;
        while (i < lines.length) {
          const l = lines[i];
          if (l.trim() === "") {
            i += 1;
            continue;
          }
          const ind = l.match(/^ */)[0].length;
          if (ind === 0) break;
          if (subIndent < 0) subIndent = ind;
          if (ind !== subIndent) break;
          const km = /^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/.exec(l.slice(subIndent));
          if (!km) break;
          sub[km[1]] = parseScalar(km[2].trim(), l);
          i += 1;
        }
        value = sub;
      } else {
        value = null;
      }
    } else {
      value = parseScalar(v, line);
    }
    obj[key] = value;
  }
  return obj;
}

/** plain 安全判定:不能裸写成 YAML 指示符 / bool / 数字 / 带注释的形态。 */
function isPlainSafe(s) {
  if (!s) return false;
  if (/^(true|false|null|yes|no|on|off)$/i.test(s)) return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return false;
  if (/^[\s]|[ \t]$/.test(s)) return false;
  if (/[\n\r\t]/.test(s)) return false;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(s)) return false; // 行首指示符(含 @、% 等保留字)
  if (/: /.test(s) || s.endsWith(":")) return false;
  if (/ #/.test(s)) return false;
  return true;
}

function scalarToYaml(s) {
  if (isPlainSafe(s)) return s;
  // JSON 字符串转义与 YAML 双引号转义兼容(\n \t \" \\ \uXXXX)
  return JSON.stringify(s);
}

function serializePair(key, value, indent) {
  const pad = " ".repeat(indent);
  if (value === null || value === undefined) return [`${pad}${key}: null`];
  if (typeof value === "boolean" || typeof value === "number") return [`${pad}${key}: ${value}`];
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${pad}${key}: []`];
    const out = [`${pad}${key}:`];
    for (const item of value) {
      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        const ks = Object.keys(item);
        if (ks.length === 0) {
          out.push(`${pad}  - {}`);
          continue;
        }
        // 数组内嵌映射:首键跟在 `- ` 后,其余键对齐到同一缩进
        ks.forEach((k, idx) => {
          const body = serializePair(k, item[k], 0);
          body.forEach((bl, bidx) => {
            if (idx === 0 && bidx === 0) out.push(`${pad}  - ${bl}`);
            else out.push(`${pad}    ${bl}`);
          });
        });
        continue;
      }
      if (Array.isArray(item)) {
        // 数组的数组 / 复杂项:降级成 JSON flow(JSON 是 YAML flow 的子集),
        // 技能库的 parameters 实际不会长成这样,只为不丢数据。
        out.push(`${pad}  - ${JSON.stringify(item)}`);
        continue;
      }
      out.push(`${pad}  - ${scalarToYaml(String(item))}`);
    }
    return out;
  }
  if (typeof value === "object") {
    const ks = Object.keys(value);
    if (ks.length === 0) return [`${pad}${key}: {}`];
    const out = [`${pad}${key}:`];
    for (const k of ks) out.push(...serializePair(k, value[k], indent + 2));
    return out;
  }
  const s = String(value);
  if (s.includes("\n")) {
    // 块标量:内容带结尾换行用 |,不带用 |-;空内容用 |-。
    const endsNl = s.endsWith("\n");
    const body = endsNl ? s.slice(0, -1) : s;
    const out = [`${pad}${key}: ${endsNl ? "|" : "|-"}`];
    for (const l of body.split("\n")) out.push(l.trim() === "" ? "" : `${pad}  ${l}`);
    return out;
  }
  return [`${pad}${key}: ${scalarToYaml(s)}`];
}

function serializeYaml(obj, keyOrder) {
  const keys = Array.isArray(keyOrder)
    ? [...keyOrder.filter((k) => k in obj), ...Object.keys(obj).filter((k) => !keyOrder.includes(k))]
    : Object.keys(obj);
  const lines = [];
  for (const k of keys) lines.push(...serializePair(k, obj[k], 0));
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// 技能库 —— <storeDir>/skills/<id>.yaml,格式与 HBA seed/*.yaml 一致
// ---------------------------------------------------------------------------

function skillsDir() {
  return ensureDir(path.join(storeDir(), "skills"));
}

function skillFileOf(id) {
  return path.join(skillsDir(), `${id}.yaml`);
}

function normalizeSkillRecord(rec) {
  const num = Number(rec.sort_order);
  return {
    id: String(rec.id),
    name: typeof rec.name === "string" ? rec.name : "",
    description: typeof rec.description === "string" ? rec.description : "",
    category: typeof rec.category === "string" && rec.category ? rec.category : "general",
    scope: typeof rec.scope === "string" && rec.scope ? rec.scope : "global",
    is_active: typeof rec.is_active === "boolean" ? rec.is_active : true,
    sort_order: Number.isFinite(num) ? Math.trunc(num) : 0,
    instructions: typeof rec.instructions === "string" ? rec.instructions : "",
    examples: typeof rec.examples === "string" ? rec.examples : "",
    parameters: Array.isArray(rec.parameters) ? rec.parameters : [],
    param_values:
      rec.param_values && typeof rec.param_values === "object" && !Array.isArray(rec.param_values)
        ? rec.param_values
        : {},
  };
}

function parseSkillFile(file) {
  const rec = parseYaml(fs.readFileSync(file, "utf8"));
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) throw new Error("not a skill mapping");
  return rec;
}

/** 按 id 找技能文件:先 <id>.yaml,找不到再全量扫(容文件名与 id 不一致的历史形态)。 */
function findSkillFile(id) {
  const direct = skillFileOf(id);
  if (fs.existsSync(direct)) return direct;
  let names;
  try {
    names = fs.readdirSync(skillsDir());
  } catch {
    return null;
  }
  for (const n of names) {
    if (!n.toLowerCase().endsWith(".yaml")) continue;
    const file = path.join(skillsDir(), n);
    try {
      const rec = parseSkillFile(file);
      if (rec.id === id) return file;
    } catch (e) {
      console.error(`[hba-uigen] skill parse failed, skip ${n}: ${e.message}`);
    }
  }
  return null;
}

function loadSkill(id) {
  const file = findSkillFile(id);
  if (!file) return null;
  try {
    return normalizeSkillRecord({ ...parseSkillFile(file), id });
  } catch (e) {
    console.error(`[hba-uigen] skill parse failed, skip ${path.basename(file)}: ${e.message}`);
    return null;
  }
}

function listSkillRecords() {
  let names;
  try {
    names = fs.readdirSync(skillsDir()).filter((n) => n.toLowerCase().endsWith(".yaml")).sort();
  } catch (e) {
    console.error(`[hba-uigen] skills dir unreadable: ${e.message}`);
    return [];
  }
  const out = [];
  for (const n of names) {
    try {
      const rec = parseSkillFile(path.join(skillsDir(), n));
      const id = typeof rec.id === "string" && rec.id ? rec.id : n.replace(/\.yaml$/i, "");
      out.push(normalizeSkillRecord({ ...rec, id }));
    } catch (e) {
      console.error(`[hba-uigen] skill parse failed, skip ${n}: ${e.message}`);
    }
  }
  return out;
}

function writeSkillFile(rec) {
  fs.writeFileSync(skillFileOf(rec.id), serializeYaml(rec, SKILL_FIELD_ORDER), "utf8");
}

/** name → slug:小写、非字母数字转 `-`、首尾 `-` 去掉;空则退到 untitled。 */
function slugify(name) {
  const slug = String(name)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled";
}

/**
 * 启动播种(语义照抄 HBA db/seed.py,差异见文件头):
 * - 解析失败的 seed 文件 console.error 跳过,不炸启动;
 * - store 缺 → 按 seed 原值写入(含 is_active/scope);
 * - store 已有 → 内容字段(name/description/instructions/examples/parameters/
 *   param_values/category/sort_order)用 seed 覆盖,is_active/scope 保留 store 值;
 * - store 有 seed 缺 → 不动(用户自建技能不删)。
 */
function seedSkills() {
  const seedDir = path.join(__dirname, "skills", "seed");
  let names;
  try {
    names = fs.readdirSync(seedDir).filter((n) => n.toLowerCase().endsWith(".yaml")).sort();
  } catch (e) {
    console.error(`[hba-uigen] seed dir unreadable (${seedDir}): ${e.message}`);
    return;
  }
  for (const fname of names) {
    let rec;
    try {
      rec = parseSkillFile(path.join(seedDir, fname));
    } catch (e) {
      console.error(`[hba-uigen] seed parse failed, skip ${fname}: ${e.message}`);
      continue;
    }
    const id = typeof rec.id === "string" && rec.id.trim() ? rec.id.trim() : "";
    if (!id) {
      console.error(`[hba-uigen] seed missing id, skip ${fname}`);
      continue;
    }
    try {
      const existing = loadSkill(id);
      if (!existing) {
        // 首次写入:全部字段按 seed 原值(含 is_active / scope)
        writeSkillFile(normalizeSkillRecord({ ...rec, id }));
        continue;
      }
      const num = Number(rec.sort_order);
      writeSkillFile(
        normalizeSkillRecord({
          ...existing,
          id,
          name: typeof rec.name === "string" ? rec.name : existing.name,
          description: typeof rec.description === "string" ? rec.description : existing.description,
          instructions: typeof rec.instructions === "string" ? rec.instructions : existing.instructions,
          examples: typeof rec.examples === "string" ? rec.examples : existing.examples,
          parameters: Array.isArray(rec.parameters) ? rec.parameters : existing.parameters,
          param_values:
            rec.param_values && typeof rec.param_values === "object" && !Array.isArray(rec.param_values)
              ? rec.param_values
              : existing.param_values,
          category: typeof rec.category === "string" && rec.category ? rec.category : existing.category,
          sort_order: Number.isFinite(num) ? Math.trunc(num) : existing.sort_order,
          // is_active / scope 刻意不碰:保留 store 值
        })
      );
    } catch (e) {
      console.error(`[hba-uigen] seed write failed ${id}: ${e.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC plumbing
// ---------------------------------------------------------------------------

const subscribers = new Set();

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
  } catch {
    /* never break the loop */
  }
}

function notifyStateUpdated() {
  if (subscribers.has(STATE_URI)) notify("notifications/resources/updated", { uri: STATE_URI });
}

// ---------------------------------------------------------------------------
// 本地预览 HTTP 服务 —— 面板预览的载体(见文件头"预览架构")。
//   懒启动:首次 uigen_preview_url 才 listen;127.0.0.1 随机端口,仅 GET;
//   路由 /__uigen_preview__/<rel> = 读 HTML 注入拾取脚本后返回,
//   路由 /<rel> = root 下对应文件原样流式返回(mime 按扩展名粗分);
//   两条路由都做路径逃逸防护(resolve 后必须仍在 root 内,否则 403);
//   unref:服务不拽住事件循环,进程退出端口自然释放。
// ---------------------------------------------------------------------------

const PREVIEW_PREFIX = "__uigen_preview__/";
const PREVIEW_SOURCE = "hba-uigen-preview";

// 扩展名 → 静态资源 Content-Type(粗分即可,预览够用)
const STATIC_MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
};

function mimeOf(abs) {
  return STATIC_MIME[path.posix.extname(abs).toLowerCase()] || "application/octet-stream";
}

function sendText(res, code, text) {
  res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

/**
 * 拾取脚本 —— 服务端注入到 </body> 前(页面自身 script 一律不剥,照常执行)。
 * 快照口径与 panel.html 的 elementCssSelector / domPath / buildElementReference
 * 逐字一致(tagName 小写、text 空白归一截 40、path=tag(n) 链同名唯一省序号
 * 最多 8 段、selector=#id→tag.≤3class→tag、不存 data-os-id);
 * screenId/screenName 由注入时常量写入。
 * 用 String.raw:正则里的反斜杠必须原样进入页面。
 */
function buildPickScript(screenId, screenName) {
  return String.raw`/* hba-uigen-preview-pick —— 服务端注入的拾取脚本(跨源 iframe 父页无法直连 DOM) */
(function () {
  "use strict";
  var SOURCE = ${JSON.stringify(PREVIEW_SOURCE)};
  var HBA_PREVIEW_SCREEN_ID = ${JSON.stringify(screenId)};
  var HBA_PREVIEW_SCREEN_NAME = ${JSON.stringify(screenName)};
  var pickOn = false;
  var hoverEl = null;
  var hoverPrevOutline = "";
  var hoverPrevOffset = "";
  var prevCursor = "";

  function post(type, extra) {
    var msg = { source: SOURCE, type: type };
    if (extra) for (var k in extra) msg[k] = extra[k];
    try { parent.postMessage(msg, "*"); } catch (e) { /* 忽略 */ }
  }

  /** 元素 CSS 选择器:#id 优先 → tag.c1.c2.c3(最多 3 类)→ 裸 tag。 */
  function elementCssSelector(el) {
    if (el.htmlId) return "#" + el.htmlId;
    var classes = el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3);
    if (classes.length > 0) return el.tagName + classes.map(function (c) { return "." + c; }).join("");
    return el.tagName;
  }

  /** 结构路径(复刻 sandbox-utils domPath):body>section(2)>form>button(1)。 */
  function domPath(el, doc) {
    var parts = [];
    var cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 8) {
      var tag = cur.tagName ? cur.tagName.toLowerCase() : "";
      if (cur === doc.body) { parts.unshift("body"); break; }
      var parent = cur.parentElement;
      if (parent) {
        var idx = 0, total = 0;
        for (var i = 0; i < parent.children.length; i++) {
          if (parent.children[i].tagName === cur.tagName) {
            total++;
            if (parent.children[i] === cur) idx = total;
          }
        }
        if (total > 1) tag += "(" + idx + ")";
      }
      parts.unshift(tag);
      cur = parent;
    }
    return parts.join(">");
  }

  /** DOM → 纯数据快照:tagName 小写,text 空白归一截 40,刻意不落 data-os-id。 */
  function buildElementReference(screenId, screenName, el, doc) {
    var tagName = (el.tagName || "div").toLowerCase();
    var htmlId = el.id || "";
    var className = (el.className && typeof el.className === "string") ? el.className.trim() : "";
    var text = String(el.textContent == null ? "" : el.textContent)
      .replace(/\s+/g, " ").trim().slice(0, 40);
    var path = domPath(el, doc);
    var ref = {
      screenId: screenId,
      screenName: screenName,
      tagName: tagName,
      text: text,
      selector: elementCssSelector({ tagName: tagName, htmlId: htmlId, className: className })
    };
    if (path) ref.path = path;
    if (htmlId) ref.htmlId = htmlId;
    return ref;
  }

  function isSkippable(el) {
    return !el || el.nodeType !== 1 || el === document.body || el === document.documentElement;
  }

  function clearHover() {
    if (!hoverEl) return;
    try {
      hoverEl.style.outline = hoverPrevOutline;
      hoverEl.style.outlineOffset = hoverPrevOffset;
    } catch (e) { /* 目标可能已卸载 */ }
    hoverEl = null;
  }

  function pickOver(ev) {
    var el = ev.target;
    if (isSkippable(el)) { clearHover(); return; }
    if (el === hoverEl) return;
    clearHover();
    hoverEl = el;
    try {
      hoverPrevOutline = el.style.outline;
      hoverPrevOffset = el.style.outlineOffset;
      el.style.outline = "2px solid #38788A";
      el.style.outlineOffset = "1px";
    } catch (e) { /* 个别目标不支持内联样式 */ }
  }

  function pickOut(ev) {
    if (!ev.relatedTarget) clearHover(); // 指针离开预览文档
  }

  function pickClick(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation(); // 吞掉页内链接/按钮的默认行为
    var el = ev.target;
    if (isSkippable(el)) return; // body/html 空白:留在拾取模式
    var ref = buildElementReference(HBA_PREVIEW_SCREEN_ID, HBA_PREVIEW_SCREEN_NAME, el, document);
    clearHover();
    setPickMode(false); // 选中后自动退出拾取态
    post("element", { ref: ref });
  }

  function setPickMode(on) {
    on = !!on;
    if (on === pickOn) return;
    pickOn = on;
    if (on) {
      document.addEventListener("mouseover", pickOver, true);
      document.addEventListener("mouseout", pickOut, true);
      document.addEventListener("click", pickClick, true);
      prevCursor = document.documentElement.style.cursor;
      document.documentElement.style.cursor = "crosshair";
    } else {
      document.removeEventListener("mouseover", pickOver, true);
      document.removeEventListener("mouseout", pickOut, true);
      document.removeEventListener("click", pickClick, true);
      document.documentElement.style.cursor = prevCursor;
      clearHover();
    }
  }

  window.addEventListener("message", function (ev) {
    var d = ev && ev.data;
    if (!d || d.source !== "hba-uigen-panel") return;
    if (d.type === "setPickMode") setPickMode(!!d.on);
  });

  function announceReady() { post("ready"); }
  if (document.readyState === "complete") announceReady();
  else window.addEventListener("load", announceReady);
})();
`;
}

/** 在 </body> 前注入拾取脚本;没有 </body> 则追加到文件尾。 */
function injectPickScript(html, screenId, screenName) {
  const script = "\n<script>\n" + buildPickScript(screenId, screenName) + "</script>\n";
  const idx = html.toLowerCase().lastIndexOf("</body");
  if (idx >= 0) return html.slice(0, idx) + script + html.slice(idx);
  return html + script;
}

/** 页面 screenName:路径各段名(目录名 / 末段去扩展名)以 " > " 连接,复刻面板 nodePathLabel 口径。 */
function screenNameOf(id) {
  const parts = id.split("/");
  return parts
    .map((seg, i) => {
      if (i !== parts.length - 1) return seg;
      const ext = path.posix.extname(seg);
      return ext ? seg.slice(0, seg.length - ext.length) : seg;
    })
    .join(" > ");
}

/** URL 路径 → root 内绝对路径;逃逸(../、绝对路径、盘符)返回 null。 */
function resolveUrlPath(rootAbs, rel) {
  const abs = path.resolve(rootAbs, ...rel.split("/").filter((s) => s && s !== "."));
  return isWithin(rootAbs, abs) ? abs : null;
}

async function handlePreviewRequest(req, res) {
  if (req.method !== "GET") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8", Allow: "GET" });
    res.end("method not allowed");
    return;
  }
  // 手工解码:WHATWG URL 会把 %2e%2e 归一化掉,逃逸就测不出来了
  let decoded;
  try {
    decoded = decodeURIComponent((req.url || "/").split("?")[0].split("#")[0]);
  } catch {
    sendText(res, 400, "bad request");
    return;
  }
  const rel = decoded.replace(/^\/+/, "");
  const rootAbs = rootAbsPath();

  if (rel.startsWith(PREVIEW_PREFIX)) {
    const pageRel = rel.slice(PREVIEW_PREFIX.length);
    const abs = resolveUrlPath(rootAbs, pageRel);
    if (!abs) {
      sendText(res, 403, "forbidden");
      return;
    }
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      sendText(res, 404, "not found");
      return;
    }
    if (!st.isFile()) {
      sendText(res, 404, "not found");
      return;
    }
    const screenId = path.relative(rootAbs, abs).split(path.sep).join("/");
    let html;
    try {
      html = readTextFile(abs);
    } catch (e) {
      sendText(res, 500, `read failed: ${e.message}`);
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/html;charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(injectPickScript(html, screenId, screenNameOf(screenId)));
    return;
  }

  // 静态资源:root 下对应文件原样流式返回
  const abs = resolveUrlPath(rootAbs, rel);
  if (!abs) {
    sendText(res, 403, "forbidden");
    return;
  }
  let st;
  try {
    st = fs.statSync(abs);
  } catch {
    sendText(res, 404, "not found");
    return;
  }
  if (!st.isFile()) {
    sendText(res, 404, "not found");
    return;
  }
  res.writeHead(200, {
    "Content-Type": mimeOf(abs),
    "Content-Length": st.size,
    "Cache-Control": "no-store",
  });
  const stream = fs.createReadStream(abs);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

/** 懒启动预览服务:进程内单实例,重复调用拿到同一端口(同一 url)。 */
let previewListening = null;
function ensurePreviewServer() {
  if (!previewListening) {
    previewListening = new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        handlePreviewRequest(req, res).catch((e) => {
          try { sendText(res, 500, `internal error: ${e.message}`); } catch { /* 已响应 */ }
        });
      });
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.unref(); // 不拽住事件循环:进程退出端口自然释放
        resolve({ server, port: server.address().port });
      });
    });
  }
  return previewListening;
}

// ---------------------------------------------------------------------------
// tools
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "uigen_rescan",
    description:
      "Rescan the workspace root (the panel is bound to the current workspace) and reconcile the <store>/index.json cache. Returns { root, tree, stats: { modules, pages, skipped } }.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "uigen_list_pages",
    description:
      "Return the module/page tree of the workspace root — the root is always the current workspace, no binding step needed (scan + reconcile, then read the cache).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "uigen_get_page",
    description:
      "Read one page or module by posix id relative to the workspace root (e.g. login/register.html). Pages return { id, name, type, framework, content }; modules return content=null.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Page/module id from the tree (posix relative path)." } },
      required: ["id"],
    },
  },
  {
    name: "uigen_save_page",
    description:
      "Create, update or rename a page file / module directory under the workspace root. Missing id creates it (extension => page written with a placeholder HTML skeleton when content is omitted; no extension => module directory). Existing id: content writes the file; a different name renames (page keeps its extension, module renames its directory) and the new id is returned. Ids must stay inside the workspace root (no .. escapes).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Target id (posix relative path). Required — the path is the identity." },
        content: { type: "string", description: "File content for pages (create/update)." },
        name: { type: "string", description: "New display name; when it differs from the current stem/dir name the entry is renamed and the new id returned." },
      },
      required: ["id"],
    },
  },
  {
    name: "uigen_delete_page",
    description:
      "Delete a page file, or a module directory (empty modules delete directly; non-empty modules require recursive=true). Ids must stay inside the workspace root.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Page/module id to delete." },
        recursive: { type: "boolean", description: "Delete a non-empty module with its contents." },
      },
      required: ["id"],
    },
  },
  {
    name: "uigen_preview_url",
    description:
      "Get a local read-only preview URL for a page (http://127.0.0.1:<port>/__uigen_preview__/<id>). The page loads in its own http origin so its own scripts run (Tailwind CDN etc.) and relative assets resolve; the server injects an element-pick script that postMessages refs to the panel. The server starts lazily on first call and keeps one port for the process lifetime.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Page id (posix relative path), e.g. app/login.html." } },
      required: ["id"],
    },
  },
  {
    name: "uigen_move_page",
    description:
      "Move a page file or module directory into a target directory (tree drag-drop). parent is the target directory id, \"\" = workspace root. The file/dir keeps its name and the new relative id is returned; the index cache is reconciled and a state update is pushed. Rejects missing ids, non-directory parents, cycles (a directory moved into itself or its own subtree), target name conflicts and path escapes.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Page/module id to move." },
        parent: { type: "string", description: 'Target directory id; "" = workspace root.' },
      },
      required: ["id", "parent"],
    },
  },
  {
    name: "uigen_list_skills",
    description:
      "List skill-library records from <store>/skills/*.yaml, sorted by sort_order ascending. Defaults to active skills only (AI consumption); includeInactive=true returns all records (panel management).",
    inputSchema: {
      type: "object",
      properties: {
        includeInactive: { type: "boolean", description: "Return inactive skills too (default: active only)." },
      },
    },
  },
  {
    name: "uigen_get_skill",
    description: "Read one full skill record by id (all fields including instructions and examples).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Skill id, e.g. skill-a11y." } },
      required: ["id"],
    },
  },
  {
    name: "uigen_save_skill",
    description:
      "Create or update a skill YAML in <store>/skills/. New skills get id skill-<slug> (name lowercased, non-alphanumerics to '-', conflicts get a numeric suffix). instructions is required and non-empty; on update, omitted fields keep their stored values (is_active/scope survive re-seeding).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Existing skill id to update; omit to create a new skill." },
        name: { type: "string", description: "Skill display name." },
        description: { type: "string", description: "One-line summary shown in the skill picker." },
        instructions: { type: "string", description: "Skill body — required, must be non-empty." },
        examples: { type: "string", description: "Example snippets / usage patterns." },
        category: { type: "string", description: "Skill category (e.g. layout, constraints, style)." },
        is_active: { type: "boolean", description: "Whether the skill is active (default true on create)." },
        sort_order: { type: "integer", description: "Sort order in the skill list (ascending)." },
      },
      required: ["name", "description", "instructions"],
    },
  },
  {
    name: "uigen_delete_skill",
    description:
      "Delete a skill YAML file from <store>/skills/. Built-in skills are re-seeded on the next server start (HBA semantics).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Skill id to delete." } },
      required: ["id"],
    },
  },
  {
    name: "uigen_canvas_save",
    description:
      "Persist the workspace-level canvas layout (card positions/sizes, zoom, grid, viewport preset, sidebar state) to <store>/canvas-layout.json. Screen-independent: applies across rescans.",
    inputSchema: {
      type: "object",
      properties: {
        layoutJson: {
          type: "object",
          description:
            'Layout object, e.g. { version, zoom, grid, viewport, sidebarCollapsed, cards: { "<pageId>": { x, y, w } } }.',
        },
      },
      required: ["layoutJson"],
    },
  },
  {
    name: "uigen_canvas_get",
    description:
      "Read the workspace-level canvas layout saved by uigen_canvas_save (layout null when never saved). Also reports the VCode workspace { root, name } for the panel header.",
    inputSchema: { type: "object", properties: {} },
  },
];

const RESOURCES = [
  { uri: PANEL_URI, name: "panel.html", mimeType: HTML_MIME, description: "Prototype library panel (mcp-app surface)." },
  { uri: BRIDGE_URI, name: "bridge.js", mimeType: "text/javascript", description: "Panel <-> host MCP bridge adapter layer." },
  { uri: STATE_URI, name: "state.json", mimeType: "application/json", description: "Live prototype tree { root, tree, stats } for the panel." },
];

function readResourceFile(name) {
  return fs.readFileSync(path.join(__dirname, "ui", name), "utf8");
}

// ---------------------------------------------------------------------------
// tools/call handlers
// ---------------------------------------------------------------------------

async function toolRescan() {
  const rootAbs = rootAbsPath();
  const r = reconcile(rootAbs);
  if (r.errors.length) log("info", `uigen_rescan: partial scan (${r.errors.length} dir error(s))`);
  notifyStateUpdated();
  return { ok: true, root: rootAbs, tree: buildTree(r.entries), stats: r.stats };
}

async function toolListPages() {
  return { ok: true, ...snapshotState() };
}

async function toolGetPage(args) {
  const rootAbs = rootAbsPath();
  const r = resolveInRoot(rootAbs, args.id);
  if (!r.ok) return r;
  let st;
  try {
    st = fs.statSync(r.abs);
  } catch {
    return { ok: false, error: `not found: ${r.id}` };
  }
  if (st.isDirectory()) {
    return {
      ok: true,
      id: r.id,
      name: path.posix.basename(r.id),
      type: "module",
      framework: "",
      content: null,
    };
  }
  const ext = path.posix.extname(r.id).toLowerCase();
  const base = path.posix.basename(r.id);
  return {
    ok: true,
    id: r.id,
    name: ext ? base.slice(0, base.length - ext.length) : base,
    type: "page",
    framework: EXTENSION_FRAMEWORKS[ext] || "",
    content: readTextFile(r.abs),
  };
}

/** 重命名用的新名字校验:非空、不是路径片段、不含分隔符。 */
function checkRenameName(name) {
  if (!name) return { ok: false, error: "name is required for rename" };
  if (name === "." || name === "..") return { ok: false, error: `invalid name: ${name}` };
  if (/[\\/\0]/.test(name)) return { ok: false, error: `name must not contain path separators: ${name}` };
  return { ok: true };
}

async function toolSavePage(args) {
  const rootAbs = rootAbsPath();
  const r = resolveInRoot(rootAbs, args.id);
  if (!r.ok) return r;
  const id = r.id;
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const hasContent = typeof args.content === "string";
  const parentRel = id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : "";

  const exists = fs.existsSync(r.abs);
  if (!exists) {
    // 不存在 → 创建:type 按 id 推断(有扩展名 = page,无 = module)。
    // 新建时 name 忽略 —— 身份就是 id,避免 create 即 rename 的歧义。
    if (path.posix.extname(id)) {
      ensureDir(path.dirname(r.abs));
      fs.writeFileSync(r.abs, hasContent ? args.content : PLACEHOLDER_HTML, "utf8");
    } else {
      fs.mkdirSync(r.abs, { recursive: true });
    }
    reconcile(rootAbs);
    notifyStateUpdated();
    return { ok: true, id };
  }

  const st = fs.statSync(r.abs);
  if (st.isDirectory()) {
    if (hasContent) return { ok: false, error: `cannot write content into a module: ${id}` };
    let newId = id;
    if (name) {
      const check = checkRenameName(name);
      if (!check.ok) return check;
      const base = path.posix.basename(id);
      if (name !== base) {
        const newRel = parentRel ? `${parentRel}/${name}` : name;
        const nr = resolveInRoot(rootAbs, newRel);
        if (!nr.ok) return nr;
        if (fs.existsSync(nr.abs)) return { ok: false, error: `rename target already exists: ${newRel}` };
        fs.renameSync(r.abs, nr.abs);
        newId = nr.id;
      }
    }
    reconcile(rootAbs);
    notifyStateUpdated();
    return { ok: true, id: newId };
  }

  // page 文件:content 有则写;name 有且不同 → 改文件名(stem 保扩展名)
  if (hasContent) fs.writeFileSync(r.abs, args.content, "utf8");
  let newId = id;
  if (name) {
    const ext = path.posix.extname(id);
    let stem = name;
    if (ext && stem.toLowerCase().endsWith(ext.toLowerCase())) stem = stem.slice(0, -ext.length);
    const check = checkRenameName(stem);
    if (!check.ok) return check;
    const base = ext ? path.posix.basename(id, ext) : path.posix.basename(id);
    if (stem !== base) {
      const newRel = parentRel ? `${parentRel}/${stem}${ext}` : `${stem}${ext}`;
      const nr = resolveInRoot(rootAbs, newRel);
      if (!nr.ok) return nr;
      if (fs.existsSync(nr.abs)) return { ok: false, error: `rename target already exists: ${newRel}` };
      fs.renameSync(r.abs, nr.abs);
      newId = nr.id;
    }
  }
  reconcile(rootAbs);
  notifyStateUpdated();
  return { ok: true, id: newId };
}

async function toolDeletePage(args) {
  const rootAbs = rootAbsPath();
  const r = resolveInRoot(rootAbs, args.id);
  if (!r.ok) return r;
  let st;
  try {
    st = fs.statSync(r.abs);
  } catch {
    return { ok: false, error: `not found: ${r.id}` };
  }
  const recursive = args.recursive === true;
  if (st.isDirectory()) {
    let children;
    try {
      children = fs.readdirSync(r.abs);
    } catch (e) {
      return { ok: false, error: `cannot read module ${r.id}: ${e.message}` };
    }
    if (children.length > 0 && !recursive) {
      return {
        ok: false,
        error: `module not empty: ${r.id} — pass recursive:true to delete it with its contents`,
      };
    }
    if (children.length === 0) fs.rmdirSync(r.abs);
    else fs.rmSync(r.abs, { recursive: true });
  } else {
    fs.rmSync(r.abs, { force: true });
  }
  reconcile(rootAbs);
  notifyStateUpdated();
  return { ok: true, deleted: r.id };
}

async function toolPreviewUrl(args) {
  const rootAbs = rootAbsPath();
  const r = resolveInRoot(rootAbs, args.id);
  if (!r.ok) return r;
  let st;
  try {
    st = fs.statSync(r.abs);
  } catch {
    return { ok: false, error: `not found: ${r.id}` };
  }
  if (!st.isFile()) return { ok: false, error: `not a page file: ${r.id}` };
  try {
    const { port } = await ensurePreviewServer();
    const encoded = r.id.split("/").map(encodeURIComponent).join("/");
    return { ok: true, url: `http://127.0.0.1:${port}/${PREVIEW_PREFIX}${encoded}` };
  } catch (e) {
    return { ok: false, error: `preview server failed: ${e.message}` };
  }
}

async function toolMovePage(args) {
  const rootAbs = rootAbsPath();
  const r = resolveInRoot(rootAbs, args.id);
  if (!r.ok) return r;
  let st;
  try {
    st = fs.statSync(r.abs);
  } catch {
    return { ok: false, error: `not found: ${r.id}` };
  }

  if (typeof args.parent !== "string") {
    return { ok: false, error: 'parent is required (use "" for the workspace root)' };
  }
  let parentRel = args.parent.replace(/\\/g, "/").trim();
  if (parentRel === ".") parentRel = "";
  let parentAbs = rootAbs;
  if (parentRel) {
    const pr = resolveInRoot(rootAbs, parentRel);
    if (!pr.ok) return pr;
    parentAbs = pr.abs;
    let pst;
    try {
      pst = fs.statSync(parentAbs);
    } catch {
      return { ok: false, error: `parent not found: ${pr.id}` };
    }
    if (!pst.isDirectory()) return { ok: false, error: `parent is not a directory: ${pr.id}` };
  }

  const destAbs = path.join(parentAbs, path.basename(r.abs));
  // 循环:目录移进自己或自己的子孙
  if (st.isDirectory() && isWithin(r.abs, parentAbs)) {
    return { ok: false, error: `cannot move ${r.id} into itself or its own subtree: ${parentRel || "(root)"}` };
  }
  if (destAbs === r.abs) return { ok: true, id: r.id }; // 已在目标目录:无操作
  if (fs.existsSync(destAbs)) {
    return { ok: false, error: `target already exists: ${toStoreForm(destAbs)}` };
  }
  fs.renameSync(r.abs, destAbs);
  const newId = path.relative(rootAbs, destAbs).split(path.sep).join("/");
  reconcile(rootAbs);
  notifyStateUpdated();
  return { ok: true, id: newId };
}

async function toolListSkills(args) {
  const includeInactive = args.includeInactive === true;
  let skills = listSkillRecords();
  if (!includeInactive) skills = skills.filter((s) => s.is_active === true);
  skills.sort(
    (a, b) => a.sort_order - b.sort_order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
  return { ok: true, skills };
}

async function toolGetSkill(args) {
  const id = String(args.id || "").trim();
  if (!id) return { ok: false, error: "id is required" };
  const rec = loadSkill(id);
  if (!rec) return { ok: false, error: `skill not found: ${id}` };
  return { ok: true, ...rec };
}

async function toolSaveSkill(args) {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const description = typeof args.description === "string" ? args.description : "";
  const instructions = typeof args.instructions === "string" ? args.instructions : "";
  if (!name) return { ok: false, error: "name is required" };
  // instructions 必填非空:调用方传的 instructions 就是正文,直接落 instructions
  // 字段(修正 HBA 前端 body/instructions 错位的旧 bug)。
  if (!instructions.trim()) return { ok: false, error: "instructions is required and must be non-empty" };

  const idArg =
    args.id !== undefined && args.id !== null && String(args.id).trim() !== ""
      ? String(args.id).trim()
      : "";

  if (idArg) {
    const existing = loadSkill(idArg);
    if (!existing) return { ok: false, error: `skill not found: ${idArg}` };
    writeSkillFile(
      normalizeSkillRecord({
        ...existing,
        id: idArg,
        name,
        description,
        instructions,
        examples: typeof args.examples === "string" ? args.examples : existing.examples,
        category: typeof args.category === "string" && args.category ? args.category : existing.category,
        is_active: typeof args.is_active === "boolean" ? args.is_active : existing.is_active,
        sort_order: Number.isFinite(args.sort_order) ? Math.trunc(args.sort_order) : existing.sort_order,
      })
    );
    return { ok: true, id: idArg };
  }

  // 新建:id = skill-<slug>,冲突加序号
  const base = `skill-${slugify(name)}`;
  const used = new Set(listSkillRecords().map((s) => s.id));
  let id = base;
  let n = 1;
  while (used.has(id)) {
    n += 1;
    id = `${base}-${n}`;
  }
  writeSkillFile(
    normalizeSkillRecord({
      id,
      name,
      description,
      instructions,
      examples: typeof args.examples === "string" ? args.examples : "",
      category: typeof args.category === "string" && args.category ? args.category : "general",
      is_active: typeof args.is_active === "boolean" ? args.is_active : true,
      sort_order: Number.isFinite(args.sort_order) ? Math.trunc(args.sort_order) : 0,
    })
  );
  return { ok: true, id };
}

async function toolDeleteSkill(args) {
  const id = String(args.id || "").trim();
  if (!id) return { ok: false, error: "id is required" };
  const file = findSkillFile(id);
  if (!file) return { ok: false, error: `skill not found: ${id}` };
  fs.rmSync(file, { force: true });
  return { ok: true, deleted: id };
}

async function toolCanvasSave(args) {
  const layout = args.layoutJson;
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
    return { ok: false, error: "layoutJson must be an object" };
  }
  // 历史调用方可能仍带 ui(rootDir 绑定概念已废):剥掉,不进 layout 本体也不落盘
  const layoutOnly = { ...layout };
  delete layoutOnly.ui;
  let serialized;
  try {
    serialized = JSON.stringify(layoutOnly);
  } catch (e) {
    return { ok: false, error: `layoutJson is not serializable: ${e.message}` };
  }
  const record = writeCanvasRecord(layoutOnly);
  return {
    ok: true,
    updatedAt: record.updatedAt,
    bytes: record.bytes,
    file: canvasLayoutFile(),
  };
}

async function toolCanvasGet() {
  const { layout, updatedAt } = readCanvasLayout();
  return { ok: true, layout, updatedAt, workspace: workspaceInfo() };
}

const TOOL_HANDLERS = {
  uigen_rescan: toolRescan,
  uigen_list_pages: toolListPages,
  uigen_get_page: toolGetPage,
  uigen_save_page: toolSavePage,
  uigen_delete_page: toolDeletePage,
  uigen_preview_url: toolPreviewUrl,
  uigen_move_page: toolMovePage,
  uigen_list_skills: toolListSkills,
  uigen_get_skill: toolGetSkill,
  uigen_save_skill: toolSaveSkill,
  uigen_delete_skill: toolDeleteSkill,
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
          contents: [{ uri, mimeType: "application/json", text: JSON.stringify(snapshotState(), null, 2) }],
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

// 启动播种:内置技能 → <store>/skills/(失败只 console.error,不阻断启动)
seedSkills();

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

// 测试钩子(纯函数):tests/uigen/test-server.mjs 用它们做 YAML 往返与
// 对账对齐验证 —— 这些逻辑没有 IO,不需要起 server 进程也能测。
export { parseYaml, serializeYaml, alignIndexEntries };
