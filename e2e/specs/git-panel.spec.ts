import { test, expect } from "@playwright/test";
import { T } from "../support/testids";

/**
 * FR-3 Git 面板验收用例(TC-GIT-01、TC-GIT-02)
 *
 * 前置条件:
 *   1. `zcode --web` 已启动,工作区是一个 git 仓库,且预先制造好脏状态
 *      (1 个修改文件 + 1 个未跟踪文件,见 e2e/README.md 的 setup 脚本);
 *   2. 宿主 UI 已挂 e2e/support/testids.ts 冻结的 data-testid。
 *
 * 主路径:TC-GIT-01。状态:待宿主集成(依赖宿主 Git 面板与 worktree 能力)。
 */

test.describe("TC-GIT Git 面板", () => {
  test("TC-GIT-01 差异视图与仓库状态一致", async ({ page }) => {
    // 步骤 1: 打开 Git 面板
    await page.goto("/");
    const gitPanel = page.getByTestId(T.gitPanel);
    await gitPanel.waitFor();

    // 步骤 2: 读取面板中的仓库状态列表(工作区脏文件清单)
    const statusItems = gitPanel.getByTestId(T.gitStatusItem);
    await expect(statusItems).not.toHaveCount(0);

    // 断言: 状态列表与真实 git status 一致(通过标准)——
    //        面板列出的文件集合 === 预置脏状态的文件集合
    const expectedPaths = ["src/modified.ts", "src/untracked.ts"]; // setup 脚本制造
    const actualPaths: string[] = [];
    const count = await statusItems.count();
    for (let i = 0; i < count; i += 1) {
      actualPaths.push((await statusItems.nth(i).getAttribute("data-path")) ?? "");
    }
    expect(actualPaths.sort()).toEqual([...expectedPaths].sort());

    // 步骤 3: 逐文件核对差异视图
    for (const p of expectedPaths) {
      await statusItems.filter({ has: page.locator(`[data-path="${p}"]`) }).first().click();
      const diffFile = gitPanel.getByTestId(T.gitDiffFile).filter({ has: page.locator(`[data-path="${p}"]`) });

      // 断言: 差异视图出现该文件的 diff 块
      await expect(diffFile).toHaveCount(1);

      // 断言: diff 内容与仓库真实 diff 同向(含 +/- 行标记,不允许空 diff)
      await expect(diffFile).toContainText(/[+-]/);
    }

    // 断言: 状态徽标口径一致(修改/未跟踪的分类与 git status 一致)
    await expect(
      statusItems.filter({ has: page.locator('[data-path="src/untracked.ts"]') })
    ).toContainText(/untracked|未跟踪/i);
    await expect(
      statusItems.filter({ has: page.locator('[data-path="src/modified.ts"]') })
    ).toContainText(/modified|已修改/i);
  });

  test("TC-GIT-02 worktree 会话创建", async ({ page }) => {
    // 步骤 1: 打开 Git 面板,点击「创建 worktree 会话」
    await page.goto("/");
    const gitPanel = page.getByTestId(T.gitPanel);
    await gitPanel.waitFor();
    await gitPanel.getByTestId(T.gitWorktreeCreateBtn).click();

    // 步骤 2: 在对话框中确认创建(默认分支名/路径即可)
    const dialog = page.getByTestId(T.gitWorktreeDialog);
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /创建|create/i }).click();

    // 断言: 新会话创建入口出现(成功提示/跳转按钮)
    const sessionBtn = page.getByTestId(T.gitWorktreeSessionBtn);
    await expect(sessionBtn).toBeVisible({ timeout: 30_000 });

    // 步骤 3: 进入新会话
    await sessionBtn.click();

    // 断言: 新会话的工作目录指向 worktree 路径(路径含 .worktrees 或 worktrees 段)
    await expect(page.getByTestId(T.messageInput)).toBeVisible();
    await expect(page.locator("[data-testid='workspace-tag'], [data-testid='workspace-path']"))
      .toContainText(/worktree/i);
  });
});
