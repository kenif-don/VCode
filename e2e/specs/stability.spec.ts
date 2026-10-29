import { test, expect } from "@playwright/test";
import { T } from "../support/testids";

/**
 * 稳定性验收用例(TC-STB-02 断网恢复;TC-STB-01 见 scripts/poc/stability-poc.mjs)
 *
 * 前置条件:
 *   1. `zcode --web` 已启动,宿主 UI 已挂 e2e/support/testids.ts 冻结的 data-testid;
 *   2. 会话中已有至少一条历史消息(断网前基线)。
 *
 * TC-STB-01(杀进程恢复 100 次)不走 GUI:由 scripts/poc/stability-poc.mjs
 * 驱动真实宿主进程执行启动→随机 kill→重启→校验恢复标记,输出成功率 JSON。
 *
 * 状态:待宿主集成。
 */

test.describe("TC-STB 稳定性", () => {
  test("TC-STB-02 断网 30s 内恢复", async ({ page, context }) => {
    // 步骤 1: 正常打开会话,确认在线可用(基线)
    await page.goto("/");
    const msgList = page.getByTestId(T.messageList);
    await msgList.waitFor();
    await expect(page.getByTestId(T.messageInput)).toBeVisible();

    // 步骤 2: 模拟断网(Playwright 网络拦截层)
    await context.setOffline(true);
    await page.waitForTimeout(2000);

    // 断言: 断网期间 UI 显示离线/重连中状态,而非静默失败
    await expect(
      page.getByTestId("conn-badge").or(page.getByText(/离线|重连|offline|reconnect/i))
    ).toBeVisible();

    // 步骤 3: 恢复网络,开始计时
    const t0 = Date.now();
    await context.setOffline(false);

    // 断言: 30s 内恢复(通过标准)——连接徽标回到在线态
    const onlineBadge = page
      .getByTestId("conn-badge")
      .or(page.getByText(/已连接|在线|connected|online/i))
      .first();
    await onlineBadge.waitFor({ timeout: 30_000 });
    const elapsed = Date.now() - t0;
    expect(elapsed, `恢复耗时 ${elapsed}ms 超 30s`).toBeLessThanOrEqual(30_000);

    // 断言: 恢复后功能可用(消息输入可发送)
    await page.getByTestId(T.messageInput).fill("恢复后冒烟");
    await expect(page.getByTestId(T.messageSend)).toBeEnabled();

    await test.info().attach("recovery-ms", { body: String(elapsed) });
  });
});
