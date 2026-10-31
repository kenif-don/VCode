const GIT_SELECTED_REPOSITORY_KEY_PREFIX = "zcode-git-selected-repository:";

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getStorageKey(workspaceKey: string): string {
  return `${GIT_SELECTED_REPOSITORY_KEY_PREFIX}${workspaceKey}`;
}

/**
 * 读取该 workspace 上次选中的 Git 仓（repoRoot）。
 * 未设置或脏数据（坏 JSON / 非字符串 / 空串）一律当没有：调用方会回退到默认仓，
 * 仓库消失再回来时也能靠持久化值自动恢复。
 */
export function readSelectedGitRepository(workspaceKey: string): string | null {
  const storage = getStorage();
  if (!storage) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(storage.getItem(getStorageKey(workspaceKey)) ?? "null");
    return typeof parsed === "string" && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 写入该 workspace 的选中 Git 仓；null / 空串表示清除该项。
 * 只是选择偏好，localStorage 不可用（隐私模式等）时静默跳过，不阻断选择流程。
 */
export function writeSelectedGitRepository(
  workspaceKey: string,
  repositoryKey: string | null,
): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    if (repositoryKey === null || repositoryKey.length === 0) {
      storage.removeItem(getStorageKey(workspaceKey));
      return;
    }
    storage.setItem(getStorageKey(workspaceKey), JSON.stringify(repositoryKey));
  } catch {
    // 配额耗尽 / 存储被禁用：选择仍在内存里生效，只是不持久化。
  }
}
