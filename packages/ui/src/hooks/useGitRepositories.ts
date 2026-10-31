import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  GitDiscoveredRepository,
  GitFileChange,
  GitRepositorySummary,
} from "@zcode/shared";
import { logger } from "@/logger.js";
import {
  readSelectedGitRepository,
  writeSelectedGitRepository,
} from "@/lib/gitSelectedRepository.js";
import { shouldEnableWorkspaceRpc } from "@/lib/workspaceRpcAvailability.js";
import { useResolvedRemoteWorkspaceSessionId } from "@/hooks/useResolvedRemoteWorkspaceSessionId.js";
import { useServices } from "@/hooks/useServices.js";

/** 每轮对多少个仓并发取 status；大工作区里避免一轮刷新把 Git I/O 打满。 */
const SUMMARY_REFRESH_CONCURRENCY = 3;

export interface GitRepositoryEntry {
  /** 仓库身份键 = repoRoot。 */
  key: string;
  repoRoot: string;
  /** 发给 Git 服务的作用路径：根仓是 workspacePath（保留 monorepo 子目录裁剪），嵌套仓是 repoRoot。 */
  requestPath: string;
  /** 选择器展示名：根仓为 workspace 目录名，嵌套仓为相对路径。 */
  label: string;
  isWorkspaceRoot: boolean;
  summary: GitRepositorySummary | null;
  /** worktree 行级变化（unstaged + staged）；跨仓聚合展示用。 */
  added: number;
  removed: number;
  dirtyFileCount: number;
  loading: boolean;
}

export interface GitRepositoriesState {
  workspaceKey: string;
  /** 发现扫描进行中。 */
  loading: boolean;
  error: string | null;
  /** 仓库数超过 maxRepositories 被截断。 */
  truncated: boolean;
  repositories: GitRepositoryEntry[];
  selectedRepoKey: string | null;
  /** 当前选中仓；列表为空时为 null。 */
  selectedEntry: GitRepositoryEntry | null;
  /** 选中仓并按 workspace 维度持久化；可随时重选，无锁定。 */
  selectRepository: (repoKey: string) => void;
}

interface GitRepositoriesRefreshInput {
  workspacePath: string;
  workspaceKey: string;
  refreshToken: string | number | boolean | null;
  workspaceRpcEnabled: boolean;
}

export function shouldRefreshGitRepositories(
  previous: GitRepositoriesRefreshInput | null,
  next: GitRepositoriesRefreshInput,
): boolean {
  if (!next.workspaceRpcEnabled) {
    return false;
  }

  if (!previous || !previous.workspaceRpcEnabled) {
    return true;
  }

  return (
    previous.workspacePath !== next.workspacePath ||
    previous.workspaceKey !== next.workspaceKey ||
    previous.refreshToken !== next.refreshToken
  );
}

function toRepositoryLabel(discovered: GitDiscoveredRepository, workspacePath: string): string {
  if (discovered.kind === "workspace-root") {
    // 根仓在选择器里不需要 "." 这种记号，用 workspace 目录名更可读。
    const segments = workspacePath.split(/[\\/]/).filter((segment) => segment.length > 0);
    return segments[segments.length - 1] ?? workspacePath;
  }
  return discovered.workspaceRelativePath;
}

function countDirtyFiles(unstagedChanges: GitFileChange[], stagedChanges: GitFileChange[]): number {
  // 同一文件可同时出现在 staged / unstaged，按 path 去重后再统计。
  const paths = new Set<string>();
  for (const change of unstagedChanges) {
    paths.add(change.path);
  }
  for (const change of stagedChanges) {
    paths.add(change.path);
  }
  return paths.size;
}

function sumChangeLines(changes: GitFileChange[]): { added: number; removed: number } {
  return changes.reduce(
    (result, change) => {
      result.added += change.added;
      result.removed += change.removed;
      return result;
    },
    { added: 0, removed: 0 },
  );
}

function createEntry(
  discovered: GitDiscoveredRepository,
  workspacePath: string,
): GitRepositoryEntry {
  return {
    key: discovered.repoRoot,
    repoRoot: discovered.repoRoot,
    requestPath: discovered.requestPath,
    label: toRepositoryLabel(discovered, workspacePath),
    isWorkspaceRoot: discovered.kind === "workspace-root",
    summary: null,
    added: 0,
    removed: 0,
    dirtyFileCount: 0,
    loading: true,
  };
}

/**
 * 多仓发现 + 摘要：workspace 根仓库 + 根下扫描出的嵌套仓库。
 *
 * 选中仓只影响展示与操作目标；此处每轮对全部仓拉轻量摘要（无 identity /
 * branch comparison），供选择器徽标与折叠头部聚合使用。全量数据仍由
 * useGitRepository 对选中仓单独拉取。
 */
export function useGitRepositories(options: {
  workspacePath: string;
  refreshToken?: string | number | boolean | null;
  remoteSessionId?: string | null;
  remoteTarget?: unknown;
  workspaceIdentity?: string | null;
}): GitRepositoriesState {
  const {
    workspacePath,
    refreshToken = null,
    remoteSessionId: preferredRemoteSessionId = null,
    remoteTarget,
    workspaceIdentity = null,
  } = options;
  const { gitService } = useServices();
  // 与 useGitRepository 对齐：preferred id 可能已过期，先经解析 hook 换成当前有效的
  // remote session，再判 RPC 可用性；否则远端场景多仓发现会被误禁用（仓库列表恒空）。
  const remoteSessionId = useResolvedRemoteWorkspaceSessionId(
    workspacePath,
    preferredRemoteSessionId,
    workspaceIdentity,
    remoteTarget,
  );
  const workspaceRpcEnabled = shouldEnableWorkspaceRpc({
    workspaceIdentity,
    remoteSessionId,
    remoteTarget,
  });
  const workspaceKey = workspaceIdentity?.trim() || workspacePath;
  const [entries, setEntries] = useState<GitRepositoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  // 初始值懒读持久化：重启 / 切 workspace 再回来时恢复上次选中的仓。
  // key 已失效（仓库没了）时 render 阶段的回退会顶上；仓库回来时持久化值自动恢复。
  const [selectedRepoKey, setSelectedRepoKey] = useState<string | null>(() =>
    readSelectedGitRepository(workspaceKey),
  );
  const requestVersionRef = useRef(0);
  const lastRefreshInputRef = useRef<GitRepositoriesRefreshInput | null>(null);

  useEffect(() => {
    const nextRefreshInput: GitRepositoriesRefreshInput = {
      workspacePath,
      workspaceKey,
      refreshToken,
      workspaceRpcEnabled,
    };
    if (!workspaceRpcEnabled) {
      requestVersionRef.current += 1;
      lastRefreshInputRef.current = nextRefreshInput;
      setEntries([]);
      setLoading(false);
      setError(null);
      setTruncated(false);
      return;
    }

    const previous = lastRefreshInputRef.current;
    lastRefreshInputRef.current = nextRefreshInput;
    if (!shouldRefreshGitRepositories(previous, nextRefreshInput)) {
      return;
    }

    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const discovered = await gitService.discoverRepositories({ workspacePath });
        if (requestVersionRef.current !== requestVersion) {
          return;
        }

        setTruncated(discovered.truncated);
        const nextEntries = discovered.repositories.map((repository) =>
          createEntry(repository, workspacePath),
        );
        setEntries(nextEntries);

        // 全部仓的轻量摘要走固定并发池；每完成一个即回填，选择器不必等最慢的仓。
        const queue = [...nextEntries];
        const workers = Array.from(
          { length: Math.min(SUMMARY_REFRESH_CONCURRENCY, queue.length) },
          async () => {
            for (let entry = queue.shift(); entry; entry = queue.shift()) {
              const currentEntry = entry;
              try {
                const refreshResult = await gitService.refresh({
                  workspacePath: currentEntry.requestPath,
                  includeIdentity: false,
                  includeBranchComparison: false,
                });
                if (requestVersionRef.current !== requestVersion) {
                  return;
                }
                const unstaged = sumChangeLines(refreshResult.unstagedChanges);
                const staged = sumChangeLines(refreshResult.stagedChanges);
                const patch: Partial<GitRepositoryEntry> = {
                  summary: refreshResult.summary,
                  added: unstaged.added + staged.added,
                  removed: unstaged.removed + staged.removed,
                  dirtyFileCount: countDirtyFiles(
                    refreshResult.unstagedChanges,
                    refreshResult.stagedChanges,
                  ),
                  loading: false,
                };
                setEntries((current) =>
                  current.map((existing) =>
                    existing.key === currentEntry.key ? { ...existing, ...patch } : existing,
                  ),
                );
              } catch (refreshError) {
                if (requestVersionRef.current !== requestVersion) {
                  return;
                }
                logger.warn("[useGitRepositories] 读取仓库摘要失败", {
                  repoRoot: currentEntry.repoRoot,
                  error:
                    refreshError instanceof Error ? refreshError.message : String(refreshError),
                });
                setEntries((current) =>
                  current.map((existing) =>
                    existing.key === currentEntry.key
                      ? { ...existing, summary: null, loading: false }
                      : existing,
                  ),
                );
              }
            }
          },
        );
        await Promise.all(workers);
        if (requestVersionRef.current === requestVersion) {
          setLoading(false);
        }
      } catch (discoverError) {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        const message =
          discoverError instanceof Error ? discoverError.message : String(discoverError);
        logger.warn("[useGitRepositories] 发现 Git 仓库失败", {
          workspacePath,
          error: message,
        });
        setEntries([]);
        setTruncated(false);
        setError(message);
        setLoading(false);
      }
    })();
  }, [
    gitService,
    refreshToken,
    remoteSessionId,
    workspaceKey,
    workspacePath,
    workspaceRpcEnabled,
  ]);

  // 切 workspace 时恢复该 workspace 自己的持久化选择，而不是沿用上一个 workspace 的选中仓。
  useEffect(() => {
    setSelectedRepoKey(readSelectedGitRepository(workspaceKey));
  }, [workspaceKey]);

  const selectRepository = useCallback(
    (repoKey: string) => {
      setSelectedRepoKey(repoKey);
      writeSelectedGitRepository(workspaceKey, repoKey);
    },
    [workspaceKey],
  );

  return useMemo(() => {
    // render 阶段派生选中仓：列表变化（新仓出现/消失）后旧选中键失效时回退到
    // 根仓（或首个仓），不必再走一轮 effect 收敛。
    const selectedEntry =
      entries.find((entry) => entry.key === selectedRepoKey) ??
      entries.find((entry) => entry.isWorkspaceRoot) ??
      entries[0] ??
      null;
    return {
      workspaceKey,
      loading,
      error,
      truncated,
      repositories: entries,
      selectedRepoKey: selectedEntry?.key ?? null,
      selectedEntry,
      selectRepository,
    };
  }, [entries, error, loading, selectRepository, selectedRepoKey, truncated, workspaceKey]);
}
