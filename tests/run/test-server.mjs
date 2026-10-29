/**
 * FR-4 hba-run server integration test (node:test, zero dependencies).
 *
 * Spawns plugins/hba-run/server.mjs and drives it over real MCP stdio
 * JSON-RPC 2.0 (newline-delimited):
 *   config CRUD (+ .hba/run.json persistence on disk)
 *   -> run_start with a real long-running command
 *   -> run_output streaming
 *   -> run_stop with process-tree termination verification
 *   -> run_history records
 *   -> resource reads and tool validation errors.
 *
 * Run: node --test tests/run/test-server.mjs
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, "..", "..", "plugins", "hba-run", "server.mjs");

const TICK_CMD =
  'node -e "console.log(\'PID=\'+process.pid);setInterval(()=>console.log(\'tick\'),100)"';
const DONE_CMD = 'node -e "console.log(\'done\')"';
const FAIL_CMD = 'node -e "process.exit(3)"';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(fn, { timeout = 15000, interval = 100, desc = "condition" } = {}) {
  const deadline = Date.now() + timeout;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      lastErr = e;
    }
    await sleep(interval);
  }
  throw new Error(`timeout waiting for ${desc}${lastErr ? ` (last error: ${lastErr.message})` : ""}`);
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Minimal MCP stdio JSON-RPC 2.0 client. */
class RpcClient {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.pending = new Map();
    this.notifications = [];
    this.stderrLog = "";
    let buf = "";
    child.stdout.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        const hasId = msg.id !== undefined && msg.id !== null;
        if (hasId && (msg.result !== undefined || msg.error !== undefined)) {
          const p = this.pending.get(msg.id);
          if (p) {
            this.pending.delete(msg.id);
            clearTimeout(p.timer);
            if (msg.error) p.reject(new Error(msg.error.message || "JSON-RPC error"));
            else p.resolve(msg.result);
          }
        } else if (typeof msg.method === "string") {
          this.notifications.push(msg);
        }
      }
    });
    child.stderr.on("data", (d) => {
      this.stderrLog += d.toString();
    });
  }

  request(method, params, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout waiting for response to ${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params: params || {} }) + "\n");
    });
  }

  async callTool(name, args, timeout) {
    const result = await this.request("tools/call", { name, arguments: args || {} }, timeout);
    return result;
  }

  /** tools/call wrapper that unwraps structuredContent and asserts success. */
  async toolOk(name, args, timeout) {
    const result = await this.callTool(name, args, timeout);
    assert.equal(result.isError, undefined, `tool ${name} unexpectedly failed: ${JSON.stringify(result)}`);
    return result.structuredContent ?? result;
  }
}

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

let tmpWs; // temp workspace root
let child; // server process
let rpc;
const runIds = {}; // named run ids for later assertions
let tickInnerPid = null;

before(async () => {
  tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), "hba-run-test-"));
  child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, ZCODE_WORKSPACE_ROOT: tmpWs },
    stdio: ["pipe", "pipe", "pipe"]
  });
  rpc = new RpcClient(child);
  const init = await rpc.request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "hba-run-test", version: "0.0.0" }
  });
  assert.equal(init.serverInfo.name, "hba-run");
  rpc.child.stdin.write(
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n"
  );
});

after(async () => {
  try {
    if (child && child.exitCode === null) {
      child.stdin.end();
      const exited = await Promise.race([
        new Promise((r) => child.once("exit", () => r(true))),
        sleep(3000).then(() => false)
      ]);
      if (!exited) {
        child.kill();
        await sleep(300);
      }
    }
    // give Windows a moment to release file handles (taskkill, pipes, AV scans)
    await sleep(200);
  } finally {
    if (tmpWs && fs.existsSync(tmpWs)) {
      // retry: Windows can transiently lock the temp dir right after process exit
      for (let i = 0; i < 10; i++) {
        try {
          fs.rmSync(tmpWs, { recursive: true, force: true });
          break;
        } catch (e) {
          if (i === 9) throw e;
          await sleep(250);
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Tests (sequential)
// ---------------------------------------------------------------------------

test("initialize handshake negotiates protocol and advertises tools + resources", async () => {
  const toolsRes = await rpc.request("tools/list", {});
  const names = toolsRes.tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "run_config_delete",
    "run_config_duplicate",
    "run_config_list",
    "run_config_save",
    "run_history",
    "run_output",
    "run_start",
    "run_status",
    "run_stop",
    "run_ui_state"
  ]);

  for (const t of toolsRes.tools) {
    assert.equal(t._meta.ui.resourceUri, "ui://run/panel.html", `tool ${t.name} should surface to the panel`);
    assert.equal(t._meta.ui.surface, "hba-run");
    assert.ok(t.inputSchema && t.inputSchema.type === "object");
    assert.ok(typeof t.description === "string" && t.description.length > 0);
  }

  const resources = await rpc.request("resources/list", {});
  const uris = resources.resources.map((r) => r.uri).sort();
  assert.deepEqual(uris, ["ui://run/panel.html", "ui://run/state"]);
});

test("resources/read serves panel.html with mcp-app mime type", async () => {
  const res = await rpc.request("resources/read", { uri: "ui://run/panel.html" });
  const content = res.contents[0];
  assert.equal(content.mimeType, "text/html;profile=mcp-app");
  assert.ok(content.text.includes("HBA 运行面板"), "panel.html should contain the panel title");
  assert.ok(content.text.includes("Bridge"), "panel.html should contain the bridge adapter");
  assert.ok(content.text.includes("run_config_save"), "panel should talk to run tools");
});

test("config CRUD is persisted to .hba/run.json", async () => {
  // create
  const created = await rpc.toolOk("run_config_save", {
    name: "dev server",
    command: "npm run dev",
    cwd: "packages/app",
    env: { PORT: "5173", NODE_ENV: "development" },
    previewUrl: "http://localhost:5173"
  });
  const cfgId = created.config.id;
  assert.ok(cfgId.startsWith("cfg-"), "config id should be generated");
  assert.equal(created.config.name, "dev server");
  assert.equal(created.config.env.PORT, "5173");

  // persisted on disk
  const runJsonPath = path.join(tmpWs, ".hba", "run.json");
  const onDisk = JSON.parse(fs.readFileSync(runJsonPath, "utf8"));
  assert.equal(onDisk.configs.length, 1);
  assert.equal(onDisk.configs[0].name, "dev server");
  assert.equal(onDisk.configs[0].command, "npm run dev");
  assert.equal(onDisk.configs[0].cwd, "packages/app");
  assert.deepEqual(onDisk.configs[0].env, { PORT: "5173", NODE_ENV: "development" });
  assert.equal(onDisk.configs[0].previewUrl, "http://localhost:5173");

  // list
  const listed = await rpc.toolOk("run_config_list", {});
  assert.equal(listed.configs.length, 1);

  // update
  const updated = await rpc.toolOk("run_config_save", {
    id: cfgId,
    name: "dev server v2",
    command: "npm run dev",
    cwd: "packages/app",
    env: { PORT: "5174" },
    previewUrl: "http://localhost:5174"
  });
  assert.equal(updated.config.id, cfgId);
  assert.equal(updated.config.name, "dev server v2");
  const onDisk2 = JSON.parse(fs.readFileSync(runJsonPath, "utf8"));
  assert.equal(onDisk2.configs.length, 1);
  assert.equal(onDisk2.configs[0].name, "dev server v2");
  assert.equal(onDisk2.configs[0].env.PORT, "5174");
  assert.equal(onDisk2.configs[0].env.NODE_ENV, undefined);

  // duplicate
  const dup = await rpc.toolOk("run_config_duplicate", { configId: cfgId });
  assert.notEqual(dup.config.id, cfgId);
  assert.equal(dup.config.name, "dev server v2 (copy)");
  assert.equal(dup.config.env.PORT, "5174");

  // delete the copy
  await rpc.toolOk("run_config_delete", { configId: dup.config.id });
  const listed2 = await rpc.toolOk("run_config_list", {});
  assert.equal(listed2.configs.length, 1);
  assert.equal(listed2.configs[0].id, cfgId);
  const onDisk3 = JSON.parse(fs.readFileSync(runJsonPath, "utf8"));
  assert.equal(onDisk3.configs.length, 1);
});

test("run_start streams output, run_output cursors, run_stop kills the process tree", async () => {
  const cfg = await rpc.toolOk("run_config_save", {
    name: "ticker",
    command: TICK_CMD,
    cwd: ".",
    env: { HBA_TEST_ENV: "42" },
    previewUrl: "http://localhost:5199"
  });
  const started = await rpc.toolOk("run_start", { configId: cfg.config.id });
  const runId = started.run.runId;
  runIds.tick = runId;
  assert.ok(runId.startsWith("run-"), "runId should be generated");
  assert.equal(started.run.state, "running");
  assert.ok(typeof started.run.pid === "number" && started.run.pid > 0, "server-side shell pid");

  // stream output until we have the inner pid and a few ticks
  const acc = [];
  const found = await waitFor(
    async () => {
      const out = await rpc.toolOk("run_output", { runId, since: acc.length ? acc[acc.length - 1].seq : 0 });
      acc.push(...out.lines);
      const pidLine = acc.find((l) => /^PID=\d+$/.test(l.text));
      const ticks = acc.filter((l) => l.text === "tick").length;
      if (pidLine && ticks >= 2) return true;
      return false;
    },
    { desc: "tick output", timeout: 15000 }
  );
  assert.ok(found);
  tickInnerPid = Number(acc.find((l) => /^PID=\d+$/.test(l.text)).text.slice(4));
  assert.ok(tickInnerPid > 0);
  assert.ok(isAlive(tickInnerPid), "inner process should be alive while running");

  // cursor semantics: replaying with the newest seq returns nothing new
  const lastSeq = acc[acc.length - 1].seq;
  const empty = await rpc.toolOk("run_output", { runId, since: lastSeq });
  assert.equal(empty.lines.length, 0);
  assert.ok(empty.nextSince >= lastSeq);
  const fromZero = await rpc.toolOk("run_output", { runId, since: 0 });
  assert.ok(fromZero.lines.length >= acc.length, "since=0 must return the buffered history");

  // env must have reached the child: HBA_TEST_ENV=42 is visible in the run env;
  // verify via a fresh probe command instead (the ticker does not print env).
  const statusRunning = await rpc.toolOk("run_status", { runId });
  assert.equal(statusRunning.run.state, "running");

  // stop with a short grace period -> force tree kill kicks in fast
  await rpc.toolOk("run_stop", { runId, timeoutMs: 400 });
  const finished = await waitFor(
    async () => {
      const s = await rpc.toolOk("run_status", { runId });
      return s.run.state !== "running" ? s.run : false;
    },
    { desc: "run to finish after run_stop" }
  );
  assert.equal(finished.state, "exited", "user-initiated stop is not a failure");
  assert.equal(finished.stopped, true);
  assert.ok(finished.endedAt, "endedAt should be set");

  // the whole tree must be gone: the inner node process has to be dead
  const treeDead = await waitFor(() => !isAlive(tickInnerPid), { desc: "process tree death", timeout: 8000 });
  assert.ok(treeDead, `inner pid ${tickInnerPid} should be dead after run_stop`);
});

test("environment variables reach the spawned process", async () => {
  const cfg = await rpc.toolOk("run_config_save", {
    name: "env probe",
    command: 'node -e "console.log(\'ENV=\'+process.env.HBA_TEST_ENV)"',
    env: { HBA_TEST_ENV: "hello-env" }
  });
  const started = await rpc.toolOk("run_start", { configId: cfg.config.id });
  const runId = started.run.runId;
  runIds.env = runId;
  const lines = await waitFor(
    async () => {
      const out = await rpc.toolOk("run_output", { runId, since: 0 });
      return out.lines.some((l) => l.text === "ENV=hello-env") ? out.lines : false;
    },
    { desc: "env probe output" }
  );
  assert.ok(lines.some((l) => l.text === "ENV=hello-env"));
});

test("natural exit -> state exited/exitCode 0; non-zero exit -> state failed", async () => {
  const okCfg = await rpc.toolOk("run_config_save", { name: "quick ok", command: DONE_CMD });
  const okRun = await rpc.toolOk("run_start", { configId: okCfg.config.id });
  runIds.done = okRun.run.runId;

  const failCfg = await rpc.toolOk("run_config_save", { name: "quick fail", command: FAIL_CMD });
  const failRun = await rpc.toolOk("run_start", { configId: failCfg.config.id });
  runIds.fail = failRun.run.runId;

  // both concurrently
  const okFinal = await waitFor(
    async () => {
      const s = await rpc.toolOk("run_status", { runId: okRun.run.runId });
      return s.run.state !== "running" ? s.run : false;
    },
    { desc: "ok run to exit" }
  );
  assert.equal(okFinal.state, "exited");
  assert.equal(okFinal.exitCode, 0);
  assert.equal(okFinal.stopped, false);

  const failFinal = await waitFor(
    async () => {
      const s = await rpc.toolOk("run_status", { runId: failRun.run.runId });
      return s.run.state !== "running" ? s.run : false;
    },
    { desc: "fail run to exit" }
  );
  assert.equal(failFinal.state, "failed");
  assert.equal(failFinal.exitCode, 3);

  const out = await rpc.toolOk("run_output", { runId: okRun.run.runId, since: 0 });
  assert.ok(out.lines.some((l) => l.text === "done"));
});

test("multiple concurrent runs are tracked independently", async () => {
  const cfgs = [];
  for (const name of ["conc a", "conc b"]) {
    cfgs.push(await rpc.toolOk("run_config_save", { name, command: TICK_CMD }));
  }
  const started = [];
  for (const c of cfgs) {
    started.push(await rpc.toolOk("run_start", { configId: c.config.id }));
  }
  const all = await rpc.toolOk("run_status", {});
  const live = all.runs.filter((r) => r.state === "running");
  assert.ok(live.length >= 2, "both concurrent runs should be running");

  // collect each run's inner pid from its output before stopping
  const innerPids = [];
  for (const s of started) {
    await waitFor(
      async () => {
        const out = await rpc.toolOk("run_output", { runId: s.run.runId, since: 0 });
        const pidLine = out.lines.find((l) => /^PID=\d+$/.test(l.text));
        if (pidLine) {
          innerPids.push(Number(pidLine.text.slice(4)));
          return true;
        }
        return false;
      },
      { desc: `inner pid of ${s.run.runId}` }
    );
  }

  for (const s of started) {
    await rpc.toolOk("run_stop", { runId: s.run.runId, timeoutMs: 400 });
  }
  await waitFor(
    async () => {
      const st = await rpc.toolOk("run_status", {});
      const ids = started.map((s) => s.run.runId);
      const mine = st.runs.filter((r) => ids.includes(r.runId));
      return mine.length === 2 && mine.every((r) => r.state !== "running");
    },
    { desc: "both concurrent runs to stop" }
  );

  // every process tree must be gone
  for (const pid of innerPids) {
    const dead = await waitFor(() => !isAlive(pid), { desc: `tree death of pid ${pid}`, timeout: 8000 });
    assert.ok(dead, `inner pid ${pid} should be dead after run_stop`);
  }
});

test("run_history records command, timestamps, exit code and output", async () => {
  const res = await rpc.toolOk("run_history", { limit: 50 });
  const history = res.history;
  assert.ok(history.length >= 3, `expected >= 3 history entries, got ${history.length}`);

  const byName = (n) => history.find((h) => h.configName === n);

  const tickEntry = byName("ticker");
  assert.ok(tickEntry, "ticker run should be in history");
  assert.equal(tickEntry.stopped, true);
  assert.equal(tickEntry.state, "exited");
  assert.ok(tickEntry.startedAt && tickEntry.endedAt);
  assert.ok(tickEntry.outputLines > 0, "history entry should carry stored output");

  const doneEntry = byName("quick ok");
  assert.ok(doneEntry, "quick ok run should be in history");
  assert.equal(doneEntry.state, "exited");
  assert.equal(doneEntry.exitCode, 0);

  const failEntry = byName("quick fail");
  assert.ok(failEntry, "quick fail run should be in history");
  assert.equal(failEntry.state, "failed");
  assert.equal(failEntry.exitCode, 3);

  // historical output is retrievable through run_output
  const histOut = await rpc.toolOk("run_output", { runId: doneEntry.id, since: 0 });
  assert.ok(histOut.lines.some((l) => l.text === "done"));
  const tickOut = await rpc.toolOk("run_output", { runId: tickEntry.id, since: 0 });
  assert.ok(tickOut.lines.some((l) => l.text === "tick"));

  // history is persisted in .hba/run.json
  const onDisk = JSON.parse(fs.readFileSync(path.join(tmpWs, ".hba", "run.json"), "utf8"));
  assert.ok(Array.isArray(onDisk.history) && onDisk.history.length >= 3);
  const diskTick = onDisk.history.find((h) => h.configName === "ticker");
  assert.ok(diskTick.output.some((l) => l.text === "tick"));
});

test("resources/read ui://run/state returns a JSON snapshot", async () => {
  const res = await rpc.request("resources/read", { uri: "ui://run/state" });
  const snapshot = JSON.parse(res.contents[0].text);
  assert.equal(res.contents[0].mimeType, "application/json");
  assert.ok(Array.isArray(snapshot.configs));
  assert.ok(Array.isArray(snapshot.runs));
  assert.ok(typeof snapshot.historyCount === "number" && snapshot.historyCount >= 3);
  assert.equal(
    path.resolve(snapshot.workspaceRoot).toLowerCase(),
    path.resolve(tmpWs).toLowerCase()
  );
});

test("resources/subscribe enables notifications/resources/updated", async () => {
  const before = rpc.notifications.length;
  await rpc.request("resources/subscribe", { uri: "ui://run/state" });
  const cfg = await rpc.toolOk("run_config_save", { name: "notify probe", command: DONE_CMD });
  await rpc.toolOk("run_start", { configId: cfg.config.id });
  const got = await waitFor(
    () =>
      rpc.notifications
        .slice(before)
        .some((n) => n.method === "notifications/resources/updated" && n.params.uri === "ui://run/state"),
    { desc: "resources/updated notification" }
  );
  assert.ok(got);
  await rpc.request("resources/unsubscribe", { uri: "ui://run/state" });
});

test("tool validation errors surface as isError results", async () => {
  const noCommand = await rpc.callTool("run_config_save", { name: "x" });
  assert.equal(noCommand.isError, true);

  const noName = await rpc.callTool("run_config_save", { command: "echo hi" });
  assert.equal(noName.isError, true);

  const badConfig = await rpc.callTool("run_start", { configId: "cfg-does-not-exist" });
  assert.equal(badConfig.isError, true);

  const badRun = await rpc.callTool("run_stop", { runId: "run-does-not-exist" });
  assert.equal(badRun.isError, true);

  const badOutput = await rpc.callTool("run_output", { runId: "run-does-not-exist" });
  assert.equal(badOutput.isError, true);

  // unknown method -> JSON-RPC error, server stays alive
  await assert.rejects(() => rpc.request("no/such/method", {}), /Method not found/);
  const alive = await rpc.request("ping", {});
  assert.deepEqual(alive, {});
});

test("run_ui_state persists panel UI state to .hba/run-ui-state.json", async () => {
  // 未保存过时读到 null
  const empty = await rpc.toolOk("run_ui_state", {});
  assert.equal(empty.state, null);

  const saved = await rpc.toolOk("run_ui_state", {
    state: { selectedConfigId: "cfg-x", currentRunId: "run-y", autoScroll: false, asideCollapsed: true }
  });
  assert.ok(saved.updatedAt, "set should report updatedAt");
  assert.ok(saved.bytes > 0);

  const back = await rpc.toolOk("run_ui_state", {});
  assert.deepEqual(back.state, {
    selectedConfigId: "cfg-x",
    currentRunId: "run-y",
    autoScroll: false,
    asideCollapsed: true
  });

  // 落盘可验证(项目级共享的依据)
  const onDisk = JSON.parse(fs.readFileSync(path.join(tmpWs, ".hba", "run-ui-state.json"), "utf8"));
  assert.deepEqual(onDisk, back.state);

  // 覆盖写 + 非法参数
  await rpc.toolOk("run_ui_state", { state: { autoScroll: true } });
  const overwritten = await rpc.toolOk("run_ui_state", {});
  assert.deepEqual(overwritten.state, { autoScroll: true });

  const badArray = await rpc.callTool("run_ui_state", { state: [1, 2] });
  assert.equal(badArray.isError, true);
});
