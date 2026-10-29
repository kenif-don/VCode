#!/usr/bin/env node
/**
 * FR-1 校验器:hba-on-zcode\agents\*.md(ZCode 子智能体定义)
 *
 * 零外部依赖,只用 Node 内置模块。运行:
 *   node tests/agents/validate-agents.mjs
 *
 * 校验项:
 *   - 6 个文件齐全(且没有多余/缺失的 .md)
 *   - frontmatter 可解析:name/description/color/model/thoughtLevel/tools 等
 *   - name 合法(仅字母/数字/连字符)、与文件名一致、不占用内置名(Explore/general-purpose)
 *   - description 非空
 *   - tools 与 FR-1 白名单逐项一致(不多不少、无重复)
 *   - thoughtLevel 属于 low/medium/high/max,且与 HBA thinking_level 映射一致
 *   - color 属于 ZCode 合法色板;permissionMode/maxTurns/background 形态合法
 *   - 提示词正文非空,且以「角色与工具边界」开头补写
 *   - (增强)迁移正文原样包含 HBA 原文件 frontmatter 之外的全部正文(HBA 目录可读时启用)
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = resolve(__dirname, "..", "..", "agents");
const HBA_SEED_DIR = resolve(__dirname, "..", "..", "..", "HBA", "seed", "agents");

// ---- 期望值(FR-1 任务书 + HBA 源文件实测) ----

const BUILTIN_NAMES = ["Explore", "general-purpose"];
const ZCODE_COLORS = ["red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan"];
const THOUGHT_LEVELS = ["low", "medium", "high", "max"];
const NAME_RE = /^[A-Za-z0-9-]+$/;

const EXPECTED = [
  {
    file: "coder.md",
    name: "coder",
    hbaSource: "coder.md",
    tools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob"],
    thoughtLevel: "low",
  },
  {
    file: "reviewer.md",
    name: "reviewer",
    hbaSource: "reviewer.md",
    tools: ["Read", "Grep", "Glob", "Bash"],
    thoughtLevel: "low",
  },
  {
    file: "architect.md",
    name: "architect",
    hbaSource: "architect.md",
    tools: ["Read", "Grep", "Glob", "WebSearch"],
    thoughtLevel: "low",
  },
  {
    file: "planner.md",
    name: "planner",
    hbaSource: "planner.md",
    tools: ["Read", "Grep", "Glob", "TodoWrite"],
    thoughtLevel: "low",
  },
  {
    file: "browser-tester.md",
    name: "browser-tester",
    hbaSource: "browser_tester.md",
    tools: ["Read", "Bash", "WebFetch", "WebSearch"],
    thoughtLevel: "low",
  },
  {
    file: "ui-prototype.md",
    name: "ui-prototype",
    hbaSource: "ui-gen-assistant.md",
    tools: ["Read", "Write", "Edit", "Bash", "Glob"],
    thoughtLevel: "medium",
  },
];

// ---- 极简 YAML(frontmatter 子集)解析 ----

function parseFrontmatter(text) {
  const normalized = text.replace(/\r\n/g, "\n");
  const m = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    fields[key] = line.slice(idx + 1).trim();
  }
  return { fields, body: m[2] };
}

function unquote(value) {
  if (value == null) return "";
  const v = value.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

function parseList(value) {
  let v = (value ?? "").trim();
  if (v.startsWith("[") && v.endsWith("]")) v = v.slice(1, -1);
  return v
    .split(",")
    .map((s) => unquote(s.trim()))
    .filter((s) => s.length > 0);
}

// ---- 断言收集 ----

let passed = 0;
let failed = 0;
const failures = [];

function check(cond, label) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    failures.push(label);
    console.log(`[FAIL] ${label}`);
  }
}

function skip(label, reason) {
  console.log(`[SKIP] ${label} (${reason})`);
}

// ---- 全局:文件齐全 ----

const expectedFiles = new Set(EXPECTED.map((e) => e.file));
const actualFiles = existsSync(AGENTS_DIR)
  ? readdirSync(AGENTS_DIR).filter((f) => f.toLowerCase().endsWith(".md")).sort()
  : [];

check(existsSync(AGENTS_DIR), `agents 目录存在: ${AGENTS_DIR}`);
for (const f of expectedFiles) {
  check(actualFiles.includes(f), `文件齐全: agents/${f}`);
}
for (const f of actualFiles) {
  check(expectedFiles.has(f), `无多余智能体文件: agents/${f}`);
}

const seenNames = new Set();
for (const e of EXPECTED) {
  const filePath = join(AGENTS_DIR, e.file);
  if (!existsSync(filePath)) continue; // 已在上面记为 FAIL
  const text = readFileSync(filePath, "utf8");
  const parsed = parseFrontmatter(text);
  const tag = e.file;

  check(parsed !== null, `${tag}: frontmatter 可解析`);
  if (!parsed) continue;

  const { fields, body } = parsed;
  const name = unquote(fields.name);
  const description = unquote(fields.description);
  const color = unquote(fields.color);
  const model = unquote(fields.model);
  const thoughtLevel = unquote(fields.thoughtLevel);
  const tools = parseList(fields.tools);
  const permissionMode = unquote(fields.permissionMode);
  const maxTurns = unquote(fields.maxTurns);
  const background = unquote(fields.background);

  // name
  check(NAME_RE.test(name), `${tag}: name「${name}」仅含字母/数字/连字符`);
  check(name === e.name, `${tag}: name「${name}」与约定名一致(${e.name})`);
  check(name === e.file.replace(/\.md$/i, ""), `${tag}: name 与文件名一致`);
  check(!BUILTIN_NAMES.includes(name), `${tag}: name 未占用内置名`);
  check(!seenNames.has(name), `${tag}: name 全局唯一`);
  seenNames.add(name);

  // description
  check(description.length > 0, `${tag}: description 非空`);

  // tools 白名单(集合相等,且无重复)
  const expectedTools = [...e.tools].sort();
  const actualTools = [...tools].sort();
  check(
    JSON.stringify(actualTools) === JSON.stringify(expectedTools),
    `${tag}: tools 与白名单一致 [${tools.join(", ")}]`
  );
  check(new Set(tools).size === tools.length, `${tag}: tools 无重复项`);

  // thoughtLevel
  check(THOUGHT_LEVELS.includes(thoughtLevel), `${tag}: thoughtLevel「${thoughtLevel}」属于 low/medium/high/max`);
  check(thoughtLevel === e.thoughtLevel, `${tag}: thoughtLevel 与 HBA thinking_level 映射一致(${e.thoughtLevel})`);

  // 其余 frontmatter 字段
  check(ZCODE_COLORS.includes(color), `${tag}: color「${color}」属于 ZCode 色板`);
  check(model.length > 0, `${tag}: model 非空`);
  check(
    model === "【provider:model,按部署环境填写】" || /^[A-Za-z0-9_-]+:[A-Za-z0-9_./-]+$/.test(model),
    `${tag}: model 为占位符或 provider:model 形式(实际:${model})`
  );
  check(permissionMode === "default", `${tag}: permissionMode 为 default`);
  check(/^\d+$/.test(maxTurns) && Number(maxTurns) > 0, `${tag}: maxTurns 为正整数(${maxTurns})`);
  check(["true", "false"].includes(background), `${tag}: background 为布尔值(${background})`);

  // 提示词正文
  const bodyTrimmed = body.trim();
  check(bodyTrimmed.length > 0, `${tag}: 提示词正文非空`);
  check(bodyTrimmed.includes("## 角色与工具边界"), `${tag}: 正文开头含「角色与工具边界」说明`);

  // (增强)与 HBA 原文的正文保真比对
  const hbaPath = join(HBA_SEED_DIR, e.hbaSource);
  if (existsSync(hbaPath)) {
    const hbaParsed = parseFrontmatter(readFileSync(hbaPath, "utf8"));
    if (hbaParsed) {
      const origBody = hbaParsed.body.replace(/\r\n/g, "\n").trim();
      check(
        origBody.length > 0 && bodyTrimmed.includes(origBody),
        `${tag}: HBA 原文正文(${e.hbaSource})原样保留于迁移正文中`
      );
      const hbaThinking = unquote(hbaParsed.fields.thinking_level);
      check(
        hbaThinking === thoughtLevel,
        `${tag}: thoughtLevel 与 HBA thinking_level「${hbaThinking}」一致`
      );
    } else {
      skip(`${tag}: HBA 原文保真比对`, `无法解析 ${e.hbaSource} 的 frontmatter`);
    }
  } else {
    skip(`${tag}: HBA 原文保真比对`, `HBA 目录不可读: ${HBA_SEED_DIR}`);
    skip(`${tag}: thinking_level 交叉核对`, `HBA 目录不可读: ${HBA_SEED_DIR}`);
  }
}

// ---- 汇总 ----

console.log("");
if (failed === 0) {
  console.log(`RESULT: 全绿 — ${passed} 项通过, 0 项失败`);
  process.exit(0);
} else {
  console.log(`RESULT: 有失败 — ${passed} 项通过, ${failed} 项失败`);
  console.log("失败项:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
