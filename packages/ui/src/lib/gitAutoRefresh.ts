import type { GitRepositorySummary, SystemInfo } from "@zcode/shared";

export interface GitAutoRefreshWatchPath {
  path: string;
  recursive: boolean;
}

export function shouldEnableGitAutoRefreshForWorkspace(params: {
  enabled: boolean;
  currentWorkspaceKey: string;
  summaryWorkspaceKey: string;
}): boolean {
  return params.enabled && params.currentWorkspaceKey === params.summaryWorkspaceKey;
}

function normalizeWatchPath(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "/" || /^[A-Za-z]:[\\/]?$/.test(trimmed)) {
    return trimmed;
  }

  return trimmed.replace(/[\\/]+$/, "");
}

export function buildGitAutoRefreshWatchPaths(
  summary: Pick<
    GitRepositorySummary,
    "workspacePath" | "repoRoot" | "isGitAvailable" | "isRepository"
  > &
    Partial<Pick<GitRepositorySummary, "autoRefreshWatchPaths">>,
  systemInfo?: Pick<SystemInfo, "platform"> | null,
): GitAutoRefreshWatchPath[] {
  if (!summary.isGitAvailable || !summary.isRepository) {
    return [];
  }

  const workspacePath = normalizeWatchPath(summary.workspacePath || summary.repoRoot);
  const platform = systemInfo?.platform?.trim();
  const canWatchWorkspaceRecursively = Boolean(platform && platform !== "linux");
  const watchPaths: GitAutoRefreshWatchPath[] = [];
  if (workspacePath.length > 0 && canWatchWorkspaceRecursively) {
    watchPaths.push({
      path: workspacePath,
      recursive: true,
    });
  }

  for (const watchPath of summary.autoRefreshWatchPaths ?? []) {
    const path = normalizeWatchPath(watchPath.path);
    if (
      !path ||
      // 兼容旧 remote server：旧 summary 仍可能携带 workspacePath，Linux 下不能让
      // 这个历史字段重新绕过平台边界，触发慢速递归 watcher。
      (path === workspacePath && !canWatchWorkspaceRecursively) ||
      watchPaths.some((entry) => entry.path === path)
    ) {
      continue;
    }

    watchPaths.push({
      path,
      recursive: watchPath.recursive,
    });
  }

  return watchPaths;
}

/** 多仓 watch 路径聚合：各仓的元数据监听路径取并集，按 path+recursive 去重。 */
export function unionGitAutoRefreshWatchPaths(
  watchPathLists: readonly GitAutoRefreshWatchPath[][],
): GitAutoRefreshWatchPath[] {
  const union: GitAutoRefreshWatchPath[] = [];
  for (const watchPath of watchPathLists.flat()) {
    if (
      union.some(
        (entry) => entry.path === watchPath.path && entry.recursive === watchPath.recursive,
      )
    ) {
      continue;
    }
    union.push(watchPath);
  }
  return union;
}

export function stringifyGitAutoRefreshWatchPaths(
  watchPaths: readonly GitAutoRefreshWatchPath[],
): string {
  return JSON.stringify(watchPaths);
}

export function parseGitAutoRefreshWatchPaths(
  signature: string,
): GitAutoRefreshWatchPath[] {
  const parsed = JSON.parse(signature) as GitAutoRefreshWatchPath[];
  return parsed.map((watchPath) => ({
    path: watchPath.path,
    recursive: Boolean(watchPath.recursive),
  }));
}
