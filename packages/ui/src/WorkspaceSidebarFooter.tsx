import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import type { Locale, UserInfo } from "@zcode/shared";
import { memo, type ReactNode } from "react";
import {
  TID_SIDEBAR_CODING_PLAN_USAGE_BUTTON,
  TID_TASK_SETTINGS_BUTTON,
} from "@zcode/shared/test-ids";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { BarChart3, Settings } from "lucide-react";
import type { Theme } from "@/useTheme.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { setPendingSettingsUsageIntent } from "@/lib/settingsNavigation.js";
import type { WorkspaceSidebarFooterUsageSummaryContent } from "@/WorkspaceSidebarFooterUsageSummary.js";
import { WorkspaceWebRemoteControlTrigger } from "@/WorkspaceWebRemoteControlTrigger.js";

export const WorkspaceSidebarFooter = memo(function WorkspaceSidebarFooterComponent({
  onSettingsButtonClick,
  onUsageClick,
  settingsButtonMode = "settings",
  workspacePath,
  workspaceIdentity,
  workspaceRemoteSessionId,
  activeTaskId,
  isDesktop = false,
  banner,
  className,
}: {
  theme: Theme;
  localeMenuValue: Locale | "system";
  onLocaleChange: (value: string) => void;
  onThemeChange: (value: string) => void;
  onSettingsButtonClick?: () => void;
  onUsageClick?: () => void;
  onUpgradeClick?: Parameters<
    typeof WorkspaceSidebarFooterUsageSummaryContent
  >[0]["onUpgradeClick"];
  onLogin?: () => void;
  onLogout?: () => void;
  settingsButtonMode?: "settings" | "back";
  user?: UserInfo | null;
  workspacePath?: string;
  workspaceIdentity?: string;
  workspaceRemoteSessionId?: string;
  activeTaskId?: string | null;
  isDesktop?: boolean;
  banner?: ReactNode;
  className?: string;
}) {
  const { intl } = useZCodeIntl();
  const settingsButtonLabel =
    settingsButtonMode === "back"
      ? intl.formatMessage({ id: "workspace.backToWorkspace" })
      : intl.formatMessage({ id: "settings.title" });
  const usageStatsLabel = intl.formatMessage({ id: "sidebar.usage.plan.openStats" });
  const usageButtonClick = onUsageClick ?? onSettingsButtonClick;

  return (
    // footer 被 Settings 复用，页面专属边距由调用方传入，避免修改共享默认样式。
    <footer className={cn("flex shrink-0 flex-col gap-2.5 px-4 pt-2 pb-4", className)}>
      {banner}
      <div className="flex min-w-0 gap-2">
        {/* HBA 白标：隐藏登录者信息入口与其点击展开菜单（登录信息/界面语言/主题/界面模式/缩放/登录登出），
            使用统计保留为图标入口，与手机连接、设置同一行，行内图标左对齐。 */}
        <div className="flex shrink-0 items-center gap-1.5">
          <ControlHintTooltip title={usageStatsLabel}>
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              data-testid={TID_SIDEBAR_CODING_PLAN_USAGE_BUTTON}
              aria-label={usageStatsLabel}
              onClick={() => {
                setPendingSettingsUsageIntent();
                usageButtonClick?.();
              }}
            >
              <BarChart3 className="size-4" />
            </Button>
          </ControlHintTooltip>
          {isDesktop && workspacePath ? (
            <WorkspaceWebRemoteControlTrigger
              workspacePath={workspacePath}
              workspaceIdentity={workspaceIdentity}
              remoteSessionId={workspaceRemoteSessionId}
              initialTaskId={activeTaskId ?? undefined}
              compact
            />
          ) : null}
          <ControlHintTooltip title={settingsButtonLabel}>
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              data-testid={TID_TASK_SETTINGS_BUTTON}
              aria-label={settingsButtonLabel}
              disabled={!onSettingsButtonClick}
              onClick={onSettingsButtonClick}
            >
              <Settings className="size-4" />
            </Button>
          </ControlHintTooltip>
        </div>
      </div>
    </footer>
  );
});
