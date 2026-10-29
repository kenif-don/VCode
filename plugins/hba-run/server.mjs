#!/usr/bin/env node
/**
 * hba-run MCP server (FR-4) — zero-dependency, hand-written MCP stdio JSON-RPC 2.0.
 *
 * Wire format: newline-delimited JSON-RPC 2.0 over stdin/stdout (MCP stdio transport).
 * Implements: initialize, ping, tools/list, tools/call, resources/list,
 * resources/templates/list, resources/read, resources/subscribe, resources/unsubscribe,
 * plus the notification side (notifications/resources/updated).
 *
 * Tools: run_config_list / run_config_save / run_config_delete / run_config_duplicate /
 *        run_start / run_stop / run_status / run_output / run_history
 *
 * Config + history persistence: <workspace>/.hba/run.json
 * Workspace root: $ZCODE_WORKSPACE_ROOT (set by plugin.json), fallback process.cwd().
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SERVER_NAME = "hba-run";
const SERVER_VERSION = "0.1.0";
const PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"];

const SURFACE_ID = "hba-run";
const PANEL_URI = "ui://run/panel.html";
const STATE_URI = "ui://run/state";
const HTML_MIME = "text/html;profile=mcp-app";

const IS_WIN = process.platform === "win32";
const WORKSPACE_ROOT = path.resolve(
  process.env.ZCODE_WORKSPACE_ROOT || process.env.HBA_WORKSPACE_ROOT || process.cwd()
);
const HBA_DIR = path.join(WORKSPACE_ROOT, ".hba");
const RUN_JSON_PATH = path.join(HBA_DIR, "run.json");
const UI_STATE_PATH = path.join(HBA_DIR, "run-ui-state.json");

const RING_BUFFER_LINES = 2000; // live output ring buffer per run
const HISTORY_OUTPUT_LINES = 500; // persisted output lines per history entry
const HISTORY_MAX_ENTRIES = 50;
const DEFAULT_STOP_GRACE_MS = 2000;
const MAX_STOP_GRACE_MS = 30000;
const OUTPUT_NOTIFY_THROTTLE_MS = 120;

// ---------------------------------------------------------------------------
// Store: .hba/run.json  { version, configs[], history[] }
// ---------------------------------------------------------------------------

const store = { version: 1, configs: [], history: [] };

function loadStore() {
  try {
    const raw = fs.readFileSync(RUN_JSON_PATH, "utf8");
    const data = JSON.parse(raw);
    if (data && typeof data === "object") {
      if (Array.isArray(data.configs)) store.configs = data.configs;
      if (Array.isArray(data.history)) store.history = data.history;
      if (typeof data.version === "number") store.version = data.version;
    }
  } catch {
    /* missing or corrupt file -> start empty */
  }
}

function saveStore() {
  fs.mkdirSync(HBA_DIR, { recursive: true });
  const tmp = RUN_JSON_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tmp, RUN_JSON_PATH); // atomic-ish on POSIX and Windows
}

loadStore();

// ---------------------------------------------------------------------------
// Panel UI state: <workspace>/.hba/run-ui-state.json — workspace-scoped so every
// session/window of the project shares one run-panel state (selected config,
// open run, autoscroll, sidebar). Read/written by the panel via run_ui_state.
// ---------------------------------------------------------------------------

function readUiStateFile() {
  try {
    const data = JSON.parse(fs.readFileSync(UI_STATE_PATH, "utf8"));
    if (data && typeof data === "object" && !Array.isArray(data)) return data;
  } catch {
    /* missing or corrupt file -> no saved state */
  }
  return null;
}

function writeUiStateFile(state) {
  fs.mkdirSync(HBA_DIR, { recursive: true });
  const tmp = UI_STATE_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(tmp, UI_STATE_PATH);
}

// ---------------------------------------------------------------------------
// Run manager
// ---------------------------------------------------------------------------

/** @type {Map<string, Run>} */
const runs = new Map();
let runCounter = 0;

function nowIso() {
  return new Date().toISOString();
}

function newRunId() {
  runCounter += 1;
  return `run-${Date.now().toString(36)}-${runCounter.toString(36)}`;
}

function newConfigId() {
  return `cfg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

class Run {
  constructor(config) {
    this.id = newRunId();
    this.configId = config.id;
    this.configName = config.name;
    this.command = config.command;
    this.cwd = config.cwd || "";
    this.env = config.env && typeof config.env === "object" ? { ...config.env } : {};
    this.previewUrl = config.previewUrl || "";
    this.state = "running"; // running | exited | failed
    this.pid = null;
    this.startedAt = nowIso();
    this.endedAt = null;
    this.exitCode = null;
    this.signal = null;
    this.stopped = false; // true when terminated via run_stop
    this.spawnError = null;
    this.lines = []; // ring buffer: { seq, stream, text }
    this.seq = 0;
    this.child = null;
    this.stopTimer = null;
    this.notifyTimer = null;
    this.partialStdout = "";
    this.partialStderr = "";
    this.exited = false;
  }

  appendLine(stream, text) {
    this.seq += 1;
    this.lines.push({ seq: this.seq, stream, text });
    if (this.lines.length > RING_BUFFER_LINES) {
      this.lines.splice(0, this.lines.length - RING_BUFFER_LINES);
    }
    this.scheduleNotify();
  }

  scheduleNotify() {
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      sendResourceUpdated();
    }, OUTPUT_NOTIFY_THROTTLE_MS);
    if (typeof this.notifyTimer.unref === "function") this.notifyTimer.unref();
  }

  snapshot() {
    return {
      runId: this.id,
      configId: this.configId,
      configName: this.configName,
      command: this.command,
      cwd: this.cwd,
      previewUrl: this.previewUrl,
      state: this.state,
      pid: this.pid,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      exitCode: this.exitCode,
      signal: this.signal,
      stopped: this.stopped,
      spawnError: this.spawnError,
      lineCount: this.seq
    };
  }
}

function resolveCwd(cwd) {
  if (!cwd) return WORKSPACE_ROOT;
  return path.isAbsolute(cwd) ? cwd : path.resolve(WORKSPACE_ROOT, cwd);
}

function startRun(config) {
  const run = new Run(config);
  const cwd = resolveCwd(config.cwd);
  const env = { ...process.env, ...run.env };

  let child;
  try {
    child = spawn(run.command, {
      cwd,
      env,
      shell: true, // run through the platform shell (cmd.exe on Windows)
      windowsHide: true,
      // On POSIX create a new process group so we can signal the whole tree.
      // On Windows detached would create a new console window -> do not use it;
      // the tree is terminated with `taskkill /T` instead.
      detached: !IS_WIN
    });
  } catch (err) {
    run.state = "failed";
    run.spawnError = String(err && err.message ? err.message : err);
    run.endedAt = nowIso();
    run.exitCode = null;
    run.appendLine("system", `[spawn error] ${run.spawnError}`);
    runs.set(run.id, run);
    finalizeRun(run);
    return run;
  }

  run.child = child;
  run.pid = child.pid ?? null;
  runs.set(run.id, run);
  run.appendLine("system", `[hba-run] started: ${run.command} (cwd: ${cwd}, pid: ${run.pid})`);

  const pump = (stream, run2, key) => (chunk) => {
    run2[key] += chunk.toString("utf8");
    let idx;
    while ((idx = run2[key].indexOf("\n")) >= 0) {
      const line = run2[key].slice(0, idx).replace(/\r$/, "");
      run2[key] = run2[key].slice(idx + 1);
      run2.appendLine(stream, line);
    }
  };
  child.stdout.on("data", pump("stdout", run, "partialStdout"));
  child.stderr.on("data", pump("stderr", run, "partialStderr"));

  child.on("error", (err) => {
    if (run.exited) return;
    run.spawnError = String(err && err.message ? err.message : err);
    run.appendLine("system", `[spawn error] ${run.spawnError}`);
    finishRun(run, null, null, "failed");
  });

  child.on("exit", (code, signal) => {
    // flush partial trailing lines
    if (run.partialStdout) {
      run.appendLine("stdout", run.partialStdout);
      run.partialStdout = "";
    }
    if (run.partialStderr) {
      run.appendLine("stderr", run.partialStderr);
      run.partialStderr = "";
    }
    let state;
    if (run.stopped) state = "exited"; // user-initiated stop is not a failure
    else if (signal) state = "failed";
    else state = code === 0 ? "exited" : "failed";
    finishRun(run, code, signal, state);
  });

  return run;
}

function finishRun(run, code, signal, state) {
  if (run.exited) return;
  run.exited = true;
  run.state = state;
  run.exitCode = code;
  run.signal = signal;
  run.endedAt = nowIso();
  if (run.stopTimer) {
    clearTimeout(run.stopTimer);
    run.stopTimer = null;
  }
  if (run.notifyTimer) {
    clearTimeout(run.notifyTimer);
    run.notifyTimer = null;
  }
  run.appendLine(
    "system",
    `[hba-run] finished: state=${state} exitCode=${code === null ? "null" : code} signal=${signal ?? "null"}`
  );
  finalizeRun(run);
}

function finalizeRun(run) {
  const entry = {
    id: run.id,
    configId: run.configId,
    configName: run.configName,
    command: run.command,
    cwd: run.cwd,
    env: run.env,
    previewUrl: run.previewUrl,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    exitCode: run.exitCode,
    signal: run.signal,
    state: run.state,
    stopped: run.stopped,
    spawnError: run.spawnError,
    output: run.lines.slice(-HISTORY_OUTPUT_LINES)
  };
  store.history.push(entry);
  if (store.history.length > HISTORY_MAX_ENTRIES) {
    store.history.splice(0, store.history.length - HISTORY_MAX_ENTRIES);
  }
  try {
    saveStore();
  } catch (err) {
    process.stderr.write(`[${SERVER_NAME}] failed to persist history: ${err}\n`);
  }
  sendResourceUpdated();
}

/**
 * Gracefully stop a run, then force-kill its whole process tree.
 * Windows: `taskkill /pid <pid> /T` (graceful WM_CLOSE) then `taskkill /pid <pid> /T /F`.
 * POSIX:   SIGTERM to the process group, then SIGKILL.
 */
function stopRun(run, graceMs = DEFAULT_STOP_GRACE_MS) {
  if (!run.child || run.exited) return;
  run.stopped = true;
  run.appendLine("system", `[hba-run] stopping (grace ${graceMs}ms)...`);

  const forceKill = () => {
    if (run.exited) return;
    run.appendLine("system", "[hba-run] grace period elapsed, force-killing process tree");
    killTree(run, true);
  };

  if (run.pid) {
    killTree(run, false);
    run.stopTimer = setTimeout(forceKill, graceMs);
    if (typeof run.stopTimer.unref === "function") run.stopTimer.unref();
  } else {
    try {
      run.child.kill("SIGKILL");
    } catch {
      /* already dead */
    }
  }
}

/**
 * Kill a process and all of its descendants. force=true -> uncatchable kill.
 *
 * Windows: `taskkill /pid <pid> /T` (WM_CLOSE-based, graceful-ish) and
 * `taskkill /pid <pid> /T /F` (force). The direct child is deliberately NOT
 * killed with child.kill() first: on Windows that would terminate only the
 * shell (cmd.exe), fire its 'exit' event and orphan the grandchildren before
 * taskkill can walk the tree. taskkill /T always targets the whole tree.
 *
 * POSIX: SIGTERM/SIGKILL to the process group (the child was spawned with
 * detached=true, so its pid is the group leader).
 */
function killTree(run, force) {
  const pid = run.pid;
  if (!pid) return;
  if (IS_WIN) {
    const args = ["/pid", String(pid), "/T"];
    if (force) args.push("/F");
    execFile("taskkill", args, { windowsHide: true }, (err) => {
      if (err && force) {
        // Last resort (e.g. taskkill missing): kill the direct child only.
        try {
          run.child.kill("SIGKILL");
        } catch {
          /* already dead */
        }
      }
    });
  } else {
    try {
      process.kill(-pid, force ? "SIGKILL" : "SIGTERM");
    } catch {
      try {
        run.child.kill(force ? "SIGKILL" : "SIGTERM");
      } catch {
        /* already dead */
      }
    }
  }
}

function killAllRuns() {
  for (const run of runs.values()) {
    if (!run.exited && run.child) {
      run.stopped = true;
      killTree(run, true);
    }
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC plumbing (newline-delimited over stdio)
// ---------------------------------------------------------------------------

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
function sendResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}
function sendError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}
function sendNotification(method, params) {
  send({ jsonrpc: "2.0", method, params });
}

const subscribedUris = new Set();
function sendResourceUpdated(uri = STATE_URI) {
  if (!subscribedUris.has(uri)) return;
  sendNotification("notifications/resources/updated", { uri });
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

function toolText(obj) {
  return JSON.stringify(obj, null, 2);
}

function ok(structured, text) {
  return {
    content: [{ type: "text", text: text ?? toolText(structured) }],
    structuredContent: structured
  };
}

function fail(message, structured = {}) {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
    structuredContent: { error: message, ...structured }
  };
}

function cleanConfigInput(input) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const command = typeof input.command === "string" ? input.command.trim() : "";
  if (!name) throw new Error("name is required");
  if (!command) throw new Error("command is required");
  const cwd = typeof input.cwd === "string" ? input.cwd.trim() : "";
  const previewUrl = typeof input.previewUrl === "string" ? input.previewUrl.trim() : "";
  let env = {};
  if (input.env != null) {
    if (typeof input.env !== "object" || Array.isArray(input.env)) {
      throw new Error("env must be an object of KEY -> value");
    }
    for (const [k, v] of Object.entries(input.env)) {
      if (!k) continue;
      env[k] = String(v);
    }
  }
  return { name, command, cwd, env, previewUrl };
}

function publicConfig(c) {
  return {
    id: c.id,
    name: c.name,
    command: c.command,
    cwd: c.cwd || "",
    env: c.env || {},
    previewUrl: c.previewUrl || "",
    createdAt: c.createdAt || null,
    updatedAt: c.updatedAt || null
  };
}

const TOOLS = [
  {
    name: "run_config_list",
    description: "List all saved run configurations (name, command, working directory, env vars, preview URL).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
    handler: async () => ok({ configs: store.configs.map(publicConfig) })
  },
  {
    name: "run_config_save",
    description:
      "Create or update a run configuration. Pass id to update an existing one, omit it to create a new one. Fields: name, command, cwd (absolute or relative to workspace root), env (KEY -> value map), previewUrl.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Existing config id to update; omit to create." },
        name: { type: "string", description: "Configuration display name." },
        command: { type: "string", description: "Shell command to run." },
        cwd: { type: "string", description: "Working directory; absolute or relative to the workspace root." },
        env: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Extra environment variables merged over the server environment."
        },
        previewUrl: { type: "string", description: "Preview URL to offer after a successful run." }
      },
      required: ["name", "command"],
      additionalProperties: false
    },
    readOnly: false,
    handler: async (input) => {
      let clean;
      try {
        clean = cleanConfigInput(input);
      } catch (err) {
        return fail(String(err.message || err));
      }
      const now = nowIso();
      if (input.id) {
        const idx = store.configs.findIndex((c) => c.id === input.id);
        if (idx < 0) return fail(`config not found: ${input.id}`);
        const prev = store.configs[idx];
        store.configs[idx] = { ...prev, ...clean, id: prev.id, createdAt: prev.createdAt, updatedAt: now };
        saveStore();
        sendResourceUpdated();
        return ok({ config: publicConfig(store.configs[idx]) }, `Updated config ${store.configs[idx].name}`);
      }
      const config = { id: newConfigId(), ...clean, createdAt: now, updatedAt: now };
      store.configs.push(config);
      saveStore();
      sendResourceUpdated();
      return ok({ config: publicConfig(config) }, `Created config ${config.name}`);
    }
  },
  {
    name: "run_config_delete",
    description: "Delete a run configuration by id. Historical run records are kept.",
    inputSchema: {
      type: "object",
      properties: { configId: { type: "string", description: "Config id to delete." } },
      required: ["configId"],
      additionalProperties: false
    },
    readOnly: false,
    handler: async ({ configId }) => {
      const idx = store.configs.findIndex((c) => c.id === configId);
      if (idx < 0) return fail(`config not found: ${configId}`);
      const [removed] = store.configs.splice(idx, 1);
      saveStore();
      sendResourceUpdated();
      return ok({ deleted: publicConfig(removed) }, `Deleted config ${removed.name}`);
    }
  },
  {
    name: "run_config_duplicate",
    description: "Duplicate a run configuration; the copy gets a new id and a '(copy)' name suffix unless name is given.",
    inputSchema: {
      type: "object",
      properties: {
        configId: { type: "string", description: "Config id to copy." },
        name: { type: "string", description: "Optional name for the copy." }
      },
      required: ["configId"],
      additionalProperties: false
    },
    readOnly: false,
    handler: async ({ configId, name }) => {
      const src = store.configs.find((c) => c.id === configId);
      if (!src) return fail(`config not found: ${configId}`);
      const now = nowIso();
      const copy = {
        ...publicConfig(src),
        id: newConfigId(),
        name: typeof name === "string" && name.trim() ? name.trim() : `${src.name} (copy)`,
        createdAt: now,
        updatedAt: now
      };
      store.configs.push(copy);
      saveStore();
      sendResourceUpdated();
      return ok({ config: publicConfig(copy) }, `Duplicated as ${copy.name}`);
    }
  },
  {
    name: "run_start",
    description:
      "Start a run of a saved configuration. Spawns the command (through the platform shell) and streams stdout/stderr into a ring buffer. Returns the runId used by run_output/run_status/run_stop.",
    inputSchema: {
      type: "object",
      properties: { configId: { type: "string", description: "Configuration id to run." } },
      required: ["configId"],
      additionalProperties: false
    },
    readOnly: false,
    handler: async ({ configId }) => {
      const config = store.configs.find((c) => c.id === configId);
      if (!config) return fail(`config not found: ${configId}`);
      const run = startRun(config);
      const snap = run.snapshot();
      if (run.state === "failed" && run.spawnError) return fail(`spawn failed: ${run.spawnError}`, { run: snap });
      sendResourceUpdated();
      return ok({ run: snap }, `Started run ${run.id} (pid ${run.pid})`);
    }
  },
  {
    name: "run_stop",
    description:
      "Stop a running process gracefully, then kill its whole process tree if it does not exit in time (Windows: taskkill /T /F; POSIX: SIGTERM then SIGKILL to the process group).",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Run id to stop." },
        timeoutMs: {
          type: "integer",
          minimum: 0,
          maximum: MAX_STOP_GRACE_MS,
          description: "Grace period before force-killing the tree (default 2000)."
        }
      },
      required: ["runId"],
      additionalProperties: false
    },
    readOnly: false,
    handler: async ({ runId, timeoutMs }) => {
      const run = runs.get(runId);
      if (!run) return fail(`run not found: ${runId}`);
      if (run.exited) return ok({ run: run.snapshot() }, `Run ${runId} already finished`);
      const grace =
        typeof timeoutMs === "number" && Number.isFinite(timeoutMs)
          ? Math.max(0, Math.min(MAX_STOP_GRACE_MS, Math.round(timeoutMs)))
          : DEFAULT_STOP_GRACE_MS;
      stopRun(run, grace);
      sendResourceUpdated();
      return ok({ run: run.snapshot() }, `Stopping run ${runId} (grace ${grace}ms)`);
    }
  },
  {
    name: "run_status",
    description: "Get the status of one run (by runId) or of all runs of this session.",
    inputSchema: {
      type: "object",
      properties: { runId: { type: "string", description: "Optional run id; omit for all runs." } },
      additionalProperties: false
    },
    readOnly: true,
    handler: async ({ runId }) => {
      if (runId) {
        const run = runs.get(runId);
        if (!run) return fail(`run not found: ${runId}`);
        return ok({ run: run.snapshot() });
      }
      return ok({ runs: [...runs.values()].map((r) => r.snapshot()) });
    }
  },
  {
    name: "run_output",
    description:
      "Fetch run output lines with a cursor: pass the last seen seq as `since` (0 for the beginning) to get lines after it. Works for live runs and for history entries.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Run id." },
        since: { type: "integer", minimum: 0, description: "Return lines with seq > since (default 0)." }
      },
      required: ["runId"],
      additionalProperties: false
    },
    readOnly: true,
    handler: async ({ runId, since }) => {
      const cursor = typeof since === "number" && Number.isFinite(since) && since >= 0 ? Math.floor(since) : 0;
      const run = runs.get(runId);
      if (run) {
        const lines = run.lines.filter((l) => l.seq > cursor);
        return ok({
          runId,
          state: run.state,
          lines,
          nextSince: run.seq,
          truncatedBefore: run.lines.length ? run.lines[0].seq : cursor + 1
        });
      }
      const entry = store.history.find((h) => h.id === runId);
      if (entry) {
        const all = entry.output || [];
        const lines = all.filter((l) => l.seq > cursor);
        return ok({
          runId,
          state: entry.state,
          lines,
          nextSince: all.length ? all[all.length - 1].seq : cursor,
          truncatedBefore: all.length ? all[0].seq : cursor + 1
        });
      }
      return fail(`run not found: ${runId}`);
    }
  },
  {
    name: "run_history",
    description:
      "List past runs (newest first): config name, command, start/end time, exit code, state, stopped flag, and stored output (capped).",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: HISTORY_MAX_ENTRIES, description: "Max entries (default 20)." }
      },
      additionalProperties: false
    },
    readOnly: true,
    handler: async ({ limit }) => {
      const n = typeof limit === "number" && Number.isFinite(limit) ? Math.max(1, Math.min(HISTORY_MAX_ENTRIES, Math.floor(limit))) : 20;
      const history = [...store.history].reverse().slice(0, n).map((e) => ({
        id: e.id,
        configId: e.configId,
        configName: e.configName,
        command: e.command,
        cwd: e.cwd,
        env: e.env,
        previewUrl: e.previewUrl,
        startedAt: e.startedAt,
        endedAt: e.endedAt,
        exitCode: e.exitCode,
        signal: e.signal,
        state: e.state,
        stopped: e.stopped,
        outputLines: (e.output || []).length
      }));
      return ok({ history });
    }
  },
  {
    name: "run_ui_state",
    description:
      "Internal panel-state store, shared by every session/window of this workspace (persisted to <workspace>/.hba/run-ui-state.json). Call with no arguments to read the saved run-panel UI state (null when never saved), or with `state` (a JSON object) to persist it. Not meant for agent use.",
    inputSchema: {
      type: "object",
      properties: {
        state: {
          type: "object",
          description: "Panel UI state to persist (free-form JSON object). Omit to read the current state."
        }
      },
      additionalProperties: false
    },
    readOnly: false,
    handler: async (input) => {
      if (input.state === undefined) {
        return ok({ state: readUiStateFile() });
      }
      const state = input.state;
      if (!state || typeof state !== "object" || Array.isArray(state)) {
        return fail("state must be a JSON object");
      }
      let serialized;
      try {
        serialized = JSON.stringify(state);
      } catch (err) {
        return fail(`state is not serializable: ${String(err && err.message ? err.message : err)}`);
      }
      try {
        writeUiStateFile(state);
      } catch (err) {
        return fail(`failed to persist ui state: ${String(err && err.message ? err.message : err)}`);
      }
      return ok({ updatedAt: nowIso(), bytes: Buffer.byteLength(serialized, "utf8"), file: UI_STATE_PATH });
    }
  }
];

const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

function toolDefinition(t) {
  return {
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { readOnlyHint: t.readOnly, idempotentHint: t.readOnly },
    _meta: {
      ui: {
        resourceUri: PANEL_URI,
        surface: SURFACE_ID,
        visibility: ["model", "app"]
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

function readPanelHtml() {
  const panelPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "ui", "panel.html");
  return fs.readFileSync(panelPath, "utf8");
}

function stateSnapshot() {
  return {
    workspaceRoot: WORKSPACE_ROOT,
    serverTime: nowIso(),
    configs: store.configs.map(publicConfig),
    runs: [...runs.values()].map((r) => r.snapshot()),
    historyCount: store.history.length,
    platform: process.platform
  };
}

const RESOURCES = [
  {
    uri: PANEL_URI,
    name: "Run Panel",
    description: "The hba-run panel UI (run configurations, run/stop, live output, history, preview).",
    mimeType: HTML_MIME
  },
  {
    uri: STATE_URI,
    name: "Run State",
    description: "JSON snapshot of run configurations, live runs and history; updated as runs produce output.",
    mimeType: "application/json"
  }
];

// ---------------------------------------------------------------------------
// Request dispatch
// ---------------------------------------------------------------------------

async function dispatch(method, params) {
  switch (method) {
    case "initialize": {
      const requested = params && typeof params.protocolVersion === "string" ? params.protocolVersion : null;
      return {
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: true, listChanged: false }
        },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions:
          "Run panel server. Manage run configs with run_config_* tools, start/stop processes with run_start/run_stop, read live output with run_output and past runs with run_history. The panel UI is served at " +
          PANEL_URI +
          "."
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS.map(toolDefinition) };
    case "tools/call": {
      const name = params && params.name;
      const tool = TOOLS_BY_NAME.get(name);
      if (!tool) throw rpcError(-32602, `Unknown tool: ${name}`);
      const input = params && params.arguments && typeof params.arguments === "object" ? params.arguments : {};
      try {
        return await tool.handler(input);
      } catch (err) {
        return fail(`${tool.name}: ${String(err && err.message ? err.message : err)}`);
      }
    }
    case "resources/list":
      return { resources: RESOURCES };
    case "resources/templates/list":
      return { resourceTemplates: [] };
    case "resources/read": {
      const uri = params && params.uri;
      if (uri === PANEL_URI) {
        return {
          contents: [
            {
              uri: PANEL_URI,
              mimeType: HTML_MIME,
              text: readPanelHtml(),
              _meta: { "zcode/csp": {} }
            }
          ]
        };
      }
      if (uri === STATE_URI) {
        return {
          contents: [{ uri: STATE_URI, mimeType: "application/json", text: JSON.stringify(stateSnapshot(), null, 2) }]
        };
      }
      throw rpcError(-32002, `Unknown resource: ${uri}`);
    }
    case "resources/subscribe": {
      const uri = params && params.uri;
      if (typeof uri !== "string" || !uri) throw rpcError(-32602, "uri is required");
      subscribedUris.add(uri);
      return {};
    }
    case "resources/unsubscribe": {
      const uri = params && params.uri;
      if (typeof uri !== "string" || !uri) throw rpcError(-32602, "uri is required");
      subscribedUris.delete(uri);
      return {};
    }
    default:
      throw rpcError(-32601, `Method not found: ${method}`);
  }
}

function rpcError(code, message) {
  const err = new Error(message);
  err.rpcCode = code;
  return err;
}

async function handleMessage(msg) {
  if (!msg || msg.jsonrpc !== "2.0") return;
  const { id, method, params } = msg;

  // notification (no id) — nothing to answer
  if (id === undefined || id === null) {
    if (method === "notifications/initialized" || method === "notifications/cancelled") return;
    return;
  }
  if (typeof method !== "string") {
    sendError(id, -32600, "Invalid request: method must be a string");
    return;
  }
  try {
    const result = await dispatch(method, params);
    sendResult(id, result);
  } catch (err) {
    sendError(id, typeof err.rpcCode === "number" ? err.rpcCode : -32603, String(err && err.message ? err.message : err));
  }
}

// stdin: newline-delimited JSON
let stdinBuf = "";
process.stdin.on("data", (chunk) => {
  stdinBuf += chunk.toString("utf8");
  let idx;
  while ((idx = stdinBuf.indexOf("\n")) >= 0) {
    const line = stdinBuf.slice(0, idx).trim();
    stdinBuf = stdinBuf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      sendError(null, -32700, "Parse error");
      continue;
    }
    handleMessage(msg);
  }
});

function shutdown() {
  killAllRuns();
  try {
    saveStore();
  } catch {
    /* best effort */
  }
  process.exit(0);
}
process.stdin.on("end", shutdown);
process.stdin.on("close", shutdown);
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("uncaughtException", (err) => {
  process.stderr.write(`[${SERVER_NAME}] uncaughtException: ${err && err.stack ? err.stack : err}\n`);
});

process.stderr.write(`[${SERVER_NAME}] ready (workspace: ${WORKSPACE_ROOT})\n`);

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
