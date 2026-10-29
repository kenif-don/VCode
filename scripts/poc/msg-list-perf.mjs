#!/usr/bin/env node
/**
 * msg-list-perf.mjs — 消息列表加载性能测量(TC-PERF-01 POC)
 *
 * 零外部依赖(仅 Node 内置模块)。读取 session-fixtures.mjs 生成的会话夹具,
 * 模拟两种消息列表加载策略并计时,输出 P50/P95 JSON 报告,含基线对比
 * (旧值/新值/达标判定,阈值 ≤2000ms,对应 PRD「500 轮会话打开 ≤2s」)。
 *
 * 加载策略:
 *   full  — 全量加载:一次 JSON.parse 后整表构建渲染模型(消息项 + 工具块摘要)
 *   paged — 分页加载:首屏只构建第 1 页(page-size 条),再按页滚动补齐
 *           (每页构建 + 首屏时间单独计时,反映真实滚动成本)
 *
 * 用法:
 *   node scripts/poc/msg-list-perf.mjs [--fixture <path>] [--iterations 30]
 *        [--warmup 5] [--page-size 50] [--threshold 2000] [--report <path>]
 *
 * 默认夹具: scripts/poc/fixtures/session.json(由 session-fixtures.mjs 生成)
 * 示例报告: scripts/poc/sample-report.json
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, totalmem, platform, arch } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURE = join(__dirname, "fixtures", "session.json");
const TC_ID = "TC-PERF-01";
const TC_TITLE = "500 轮会话打开 ≤2s";

// ---------------------------------------------------------------------------
// 统计
// ---------------------------------------------------------------------------
function quantile(sorted, q) {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    samples: sorted.length,
    minMs: round(sorted[0]),
    p50Ms: round(quantile(sorted, 0.5)),
    p95Ms: round(quantile(sorted, 0.95)),
    maxMs: round(sorted[sorted.length - 1]),
    meanMs: round(sum / sorted.length),
  };
}

function round(v) {
  return Math.round(v * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// 渲染模型构建(模拟消息列表首渲染的映射成本)
// ---------------------------------------------------------------------------
function buildItem(m) {
  // 模拟列表项渲染模型:文本摘要、角色标记、工具块摘要、时间标签
  const blocks = (m.blocks || []).map((b) => {
    if (b.type === "tool_call") return `${b.name}(${b.callId})`;
    if (b.type === "tool_result") return `${b.ok ? "ok" : "err"}:${b.bytes}B`;
    return (b.text || "").slice(0, 80);
  });
  return {
    key: m.id,
    role: m.role,
    round: m.round,
    tsLabel: new Date(m.ts).toISOString(),
    preview: (m.text || "").slice(0, 120),
    blocks,
    tokens: m.meta?.tokens ?? 0,
  };
}

/** 全量加载:一次 parse + 整表建模 */
function loadFull(raw) {
  const data = JSON.parse(raw);
  const items = new Array(data.messages.length);
  for (let i = 0; i < data.messages.length; i += 1) items[i] = buildItem(data.messages[i]);
  return { items, total: items.length };
}

/** 分页加载:parse 后按页建模;返回首屏与全部页计时 */
function loadPaged(raw, pageSize) {
  const data = JSON.parse(raw);
  const total = data.messages.length;
  // 首屏:仅第 1 页
  const firstPage = [];
  for (let i = 0; i < Math.min(pageSize, total); i += 1) firstPage.push(buildItem(data.messages[i]));
  // 后续页(模拟滚动补齐)
  let built = firstPage.length;
  for (let start = pageSize; start < total; start += pageSize) {
    for (let i = start; i < Math.min(start + pageSize, total); i += 1) {
      buildItem(data.messages[i]);
      built += 1;
    }
  }
  return { firstPage, built, total };
}

// ---------------------------------------------------------------------------
// 测量主流程
// ---------------------------------------------------------------------------
function measure(fn, iterations, warmup) {
  for (let i = 0; i < warmup; i += 1) fn(); // 预热,排除 JIT/缓存冷启动
  const samples = [];
  for (let i = 0; i < iterations; i += 1) {
    const t0 = process.hrtime.bigint();
    fn();
    const t1 = process.hrtime.bigint();
    samples.push(Number(t1 - t0) / 1e6);
  }
  return samples;
}

function main() {
  const { values } = parseArgs({
    options: {
      fixture: { type: "string", default: DEFAULT_FIXTURE },
      iterations: { type: "string", default: "30" },
      warmup: { type: "string", default: "5" },
      "page-size": { type: "string", default: "50" },
      threshold: { type: "string", default: "2000" },
      report: { type: "string", default: "" },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(
      [
        "用法:",
        "  node scripts/poc/msg-list-perf.mjs [--fixture <path>] [--iterations 30]",
        "       [--warmup 5] [--page-size 50] [--threshold 2000] [--report <path>]",
        "",
        `测量 ${TC_ID}(${TC_TITLE}):消息列表全量/分页加载 P50/P95,含基线对比。`,
      ].join("\n")
    );
    return 0;
  }

  const fixturePath = resolve(values.fixture);
  if (!existsSync(fixturePath)) {
    console.error(`夹具不存在: ${fixturePath}(先运行 session-fixtures.mjs 生成)`);
    return 2;
  }

  const iterations = Number(values.iterations);
  const warmup = Number(values.warmup);
  const pageSize = Number(values["page-size"]);
  const thresholdMs = Number(values.threshold);
  if (!Number.isInteger(iterations) || iterations < 1) {
    console.error(`无效 --iterations: ${values.iterations}`);
    return 2;
  }
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    console.error(`无效 --page-size: ${values["page-size"]}`);
    return 2;
  }

  const raw = readFileSync(fixturePath, "utf8");
  const head = JSON.parse(raw); // 只取元信息
  const fixtureMeta = {
    path: fixturePath,
    rounds: head.rounds,
    messageCount: head.messageCount,
    bytes: Buffer.byteLength(raw, "utf8"),
  };

  // 场景 1:全量加载(读文件 + parse + 整表建模,冷路径)
  const fullSamples = measure(() => {
    const raw2 = readFileSync(fixturePath, "utf8");
    loadFull(raw2);
  }, iterations, warmup);

  // 场景 2:全量加载(共享已读内容,只测 parse + 建模,热路径)
  const fullWarmSamples = measure(() => loadFull(raw), iterations, warmup);

  // 场景 3:分页加载(首屏 + 滚动补齐全部页,冷路径)
  const pagedSamples = measure(() => {
    const raw2 = readFileSync(fixturePath, "utf8");
    loadPaged(raw2, pageSize);
  }, iterations, warmup);

  // 场景 4:首屏时间(分页策略 time-to-first-paint,热路径)
  const firstPaintSamples = measure(() => {
    const data = JSON.parse(raw);
    const n = Math.min(pageSize, data.messages.length);
    for (let i = 0; i < n; i += 1) buildItem(data.messages[i]);
  }, iterations, warmup);

  const scenarios = {
    "full-load-cold": {
      desc: "全量加载:读文件 + JSON.parse + 整表建模(会话打开完整成本)",
      ...stats(fullSamples),
    },
    "full-load-warm": {
      desc: "全量加载:JSON.parse + 整表建模(排除磁盘 IO)",
      ...stats(fullWarmSamples),
    },
    "paged-load-cold": {
      desc: `分页加载:读文件 + parse + 首屏 1 页(${pageSize} 条)+ 滚动补齐全部页`,
      pageSize,
      ...stats(pagedSamples),
    },
    "first-paint": {
      desc: `首屏时间:parse + 仅建模第 1 页(${pageSize} 条)`,
      pageSize,
      ...stats(firstPaintSamples),
    },
  };

  // 基线对比:主口径取「全量加载冷路径 P95」= 会话打开完整成本
  const primary = scenarios["full-load-cold"];
  const newValue = primary.p95Ms;
  const baseline = {
    tc: TC_ID,
    title: TC_TITLE,
    metric: "full-load-cold.p95Ms",
    thresholdMs,
    unit: "ms",
    old: {
      value: thresholdMs,
      label: "PRD 基线(旧值):会话打开 ≤2000ms",
      source: "PRD 性能指标 TC-PERF-01",
    },
    new: {
      value: newValue,
      label: "本次实测(新值):全量加载冷路径 P95",
      measuredAt: new Date().toISOString(),
    },
    deltaMs: round(newValue - thresholdMs),
    deltaPct: round(((newValue - thresholdMs) / thresholdMs) * 100),
    verdict: newValue <= thresholdMs ? "PASS" : "FAIL",
    rule: `新值 P95 ≤ ${thresholdMs}ms 判 PASS`,
  };

  const report = {
    tool: "msg-list-perf.mjs",
    generatedAt: new Date().toISOString(),
    tc: TC_ID,
    environment: {
      node: process.version,
      platform: platform(),
      arch: arch(),
      cpuCount: cpus().length,
      totalMemMB: Math.round(totalmem() / 1024 / 1024),
    },
    fixture: fixtureMeta,
    config: { iterations, warmup, pageSize, thresholdMs },
    scenarios,
    baseline,
    notes: [
      "POC 在 Node 侧模拟消息列表的加载/建模成本,不含 ZCode 宿主 IPC 与真实 DOM 渲染;",
      "宿主内实测(TC-PERF-01 端到端)由 e2e/specs/perf.spec.ts 在 zcode --web 上执行,",
      "两者共用同一夹具与同一 ≤2000ms 判定口径。",
    ],
  };

  if (values.report) {
    const reportPath = resolve(values.report);
    report.reportPath = reportPath;
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }

  console.log(JSON.stringify(report, null, 2));
  return baseline.verdict === "PASS" ? 0 : 1;
}

process.exit(main());
