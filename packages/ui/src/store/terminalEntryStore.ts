import { create } from "zustand";

/**
 * 打开/聚焦“右侧终端 tab”的请求桥接 store（FR-5-2）。
 *
 * 背景：底部“打开终端”按钮挂在 composer 左下（leadingActionsNode），位置很深；而右侧
 * side pane 的终端 tab 状态由每个 workspace 的 useAppPanels 持有。为避免把侧栏控制器
 * 回调贯穿整棵 composer/SessionPane 树，这里用轻量单例 store 作为桥：按钮写入 pending
 * 请求，目标 workspace 的 useAppPanels 经 useTerminalEntryBridge 订阅并消费（按
 * workspaceKey 匹配，避免多 workspace 实例串开）。形态与 modelTrajectoryStore 保持一致。
 */
export interface TerminalEntryOpenRequest {
  /** 唯一请求 id，保证同一按钮连续点击也能触发消费。 */
  requestId: string;
  /** workspaceIdentity?.trim() || workspacePath，用于定位目标 workspace 侧边栏。 */
  workspaceKey: string;
}

interface TerminalEntryStoreState {
  pendingRequest: TerminalEntryOpenRequest | null;
  requestOpen: (request: { workspaceKey: string }) => void;
  consumeRequest: (requestId: string) => void;
}

let requestSeq = 0;

export const useTerminalEntryStore = create<TerminalEntryStoreState>((set) => ({
  pendingRequest: null,
  requestOpen: (request) => {
    requestSeq += 1;
    set({
      pendingRequest: { ...request, requestId: `terminal-entry-open:${requestSeq}` },
    });
  },
  consumeRequest: (requestId) => {
    set((state) =>
      state.pendingRequest?.requestId === requestId ? { pendingRequest: null } : state,
    );
  },
}));
