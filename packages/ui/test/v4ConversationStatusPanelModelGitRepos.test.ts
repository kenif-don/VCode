import { describe, expect, it } from "vitest";
import type { GitRepositorySummary } from "@zcode/shared";
import {
  buildConversationStatusPanelModel,
  type ConversationStatusPanelGitRepository,
} from "@/v4/conversationStatusPanelModel.js";

function gitSummary(overrides: Partial<GitRepositorySummary> = {}): GitRepositorySummary {
  return {
    workspacePath: "/repo",
    repoRoot: "/repo",
    workspaceInRepoPath: "",
    autoRefreshWatchPaths: [],
    branchName: "main",
    trackingBranchName: "origin/main",
    headRefType: "branch",
    ahead: 0,
    behind: 0,
    isDirty: true,
    isGitAvailable: true,
    isRepository: true,
    ...overrides,
  };
}

function repoRow(
  key: string,
  overrides: Partial<ConversationStatusPanelGitRepository> = {},
): ConversationStatusPanelGitRepository {
  return {
    key,
    requestPath: key,
    label: key,
    branchName: "main",
    headRefType: "branch",
    dirtyFileCount: 0,
    added: 0,
    removed: 0,
    ahead: 0,
    behind: 0,
    isClean: true,
    loading: false,
    ...overrides,
  };
}

describe("buildConversationStatusPanelModel 多仓（子目录仓库发现）", () => {
  it("发现多个仓库时保留选择器数据并聚合计数", () => {
    const model = buildConversationStatusPanelModel({
      gitSummary: gitSummary({ workspacePath: "/workspace/root-repo" }),
      gitDirtyFileCount: 2,
      gitWorktreeChangeSummary: { added: 3, removed: 1 },
      gitRepositories: [
        repoRow("/workspace/root-repo", {
          label: "root-repo",
          added: 3,
          removed: 1,
          dirtyFileCount: 2,
          isClean: false,
        }),
        repoRow("/workspace/sub-a", {
          label: "sub-a",
          branchName: "dev",
          added: 5,
          removed: 2,
          dirtyFileCount: 1,
          isClean: false,
        }),
      ],
      activeGitRepositoryKey: "/workspace/root-repo",
    });

    expect(model.git).toMatchObject({
      // 选中仓口径（分支切换器/操作区作用对象）。
      branchName: "main",
      added: 3,
      removed: 1,
      dirtyFileCount: 2,
      activeRepositoryKey: "/workspace/root-repo",
      // 全仓聚合（折叠头部）。
      totalAdded: 8,
      totalRemoved: 3,
    });
    expect(model.git?.repositories.map((repository) => repository.key)).toEqual([
      "/workspace/root-repo",
      "/workspace/sub-a",
    ]);
  });

  it("activeGitRepositoryKey 无效时回退首个仓库", () => {
    const model = buildConversationStatusPanelModel({
      gitSummary: gitSummary({ branchName: "trunk" }),
      gitRepositories: [
        repoRow("/workspace/sub-a", { branchName: "dev", added: 1, removed: 0 }),
        repoRow("/workspace/sub-b", { branchName: "feat", added: 2, removed: 1 }),
      ],
      activeGitRepositoryKey: "/workspace/gone",
    });

    expect(model.git?.activeRepositoryKey).toBe("/workspace/sub-a");
    // 选中仓由 active 行决定；gitSummary 与 active 不同源时退到行内值，不串仓。
    expect(model.git?.added).toBe(1);
    expect(model.git?.branchName).toBe("dev");
  });

  it("根目录不是仓库但子目录有仓库时仍然展示 Git 区", () => {
    const model = buildConversationStatusPanelModel({
      gitSummary: gitSummary({ isRepository: false, isGitAvailable: true }),
      gitRepositories: [repoRow("/workspace/sub-a", { label: "sub-a", added: 4, removed: 0 })],
      activeGitRepositoryKey: "/workspace/sub-a",
    });

    expect(model.git).not.toBeNull();
    expect(model.git?.activeRepositoryKey).toBe("/workspace/sub-a");
    expect(model.hasContent).toBe(true);
  });

  it("发现列表为空且根摘要非仓库时整个 Git 区隐藏", () => {
    const model = buildConversationStatusPanelModel({
      gitSummary: gitSummary({ isRepository: false, isGitAvailable: true }),
      gitRepositories: [],
    });

    expect(model.git).toBeNull();
    expect(model.hasContent).toBe(false);
  });

  it("未接入发现链路的调用方退化为单仓模型", () => {
    const model = buildConversationStatusPanelModel({
      gitSummary: gitSummary({ branchName: "release", ahead: 2, behind: 1 }),
      gitDirtyFileCount: 1,
      gitWorktreeChangeSummary: { added: 2, removed: 0 },
    });

    expect(model.git).toMatchObject({
      branchName: "release",
      ahead: 2,
      behind: 1,
      added: 2,
      removed: 0,
      dirtyFileCount: 1,
      totalAdded: 2,
      totalRemoved: 0,
      activeRepositoryKey: "/repo",
    });
    expect(model.git?.repositories).toHaveLength(1);
    expect(model.git?.isClean).toBe(false);
  });
});
