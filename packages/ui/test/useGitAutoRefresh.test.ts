// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fileWatcherService, systemService } = vi.hoisted(() => ({
  fileWatcherService: {
    watch: vi.fn(async () => ({ id: "watch-1" })),
    unwatch: vi.fn(async () => {}),
    disposeAll: vi.fn(),
    onDynamicChange: vi.fn(() => () => ({ dispose: vi.fn() })),
  },
  systemService: {
    info: vi.fn(async () => ({ homedir: "/home/tester", platform: "linux" })),
  },
}));

vi.mock("@/hooks/useWorkspaceServices.js", () => ({
  useWorkspaceServices: () => ({ fileWatcherService, systemService }),
}));

import { useGitAutoRefresh } from "@/hooks/useGitAutoRefresh.js";

describe("useGitAutoRefresh", () => {
  beforeEach(() => {
    fileWatcherService.watch.mockClear();
    fileWatcherService.unwatch.mockClear();
    fileWatcherService.onDynamicChange.mockClear();
    systemService.info.mockClear();
  });

  it("uses the workspace Host platform and never recursively watches a Linux workspace root", async () => {
    renderHook(() =>
      useGitAutoRefresh({
        workspacePath: "/repo",
        workspaceIdentity: "remote:ssh:linux:/repo",
        remoteSessionId: "remote-session-1",
        gitSummaries: [
          {
            workspacePath: "/repo",
            repoRoot: "/repo",
            workspaceInRepoPath: ".",
            autoRefreshWatchPaths: [
              { path: "/repo", recursive: true },
              { path: "/repo/.git", recursive: true },
            ],
            branchName: "main",
            trackingBranchName: null,
            headRefType: "branch",
            ahead: 0,
            behind: 0,
            isDirty: false,
            isGitAvailable: true,
            isRepository: true,
          },
        ],
        gitSummaryWorkspaceKey: "remote:ssh:linux:/repo",
        enabled: true,
        onRefreshGit: vi.fn(),
      }),
    );

    await waitFor(() => expect(fileWatcherService.watch).toHaveBeenCalledTimes(1));
    expect(fileWatcherService.watch).toHaveBeenCalledWith({
      path: "/repo/.git",
      recursive: true,
    });
    expect(systemService.info).toHaveBeenCalledTimes(1);
  });

  it("unions metadata watch paths across discovered repositories", async () => {
    renderHook(() =>
      useGitAutoRefresh({
        workspacePath: "/workspace",
        workspaceIdentity: "remote:ssh:linux:/workspace",
        remoteSessionId: "remote-session-1",
        gitSummaries: [
          {
            workspacePath: "/workspace",
            repoRoot: "/workspace",
            workspaceInRepoPath: ".",
            autoRefreshWatchPaths: [{ path: "/workspace/.git", recursive: true }],
            branchName: "main",
            trackingBranchName: null,
            headRefType: "branch",
            ahead: 0,
            behind: 0,
            isDirty: false,
            isGitAvailable: true,
            isRepository: true,
          },
          {
            workspacePath: "/workspace/sub-repo",
            repoRoot: "/workspace/sub-repo",
            workspaceInRepoPath: ".",
            autoRefreshWatchPaths: [{ path: "/workspace/sub-repo/.git", recursive: true }],
            branchName: "dev",
            trackingBranchName: null,
            headRefType: "branch",
            ahead: 0,
            behind: 0,
            isDirty: true,
            isGitAvailable: true,
            isRepository: true,
          },
          // 与第一个仓同路径的摘要（选中仓由 useGitRepository 单独带回）必须被去重。
          {
            workspacePath: "/workspace",
            repoRoot: "/workspace",
            workspaceInRepoPath: ".",
            autoRefreshWatchPaths: [{ path: "/workspace/.git", recursive: true }],
            branchName: "main",
            trackingBranchName: null,
            headRefType: "branch",
            ahead: 0,
            behind: 0,
            isDirty: false,
            isGitAvailable: true,
            isRepository: true,
          },
          null,
        ],
        gitSummaryWorkspaceKey: "remote:ssh:linux:/workspace",
        enabled: true,
        onRefreshGit: vi.fn(),
      }),
    );

    await waitFor(() => expect(fileWatcherService.watch).toHaveBeenCalledTimes(2));
    expect(fileWatcherService.watch).toHaveBeenCalledWith({
      path: "/workspace/.git",
      recursive: true,
    });
    expect(fileWatcherService.watch).toHaveBeenCalledWith({
      path: "/workspace/sub-repo/.git",
      recursive: true,
    });
  });
});
