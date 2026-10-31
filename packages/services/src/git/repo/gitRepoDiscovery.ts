import { readdir, lstat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { GitDiscoveredRepository } from "@zcode/shared";

/** 目录名黑名单：构建产物与依赖树里不会有需要单独展示的仓库入口。 */
const IGNORED_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "__pycache__",
  "venv",
  "coverage",
]);

const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_REPOSITORIES = 20;

export interface ScanNestedGitRepositoriesOptions {
  /** 相对扫描根的目录层数上限（不含扫描根本身），默认 3。 */
  maxDepth?: number;
  maxRepositories?: number;
}

export interface ScanNestedGitRepositoriesResult {
  repositories: GitDiscoveredRepository[];
  truncated: boolean;
}

function toPosixRelativePath(root: string, dirPath: string): string {
  const rel = relative(root, dirPath);
  return rel === "" ? "." : rel.split(sep).join("/");
}

/**
 * 扫描 workspace 根下的嵌套 git 仓库（目录级 `.git`，目录或文件皆可）。
 *
 * 边界语义：
 * - 命中仓库的目录不再下探——嵌套仓内部的 `.git`（submodule / 内嵌仓）不单独列出，
 *   避免列表被父仓的 submodule 结构淹没；被点名需要时再按仓展开。
 * - 跳过符号链接目录（Windows junction 同样按 symlink 报告）避免环。
 * - 跳过隐藏目录与构建产物/依赖目录，控制大工作区的遍历成本。
 */
export async function scanNestedGitRepositories(
  root: string,
  options?: ScanNestedGitRepositoriesOptions,
): Promise<ScanNestedGitRepositoriesResult> {
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxRepositories = options?.maxRepositories ?? DEFAULT_MAX_REPOSITORIES;
  const repositories: GitDiscoveredRepository[] = [];
  let truncated = false;

  // 显式栈遍历而非递归，深度边界在同一处裁剪。
  const pending: Array<{ dirPath: string; depth: number }> = [{ dirPath: root, depth: 0 }];
  while (pending.length > 0) {
    const current = pending.shift()!;
    if (current.depth >= maxDepth) {
      continue;
    }

    let entries;
    try {
      entries = await readdir(current.dirPath, { withFileTypes: true });
    } catch {
      // 权限异常 / 目录在遍历中消失都不是 Git 协议失败，跳过该子树即可。
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        continue;
      }
      const name = entry.name;
      if (name.startsWith(".") || IGNORED_DIR_NAMES.has(name)) {
        continue;
      }
      const dirPath = join(current.dirPath, name);

      if (await isGitEntryPresent(dirPath)) {
        if (repositories.length >= maxRepositories) {
          truncated = true;
          continue;
        }
        repositories.push({
          repoRoot: dirPath,
          workspaceRelativePath: toPosixRelativePath(root, dirPath),
          kind: "nested",
          requestPath: dirPath,
        });
        continue;
      }

      pending.push({ dirPath, depth: current.depth + 1 });
    }
  }

  repositories.sort((left, right) =>
    left.workspaceRelativePath.localeCompare(right.workspaceRelativePath),
  );
  return { repositories, truncated };
}

async function isGitEntryPresent(dirPath: string): Promise<boolean> {
  try {
    const stat = await lstat(join(dirPath, ".git"));
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}
