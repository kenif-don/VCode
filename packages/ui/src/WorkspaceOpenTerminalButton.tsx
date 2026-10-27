import { SquareTerminalIcon } from "lucide-react";
import { cn } from "@/components/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useTerminalEntryStore } from "@/store/terminalEntryStore.js";
import { runUserAction } from "@/lib/userActionTelemetry.js";

/**
 * FR-5-2 底部“打开终端”按钮：点击在右侧面板打开终端标签页；再次点击聚焦已有终端。
 *
 * 挂载于 composer 左下（leadingActionsNode）。按钮只负责发起 terminalEntryStore 单例桥
 * 请求；打开/聚焦的实际动作由 useAppPanels 的 useTerminalEntryBridge 按 workspaceKey 消费，
 * 与顶部栏旧 toggleTerminal 按钮（FR-5-1 已移除）各管各的终端形态。
 */
export function WorkspaceOpenTerminalButton({
  workspacePath,
  workspaceIdentity,
  disabledReason,
}: {
  workspacePath: string;
  workspaceIdentity?: string;
  disabledReason?: string;
}) {
  const { intl } = useZCodeIntl();
  const label = intl.formatMessage({ id: "terminal.show" });
  const workspaceKey = workspaceIdentity?.trim() || workspacePath;

  return (
    <ControlHintTooltip title={disabledReason ?? label} side="top">
      <Button
        type="button"
        variant="ghost"
        size="icon-md"
        className={cn("text-foreground hover:bg-hover hover:text-foreground")}
        aria-label={label}
        disabled={Boolean(disabledReason)}
        onClick={() =>
          runUserAction({
            input: {
              featureId: "workbench.terminal",
              action: "open",
              trigger: "button",
            },
            operation: () =>
              useTerminalEntryStore.getState().requestOpen({ workspaceKey }),
            completed: { resultSource: "local_commit" },
            failureStage: "terminal_open",
          })
        }
      >
        <SquareTerminalIcon className="size-4" />
      </Button>
    </ControlHintTooltip>
  );
}
