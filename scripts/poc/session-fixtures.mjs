#!/usr/bin/env node
/**
 * session-fixtures.mjs — 500 轮消息会话测试夹具生成器 + 自检器(W0/W6 POC)
 *
 * 零外部依赖(仅 Node 内置模块)。Windows(git bash)可用。
 *
 * 生成模式(默认):
 *   node scripts/poc/session-fixtures.mjs --out <dir> [--rounds 500] [--tool-ratio 0.4] [--seed 42]
 *     合成一个完整会话 JSON(用户/助手/工具消息混排),连同 manifest.json
 *     (含 sha256、字节数、消息数)写入 <dir>。生成后自动执行一次自检。
 *
 * 自检模式:
 *   node scripts/poc/session-fixtures.mjs --verify --out <dir>
 *     校验夹具完整性:manifest 哈希/字节数、JSON 可解析、schemaVersion、
 *     轮数与消息数、seq 连续且严格递增、id 唯一、时间戳非递减、
 *     每轮至少 1 条 user + 1 条 assistant、tool_call 与 tool_result 一一配对。
 *     输出 JSON 检查报告;全部通过 exit 0,否则 exit 1。
 *
 * 消息 schema(hba-on-zcode.session-fixture/1):
 *   {
 *     id, seq, round, role: "user"|"assistant"|"tool", ts, text,
 *     blocks: [ {type:"text", text} | {type:"tool_call", callId, name, argsJson}
 *             | {type:"tool_result", callId, ok, bytes} ],
 *     meta: { tokens }
 *   }
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_VERSION = "hba-on-zcode.session-fixture/1";
const FIXTURE_NAME = "session.json";
const MANIFEST_NAME = "manifest.json";

// ---------------------------------------------------------------------------
// 确定性伪随机(LCG,保证同 seed 产物可复现)
// ---------------------------------------------------------------------------
function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return function rng() {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// 合成文本池(带填充,使夹具体积接近真实会话)
// ---------------------------------------------------------------------------
const USER_TOPICS = [
  "帮我实现一个社区图书馆借阅 App 的首页推荐模块",
  "这段解析逻辑在边界输入上抛错,帮我定位并修掉",
  "给 run 配置面板补一个复制配置的功能,顺手把测试补上",
  "评审一下上一轮的 diff,重点看错误处理有没有被吞掉",
  "把消息列表的分页加载做出来,首屏要快",
  "梳理一下 Git 面板差异视图和仓库状态的一致性问题",
  "生成一款社区团购小程序的原型,含首页、商品列表、详情页与个人中心",
  "这次改动影响面多大?给出验证强度建议",
];
const ASSISTANT_TAILS = [
  "已按最小 diff 完成改动,受影响测试子集已跑通,红绿结果见上文。",
  "定位到问题在空值兜底分支,已改为显式抛错并补了两条边界测试。",
  "实现要点:分页游标 + 首屏预取,渲染路径不做全量重建,避免长列表卡顿。",
  "评审结论:两处静默吞错需要修正,其余改动可以合入,影响面限于单一模块。",
  "计划已拆成三步,每步都带验证动作,预计工具调用规模与改动匹配。",
  "原型已生成 4 屏,含跳转热点与 390px 视口产物(html/jsx/vue)。",
  "注意:失败可见性优先于不报错,任何 fallback 都必须带日志与说明。",
  "建议按 M 级处理:只跑受影响模块测试子集,不扩大为全量回归。",
];
const PADDING =
  "此处为合成消息正文填充,用于模拟真实会话中的多段说明、代码片段引用与推理摘要。" +
  "The quick brown fox jumps over the lazy dog while the message list keeps rendering. " +
  "边界情况包括空输入、超长文本、并发写入与进程重启后的状态恢复。";
const TOOL_NAMES = ["Read", "Grep", "Glob", "Bash", "Write", "Edit", "WebSearch"];

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

function synthText(rng, base, minPad, maxPad) {
  const padLen = minPad + Math.floor(rng() * (maxPad - minPad));
  let out = base;
  while (out.length < padLen) out += PADDING;
  return out.slice(0, padLen);
}

// ---------------------------------------------------------------------------
// 生成
// ---------------------------------------------------------------------------
function generateFixture({ rounds, toolRatio, seed }) {
  const rng = makeRng(seed);
  const messages = [];
  let seq = 0;
  let callSeq = 0;
  // 以固定基准时间起步,每条消息 +1~8s,保证 ts 非递减
  let ts = Date.UTC(2026, 0, 1, 9, 0, 0);

  const push = (msg) => {
    seq += 1;
    ts += 1000 + Math.floor(rng() * 7000);
    messages.push({ id: `m-${String(seq).padStart(6, "0")}`, seq, ts, ...msg });
  };

  for (let round = 1; round <= rounds; round += 1) {
    // 1) 用户消息
    const userText = synthText(rng, pick(rng, USER_TOPICS), 60, 220);
    push({
      round,
      role: "user",
      text: userText,
      blocks: [{ type: "text", text: userText }],
      meta: { tokens: 40 + Math.floor(rng() * 120) },
    });

    const withTools = rng() < toolRatio;
    if (withTools) {
      // 2) 助手消息(带 tool_call 块,1~3 个调用)
      const nCalls = 1 + Math.floor(rng() * 3);
      const calls = [];
      for (let i = 0; i < nCalls; i += 1) {
        callSeq += 1;
        const name = pick(rng, TOOL_NAMES);
        calls.push({
          type: "tool_call",
          callId: `call-${String(callSeq).padStart(5, "0")}`,
          name,
          argsJson: JSON.stringify({
            path: `src/module-${(callSeq % 17) + 1}.ts`,
            pattern: `symbol_${(callSeq % 23) + 1}`,
            note: "合成参数",
          }),
        });
      }
      push({
        round,
        role: "assistant",
        text: "",
        blocks: calls,
        meta: { tokens: 20 + Math.floor(rng() * 60) },
      });
      // 3) 每个调用一条 tool_result
      for (const c of calls) {
        push({
          round,
          role: "tool",
          text: synthText(rng, `工具 ${c.name} 返回摘要`, 40, 160),
          blocks: [
            {
              type: "tool_result",
              callId: c.callId,
              ok: rng() > 0.05, // 约 5% 失败率,模拟真实工具输出
              bytes: 128 + Math.floor(rng() * 4096),
            },
          ],
          meta: { tokens: 10 + Math.floor(rng() * 80) },
        });
      }
      // 4) 助手收尾文本
      const tailText = synthText(rng, pick(rng, ASSISTANT_TAILS), 150, 600);
      push({
        round,
        role: "assistant",
        text: tailText,
        blocks: [{ type: "text", text: tailText }],
        meta: { tokens: 80 + Math.floor(rng() * 240) },
      });
    } else {
      // 2') 纯文本助手回复
      const replyText = synthText(rng, pick(rng, ASSISTANT_TAILS), 150, 600);
      push({
        round,
        role: "assistant",
        text: replyText,
        blocks: [{ type: "text", text: replyText }],
        meta: { tokens: 80 + Math.floor(rng() * 240) },
      });
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    id: `sess-poc-${seed}-${rounds}`,
    createdAt: new Date(ts).toISOString(),
    params: { rounds, toolRatio, seed },
    rounds,
    messageCount: messages.length,
    messages,
  };
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function runGenerate(opts) {
  const outDir = resolve(opts.out);
  mkdirSync(outDir, { recursive: true });
  const fixture = generateFixture(opts);
  const json = JSON.stringify(fixture, null, 2);
  const buf = Buffer.from(json, "utf8");
  const fixturePath = join(outDir, FIXTURE_NAME);
  writeFileSync(fixturePath, buf);

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    tool: "session-fixtures.mjs",
    generatedAt: new Date().toISOString(),
    params: { rounds: opts.rounds, toolRatio: opts.toolRatio, seed: opts.seed },
    files: [
      {
        name: FIXTURE_NAME,
        bytes: buf.byteLength,
        sha256: sha256(buf),
        messageCount: fixture.messageCount,
        rounds: fixture.rounds,
      },
    ],
  };
  const manifestPath = join(outDir, MANIFEST_NAME);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // 生成后立即自检
  const selfCheck = runVerify(outDir);
  return {
    mode: "generate",
    ok: selfCheck.ok,
    outDir,
    fixturePath,
    manifestPath,
    rounds: opts.rounds,
    messageCount: fixture.messageCount,
    bytes: buf.byteLength,
    sha256: manifest.files[0].sha256,
    verify: selfCheck,
  };
}

// ---------------------------------------------------------------------------
// 自检(--verify)
// ---------------------------------------------------------------------------
function runVerify(outDirIn) {
  const outDir = resolve(outDirIn);
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail: String(detail) });

  const manifestPath = join(outDir, MANIFEST_NAME);
  let manifest = null;
  add("manifest 存在", existsSync(manifestPath), manifestPath);
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      add("manifest 可解析", true, "JSON ok");
    } catch (e) {
      add("manifest 可解析", false, e.message);
    }
  }

  if (!manifest) {
    return finalize(checks);
  }

  for (const f of manifest.files || []) {
    const p = join(outDir, f.name);
    const exists = existsSync(p);
    add(`文件存在: ${f.name}`, exists, p);
    if (!exists) continue;

    const buf = readFileSync(p);
    add(`字节数一致: ${f.name}`, buf.byteLength === f.bytes, `actual=${buf.byteLength} expected=${f.bytes}`);
    add(`sha256 一致: ${f.name}`, sha256(buf) === f.sha256, `sha256=${sha256(buf).slice(0, 16)}…`);

    let data = null;
    try {
      data = JSON.parse(buf.toString("utf8"));
      add(`JSON 可解析: ${f.name}`, true, `bytes=${buf.byteLength}`);
    } catch (e) {
      add(`JSON 可解析: ${f.name}`, false, e.message);
      continue;
    }

    add("schemaVersion 正确", data.schemaVersion === SCHEMA_VERSION, data.schemaVersion);
    const msgs = Array.isArray(data.messages) ? data.messages : [];
    add("messages 为数组", Array.isArray(data.messages), `count=${msgs.length}`);

    // 数量一致性
    add("messageCount 一致", data.messageCount === msgs.length, `declared=${data.messageCount} actual=${msgs.length}`);
    add("rounds 一致", data.rounds === f.rounds && data.params?.rounds === data.rounds, `rounds=${data.rounds}`);
    add("manifest messageCount 一致", f.messageCount === msgs.length, `manifest=${f.messageCount}`);

    // seq 连续且严格递增(1..N)
    let seqOk = msgs.length > 0;
    for (let i = 0; i < msgs.length; i += 1) {
      if (msgs[i].seq !== i + 1) { seqOk = false; break; }
    }
    add("seq 连续且严格递增(1..N)", seqOk, `first=${msgs[0]?.seq} last=${msgs[msgs.length - 1]?.seq}`);

    // id 唯一
    const ids = new Set(msgs.map((m) => m.id));
    add("id 唯一", ids.size === msgs.length, `unique=${ids.size}/${msgs.length}`);

    // ts 非递减
    let tsOk = true;
    for (let i = 1; i < msgs.length; i += 1) {
      if (msgs[i].ts < msgs[i - 1].ts) { tsOk = false; break; }
    }
    add("ts 非递减", tsOk, `first=${msgs[0]?.ts} last=${msgs[msgs.length - 1]?.ts}`);

    // role 合法
    const ROLES = new Set(["user", "assistant", "tool"]);
    add("role 合法", msgs.every((m) => ROLES.has(m.role)), [...new Set(msgs.map((m) => m.role))].join(","));

    // 每轮至少 1 user + 1 assistant,轮号覆盖 1..rounds
    const byRound = new Map();
    for (const m of msgs) {
      if (!byRound.has(m.round)) byRound.set(m.round, { user: 0, assistant: 0, tool: 0 });
      byRound.get(m.round)[m.role] += 1;
    }
    let roundsOk = true;
    let badRound = -1;
    for (let r = 1; r <= data.rounds; r += 1) {
      const t = byRound.get(r);
      if (!t || t.user < 1 || t.assistant < 1) { roundsOk = false; badRound = r; break; }
    }
    add("每轮 ≥1 user + ≥1 assistant", roundsOk, roundsOk ? `rounds=${data.rounds}` : `badRound=${badRound}`);
    add("轮号覆盖 1..rounds", byRound.size === data.rounds, `distinct=${byRound.size}/${data.rounds}`);

    // tool_call ↔ tool_result 一一配对
    const callIds = new Map(); // callId -> round
    const resultIds = new Map();
    for (const m of msgs) {
      for (const b of m.blocks || []) {
        if (b.type === "tool_call") callIds.set(b.callId, m.round);
        if (b.type === "tool_result") resultIds.set(b.callId, m.round);
      }
    }
    let pairOk = callIds.size === resultIds.size;
    let pairDetail = `calls=${callIds.size} results=${resultIds.size}`;
    if (pairOk) {
      for (const [cid, r] of callIds) {
        if (resultIds.get(cid) !== r) { pairOk = false; pairDetail = `unpaired callId=${cid}`; break; }
      }
    }
    add("tool_call ↔ tool_result 一一配对", pairOk, pairDetail);

    // 生成参数自洽
    add("params 与声明一致", data.params?.rounds === data.rounds && typeof data.params?.toolRatio === "number", JSON.stringify(data.params));
  }

  return finalize(checks);
}

function finalize(checks) {
  const failures = checks.filter((c) => !c.ok);
  return {
    ok: failures.length === 0,
    total: checks.length,
    passed: checks.length - failures.length,
    failed: failures.length,
    checks,
    failures,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function main() {
  const { values } = parseArgs({
    options: {
      out: { type: "string", default: join(__dirname, "fixtures") },
      rounds: { type: "string", default: "500" },
      "tool-ratio": { type: "string", default: "0.4" },
      seed: { type: "string", default: "42" },
      verify: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(
      [
        "用法:",
        "  node scripts/poc/session-fixtures.mjs --out <dir> [--rounds 500] [--tool-ratio 0.4] [--seed 42]",
        "  node scripts/poc/session-fixtures.mjs --verify --out <dir>",
        "",
        "生成 500 轮合成会话夹具(session.json + manifest.json),或自检已有夹具完整性。",
      ].join("\n")
    );
    return 0;
  }

  const out = values.out;
  if (values.verify) {
    const report = runVerify(out);
    console.log(JSON.stringify({ mode: "verify", out: resolve(out), ...report }, null, 2));
    return report.ok ? 0 : 1;
  }

  const rounds = Number(values.rounds);
  const toolRatio = Number(values["tool-ratio"]);
  const seed = Number(values.seed);
  if (!Number.isInteger(rounds) || rounds < 1) {
    console.error(`无效 --rounds: ${values.rounds}`);
    return 2;
  }
  if (!(toolRatio >= 0 && toolRatio <= 1)) {
    console.error(`无效 --tool-ratio: ${values["tool-ratio"]}`);
    return 2;
  }
  if (!Number.isInteger(seed)) {
    console.error(`无效 --seed: ${values.seed}`);
    return 2;
  }

  const result = runGenerate({ out, rounds, toolRatio, seed });
  console.log(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 1;
}

process.exit(main());
