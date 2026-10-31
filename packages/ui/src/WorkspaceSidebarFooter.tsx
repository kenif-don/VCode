import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import type { Locale, UserInfo } from "@zcode/shared";
import { memo, type ReactNode } from "react";
import {
  TID_AUTOMATIONS_OPEN,
  TID_SIDEBAR_CODING_PLAN_USAGE_BUTTON,
  TID_TASK_SETTINGS_BUTTON,
} from "@zcode/shared/test-ids";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { BarChart3, Blocks, CalendarClock, Settings } from "lucide-react";
import type { Theme } from "@/useTheme.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { setPendingSettingsUsageIntent } from "@/lib/settingsNavigation.js";
import type { WorkspaceSidebarFooterUsageSummaryContent } from "@/WorkspaceSidebarFooterUsageSummary.js";

export const WorkspaceSidebarFooter = memo(function WorkspaceSidebarFooterComponent({
  onSettingsButtonClick,
  onUsageClick,
  onOpenAutomations,
  automationsActive,
  onOpenPluginStore,
  pluginStoreActive,
  settingsButtonMode = "settings",
  banner,
  className,
}: {
  theme: Theme;
  localeMenuValue: Locale | "system";
  onLocaleChange: (value: string) => void;
  onThemeChange: (value: string) => void;
  onSettingsButtonClick?: () => void;
  onUsageClick?: () => void;
  /** 自动化/插件市场入口(自侧栏顶部迁入的图标入口;Settings 复用 footer 时不传即不显示)。 */
  onOpenAutomations?: () => void;
  automationsActive?: boolean;
  onOpenPluginStore?: () => void;
  pluginStoreActive?: boolean;
  onUpgradeClick?: Parameters<
    typeof WorkspaceSidebarFooterUsageSummaryContent
  >[0]["onUpgradeClick"];
  onLogout?: () => void;
  settingsButtonMode?: "settings" | "back";
  user?: UserInfo | null;
  banner?: ReactNode;
  className?: string;
}) {
  const { intl } = useZCodeIntl();
  const settingsButtonLabel =
    settingsButtonMode === "back"
      ? intl.formatMessage({ id: "workspace.backToWorkspace" })
      : intl.formatMessage({ id: "settings.title" });
  const usageStatsLabel = intl.formatMessage({ id: "sidebar.usage.plan.openStats" });
  const automationsLabel = intl.formatMessage({ id: "workspace.openScheduledSettings" });
  const pluginStoreLabel = intl.formatMessage({ id: "workspace.openPluginsSettings" });
  const usageButtonClick = onUsageClick ?? onSettingsButtonClick;

  return (
    // footer 被 Settings 复用，页面专属边距由调用方传入，避免修改共享默认样式。
    <footer className={cn("flex shrink-0 flex-col gap-2.5 px-4 pt-2 pb-4", className)}>
      {banner}
      <div className="flex min-w-0 gap-2">
        {/* HBA 白标：隐藏登录者信息入口与其点击展开菜单（登录信息/界面语言/主题/界面模式/缩放/登录登出），
            底部统一图标行：自动化 | 使用统计 | 插件市场 | 设置（自动化/插件市场自顶部导航迁入，仅图标）。
            手机连接入口已随功能整体移除（依赖登录的远控能力，白标无登录不可用）。 */}
        <div className="flex shrink-0 items-center gap-1.5">
          {onOpenAutomations ? (
            <ControlHintTooltip title={automationsLabel}>
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                data-testid={TID_AUTOMATIONS_OPEN}
                aria-label={automationsLabel}
                aria-pressed={automationsActive ?? false}
                className={cn(automationsActive && "bg-selected text-foreground")}
                // 点击事件不能进入业务导航的可选 automationId 参数（OpenAutomationsMain）。
                onClick={() => onOpenAutomations()}
              >
                <CalendarClock className="size-4" />
              </Button>
            </ControlHintTooltip>
          ) : null}
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
          {onOpenPluginStore ? (
            <ControlHintTooltip title={pluginStoreLabel}>
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                data-testid="plugin-store-sidebar-open"
                aria-label={pluginStoreLabel}
                aria-pressed={pluginStoreActive ?? false}
                className={cn(pluginStoreActive && "bg-selected text-foreground")}
                onClick={onOpenPluginStore}
              >
                <Blocks className="size-4" />
              </Button>
            </ControlHintTooltip>
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
