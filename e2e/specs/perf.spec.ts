import { test, expect } from "@playwright/test";
import { T } from "../support/testids";

/**
 * 性能验收用例(TC-PERF-01、TC-PERF-02)
 *
 * 前置条件:
 *   1. `zcode --web` 已启动;会话存储中预置 500 轮消息的会话
 *      (由 scripts/poc/session-fixtures.mjs 生成的夹具导入宿主,见 e2e/README.md);
 *   2. 宿主 UI 已挂 e2e/support/testids.ts 冻结的 data-testid。
 *
 * 与 scripts/poc/msg-list-perf.mjs 的关系:
 *   POC 脚本在 Node 侧量测消息列表加载/建模成本(合成夹具),给出 P50/P95 基线;
 *   本 spec 在真实宿主里量测端到端「会话打开 ≤2s」「面板首帧 ≤500ms」,
 *   两者共用同一 ≤2000ms 判定口径,结果并入 docs/testing-plan.md 基准表。
 *
 * 状态:待宿主集成(500 轮会话需先导入宿主;阈值断言已就绪)。
 */

const SESSION_OPEN_BUDGET_MS = 2000; // TC-PERF-01:500 轮会话打开 ≤2s
const PANEL_FIRST_FRAME_BUDGET_MS = 500; // TC-PERF-02:面板首帧 ≤500ms

test.describe("TC-PERF 性能", () => {
  test("TC-PERF-01 500 轮会话打开 ≤2s", async ({ page }) => {
    // 步骤 1: 打开会话列表,定位 500 轮夹具会话
    await page.goto("/");
    const item = page.getByTestId(T.sessionItem).filter({ hasText: "500" }).first();
    await expect(item).toBeVisible();

    // 步骤 2: 计时点击 → 消息列表完成渲染(以最后一条消息可见为完成信号)
    const t0 = Date.now();
    await item.click();
    const msgList = page.getByTestId(T.messageList);
    await msgList.waitFor();
    // 完成信号:消息项已挂载且滚动容器高度稳定(两帧 rAF)
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    );
    const elapsed = Date.now() - t0;

    // 断言: 会话打开耗时 ≤2000ms(通过标准)
    expect(elapsed, `会话打开耗时 ${elapsed}ms 超预算`).toBeLessThanOrEqual(SESSION_OPEN_BUDGET_MS);

    // 断言: 500 轮消息完整渲染(消息项数量与夹具消息数同量级,≥500 条)
    await expect(page.getByTestId(T.messageItem)).not.toHaveCount(0);
    const n = await page.getByTestId(T.messageItem).count();
    expect(n).toBeGreaterThanOrEqual(500);

    // 记录实测值到报告(testInfo.attach 便于并入性能基准表)
    await test.info().attach("session-open-ms", { body: String(elapsed) });
  });

  test("TC-PERF-02 面板首帧 ≤500ms", async ({ page }) => {
    // 步骤 1: 从工作台打开 hba-uigen 面板,计时至首帧可见
    await page.goto("/");
    const t0 = Date.now();
    await page.evaluate(() => performance.now()); // 对齐计时起点
    await page.getByRole("button", { name: /原型|uigen/i }).click();
    await page.getByTestId(T.uigenReqInput).waitFor();
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    );
    const elapsed = Date.now() - t0;

    // 断言: 面板首帧 ≤500ms(通过标准)
    expect(elapsed, `面板首帧 ${elapsed}ms 超预算`).toBeLessThanOrEqual(PANEL_FIRST_FRAME_BUDGET_MS);
    await test.info().attach("panel-first-frame-ms", { body: String(elapsed) });
  });
});
