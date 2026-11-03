"""Build fr19 patch by reconstructing pre-edit content via exact reverse swaps.

For each touched file, before-content = current tree content with fr19's edits
reversed (in reverse-edit order). Emits a git-style unified diff.
"""
import os, shutil, subprocess

ROOT = r"D:\ai_workspace\AI IDE\hba-zcode-fork"
BASE = r"D:\ai_workspace\AI IDE\hba-on-zcode\scratch"
BEFORE = os.path.join(BASE, "fr19-before")
AFTER = os.path.join(BASE, "fr19-after")
OUT = r"D:\ai_workspace\AI IDE\hba-on-zcode\fork\patches\fr19-01-plugin-ui-session-anchor-fallback-rebind.patch"

R = {}  # rel -> [(current_text, pre_edit_text), ...] applied in order

# ---------------- apps/zcode-cli/packages/bootstrap/src/zcode-protocol/server-types.ts
R["apps/zcode-cli/packages/bootstrap/src/zcode-protocol/server-types.ts"] = [
    # revert edit2 (fallback loop rewrite)
    ("""  // Map 迭代序 = 插入序，取最近创建的存活记录作代理。
  let fallback: ZCodeProtocolSessionRecord | undefined;
  let fallbackSessionId = "";
  for (const [id, candidate] of context.sessions) {
    fallback = candidate;
    fallbackSessionId = id;
  }
  if (fallback) {
    context.logger?.warn("VCode Protocol mcp-ui session anchor missing, using live record", {
      activeSessionCount: context.sessions.size,
      event: "zcode_protocol.session.mcp_ui_fallback",
      fallbackSessionId,
      module: "bootstrap.zcode_protocol",
      operation: options.operation ?? "unknown",
      sessionId,
    });
    return fallback;
  }""",
     """  // Map 迭代序 = 插入序，取最近创建的存活记录作代理。
  let fallback: ZCodeProtocolSessionRecord | undefined;
  for (const candidate of context.sessions.values()) fallback = candidate;
  if (fallback) {
    context.logger?.warn("VCode Protocol mcp-ui session anchor missing, using live record", {
      activeSessionCount: context.sessions.size,
      event: "zcode_protocol.session.mcp_ui_fallback",
      fallbackSessionId: fallback.sessionId,
      module: "bootstrap.zcode_protocol",
      operation: options.operation ?? "unknown",
      sessionId,
    });
    return fallback;
  }"""),
    # revert edit1 (append requireSessionForMcpUi + isSessionRecordLive)
    ("""

/**
 * mcp/ui* 面板调用的会话解析（HBA fr19）：项目级面板（surface）跟随项目而非创建会话，
 * 锚点会话被归档或删除后调用仍需送达。锚定会话缺失时回退到同一 CLI 内任一存活会话
 * 记录——插件 server 声明 isolation=workspace（fr11），连接池工作区级共享，任一存活
 * 记录的 app 都能到达同一 server。归属校验仍按请求自带的 sessionId/scopeId 在
 * mcpUiInstances 内完成，不因回退而放松；会话隔离（isolation=session）的 server 在
 * 锚点会话消失后本来就应失效，回退记录查不到其连接时照常拒绝。
 * 全部会话都不存在时仍失败（面板在完全无会话的工作区退化为不可用）。
 */
export function requireSessionForMcpUi(
  context: ZCodeProtocolAgentServerContext,
  sessionId: string,
  options: { deliveryKind?: ZCodeDeliveryKind; operation?: string } = {},
): ZCodeProtocolSessionRecord {
  const record = context.sessions.get(sessionId);
  if (record) return record;
  // Map 迭代序 = 插入序，取最近创建的存活记录作代理。
  let fallback: ZCodeProtocolSessionRecord | undefined;
  for (const candidate of context.sessions.values()) fallback = candidate;
  if (fallback) {
    context.logger?.warn("VCode Protocol mcp-ui session anchor missing, using live record", {
      activeSessionCount: context.sessions.size,
      event: "zcode_protocol.session.mcp_ui_fallback",
      fallbackSessionId: fallback.sessionId,
      module: "bootstrap.zcode_protocol",
      operation: options.operation ?? "unknown",
      sessionId,
    });
    return fallback;
  }
  return requireSession(context, sessionId, options);
}

/** record 是否仍是当前有效实例：直连记录按同一性判断；回退代理记录只要仍在活跃表即有效。 */
export function isSessionRecordLive(
  context: ZCodeProtocolAgentServerContext,
  sessionId: string,
  record: ZCodeProtocolSessionRecord,
): boolean {
  const current = context.sessions.get(sessionId);
  if (current !== undefined) return current === record;
  for (const candidate of context.sessions.values()) {
    if (candidate === record) return true;
  }
  return false;
}""", ""),
]

# ---------------- mcp-ui/protocol.ts
R["apps/zcode-cli/packages/bootstrap/src/zcode-protocol/mcp-ui/protocol.ts"] = [
    ("""  if (
    !isSessionRecordLive(context, params.sessionId, record) ||
    !source ||""",
     """  if (
    context.sessions.get(params.sessionId) !== record ||
    !source ||"""),
    ("""import {
  ProtocolRequestError,
  isSessionRecordLive,
  parseParams,
  requireSessionForMcpUi,
  type ZCodeProtocolAgentServerContext,
} from "../server-types.js";""",
     """import {
  ProtocolRequestError,
  parseParams,
  requireSession,
  type ZCodeProtocolAgentServerContext,
} from "../server-types.js";"""),
    ("requireSessionForMcpUi(context, params.sessionId,", "requireSession(context, params.sessionId,"),
]

# ---------------- mcp-ui/appToolsProtocol.ts
R["apps/zcode-cli/packages/bootstrap/src/zcode-protocol/mcp-ui/appToolsProtocol.ts"] = [
    ("""import {
  ProtocolRequestError,
  parseParams,
  requireSessionForMcpUi,
  type ZCodeProtocolAgentServerContext,
} from "../server-types.js";""",
     """import {
  ProtocolRequestError,
  parseParams,
  requireSession,
  type ZCodeProtocolAgentServerContext,
} from "../server-types.js";"""),
    ("requireSessionForMcpUi(context, params.sessionId,", "requireSession(context, params.sessionId,"),
]

# ---------------- mcp-ui/samplingProtocol.ts
R["apps/zcode-cli/packages/bootstrap/src/zcode-protocol/mcp-ui/samplingProtocol.ts"] = [
    ("requireSessionForMcpUi(context, params.sessionId,", "requireSession(context, params.sessionId,"),
    ("""import {
  parseParams,
  requireSessionForMcpUi,
  type ZCodeProtocolAgentServerContext,
} from "../server-types.js";""",
     """import {
  parseParams,
  requireSession,
  type ZCodeProtocolAgentServerContext,
} from "../server-types.js";"""),
]

# ---------------- packages/ui/src/plugin-ui/contract.ts
R["packages/ui/src/plugin-ui/contract.ts"] = [
    ("""  // 修复：surfaceId 由插件自行命名，必须同时隔离工作区、会话和插件。
  // HBA fr8/fr19：面板（surface）跟随项目、跨会话共用，key 的会话位用 `*`（与 tab id 同口径）——
  // 锚点会话消亡换锚重绑时不换 key，widgetState / surfaceStateKey / 页面实例保持连续；
  // 工具卡片（toolCall）仍按会话隔离。
  return JSON.stringify([
    JSON.stringify([
      target.workspaceIdentity?.trim() || target.workspacePath,
      scope.kind === "surface" ? "*" : target.sessionId,
    ]),
    target.pluginId,""",
     """  // 修复：surfaceId 由插件自行命名，必须同时隔离工作区、会话和插件。
  return JSON.stringify([
    buildPluginUiSessionKey(target),
    target.pluginId,"""),
]

# ---------------- packages/ui/src/plugin-ui/adapters/pluginUiHostTypes.ts
R["packages/ui/src/plugin-ui/adapters/pluginUiHostTypes.ts"] = [
    ("""  >;
  /** 锚点会话消亡（删除/归档）时通知调用方换锚重绑（HBA fr19）；仅面板（surface）传。 */
  onSessionLost?: () => void;
}""",
     """  >;
}"""),
]

# ---------------- packages/ui/src/plugin-ui/adapters/pluginUiManagedPage.ts
R["packages/ui/src/plugin-ui/adapters/pluginUiManagedPage.ts"] = [
    # revert suspend boundSessionId reset
    ("""      releaseFeed = undefined;
      releaseLease = undefined;
      boundSessionId = null;""",
     """      releaseFeed = undefined;
      releaseLease = undefined;"""),
    # revert update() rebind
    ("""      if (next.enabled === false) return;
      // 换锚重绑（HBA fr19）：锚点会话消亡后调用方换到存活会话，这里整体重启页面
      // （新租约/新订阅/新 AppBridge 归属）；widgetState / surfaceFeed / surfaceStateKey
      // 因 key 的会话位是 `*` 而保持连续，guest 内存不受影响。
      if (boundSessionId !== null && next.scope.sessionId !== boundSessionId) {
        latest.current = next;
        void page.suspend(true).then(() => ensure());
        return;
      }
      latest.current = next;""",
     """      if (next.enabled === false) return;
      latest.current = next;"""),
    # revert task listener + task getter
    ("""  const workspaceEvents = services.zcodeTaskService.onDynamicWorkspaceEvent({
    workspacePath: input.scope.workspacePath,
    workspaceIdentity: input.scope.workspaceIdentity,
  })((event) => {
    if (
      event.type !== "workspace_task_list_changed" ||
      event.reason !== "task_deleted" ||
      event.taskId !== latest.current.scope.sessionId
    )
      return;
    // HBA fr19：面板（surface）跟随项目，锚点会话被删除不销毁页面，只通知换锚重绑；
    // 工具卡片归对话，任务删除仍按 task 回收页面。
    if (latest.current.scope.scope.kind === "surface") {
      latest.current.onSessionLost?.();
      return;
    }
    pluginUiPages.removeTask(buildPluginUiSessionKey(latest.current.scope));
  });
  const page: Page = {
    kind: "mcp",
    key,
    get task() {
      return buildPluginUiSessionKey(latest.current.scope);
    },""",
     """  const task = buildPluginUiSessionKey(input.scope);
  const workspaceEvents = services.zcodeTaskService.onDynamicWorkspaceEvent({
    workspacePath: input.scope.workspacePath,
    workspaceIdentity: input.scope.workspaceIdentity,
  })((event) => {
    if (
      event.type === "workspace_task_list_changed" &&
      event.reason === "task_deleted" &&
      event.taskId === input.scope.sessionId
    )
      pluginUiPages.removeTask(task);
  });
  const page: Page = {
    kind: "mcp",
    key,
    task,"""),
    # revert lease bind mark
    ("""      releaseLease = () => connection.release();
      const lease = connection.layer.acquire(latest.current.scope.sessionId);
      boundSessionId = latest.current.scope.sessionId;""",
     """      releaseLease = () => connection.release();
      const lease = connection.layer.acquire(latest.current.scope.sessionId);"""),
    # revert boundSessionId declaration
    ("""  let appIdentity: string | undefined;
  // 当前租约/订阅锚定的会话（HBA fr19）；update 交付不同锚点时整体重绑。
  let boundSessionId: string | null = null;""",
     """  let appIdentity: string | undefined;"""),
]

# ---------------- packages/ui/src/plugin-ui/adapters/usePluginUiSidePaneModel.tsx
R["packages/ui/src/plugin-ui/adapters/usePluginUiSidePaneModel.tsx"] = [
    # revert host scope + onSessionLost
    ("""      sessionId: anchorSessionId,
      scope: scopeRef,
    },
    // HBA fr19：锚点会话被删除时换锚重绑（managedPage 检测 scope.sessionId 变化整体重启）。
    onSessionLost: () => setAnchorLost(true),""",
     """      sessionId: tab.parentSessionId,
      scope: scopeRef,
    },"""),
    # revert watcher guard (undo edit3, restoring edit1 form before removing the block)
    ("""  useEffect(() => {
    if (scopeRef.kind !== "surface") return;
    if (state.status !== "error") {""",
     """  useEffect(() => {
    if (state.status !== "error") {"""),
    # revert main anchor block (edit1)
    ("""  const theme = useZCodeStoreWithDefault((state) => state.theme, "system");
  // 面板（surface）会话锚点（HBA fr19）：默认钉在创建会话（工具结果行所在），
  // 锚点会话被归档/删除后换锚到当前活跃会话——面板跟随项目，不随单个会话消亡而失效。
  const [anchorSessionId, setAnchorSessionId] = useState(tab.parentSessionId);
  const [anchorLost, setAnchorLost] = useState(false);
  const retriedStoreRef = useRef(false);

  useEffect(() => {
    const nextLease = layer.acquire(anchorSessionId);
    setLease(nextLease);
    return () => nextLease.release();
  }, [layer, anchorSessionId]);
  const state = useConversationProjection(lease);
  // 锚点消亡信号（HBA fr19）：任务删除经 onSessionLost 直达；归档/冷启动死锚落在
  // 订阅终态失败（status=error）。会话消亡特征的失败 → 标记待换锚；其余终态失败 → 手动重连一次。
  useEffect(() => {
    if (state.status !== "error") {
      if (state.status === "live") retriedStoreRef.current = false;
      return;
    }
    const message = state.lastError ?? "";
    if (/Session is not active|Session not found|sessionNotFound/i.test(message)) {
      setAnchorLost(true);
      return;
    }
    if (!retriedStoreRef.current) {
      retriedStoreRef.current = true;
      void lease?.store.retry();
    }
  }, [scopeRef.kind, state.status, state.lastError, lease]);
  // 待换锚且已有存活的活跃会话 → 重绑；活跃会话晚于消亡出现时同样生效。
  useEffect(() => {
    if (!anchorLost) return;
    if (activeSessionId && activeSessionId !== anchorSessionId) {
      setAnchorSessionId(activeSessionId);
      setAnchorLost(false);
      retriedStoreRef.current = false;
    }
  }, [anchorLost, activeSessionId, anchorSessionId]);
  // 4b-2 R4：侧栏不在 SessionPane 树内，自己把会话投影的资源通知接到路由表（按 store 引用计数，不重复投递）。
  const feedScope = useMemo<PluginUiSessionScope>(
    () => ({
      workspacePath: tab.workspacePath,
      remoteSessionId: tab.remoteSessionId,
      ...(tab.workspaceIdentity ? { workspaceIdentity: tab.workspaceIdentity } : {}),
      sessionId: anchorSessionId,
    }),
    [anchorSessionId, tab.workspaceIdentity, tab.workspacePath, tab.remoteSessionId],
  );
  usePluginUiResourceDeltaFeed(lease?.store, feedScope);""",
     """  const theme = useZCodeStoreWithDefault((state) => state.theme, "system");

  useEffect(() => {
    const nextLease = layer.acquire(tab.parentSessionId);
    setLease(nextLease);
    return () => nextLease.release();
  }, [layer, tab.parentSessionId]);
  const state = useConversationProjection(lease);
  // 4b-2 R4：侧栏不在 SessionPane 树内，自己把会话投影的资源通知接到路由表（按 store 引用计数，不重复投递）。
  const feedScope = useMemo<PluginUiSessionScope>(
    () => ({
      workspacePath: tab.workspacePath,
      remoteSessionId: tab.remoteSessionId,
      ...(tab.workspaceIdentity ? { workspaceIdentity: tab.workspaceIdentity } : {}),
      sessionId: tab.parentSessionId,
    }),
    [tab.parentSessionId, tab.workspaceIdentity, tab.workspacePath],
  );
  usePluginUiResourceDeltaFeed(lease?.store, feedScope);"""),
    # revert useRef import
    ("import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from \"react\";",
     "import { useCallback, useEffect, useMemo, useState, type ReactNode } from \"react\";"),
]

# ---------------- test files (same reversal approach)
R["packages/ui/src/plugin-ui/contract.test.ts"] = [(
    """    // HBA fr8/fr19：面板（surface）跟随项目，key 不随会话变化（换锚重绑保持连续）；
    // 工具卡片（toolCall）仍按会话隔离。
    expect(buildPluginUiSurfaceKey({ ...scope, sessionId: "s2" }, surface)).toBe(
      buildPluginUiSurfaceKey(scope, surface),
    );
    const toolCall = { kind: "toolCall" as const, toolCallId: "c1" };
    expect(buildPluginUiSurfaceKey(scope, toolCall)).not.toBe(
      buildPluginUiSurfaceKey({ ...scope, sessionId: "s2" }, toolCall),
    );
""", "")]

R["packages/ui/src/plugin-ui/domain/pluginUiLogicalScope.test.ts"] = [
    ('  it("isolates same-named surfaces by server, resource and workspace; session is shared (HBA fr8/fr19)", () => {',
     '  it("isolates same-named surfaces by server, resource, workspace and session", () => {'),
    ("""      { workspaceIdentity: "other" },
    ])
      expect(buildPluginUiSurfaceKey({ ...base, ...changed }, scope)).not.toBe(key);
    // 面板跟随项目、跨会话共用：会话位不参与 key（换锚重绑保持 widgetState 连续）。
    expect(buildPluginUiSurfaceKey({ ...base, sessionId: "other" }, scope)).toBe(key);
  });""",
     """      { workspaceIdentity: "other" },
      { sessionId: "other" },
    ])
      expect(buildPluginUiSurfaceKey({ ...base, ...changed }, scope)).not.toBe(key);
  });"""),
]

R["packages/ui/test/pluginUiBackground.test.ts"] = [(
    """  it("同插件不同会话共享同一面板（HBA fr8/fr19：surface 跟随项目）", async () => {
    const host = setup();
    host.send();
    host.send({ ...result, sessionId: "other" });
    await vi.waitFor(() => expect(createPage).toHaveBeenCalledTimes(1));
    const page = vi.mocked(createPage).mock.results[0]!.value;
    // 两次结果都投喂同一个 guest，不再按会话拆页。
    await vi.waitFor(() => expect(page.updateToolFeed).toHaveBeenCalledTimes(2));
    host.off();
  });""",
    """  it("同插件不同会话隔离", async () => {
    const host = setup();
    host.send();
    host.send({ ...result, sessionId: "other" });
    await vi.waitFor(() => expect(createPage).toHaveBeenCalledTimes(2));
    expect(vi.mocked(createPage).mock.calls[0]![0]).not.toBe(
      vi.mocked(createPage).mock.calls[1]![0],
    );
    host.off();
  });""")]

NEW_FILES = ["apps/zcode-cli/packages/bootstrap/tests/mcp-ui-session-fallback.test.ts"]

# ---------------- build staging trees
shutil.rmtree(BEFORE, ignore_errors=True)
shutil.rmtree(AFTER, ignore_errors=True)
os.makedirs(BEFORE)
os.makedirs(AFTER)

pairs = []
for rel, swaps in R.items():
    after_path = os.path.join(ROOT, rel)
    with open(after_path, "rb") as fh:
        raw = fh.read()
    crlf = b"\r\n" in raw
    content = raw.decode("utf-8").replace("\r\n", "\n")
    for new, old in swaps:
        if new not in content:
            raise SystemExit(f"reverse anchor not found in {rel}: {new[:70]!r}")
        content = content.replace(new, old)
    if crlf:
        content = content.replace("\n", "\r\n")
    before_path = os.path.join(BEFORE, rel.replace("/", os.sep))
    os.makedirs(os.path.dirname(before_path), exist_ok=True)
    with open(before_path, "wb") as fh:
        fh.write(content.encode("utf-8"))
    pairs.append((rel, True))

for rel in NEW_FILES:
    pairs.append((rel, False))

for rel, has_before in pairs:
    after_out = os.path.join(AFTER, rel.replace("/", os.sep))
    os.makedirs(os.path.dirname(after_out), exist_ok=True)
    shutil.copyfile(os.path.join(ROOT, rel), after_out)
    if not has_before:
        placeholder = os.path.join(BEFORE, rel.replace("/", os.sep))
        os.makedirs(os.path.dirname(placeholder), exist_ok=True)
        open(placeholder, "w").close()

result = subprocess.run(
    ["git", "diff", "--no-index", "--src-prefix=a/", "--dst-prefix=b/", "fr19-before", "fr19-after"],
    capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=BASE,
)
diff = result.stdout
diff = diff.replace("a/fr19-before/", "a/").replace("b/fr19-after/", "b/")

newset = set(NEW_FILES)
if newset:
    lines = diff.splitlines(keepends=True)
    out, i = [], 0
    while i < len(lines):
        if lines[i].startswith("diff --git "):
            target = lines[i].split(" b/")[-1].strip()
            block = [lines[i]]
            i += 1
            while i < len(lines) and not lines[i].startswith("diff --git "):
                block.append(lines[i])
                i += 1
            if target in newset:
                block.insert(1, "new file mode 100644\n")
                block = ["--- /dev/null\n" if l.startswith("--- ") else l for l in block]
            out.extend(block)
        else:
            out.append(lines[i])
            i += 1
    diff = "".join(out)

with open(OUT, "w", encoding="utf-8", newline="") as fh:
    fh.write(diff)
print("wrote", OUT, len(diff), "bytes")
