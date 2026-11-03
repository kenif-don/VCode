import { pluginUiStateKey } from "@/plugin-ui/adapters/pluginUiStateKey.js";
import { reportAppTelemetryEvent } from "@/lib/appTelemetry.js";
import { getPluginUiSessionActions } from "./pluginUiSessionActions.js";
import { logger } from "@/logger.js";
import { createPluginUiMessagePortTransport } from "@/plugin-ui/adapters/messagePortTransport.js";
import { createPluginUiDownloadInteraction } from "@/plugin-ui/adapters/pluginUiDownloads.js";
import { readPluginUiStyleVariables } from "@/plugin-ui/adapters/readPluginUiStyleVariables.js";
import {
  createPluginUiHostController,
  type PluginUiHostController,
  type PluginUiHostPhase,
} from "@/plugin-ui/app/pluginUiHostController.js";
import { createPluginUiResourceNotificationRegistrar } from "@/plugin-ui/app/pluginUiResourceNotificationBus.js";
import {
  clearPluginUiWidgetState,
  getPluginUiWidgetState,
  setPluginUiWidgetState,
} from "@/plugin-ui/app/pluginUiWidgetStateStore.js";
import type {
  McpUiAppCapabilities,
  McpUiHostContext,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { PluginSandboxHandle } from "@zcode/shared/mcp-apps";
import { buildPluginSandboxScopeId } from "@zcode/shared/mcp-apps";
import { clearPluginUiSurfaceFeed } from "../app/pluginUiSurfaceFeedStore.js";
import {
  PLUGIN_UI_CARD_DEFAULT_HEIGHT_PX,
  PLUGIN_UI_CARD_MAX_HEIGHT_PX,
  PLUGIN_UI_CARD_MIN_HEIGHT_PX,
} from "../contract.js";
import { buildPluginUiHostCapabilities } from "../domain/buildPluginUiHostCapabilities.js";
import {
  appAllowsDisplayMode,
  buildPluginUiHostContext,
} from "@/plugin-ui/domain/buildPluginUiHostContext.js";

import { acquireWorkspaceConnection } from "@/v4/workspaceConnectionRegistry.js";
import type { IServiceAccessor } from "@zcode/services";
import type { IPlatformService } from "@zcode/shared";
import { buildPluginUiSessionKey } from "../contract.js";
import type { Page, UsePluginUiHostInput, UsePluginUiHostResult } from "./pluginUiHostTypes.js";
import { createPluginUiPagePlane } from "./pluginUiPagePlane.js";
import { pluginUiPages } from "./pluginUiPageRegistry.js";
import { attachPluginUiResourceDeltaFeed } from "./pluginUiResourceDeltaFeed.js";
type Platform = IPlatformService;
type Services = IServiceAccessor;
// error 相位有界自动恢复（HBA fr21）：退避 5s→15s→45s→60s 封顶、单错误事件最多 6 次，
// 可见性重试另有 10s 限流；回 running 或手动 reload 清零（reload 仍清 widgetState）。
const AUTO_RECOVER_BACKOFF_MS = [5_000, 15_000, 45_000, 60_000];
const AUTO_RECOVER_MAX_ATTEMPTS = 6;
const AUTO_RECOVER_VISIBLE_THROTTLE_MS = 10_000;
export function createPage(
  key: string,
  input: UsePluginUiHostInput,
  platform: Platform,
  services: Services,
): Page {
  const reportUsage = (action: string, failed = false) => {
    void reportAppTelemetryEvent(
      platform,
      {
        elementName: failed ? "plugin_runtime_error" : "plugin_usage",
        eventRegion: "app",
        eventType: "result",
        eventExtraDetail: {
          schema_version: "1",
          action,
          plugin_id: input.presentation.pluginId,
          plugin_component: "ui",
          client_kind: "desktop",
          ...(failed ? { error_category: "unknown", result: "failure" } : {}),
        },
      },
      "plugin-ui",
    );
  };
  const bridge = services.pluginUiBridgeService!;
  const sandboxPlatform = platform.pluginSandbox!;
  const surfaceKey = key;
  const latest = { current: input };
  const listeners = new Set<() => void>();
  let surfaceStateKey: string | undefined;
  let controller: PluginUiHostController | null = null;
  let releaseFeed: (() => void) | undefined;
  let releaseLease: (() => void) | undefined;
  let executionKey = "";
  let disposed = false;
  let starting = false;
  let incarnation = 0;
  let releasing: Promise<unknown> = Promise.resolve();
  let recycling: Promise<boolean> | undefined;
  let activityFeed = "";
  let contextInputs = "";
  let lastFeed = "";
  let lastContext = "";
  let appIdentity: string | undefined;
  // 当前租约/订阅锚定的会话（HBA fr19）；update 交付不同锚点时整体重绑。
  let boundSessionId: string | null = null;
  let autoRecoverAttempts = 0;
  let autoRecoverTimer: ReturnType<typeof setTimeout> | undefined;
  let lastAutoRecoverAt = 0;
  const notify = () => {
    for (const listener of listeners) listener();
  };
  let snapshot: UsePluginUiHostResult = {
    pageKey: key,
    supported: true,
    phase: "idle",
    handle: null,
    height: PLUGIN_UI_CARD_DEFAULT_HEIGHT_PX,
    error: null,
    appCapabilities: undefined,
    reload: () => {
      resetAutoRecover();
      clearPluginUiWidgetState(key);
      void page.suspend(true).then(ensure);
    },
  };
  const patch = (value: Partial<UsePluginUiHostResult>) => {
    const previousPhase = snapshot.phase;
    snapshot = { ...snapshot, ...value };
    // error 相位有界自动恢复（HBA fr21）：进 error 挂退避重试，回 running 清零。
    if (snapshot.phase !== previousPhase) {
      if (snapshot.phase === "error") scheduleAutoRecover();
      else if (snapshot.phase === "running") resetAutoRecover();
    }
    notify();
  };
  const setPhase = (phase: PluginUiHostPhase) => patch({ phase });
  const setHandle = (handle: PluginSandboxHandle) => {
    if (appIdentity && appIdentity !== handle.instance.appIdentity) clearPluginUiWidgetState(key);
    appIdentity = handle.instance.appIdentity;
    const fresh =
      snapshot.handle?.sandboxId !== handle.sandboxId || snapshot.handle?.initId !== handle.initId;
    patch({ handle });
    if (fresh) pluginUiPages.prepared(page, handle.resourceMeta?.backgroundRetention === true);
    plane.mount(handle);
    syncExecution();
  };
  const setHeight = (height: number) => patch({ height });
  const setError = (error: string) => patch({ error });
  const syncDisplayModes = (appCapabilities: McpUiAppCapabilities | undefined) => {
    // 能力只有握手后才可知；之前在后台加载，避免 fullscreen-only 页面先闪现 inline。
    plane.setAllowedDisplayModes(
      appCapabilities === undefined
        ? []
        : (["inline", "fullscreen"] as const).filter((mode) =>
            appAllowsDisplayMode(
              appCapabilities,
              mode,
              latest.current.presentation.preferredDisplayMode,
            ),
          ),
    );
  };
  const setAppCapabilities = (appCapabilities: McpUiAppCapabilities | undefined) => {
    syncDisplayModes(appCapabilities);
    patch({ appCapabilities });
    if (appCapabilities)
      logger.lifecycle.info("[plugin-ui] display modes registered", {
        pluginId: latest.current.presentation.pluginId,
        scopeId: buildPluginSandboxScopeId(latest.current.scope.scope),
        availableDisplayModes: appCapabilities.availableDisplayModes ?? ["inline", "fullscreen"],
        preferredDisplayMode: latest.current.presentation.preferredDisplayMode,
      });
  };
  const plane = createPluginUiPagePlane({
    onVisibility(visible) {
      if (page.visible !== visible) pluginUiPages.visibility(page, visible);
      if (visible) {
        if (snapshot.phase === "error") recoverOnVisible();
        else ensure();
      }
      syncExecution();
    },
    onCrash() {
      void page.suspend(true);
      patch({ phase: "error", error: "MCP App page stopped" });
    },
  });
  function syncExecution() {
    // 过去对所有页面强制维持后台帧，隐藏页也持续消耗 CPU；只有资源显式申请才启用。
    const active =
      controller !== null && snapshot.handle?.resourceMeta?.backgroundRetention === true;
    // 无锚点的冷启动也要完成握手；display:none 会让 Electron guest 无法首次挂载。
    // 仅启动阶段提供不可交互的承载面，握手后未声明的页面立即恢复普通隐藏策略。
    plane.setExecutionActive(active || (controller !== null && snapshot.phase !== "running"));
    const handle = snapshot.handle;
    if (!handle || !sandboxPlatform.setExecutionActive) return;
    const background = active && (!page.visible || document.hidden);
    const nextKey = `${handle.sandboxId}:${handle.initId}:${background}`;
    if (nextKey === executionKey) return;
    executionKey = nextKey;
    logger.lifecycle.info("[plugin-ui] background execution", {
      sessionId: input.scope.sessionId,
      sandboxId: handle.sandboxId,
      active: background,
    });
    void sandboxPlatform
      .setExecutionActive(handle.sandboxId, handle.initId, background)
      .catch((error: unknown) => {
        if (snapshot.handle !== handle || disposed) return;
        logger.warn("[plugin-ui] background execution failed", { error: String(error) });
      });
  }
  function onWindowVisibility() {
    if (!document.hidden && plane.hasVisibleAnchor()) {
      if (snapshot.phase === "error") recoverOnVisible();
      else void ensure();
    }
    syncExecution();
  }
  function cancelAutoRecover() {
    if (autoRecoverTimer !== undefined) {
      clearTimeout(autoRecoverTimer);
      autoRecoverTimer = undefined;
    }
  }
  function resetAutoRecover() {
    autoRecoverAttempts = 0;
    cancelAutoRecover();
  }
  function scheduleAutoRecover() {
    if (disposed || autoRecoverTimer !== undefined) return;
    if (autoRecoverAttempts >= AUTO_RECOVER_MAX_ATTEMPTS) return;
    const delay =
      AUTO_RECOVER_BACKOFF_MS[Math.min(autoRecoverAttempts, AUTO_RECOVER_BACKOFF_MS.length - 1)];
    autoRecoverTimer = setTimeout(() => {
      autoRecoverTimer = undefined;
      runAutoRecover();
    }, delay);
  }
  function runAutoRecover() {
    if (disposed || snapshot.phase !== "error") return;
    autoRecoverAttempts++;
    lastAutoRecoverAt = Date.now();
    logger.lifecycle.info(`[plugin-ui] auto-recover attempt ${autoRecoverAttempts}`, {
      sessionId: latest.current.scope.sessionId,
      pluginId: latest.current.presentation.pluginId,
    });
    // 与手动 reload 同一重启路径（suspend 清 controller/换 incarnation，ensure 重建），
    // 但不清 widgetState——面板未保存状态在自动恢复中保留。
    void page.suspend(true).then(ensure);
  }
  function recoverOnVisible() {
    if (disposed || snapshot.phase !== "error") return;
    if (autoRecoverAttempts >= AUTO_RECOVER_MAX_ATTEMPTS) return;
    if (Date.now() - lastAutoRecoverAt < AUTO_RECOVER_VISIBLE_THROTTLE_MS) return;
    cancelAutoRecover();
    runAutoRecover();
  }
  async function ensure() {
    if (disposed || controller || starting || snapshot.phase === "error") return;
    starting = true;
    const epoch = ++incarnation;
    try {
      await releasing;
      surfaceStateKey = await pluginUiStateKey(surfaceKey);
      if (disposed || epoch !== incarnation) return;
      await pluginUiPages.reserve(page);
    } catch (error) {
      starting = false;
      patch({ phase: "error", error: String(error) });
      return;
    }
    if (disposed || epoch !== incarnation) {
      pluginUiPages.released(page);
      return;
    }
    starting = false;
    try {
      // 页面独立持有已有 workspace 连接租约；卡片或 pane 退出不会让后台页面失联。
      const connection = acquireWorkspaceConnection(
        latest.current.scope,
        services.zcodeAgentService,
        platform.createLocalMediaPreviewUrl,
      );
      releaseLease = () => connection.release();
      const lease = connection.layer.acquire(latest.current.scope.sessionId);
      boundSessionId = latest.current.scope.sessionId;
      const runtimeStopped = () => {
        void page.suspend(true);
        patch({ phase: "error", error: "MCP App runtime is no longer available" });
      };
      const offRestart = connection.transport.onRuntimeRestart(runtimeStopped);
      const offLifecycle = connection.transport.onRuntimeLifecycle?.((state) => {
        if (state === "unavailable") runtimeStopped();
      });
      releaseLease = () => {
        offRestart();
        offLifecycle?.();
        lease.release();
        connection.release();
      };
      releaseFeed = attachPluginUiResourceDeltaFeed(lease.store, latest.current.scope);
      patch({ phase: "preparing", error: null, handle: null });
      createController();
    } catch (error) {
      void page.suspend(true);
      patch({ phase: "error", error: String(error) });
    }
  }
  function createController() {
    const initialHostContext: McpUiHostContext = buildPluginUiHostContext({
      theme: latest.current.theme,
      locale: latest.current.locale,
      displayMode: latest.current.displayMode,
      width: latest.current.width,
      ...(latest.current.titleBar ? { titleBar: latest.current.titleBar } : {}),
      ...(latest.current.availableDisplayModes
        ? { availableDisplayModes: latest.current.availableDisplayModes }
        : {}),
      // 主题 token 随初始 hostContext 下发，主题切换时经 updateHostContext 更新。
      styleVariables: readPluginUiStyleVariables(),
    });
    const scope = latest.current.scope;
    const presentation = latest.current.presentation;
    // 平台交互（downloadFile）与调用方注入的会话交互合成一份；能力声明按合成后的回调是否存在。
    const platformInteractions = createPluginUiDownloadInteraction({
      platform,
      bridge,
      scope,
      presentation,
      getInstance: () => {
        if (!snapshot.handle) throw new Error("MCP App is not prepared");
        return snapshot.handle.instance;
      },
    });
    const nextController = createPluginUiHostController({
      bridge,
      sampling: services?.pluginUiSamplingService,
      ...(services?.pluginUiAppToolsService ? { appTools: services.pluginUiAppToolsService } : {}),
      createTransport: createPluginUiMessagePortTransport,
      platform: sandboxPlatform,
      scope,
      presentation,
      // 按代际登记到路由表；该会话的投影 store 收到 pluginUi.* 增量后按 (scopeId, generation) 投递。
      resourceNotifications: createPluginUiResourceNotificationRegistrar(
        scope,
        presentation.serverName,
      ),
      initialHostContext,
      getPreferredDisplayMode: () => latest.current.presentation.preferredDisplayMode,
      hostVersion: latest.current.hostVersion,
      getToolFeed: () => ({
        ...(latest.current.toolInput ? { toolInput: { arguments: latest.current.toolInput } } : {}),
        ...(latest.current.toolResult ? { toolResult: latest.current.toolResult } : {}),
        ...(latest.current.toolCancelled ? { toolCancelled: true } : {}),
      }),
      // widgetState 初值直接读宿主内存 store（唯一 owner），不经 props 再缓存一份；
      // 端口投递时才读；切换展示位置仍使用同一 guest 与内存状态。
      getWidgetState: () => getPluginUiWidgetState(surfaceKey),
      getHostCapabilities: () =>
        buildPluginUiHostCapabilities({
          canSendFollowUpMessage: Boolean(latest.current.interactions?.onSendFollowUpMessage),
          canUpdateModelContext: Boolean(latest.current.interactions?.onUpdateModelContext),
          canInsertInputText: Boolean(latest.current.interactions?.onInsertInputText),
          canSetWidgetState: true,
          canSample: Boolean(services?.pluginUiSamplingService && getPluginUiSessionActions(scope)),
          canSubscribeResources: true,
          canDownloadFile: Boolean(platformInteractions?.onDownloadFile),
          ...(scope.scope.kind === "surface"
            ? { surfaceId: scope.scope.surfaceId, surfaceStateKey }
            : {}),
        }),
      ...platformInteractions,
      // 经 latest ref 转调，回调 identity 变化不触发 controller 重建；缺省回 -32601（端口层翻译成 ProtocolError）。
      onSendFollowUpMessage: (payload, context) =>
        latest.current.interactions?.onSendFollowUpMessage
          ? latest.current.interactions.onSendFollowUpMessage(payload, context)
          : Promise.reject(Object.assign(new Error("Not supported"), { code: -32601 })),
      onUpdateModelContext: (payload) =>
        latest.current.interactions?.onUpdateModelContext
          ? latest.current.interactions.onUpdateModelContext(payload)
          : Promise.reject(Object.assign(new Error("Not supported"), { code: -32601 })),
      onInsertInputText: (payload) =>
        latest.current.interactions?.onInsertInputText
          ? latest.current.interactions.onInsertInputText(payload)
          : Promise.reject(Object.assign(new Error("Not supported"), { code: -32601 })),
      onUpdateWidgetState: async (widgetState) => {
        setPluginUiWidgetState(surfaceKey, widgetState);
      },
      onPhase: (next, detail) => {
        if (controller !== nextController) return;
        if (next === "running" && snapshot.phase !== "running") reportUsage("ui_ready");
        if (next === "error" && snapshot.phase !== "error") reportUsage("ui_open_request", true);
        // 生命周期事件每个沙箱只有几条，走 lifecycle 才能进主日志（排查用户现场用）。
        logger.lifecycle.info("[plugin-ui] lifecycle", {
          phase: next,
          sessionId: latest.current.scope.sessionId,
          pluginId: latest.current.presentation.pluginId,
          scopeId: buildPluginSandboxScopeId(latest.current.scope.scope),
          ...(detail?.error ? { error: detail.error } : {}),
        });
        if (next === "error") {
          void page.suspend(true);
          patch({ phase: "error", error: detail?.error ?? "MCP App failed" });
          return;
        }
        setPhase(next);
        if (detail?.handle) {
          setHandle(detail.handle);
          // 资源声明的初始高度替代固定 240；仍受 min / max clamp。
          const hint = detail.handle.resourceMeta?.heightHint;
          if (hint !== undefined) setHeight(clampCardHeight(hint, detail.handle));
          // 资源声明的浏览器权限随句柄到达（早于端口），进 hostContext 让页面 feature detect（规范草案 `permissions`）。
          const permissions = detail.handle.resourceMeta?.permissions;
          if (permissions?.length) {
            nextController.updateHostContext({
              permissions: Object.fromEntries(permissions.map((item) => [item, {}])),
            });
          }
        }
        if (detail?.error) setError(detail.error);
      },
      onInstanceClosed: () => {
        void page.suspend(true);
        clearPluginUiWidgetState(key);
        patch({ phase: "error", error: "MCP App connection is no longer available" });
      },
      onActivity: () => {
        if (controller === nextController) pluginUiPages.activity(page);
      },
      onBusyChange: () => {
        if (controller === nextController) pluginUiPages.settled(page);
      },
      onAppCapabilities: setAppCapabilities,
      onHeight: (next) => setHeight(clampCardHeight(next, snapshot.handle)),
      onDisplayModeRequest: (mode) => latest.current.onDisplayModeRequest?.(mode) ?? mode,
      onOpenExternal: (url) => latest.current.onOpenExternal?.(url),
      log: (message, detail) => logger.warn(message, detail),
    });

    controller = nextController;
    reportUsage("ui_open_request");
    controller.start();
  }
  const workspaceEvents = services.zcodeTaskService.onDynamicWorkspaceEvent({
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
    },
    visible: false,
    snapshot: () => snapshot,
    start: () => void ensure(),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    busy: () => controller?.isBusy() ?? false,
    running: () => controller !== null || starting,
    bind(node, sidebar) {
      const off = plane.bind({
        node,
        kind: sidebar ? "sidebar" : "inline",
        container: node.closest<HTMLElement>("[data-sandbox-page-container]") ?? undefined,
      });
      ensure();
      return off;
    },
    update(next) {
      // 背景内联锚点不能覆盖侧栏当前的交互上下文。
      if (next.enabled === false) return;
      // 换锚重绑（HBA fr19）：锚点会话消亡后调用方换到存活会话，这里整体重启页面
      // （新租约/新订阅/新 AppBridge 归属）；widgetState / surfaceFeed / surfaceStateKey
      // 因 key 的会话位是 `*` 而保持连续，guest 内存不受影响。
      if (boundSessionId !== null && next.scope.sessionId !== boundSessionId) {
        latest.current = next;
        void page.suspend(true).then(() => ensure());
        return;
      }
      latest.current = next;
      // 只重选展示锚点，绝不销毁或重载 WebView；插件的未保存状态仍留在同一 guest。
      syncDisplayModes(snapshot.appCapabilities);
      const nextContextInputs = JSON.stringify([
        next.theme,
        next.locale,
        next.displayMode,
        next.width,
        next.titleBar,
        next.availableDisplayModes,
        next.presentation.preferredDisplayMode,
      ]);
      if (nextContextInputs !== contextInputs) {
        contextInputs = nextContextInputs;
        const context = buildPluginUiHostContext({
          theme: next.theme,
          locale: next.locale,
          displayMode: next.displayMode,
          width: next.width,
          titleBar: next.titleBar,
          availableDisplayModes: next.availableDisplayModes,
          styleVariables: readPluginUiStyleVariables(),
        });
        const contextKey = JSON.stringify(context);
        if (contextKey !== lastContext) {
          lastContext = contextKey;
          controller?.updateHostContext(context);
        }
      }
      page.updateToolFeed(next);
    },
    updateToolFeed(next) {
      if (disposed) return;
      const activityKey = JSON.stringify([
        next.toolCallId,
        Boolean(next.toolResult),
        next.toolCancelled,
      ]);
      if (next.toolCallId && activityKey !== activityFeed) {
        activityFeed = activityKey;
        pluginUiPages.activity(page);
        void ensure();
      }
      latest.current = {
        ...latest.current,
        toolCallId: next.toolCallId,
        toolInput: next.toolInput,
        toolResult: next.toolResult,
        toolCancelled: next.toolCancelled,
      };
      const feed = JSON.stringify([
        next.toolCallId,
        next.toolInput,
        next.toolResult,
        next.toolCancelled,
      ]);
      if (feed !== lastFeed) {
        lastFeed = feed;
        if (next.toolInput) controller?.notifyToolInput({ arguments: next.toolInput });
        if (next.toolResult) controller?.notifyToolResult(next.toolResult);
        if (next.toolCancelled) controller?.notifyToolCancelled();
      }
    },
    async suspend(force = false) {
      if (!force) {
        if (recycling) return recycling;
        if (starting || !pluginUiPages.claimRecycle(page)) return false;
        const candidate = controller;
        const attempt = (async () => {
          if (candidate && !(await candidate.tryRecycle().catch(() => false))) return false;
          // Agent 原子裁决 busy/审批；等待期间被重载或删除的旧 controller 不得释放新实例。
          if (candidate !== controller || disposed) return false;
          await page.suspend(true);
          // 裁决期间用户可能重新打开；旧凭证已撤销，必须从同一 owner 重建。
          if (!document.hidden && !disposed && plane.hasVisibleAnchor()) void ensure();
          return true;
        })();
        recycling = attempt;
        try {
          return await attempt;
        } finally {
          if (recycling === attempt) recycling = undefined;
          pluginUiPages.finishRecycle(page);
        }
      }
      incarnation++;
      starting = false;
      const previous = controller;
      controller = null;
      plane.setExecutionActive(false);
      executionKey = "";
      const previousHandle = snapshot.handle;
      const offFeed = releaseFeed,
        offLease = releaseLease;
      releaseFeed = undefined;
      releaseLease = undefined;
      boundSessionId = null;
      patch({ phase: "idle", handle: null, appCapabilities: undefined });
      plane.setAllowedDisplayModes([]);
      // 先前释放未完成时不能重新预备；反复重试也只等待同一个释放链。
      // Main 主动导航到 about:blank 会触发 navigation；先解除旧代际观察，避免回收被误报为崩溃。
      if (previousHandle) plane.prepareUnmount(previousHandle.sandboxId);
      if (previous) reportUsage("ui_close");
      const closing = previous?.dispose();
      releasing = Promise.all([releasing, closing]).then(() => {
        if (previousHandle) plane.unmount(previousHandle.sandboxId);
        offFeed?.();
        offLease?.();
        pluginUiPages.released(page);
      });
      await releasing;
      return true;
    },
    destroy() {
      cancelAutoRecover();
      document.removeEventListener("visibilitychange", onWindowVisibility);
      workspaceEvents.dispose();
      clearPluginUiSurfaceFeed(key);
      disposed = true;
      void page.suspend(true).finally(() => plane.dispose());
      clearPluginUiWidgetState(key);
      listeners.clear();
    },
  };
  plane.setAllowedDisplayModes([]);
  document.addEventListener("visibilitychange", onWindowVisibility);
  return page;
}

/** 卡片高度 clamp：下限取资源 `minFrameHeight` 与宿主最小值的较大者，上限固定。 */
function clampCardHeight(next: number, handle: PluginSandboxHandle | null): number {
  const min = Math.max(PLUGIN_UI_CARD_MIN_HEIGHT_PX, handle?.resourceMeta?.minFrameHeight ?? 0);
  return Math.min(PLUGIN_UI_CARD_MAX_HEIGHT_PX, Math.max(min, next));
}
