#!/usr/bin/env node
/**
 * stability-poc.mjs — 杀进程恢复测试驱动器(TC-STB-01 POC)
 *
 * 零外部依赖(仅 Node 内置模块)。对给定命令反复执行:
 *   启动 → 等待启动标记 → 随机时点 kill(进程树)→ 校验进程退出
 *   → 重启 → 校验恢复标记 → 清理
 * 可配次数/并发/随机区间/成功率阈值,输出成功率 JSON 报告。
 *
 * --dry-run 自测模式:被测对象用 node 子进程模拟(内置模拟服务,
 *   启动时写入恢复标记文件并常驻),驱动器自身走完整 kill→重启→校验回路,
 *   用于验证驱动器逻辑,不需要真实宿主。
 *
 * 恢复标记契约:被测进程在启动完成时向 --marker 文件追加一行
 *   JSON { pid, ts }(或任意新内容)。驱动器以「标记内容发生变化」
 *   判定该次启动/恢复完成。真实目标(zcode --web 等)可用包装脚本
 *   落标记,或直接指向目标自身的恢复产物文件(如会话自动保存文件)。
 *
 * 用法:
 *   node scripts/poc/stability-poc.mjs --dry-run [--times 10] [--concurrency 2]
 *   node scripts/poc/stability-poc.mjs --cmd "zcode --web" --marker <path> \
 *        [--times 100] [--concurrency 4] [--min-delay 200] [--max-delay 2000] \
 *        [--restart-timeout 10000] [--threshold 99] [--seed 42] [--report <path>]
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TC_ID = "TC-STB-01";
const TC_TITLE = "杀进程恢复 100 次成功率 ≥99%";

// 模拟服务:启动即写恢复标记,然后常驻(等待被 kill)
const SIM_SCRIPT = `
const fs = require("node:fs");
const marker = process.env.POC_MARKER;
fs.appendFileSync(marker, JSON.stringify({ pid: process.pid, ts: Date.now() }) + "\\n");
setInterval(() => {}, 1000); // 常驻直到被杀
`;

// ---------------------------------------------------------------------------
// 确定性随机(同 seed 可复现)
// ---------------------------------------------------------------------------
function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return function rng() {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// 进程管理
// ---------------------------------------------------------------------------
function startTarget(cmd, markerPath, dryRun) {
  if (dryRun) {
    return spawn(process.execPath, ["-e", SIM_SCRIPT], {
      env: { ...process.env, POC_MARKER: markerPath },
      stdio: "ignore",
    });
  }
  // 真实目标:交给 shell(Windows 下即 cmd /c),POC_MARKER 透传给包装脚本
  return spawn(cmd, {
    shell: true,
    env: { ...process.env, POC_MARKER: markerPath },
    stdio: "ignore",
  });
}

/** 进程树 kill:Windows 用 taskkill /T /F,POSIX 用 SIGKILL */
function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  }
  try {
    child.kill("SIGKILL");
  } catch {
    /* 进程已退出 */
  }
}

function waitExit(child, timeoutMs) {
  return new Promise((resolveExit) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolveExit(true);
      return;
    }
    const timer = setTimeout(() => resolveExit(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveExit(true);
    });
  });
}

/** 等待恢复标记内容变化(启动/恢复完成信号) */
async function waitMarker(markerPath, prevContent, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(markerPath)) {
      const cur = readFileSync(markerPath, "utf8");
      if (cur !== prevContent && cur.trim().length > 0) return cur;
    }
    await sleep(25);
  }
  return null;
}

function readMarker(markerPath) {
  return existsSync(markerPath) ? readFileSync(markerPath, "utf8") : "";
}

// ---------------------------------------------------------------------------
// 单次恢复回路
// ---------------------------------------------------------------------------
async function oneCycle(index, cmd, opts, rng) {
  const { markerPath, minDelayMs, maxDelayMs, restartTimeoutMs, dryRun } = opts;
  const record = { index, ok: false, failReason: null };

  try {
    // 1) 启动并等待启动标记
    let markerBefore = readMarker(markerPath);
    let t0 = Date.now();
    let child = startTarget(cmd, markerPath, dryRun);
    let marker = await waitMarker(markerPath, markerBefore, restartTimeoutMs);
    if (!marker) {
      killTree(child);
      record.failReason = "startup: 未观测到启动标记";
      return record;
    }
    record.startupMs = Date.now() - t0;

    // 2) 随机时点 kill(进程树)
    const killAfterMs = minDelayMs + Math.floor(rng() * (maxDelayMs - minDelayMs));
    record.killAfterMs = killAfterMs;
    await sleep(killAfterMs);
    t0 = Date.now();
    killTree(child);
    const dead = await waitExit(child, 5000);
    record.killMs = Date.now() - t0;
    if (!dead) {
      record.failReason = "kill: 进程未在 5s 内退出";
      killTree(child);
      return record;
    }

    // 3) 重启并校验恢复标记
    markerBefore = readMarker(markerPath);
    t0 = Date.now();
    child = startTarget(cmd, markerPath, dryRun);
    marker = await waitMarker(markerPath, markerBefore, restartTimeoutMs);
    if (!marker) {
      record.failReason = "recovery: 重启后未观测到恢复标记";
      killTree(child);
      return record;
    }
    record.recoveryMs = Date.now() - t0;

    // 4) 标记可解析性(dry-run 模拟目标写 JSON;真实目标写任意内容则跳过)
    if (dryRun) {
      const lines = marker.trim().split("\n");
      const last = JSON.parse(lines[lines.length - 1]);
      if (!Number.isInteger(last.pid)) {
        record.failReason = "recovery: 恢复标记 JSON 不合法";
        killTree(child);
        return record;
      }
    }

    // 5) 清理
    killTree(child);
    await waitExit(child, 5000);
    record.ok = true;
    return record;
  } catch (e) {
    record.failReason = `exception: ${e.message}`;
    return record;
  }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function main() {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      cmd: { type: "string", default: "" },
      marker: { type: "string", default: "" },
      times: { type: "string", default: "" },
      concurrency: { type: "string", default: "4" },
      "min-delay": { type: "string", default: "200" },
      "max-delay": { type: "string", default: "2000" },
      "restart-timeout": { type: "string", default: "10000" },
      threshold: { type: "string", default: "99" },
      seed: { type: "string", default: "42" },
      report: { type: "string", default: "" },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(
      [
        "用法:",
        "  node scripts/poc/stability-poc.mjs --dry-run [--times 10] [--concurrency 2]",
        "  node scripts/poc/stability-poc.mjs --cmd \"<command>\" --marker <path> \\",
        "       [--times 100] [--concurrency 4] [--min-delay 200] [--max-delay 2000] \\",
        "       [--restart-timeout 10000] [--threshold 99] [--seed 42] [--report <path>]",
        "",
        `${TC_ID} ${TC_TITLE}:启动→随机时点 kill→重启→校验恢复标记,输出成功率 JSON。`,
      ].join("\n")
    );
    return 0;
  }

  const dryRun = values["dry-run"];
  const cmd = values.cmd;
  if (!dryRun && !cmd) {
    console.error("必须提供 --cmd(被测命令)或 --dry-run(自测模式)");
    return 2;
  }

  const times = Number(values.times || (dryRun ? "10" : "100"));
  const concurrency = Math.max(1, Number(values.concurrency));
  const minDelayMs = Number(values["min-delay"]);
  const maxDelayMs = Math.max(minDelayMs, Number(values["max-delay"]));
  const restartTimeoutMs = Number(values["restart-timeout"]);
  const thresholdPct = Number(values.threshold);
  const seed = Number(values.seed);
  if (!Number.isInteger(times) || times < 1) {
    console.error(`无效 --times: ${values.times}`);
    return 2;
  }

  // 恢复标记文件:dry-run 用内置模拟目标,默认落在 scripts/poc/.stability/ 下
  const workDir = join(__dirname, ".stability");
  mkdirSync(workDir, { recursive: true });
  const markerPath = values.marker
    ? resolve(values.marker)
    : join(workDir, `marker-${process.pid}.log`);
  if (values.marker) mkdirSync(dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, ""); // 清空旧标记

  const rng = makeRng(seed);
  const opts = { markerPath, minDelayMs, maxDelayMs, restartTimeoutMs, dryRun };

  // 并发分批执行
  const cycles = [];
  for (let start = 0; start < times; start += concurrency) {
    const batch = [];
    for (let i = start; i < Math.min(start + concurrency, times); i += 1) {
      batch.push(oneCycle(i + 1, cmd, opts, rng));
    }
    const results = await Promise.all(batch);
    cycles.push(...results);
  }

  const successes = cycles.filter((c) => c.ok).length;
  const failures = cycles.filter((c) => !c.ok);
  const successRatePct = Math.round((successes / times) * 10000) / 100;
  const verdict = successRatePct >= thresholdPct ? "PASS" : "FAIL";

  const report = {
    tool: "stability-poc.mjs",
    tc: TC_ID,
    title: TC_TITLE,
    mode: dryRun ? "dry-run(模拟目标=node 子进程)" : "target",
    generatedAt: new Date().toISOString(),
    config: {
      cmd: dryRun ? "node -e <内置模拟服务>" : cmd,
      times,
      concurrency,
      minDelayMs,
      maxDelayMs,
      restartTimeoutMs,
      thresholdPct,
      seed,
      markerPath,
    },
    summary: {
      times,
      successes,
      failures: failures.length,
      successRatePct,
      thresholdPct,
      verdict,
      rule: `成功率 ≥ ${thresholdPct}% 判 PASS(${TC_TITLE})`,
    },
    cycles,
    failureDetails: failures.map((f) => ({ index: f.index, failReason: f.failReason })),
  };

  if (values.report) {
    const reportPath = resolve(values.report);
    report.reportPath = reportPath;
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }
  if (dryRun) {
    // 自测产物不残留
    try {
      rmSync(markerPath, { force: true });
    } catch {
      /* ignore */
    }
  }

  console.log(JSON.stringify(report, null, 2));
  return verdict === "PASS" ? 0 : 1;
}

process.exit(await main());
