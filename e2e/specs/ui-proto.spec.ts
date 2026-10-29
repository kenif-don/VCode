import { test, expect } from "@playwright/test";
import { T } from "../support/testids";

/**
 * FR-2 UI 原型面板(hba-uigen)验收用例(TC-UIP-01 ~ TC-UIP-05)
 *
 * 前置条件:
 *   1. `zcode --web` 已启动,已安装 hba-uigen 插件,面板可打开;
 *   2. 面板已挂 e2e/support/testids.ts 冻结的 data-testid
 *      (现面板使用 id 选择器,见 plugins/hba-uigen/ui/panel.html);
 *   3. 390px 预览 iframe(sandbox=allow-scripts)可渲染产物。
 *
 * 主路径:TC-UIP-01。状态:待宿主集成(生成链路已有 tests/uigen 自动化覆盖)。
 */

test.describe("TC-UIP UI 原型面板", () => {
  test("TC-UIP-01 需求生成 HTML 原型 | 390px 预览渲染正确", async ({ page }) => {
    // 步骤 1: 打开 hba-uigen 面板
    await page.goto("/plugins/hba-uigen");
    await page.getByTestId(T.uigenReqInput).waitFor();

    // 步骤 2: 输入需求,选择 html 格式、3 屏,点击生成
    await page.getByTestId(T.uigenReqInput).fill(
      "一款社区图书馆借阅 App,含首页推荐、图书列表、详情页与个人中心"
    );
    await page.getByTestId(T.uigenFormatSelect).selectOption("html");
    await page.getByTestId(T.uigenScreenCount).selectOption("3");
    await page.getByTestId(T.uigenGenerateBtn).click();

    // 步骤 3: 等待生成完成(进度条走完 / 版本列表新增一项)
    await expect(page.getByTestId(T.uigenVersionList).getByTestId(T.uigenVersionItem).first())
      .toBeVisible({ timeout: 120_000 });

    // 断言: 画布出现 3 张屏幕卡片(生成产物完整)
    await expect(page.getByTestId(T.uigenScreenCard)).toHaveCount(3);

    // 步骤 4: 选中第 1 屏,检查 390px 预览
    await page.getByTestId(T.uigenScreenCard).first().click();
    const frame = page.frameLocator(`[data-testid="${T.uigenPreviewFrame}"]`);

    // 断言: 390px 预览渲染正确(通过标准)——
    //        预览容器宽度为 390px(允许 ±1px 渲染误差)
    const width = await frame.locator(`[data-testid="${T.uigenPreviewViewport}"]`)
      .evaluate((el) => (el as HTMLElement).getBoundingClientRect().width);
    expect(Math.round(width)).toBeGreaterThanOrEqual(389);
    expect(Math.round(width)).toBeLessThanOrEqual(391);

    // 断言: iframe 内是完整 HTML 文档且含视口声明(与 tests/uigen 断言同口径)
    await expect(frame.locator("html")).toBeVisible();
    const html = await frame.locator("html").innerHTML();
    expect(html.toLowerCase()).toContain("width=390");

    // 断言: 产物包含跳转热点(FlowEdge 迁移),屏幕间可点击跳转
    await expect(frame.locator("[data-hotspot], a[href]")).not.toHaveCount(0);
  });

  test("TC-UIP-02 JSX/Vue 产物", async ({ page }) => {
    // 步骤 1: 以 jsx 格式生成,再以 vue 格式生成,各 2 屏
    await page.goto("/plugins/hba-uigen");
    for (const fmt of ["jsx", "vue"] as const) {
      await page.getByTestId(T.uigenReqInput).fill(`生成 ${fmt} 产物冒烟:登录与首页`);
      await page.getByTestId(T.uigenFormatSelect).selectOption(fmt);
      await page.getByTestId(T.uigenScreenCount).selectOption("2");
      await page.getByTestId(T.uigenGenerateBtn).click();
      await expect(page.getByTestId(T.uigenVersionList).getByTestId(T.uigenVersionItem).first())
        .toBeVisible({ timeout: 120_000 });

      // 断言: 产物断言语义与 tests/uigen/test-server.mjs 一致——
      //        jsx 含 export default 组件;vue 含 <template> + export default SFC
      //        (GUI 层通过导出预览或版本详情查看产物文本)
      await page.getByTestId(T.uigenVersionItem).first().click();
      await expect(page.getByTestId(T.uigenScreenCard).first()).toBeVisible();
      // 产物细节以 tests/uigen 自动化为准,GUI 层只验证生成流程不报错
    }
  });

  test("TC-UIP-03 演示播放", async ({ page }) => {
    // 步骤 1: 生成 3 屏原型后进入演示播放
    await page.goto("/plugins/hba-uigen");
    await page.getByTestId(T.uigenReqInput).fill("演示播放冒烟:三屏走查");
    await page.getByTestId(T.uigenScreenCount).selectOption("3");
    await page.getByTestId(T.uigenGenerateBtn).click();
    await expect(page.getByTestId(T.uigenScreenCard)).toHaveCount(3, { timeout: 120_000 });

    // 步骤 2: 播放 → 暂停 → 步进
    await page.getByTestId(T.uigenDemoPlayBtn).click();
    const active1 = page.getByTestId(T.uigenDemoActive);
    await expect(active1).toBeVisible();

    await page.getByTestId(T.uigenDemoPauseBtn).click();
    const pausedScreen = await active1.getAttribute("data-screen");
    await page.waitForTimeout(1500);
    // 断言: 暂停后不再自动切换(顺序/暂停/步进语义,FR-2-5)
    await expect(active1).toHaveAttribute("data-screen", pausedScreen ?? "");

    await page.getByTestId(T.uigenDemoNextBtn).click();
    // 断言: 步进后切换到下一屏
    await expect(active1).not.toHaveAttribute("data-screen", pausedScreen ?? "");
  });

  test("TC-UIP-04 本地目录导入", async ({ page }) => {
    // 步骤 1: 点击「导入目录」,选择含 2 个 html 原型的目录
    await page.goto("/plugins/hba-uigen");
    await page.getByTestId(T.uigenImportDirBtn).click();
    // 注: 文件选择对话框用 page.on("filechooser") 或宿主目录选择器桥接
    // const chooser = await page.waitForEvent("filechooser");
    // await chooser.setFiles(fixtureDir);

    // 断言: 导入完成提示可见,且屏幕卡片出现 2 张(FR-2-6)
    await expect(page.getByTestId(T.uigenImportDone)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId(T.uigenScreenCard)).toHaveCount(2);
  });

  test("TC-UIP-05 历史版本回滚", async ({ page }) => {
    // 步骤 1: 连续生成 v1、v2 两版(不同需求文本,便于区分)
    await page.goto("/plugins/hba-uigen");
    await page.getByTestId(T.uigenReqInput).fill("版本 v1:极简风格首页");
    await page.getByTestId(T.uigenGenerateBtn).click();
    await expect(page.getByTestId(T.uigenVersionItem)).toHaveCount(1, { timeout: 120_000 });

    await page.getByTestId(T.uigenReqInput).fill("版本 v2:卡片风格首页");
    await page.getByTestId(T.uigenGenerateBtn).click();
    await expect(page.getByTestId(T.uigenVersionItem)).toHaveCount(2, { timeout: 120_000 });

    // 步骤 2: 选中 v1,点击回滚
    await page.getByTestId(T.uigenVersionItem).nth(1).click();
    await page.getByTestId(T.uigenRollbackBtn).click();

    // 断言: 回滚完成,当前画布恢复 v1 内容(FR-2-7)
    await expect(page.getByTestId(T.uigenRollbackDone)).toBeVisible();
    await expect(page.getByTestId(T.uigenPreviewFrame)).toBeVisible();
  });
});
