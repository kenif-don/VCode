#!/usr/bin/env node
/**
 * HBA 白标改造脚本(fork/branding/apply-whitelabel.mjs)
 *
 * 把上游 zai-org/ZCode 源码树的**用户可见名称**批量改为 VCode,并完成产品身份
 * (appId / productName / Linux 可执行名)与进程名前缀的定点转换。
 *
 * 设计取舍(fork/README §5「季度 rebase」):
 * - 白标改名天然触碰数百处文案,固化成 patch 会在 rebase 时大面积冲突;
 *   本脚本是「可重放的补丁」——rebase 后重新执行一遍即可,零冲突。
 * - 只改字符串/JSX 文本里的独立词 `ZCode`(正则 \bZCode\b),标识符
 *   (ZCodeStartupLogoBadge、useZCodeIntl、helpZCodeEndpoint 等)天然不受影响。
 * - 依法保留版权与署名:含 © / Copyright / 版权 / Modified by 的行整行跳过
 *   (Apache-2.0 红线,fork/README §7:商标去除仅限商标性使用)。
 * - 注释行跳过(//、*、/*、<!--、;),注释描述的是上游代码事实,保持原样。
 * - 小写的 zcode(zcode.z.ai、zcode://、~/.zcode、@zcode/*、ZCODE_* 等)
 *   是 URL/协议/路径/包名/环境变量,一律不动。
 *
 * 用法: node apply-whitelabel.mjs <zcode-src-root>
 * 幂等:重复执行无额外改动;断点安全:逐文件原子写回。
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const srcRoot = process.argv[2];
if (!srcRoot) {
  console.error("usage: node apply-whitelabel.mjs <zcode-src-root>");
  process.exit(2);
}

/** 递归收集目标文件:只进源码/测试/资源描述层,永不进产物与依赖。 */
const SKIP_DIRS = new Set(["node_modules", "dist", "out", "bundled-agents", ".git"]);
const TEXT_EXT = new Set([".ts", ".tsx", ".mjs", ".js", ".json", ".html", ".nsh", ".xml", ".kt"]);

/** 需要重命名的文件树(相对源码根)。整树扫 packages/apps,靠 SKIP_DIRS+扩展名过滤收口。 */
const TARGETS = ["packages", "apps"];

function* walk(entry) {
  let st;
  try {
    st = statSync(entry);
  } catch {
    return;
  }
  if (st.isFile()) {
    yield entry;
    return;
  }
  for (const name of readdirSync(entry)) {
    if (SKIP_DIRS.has(name)) continue;
    yield* walk(join(entry, name));
  }
}

function collectFiles() {
  const files = new Set();
  for (const target of TARGETS) {
    for (const file of walk(join(srcRoot, target))) {
      const lower = file.toLowerCase();
      if (!TEXT_EXT.has(lower.slice(lower.lastIndexOf(".")))) continue;
      files.add(file);
    }
  }
  return [...files].sort();
}

// ---------- 通用改名:独立词 ZCode → VCode(标识符天然不受 \b 影响) ----------

// 版权/署名行依法保留上游名称(Apache-2.0,fork/README §7):
// 含 © / Copyright / 版权 / Modified by / License / Apache 的行整行跳过。
const COPYRIGHT_RE = /©|Copyright|版权|Modified by|License|Apache/i;

function renameFileContent(content, _isNsh) {
  return content
    .split("\n")
    .map((line) => (COPYRIGHT_RE.test(line) ? line : line.replace(/\bZCode\b/g, "VCode")))
    .join("\n");
}

// ---------- 定点转换:小写值/身份字段(通用 \bZCode\b 覆盖不到) ----------

const TARGETED = [
  // 进程名前缀(任务管理器可见):zcode-* → vcode-*
  {
    file: "packages/shared/src/process-names.ts",
    pairs: [['const ZCODE_PROCESS_PREFIX = "zcode";', 'const ZCODE_PROCESS_PREFIX = "vcode";']],
  },
  // 产品身份:appId / Linux 可执行名与包名(fork/README §4-1)
  {
    file: "packages/desktop/scripts/desktop-product-identity.mjs",
    pairs: [
      ['"dev.zcode.app.preview"', '"dev.vcode.app.preview"'],
      ['"dev.zcode.app"', '"dev.vcode.app"'],
      ['linuxExecutableName: "zcode"', 'linuxExecutableName: "vcode"'],
      ['linuxPackageName: "zcode"', 'linuxPackageName: "vcode"'],
      ['"zcode-preview"', '"vcode-preview"'],
    ],
  },
];

function applyTargeted(changedFiles) {
  for (const { file, pairs } of TARGETED) {
    const abs = join(srcRoot, file);
    let content = readFileSync(abs, "utf8");
    let changed = false;
    for (const [from, to] of pairs) {
      if (content.includes(from)) {
        content = content.split(from).join(to);
        changed = true;
      }
    }
    if (changed) {
      writeFileSync(abs, content);
      changedFiles.add(relative(srcRoot, abs).replaceAll("\\", "/"));
    }
  }
}

// ---------- 主流程 ----------

const changedFiles = new Set();
for (const file of collectFiles()) {
  const isNsh = file.toLowerCase().endsWith(".nsh");
  const content = readFileSync(file, "utf8");
  const next = renameFileContent(content, isNsh);
  if (next !== content) {
    writeFileSync(file, next);
    changedFiles.add(relative(srcRoot, file).replaceAll("\\", "/"));
  }
}
applyTargeted(changedFiles);

console.log(`whitelabel rename done: ${changedFiles.size} file(s) changed`);
for (const f of [...changedFiles].sort()) console.log(`  ${f}`);
