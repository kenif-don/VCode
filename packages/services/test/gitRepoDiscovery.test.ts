import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanNestedGitRepositories } from "../src/git/repo/gitRepoDiscovery.js";

const tempRoots: string[] = [];

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "zcode-git-discovery-"));
  tempRoots.push(root);
  return root;
}

function createRepoDir(root: string, relativePath: string, gitEntry: "directory" | "file"): void {
  const repoPath = join(root, ...relativePath.split("/"));
  mkdirSync(repoPath, { recursive: true });
  if (gitEntry === "directory") {
    mkdirSync(join(repoPath, ".git"));
  } else {
    writeFileSync(join(repoPath, ".git"), "gitdir: ../main/.git/worktrees/linked\n");
  }
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("scanNestedGitRepositories", () => {
  it("找出嵌套仓库（.git 目录与文件皆可）并按相对路径排序", async () => {
    const root = createTempRoot();
    createRepoDir(root, "b-repo", "directory");
    createRepoDir(root, "a-repo", "file");
    mkdirSync(join(root, "not-a-repo", "nested-deep"), { recursive: true });

    const result = await scanNestedGitRepositories(root);

    expect(result.truncated).toBe(false);
    expect(result.repositories.map((entry) => entry.workspaceRelativePath)).toEqual([
      "a-repo",
      "b-repo",
    ]);
    expect(result.repositories[0]).toMatchObject({
      kind: "nested",
      requestPath: join(root, "a-repo"),
      repoRoot: join(root, "a-repo"),
    });
  });

  it("跳过依赖/构建产物/隐藏目录", async () => {
    const root = createTempRoot();
    createRepoDir(root, "kept/repo", "directory");
    createRepoDir(root, "node_modules/pkg", "directory");
    createRepoDir(root, "dist/out", "directory");
    createRepoDir(root, ".venv/lib", "directory");
    createRepoDir(root, "build/generated", "directory");

    const result = await scanNestedGitRepositories(root);

    expect(result.repositories.map((entry) => entry.workspaceRelativePath)).toEqual(["kept/repo"]);
  });

  it("命中仓库后不再下探（嵌套 submodule 不单列）", async () => {
    const root = createTempRoot();
    createRepoDir(root, "outer", "directory");
    createRepoDir(root, "outer/inner-submodule", "directory");

    const result = await scanNestedGitRepositories(root);

    expect(result.repositories.map((entry) => entry.workspaceRelativePath)).toEqual(["outer"]);
  });

  it("受 maxDepth 约束，深层仓库默认不可达", async () => {
    const root = createTempRoot();
    createRepoDir(root, "a/b/c/repo", "directory");

    const shallow = await scanNestedGitRepositories(root, { maxDepth: 3 });
    expect(shallow.repositories).toEqual([]);

    const deep = await scanNestedGitRepositories(root, { maxDepth: 4 });
    expect(deep.repositories.map((entry) => entry.workspaceRelativePath)).toEqual(["a/b/c/repo"]);
  });

  it("超过 maxRepositories 时截断并置 truncated", async () => {
    const root = createTempRoot();
    createRepoDir(root, "repo-1", "directory");
    createRepoDir(root, "repo-2", "directory");
    createRepoDir(root, "repo-3", "directory");

    const result = await scanNestedGitRepositories(root, { maxRepositories: 2 });

    expect(result.truncated).toBe(true);
    expect(result.repositories).toHaveLength(2);
  });

  it("不跟随符号链接目录（Windows junction 同样按 symlink 报告）", async () => {
    const root = createTempRoot();
    createRepoDir(root, "real/repo", "directory");
    try {
      symlinkSync(join(root, "real"), join(root, "link"), "junction");
    } catch {
      // Windows 下创建 junction 需要相应权限；无法创建时跳过该断言，
      // 环境问题不掩盖扫描逻辑本身。
      return;
    }

    const result = await scanNestedGitRepositories(root);

    // 只走 real 子树一遍；link 指向同一棵子树，若被跟随会出现重复条目。
    expect(result.repositories.map((entry) => entry.workspaceRelativePath)).toEqual(["real/repo"]);
  });
});
