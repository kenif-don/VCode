// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceSidebarFooter } from "@/WorkspaceSidebarFooter.js";
import {
  TID_AUTOMATIONS_OPEN,
  TID_SIDEBAR_CODING_PLAN_USAGE_BUTTON,
  TID_TASK_SETTINGS_BUTTON,
} from "@zcode/shared/test-ids";

vi.mock("@/ControlHintTooltip.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ControlHintTooltip.js")>()),
  ControlHintTooltip: ({ children, title }: { children: unknown; title: string }) =>
    createElement("span", { "data-tooltip-title": title }, children),
}));

vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({
    intl: { formatMessage: ({ id }: { id: string }) => id },
  }),
}));

afterEach(cleanup);

function footerProps(overrides: Record<string, unknown> = {}) {
  return {
    theme: "light",
    localeMenuValue: "zh-CN",
    onLocaleChange: vi.fn(),
    onThemeChange: vi.fn(),
    ...overrides,
  } as Parameters<typeof WorkspaceSidebarFooter>[0];
}

it("入口行顺序:自动化 → 使用统计 → 插件市场 → 设置,自动化/插件市场仅图标", () => {
  const onOpenAutomations = vi.fn();
  const onOpenPluginStore = vi.fn();
  render(
    createElement(
      WorkspaceSidebarFooter,
      footerProps({
        onSettingsButtonClick: vi.fn(),
        onOpenAutomations,
        onOpenPluginStore,
      }),
    ),
  );
  const scheduled = screen.getByTestId(TID_AUTOMATIONS_OPEN);
  const usage = screen.getByTestId(TID_SIDEBAR_CODING_PLAN_USAGE_BUTTON);
  const plugins = screen.getByTestId("plugin-store-sidebar-open");
  const settings = screen.getByTestId(TID_TASK_SETTINGS_BUTTON);

  // 仅图标入口：不渲染文字，悬停提示（data-tooltip-title）与 aria-label 承载名称。
  expect(scheduled.textContent).toBe("");
  expect(plugins.textContent).toBe("");
  expect(scheduled.getAttribute("aria-label")).toBe("workspace.openScheduledSettings");
  expect(plugins.getAttribute("aria-label")).toBe("workspace.openPluginsSettings");
  expect(
    scheduled.parentElement?.getAttribute("data-tooltip-title"),
  ).toBe("workspace.openScheduledSettings");

  // DOM 顺序即行内顺序。
  const order = [scheduled, usage, plugins, settings];
  for (let i = 1; i < order.length; i += 1) {
    expect(
      order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  }

  fireEvent.click(scheduled);
  expect(onOpenAutomations).toHaveBeenCalledOnce();
  // 回归：onClick 不能把点击事件当 automationId 传进 OpenAutomationsMain（曾致自动化打不开）。
  expect(onOpenAutomations).toHaveBeenCalledWith();
  fireEvent.click(plugins);
  expect(onOpenPluginStore).toHaveBeenCalledOnce();
});

it("未传 handler（Settings 复用 footer）时自动化/插件市场不渲染", () => {
  render(
    createElement(
      WorkspaceSidebarFooter,
      footerProps({ onSettingsButtonClick: vi.fn() }),
    ),
  );
  expect(screen.queryByTestId(TID_AUTOMATIONS_OPEN)).toBeNull();
  expect(screen.queryByTestId("plugin-store-sidebar-open")).toBeNull();
  expect(screen.getByTestId(TID_SIDEBAR_CODING_PLAN_USAGE_BUTTON)).toBeTruthy();
  expect(screen.getByTestId(TID_TASK_SETTINGS_BUTTON)).toBeTruthy();
});

it("选中态映射到图标按钮的按下态", () => {
  render(
    createElement(
      WorkspaceSidebarFooter,
      footerProps({
        onOpenAutomations: vi.fn(),
        automationsActive: true,
        onOpenPluginStore: vi.fn(),
        pluginStoreActive: false,
      }),
    ),
  );
  expect(screen.getByTestId(TID_AUTOMATIONS_OPEN).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByTestId("plugin-store-sidebar-open").getAttribute("aria-pressed")).toBe("false");
});
