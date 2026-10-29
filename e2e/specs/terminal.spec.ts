import { test, expect } from "@playwright/test";
import { T } from "../support/testids";

/**
 * FR-5 终端整合验收用例(TC-TRM-01)
 *
 * 前置条件:
 *   1. `zcode --web` 已启动;
 *   2. 宿主 UI 已挂 e2e/support/testids.ts 冻结的 data-testid;
 *   3. 终端能力已由宿主接入(右侧面板,非顶部按钮)。
 *
 * 主路径:TC-TRM-01。状态:待宿主集成(依赖宿主 UI 改造落地)。
 */

test.describe("TC-TRM 终端整合", () => {
  test("TC-TRM-01 终端入口收敛 | 顶部无终端按钮,底部按钮开右侧终端", async ({ page }) => {
    // 步骤 1: 打开工作台首页
    await page.goto("/");
    await page.getByTestId(T.messageInput).waitFor();

    // 断言: 顶部工具栏无终端按钮(通过标准的负向部分)——
    //        顶部区域(top-bar)内不得存在任何终端入口
    await expect(page.getByTestId(T.topTerminalBtn)).toHaveCount(0);
    const topBar = page.locator("header, [data-testid='top-bar']").first();
    await expect(topBar.getByRole("button", { name: /终端|terminal/i })).toHaveCount(0);

    // 步骤 2: 点击底部终端按钮
    await page.getByTestId(T.bottomTerminalBtn).click();

    // 断言: 右侧终端面板打开(通过标准的正向部分)——
    //        面板可见且锚定右侧(data-side=right)
    const panel = page.getByTestId(T.terminalPanel);
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("data-side", "right");

    // 断言: 终端可交互(命令输入框聚焦可用)
    await expect(panel.getByTestId(T.terminalInput)).toBeVisible();
    await panel.getByTestId(T.terminalInput).click();
    await expect(panel.getByTestId(T.terminalInput)).toBeFocused();

    // 步骤 3: 再次点击底部按钮,面板收起(入口收敛:同一按钮开合)
    await page.getByTestId(T.bottomTerminalBtn).click();
    await expect(panel).toBeHidden();
  });
});
