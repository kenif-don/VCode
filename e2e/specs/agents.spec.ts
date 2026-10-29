import { test, expect } from "@playwright/test";
import { T } from "../support/testids";

/**
 * FR-1 六子智能体验收用例(TC-AGT-01 ~ TC-AGT-04)
 *
 * 前置条件(见 e2e/README.md):
 *   1. `zcode --web` 已启动,ZCODE_WEB_URL 指向其地址;
 *   2. hba-on-zcode\agents\ 下 6 个智能体定义已装入 ZCode(<repo>/.zcode/agents/);
 *   3. 宿主 UI 已挂 e2e/support/testids.ts 冻结的 data-testid。
 *
 * 状态:待宿主集成(骨架完整,依赖宿主 UI testid 与子智能体派发机制)。
 */

test.describe("TC-AGT 六子智能体", () => {
  test("TC-AGT-01 六智能体定义加载与校验", async ({ page }) => {
    // 步骤 1: 打开 ZCode 设置页,进入智能体(Agents)面板
    await page.goto("/settings");
    await page.getByTestId(T.settingsAgentsPanel).waitFor();

    // 步骤 2: 收集面板中列出的智能体行
    const rows = page.getByTestId(T.agentRow);
    // 断言: 设置页列出 6 项(通过标准)
    await expect(rows).toHaveCount(6);

    // 步骤 3: 逐项核对名称集合与校验徽标
    const expected = ["architect", "browser-tester", "coder", "planner", "reviewer", "ui-prototype"];
    for (const name of expected) {
      const row = rows.filter({ has: page.locator(`[data-agent="${name}"]`) });
      // 断言: 每个智能体定义存在且名称与文件名一致
      await expect(row).toBeVisible();
      // 断言: 校验通过(frontmatter 合法、tools 白名单、model/thoughtLevel 合法)
      await expect(row.getByTestId(T.agentValidationBadge)).toHaveText("ok");
    }

    // 步骤 4: 负向抽查——校验徽标不得出现 fail(任何一项解析失败都会在此暴露)
    await expect(page.getByText("fail", { exact: true })).toHaveCount(0);
  });

  test("TC-AGT-02 派发与结果回注", async ({ page }) => {
    // 步骤 1: 打开主会话(新建会话页)
    await page.goto("/session/new");
    const msgList = page.getByTestId(T.messageList);
    await msgList.waitFor();

    // 步骤 2: 在消息输入框输入任务,并通过智能体选择器派发给 coder 子智能体
    await page.getByTestId(T.messageInput).fill("统计 scripts/poc 目录下脚本数量并说明各自作用");
    await page.getByTestId(T.agentPicker).click();
    await page.getByTestId(T.agentOption).filter({ hasText: "coder" }).click();
    await page.getByTestId(T.messageSend).click();

    // 步骤 3: 等待子会话产出回注主会话(超时放宽,真实派发耗时不可控)
    const resultCard = page.getByTestId(T.subagentResultCard).first();
    await resultCard.waitFor({ timeout: 120_000 });

    // 断言: 子会话产出回注主会话消息流(通过标准)——
    //        消息列表中出现 agent-result 角色的消息项
    await expect(
      msgList.getByTestId(T.messageItem).filter({ has: page.locator('[data-role="agent-result"]') })
    ).toHaveCount(1);

    // 断言: 回注内容非空(产出真实写回,而非空壳卡片)
    await expect(resultCard).not.toBeEmpty();

    // 断言: 卡片提供子会话跳转入口,可回溯派发来源
    await expect(resultCard.getByTestId(T.subagentSessionLink)).toBeVisible();
  });

  test("TC-AGT-03 并行子智能体无串扰", async ({ page }) => {
    // 步骤 1: 在同一主会话并行派发两个不同子智能体(coder / reviewer)
    await page.goto("/session/new");
    await page.getByTestId(T.messageInput).fill("并行任务:分别报告你的智能体名称与颜色");
    await page.getByTestId(T.agentPicker).click();
    await page.getByTestId(T.agentOption).filter({ hasText: "coder" }).click();
    await page.getByTestId(T.agentOption).filter({ hasText: "reviewer" }).click();
    await page.getByTestId(T.messageSend).click();

    // 步骤 2: 等待两路回注全部到达
    await expect(page.getByTestId(T.subagentResultCard)).toHaveCount(2, { timeout: 180_000 });

    // 断言: 无串扰——coder 回注中不含 reviewer 的标识文本,反之亦然
    const cards = page.getByTestId(T.subagentResultCard);
    const coderCard = cards.filter({ hasText: "coder" }).first();
    const reviewerCard = cards.filter({ hasText: "reviewer" }).first();
    await expect(coderCard).not.toContainText("reviewer 的回答");
    await expect(reviewerCard).not.toContainText("coder 的回答");

    // 断言: 两条回注分属不同子会话入口(会话 id 不同)
    const coderLink = coderCard.getByTestId(T.subagentSessionLink);
    const reviewerLink = reviewerCard.getByTestId(T.subagentSessionLink);
    expect(await coderLink.getAttribute("data-session-id")).not.toBe(
      await reviewerLink.getAttribute("data-session-id")
    );
  });

  test("TC-AGT-04 只读智能体写操作被拒", async ({ page }) => {
    // 步骤 1: 派发只读智能体 reviewer,任务中明确要求写文件
    await page.goto("/session/new");
    await page.getByTestId(T.messageInput).fill("请用 Write 工具创建 tests/should-not-exist.txt");
    await page.getByTestId(T.agentPicker).click();
    await page.getByTestId(T.agentOption).filter({ hasText: "reviewer" }).click();
    await page.getByTestId(T.messageSend).click();

    // 步骤 2: 等待子会话结束回注
    const resultCard = page.getByTestId(T.subagentResultCard).first();
    await resultCard.waitFor({ timeout: 120_000 });

    // 断言: 写操作被拒(通过标准)——回注文本包含工具不可用/被拒绝的说明
    await expect(resultCard).toContainText(/Write.*(不可用|被拒|未授权|not allowed)/i);

    // 断言: 不得出现"已创建"之类成功表述(失败可见性,不允许静默伪装成功)
    await expect(resultCard).not.toContainText(/已创建\s*tests\/should-not-exist/);

    // 注:文件系统侧的负向断言(该文件确实不存在)由 tests/agents/validate-agents.mjs
    //    与宿主权限层保证,GUI 层只断言可见的拒绝反馈。
  });
});
