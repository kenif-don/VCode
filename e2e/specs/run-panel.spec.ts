import { test, expect } from "@playwright/test";
import { T } from "../support/testids";

/**
 * FR-4 运行面板(hba-run)验收用例(TC-RUN-01 ~ TC-RUN-03)
 *
 * 前置条件:
 *   1. `zcode --web` 已启动,已安装 hba-run 插件,工作区可写(.hba/run.json);
 *   2. 面板已挂 e2e/support/testids.ts 冻结的 data-testid
 *      (现面板使用 id 选择器,见 plugins/hba-run/ui/panel.html);
 *   3. 可用的长跑命令(node 一行脚本即可,跨平台)。
 *
 * 主路径:TC-RUN-01、TC-RUN-02。状态:待宿主集成
 * (配置 CRUD + 进程树停止已有 tests/run/test-server.mjs 自动化覆盖)。
 */

// 跨平台长跑命令:每 100ms 输出 tick;与 tests/run 同款
const TICK_CMD = `node -e "console.log('PID='+process.pid);setInterval(()=>console.log('tick'),100)"`;

test.describe("TC-RUN 运行面板", () => {
  test("TC-RUN-01 运行配置增删改 | 持久化重开可见", async ({ page }) => {
    // 步骤 1: 打开 hba-run 面板,点击「新建」
    await page.goto("/plugins/hba-run");
    await page.getByTestId(T.runConfigList).waitFor();
    await page.getByTestId(T.runConfigNewBtn).click();

    // 步骤 2: 填写配置并保存(名称/命令/工作目录/环境变量/预览 URL)
    await page.getByTestId(T.runConfigName).fill("e2e dev server");
    await page.getByTestId(T.runConfigCommand).fill("npm run dev");
    await page.getByTestId(T.runConfigCwd).fill("packages/app");
    await page.getByTestId(T.runConfigEnv).fill("PORT=5173");
    await page.getByTestId(T.runConfigPreviewUrl).fill("http://localhost:5173");
    await page.getByTestId(T.runConfigSaveBtn).click();

    // 断言: 列表出现新配置项(增)
    const item = page.getByTestId(T.runConfigItem).filter({ hasText: "e2e dev server" });
    await expect(item).toHaveCount(1);

    // 步骤 3: 改名后再次保存(改)
    await page.getByTestId(T.runConfigName).fill("e2e dev server v2");
    await page.getByTestId(T.runConfigSaveBtn).click();
    await expect(
      page.getByTestId(T.runConfigItem).filter({ hasText: "e2e dev server v2" })
    ).toHaveCount(1);

    // 步骤 4: 重载页面,验证持久化(通过标准:持久化重开可见)
    await page.reload();
    await expect(
      page.getByTestId(T.runConfigItem).filter({ hasText: "e2e dev server v2" })
    ).toHaveCount(1);

    // 步骤 5: 删除配置(删)
    await page.getByTestId(T.runConfigItem).filter({ hasText: "e2e dev server v2" }).click();
    await page.getByTestId(T.runConfigDeleteBtn).click();
    await expect(
      page.getByTestId(T.runConfigItem).filter({ hasText: "e2e dev server v2" })
    ).toHaveCount(0);

    // 断言: 删除同样持久化(重载后仍不可见)
    await page.reload();
    await expect(
      page.getByTestId(T.runConfigItem).filter({ hasText: "e2e dev server v2" })
    ).toHaveCount(0);
  });

  test("TC-RUN-02 一键运行与停止 | 输出实时显示停止后进程退出", async ({ page }) => {
    // 步骤 1: 新建并选中一条长跑配置
    await page.goto("/plugins/hba-run");
    await page.getByTestId(T.runConfigNewBtn).click();
    await page.getByTestId(T.runConfigName).fill("e2e ticker");
    await page.getByTestId(T.runConfigCommand).fill(TICK_CMD);
    await page.getByTestId(T.runConfigSaveBtn).click();
    await page.getByTestId(T.runConfigItem).filter({ hasText: "e2e ticker" }).click();

    // 步骤 2: 点击「运行」
    await page.getByTestId(T.runBtn).click();

    // 断言: 状态转 running
    await expect(page.getByTestId(T.runStatus)).toHaveText(/running/);

    // 断言: 输出实时显示(通过标准)——控制台在数秒内出现多条 tick
    await expect(
      page.getByTestId(T.runOutputLine).filter({ hasText: "tick" })
    ).not.toHaveCount(0, { timeout: 10_000 });
    await page.waitForTimeout(1500);
    const lines = page.getByTestId(T.runOutputLine).filter({ hasText: "tick" });
    await expect(lines).not.toHaveCount(0);

    // 步骤 3: 点击「停止」
    await page.getByTestId(T.runStopBtn).click();

    // 断言: 停止后进程退出(通过标准)——状态转 stopped/exited,且输出不再增长
    await expect(page.getByTestId(T.runStatus)).toHaveText(/stopped|exited/, { timeout: 10_000 });
    const countAfterStop = await page.getByTestId(T.runOutputLine).count();
    await page.waitForTimeout(2000);
    await expect(page.getByTestId(T.runOutputLine)).toHaveCount(countAfterStop);

    // 注:进程树被真正杀死(含子进程)的黑盒验证由 tests/run/test-server.mjs
    //    的 run_stop 用例负责(GUI 层以状态与输出停滞为准)。
  });

  test("TC-RUN-03 预览联动", async ({ page }) => {
    // 步骤 1: 运行一条带 previewUrl 的配置
    await page.goto("/plugins/hba-run");
    await page.getByTestId(T.runConfigNewBtn).click();
    await page.getByTestId(T.runConfigName).fill("e2e preview");
    await page.getByTestId(T.runConfigCommand).fill(TICK_CMD);
    await page.getByTestId(T.runConfigPreviewUrl).fill("http://localhost:5173");
    await page.getByTestId(T.runConfigSaveBtn).click();
    await page.getByTestId(T.runConfigItem).filter({ hasText: "e2e preview" }).click();
    await page.getByTestId(T.runBtn).click();
    await expect(page.getByTestId(T.runStatus)).toHaveText(/running/);

    // 步骤 2: 点击预览链接
    const popupPromise = page.waitForEvent("popup");
    await page.getByTestId(T.runPreviewLink).click();
    const popup = await popupPromise;

    // 断言: 预览在新窗口/标签打开且 URL 与配置一致(预览联动)
    await popup.waitForLoadState();
    expect(popup.url()).toContain("localhost:5173");

    // 清理:停止运行
    await page.getByTestId(T.runStopBtn).click();
    await expect(page.getByTestId(T.runStatus)).toHaveText(/stopped|exited/);
  });
});
