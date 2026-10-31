import { describe, expect, it } from "vitest";
import {
  matchesGitBranchPickerSearch,
  toGitRepositoryPickerValue,
} from "./display.js";

describe("toGitRepositoryPickerValue", () => {
  it("编码为带前缀的 value，key 用长度前缀圈出", () => {
    expect(
      toGitRepositoryPickerValue({ key: "/workspace/pkg", label: "pkg", branchName: "main" }),
    ).toBe("repository 14:/workspace/pkg pkg main");
  });

  it("分支名为空时搜索面只剩 label", () => {
    expect(toGitRepositoryPickerValue({ key: "/workspace/pkg", label: "pkg", branchName: null })).toBe(
      "repository 14:/workspace/pkg pkg ",
    );
    expect(
      toGitRepositoryPickerValue({ key: "/workspace/pkg", label: "pkg" }),
    ).toBe("repository 14:/workspace/pkg pkg ");
  });

  it("label 与分支名相同但 key 不同的仓库 value 仍互不相同", () => {
    const left = toGitRepositoryPickerValue({ key: "/workspace/app", label: "app", branchName: "main" });
    const right = toGitRepositoryPickerValue({ key: "/workspace/other/app", label: "app", branchName: "main" });
    expect(left).not.toBe(right);
  });
});

describe("matchesGitBranchPickerSearch", () => {
  const repositoryValue = toGitRepositoryPickerValue({
    key: "/workspace/packages/pkg",
    label: "packages/pkg",
    branchName: "feature/git-picker",
  });

  it("仓库行按 label 匹配", () => {
    expect(matchesGitBranchPickerSearch(repositoryValue, "packages/")).toBe(true);
    expect(matchesGitBranchPickerSearch(repositoryValue, "pkg")).toBe(true);
    expect(matchesGitBranchPickerSearch(repositoryValue, "other")).toBe(false);
  });

  it("仓库行按当前分支名匹配", () => {
    expect(matchesGitBranchPickerSearch(repositoryValue, "git-picker")).toBe(true);
    expect(matchesGitBranchPickerSearch(repositoryValue, "feature/")).toBe(true);
    expect(matchesGitBranchPickerSearch(repositoryValue, "release")).toBe(false);
  });

  it("repoRoot 绝对路径不进搜索面", () => {
    // key 里的 workspace 目录名只出现在 repoRoot，label / 分支名都没有。
    expect(matchesGitBranchPickerSearch(repositoryValue, "workspace")).toBe(false);
  });

  it("空搜索词显示全部，大小写不敏感", () => {
    expect(matchesGitBranchPickerSearch(repositoryValue, "  ")).toBe(true);
    expect(matchesGitBranchPickerSearch(repositoryValue, "PACKAGES")).toBe(true);
    expect(matchesGitBranchPickerSearch(repositoryValue, "GIT-PICKER")).toBe(true);
  });

  it("普通分支行走分支名匹配", () => {
    expect(matchesGitBranchPickerSearch("feature/git-picker", "picker")).toBe(true);
    expect(matchesGitBranchPickerSearch("main", "picker")).toBe(false);
    expect(matchesGitBranchPickerSearch("main", "")).toBe(true);
  });
});
