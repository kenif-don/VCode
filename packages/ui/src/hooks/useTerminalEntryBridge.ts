import { useEffect } from "react";
import { useTerminalEntryStore } from "@/store/terminalEntryStore.js";

/**
 * 订阅“打开/聚焦右侧终端 tab”请求并交给当前 workspace 的侧边栏控制器（FR-5-2）。
 *
 * 触发入口是 composer 左下的“打开终端”按钮，经 terminalEntryStore 单例 store 发起请求；
 * 这里按 workspaceKey 匹配后调用 onOpen 打开/聚焦侧边栏终端 tab，再消费请求，
 * 避免多 workspace 实例串开。形态与 useModelTrajectoryOpenBridge 保持一致。
 */
export function useTerminalEntryBridge(ownWorkspaceKey: string, onOpen: () => void): void {
  useEffect(() => {
    const handlePending = (
      pendingRequest: ReturnType<typeof useTerminalEntryStore.getState>["pendingRequest"],
    ) => {
      if (!pendingRequest || pendingRequest.workspaceKey !== ownWorkspaceKey) {
        return;
      }
      onOpen();
      useTerminalEntryStore.getState().consumeRequest(pendingRequest.requestId);
    };

    // 订阅期间可能已有 pending 请求（点击与挂载存在竞态），先处理一次当前值。
    handlePending(useTerminalEntryStore.getState().pendingRequest);
    return useTerminalEntryStore.subscribe((state) => {
      handlePending(state.pendingRequest);
    });
  }, [onOpen, ownWorkspaceKey]);
}
