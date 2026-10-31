import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readSelectedGitRepository,
  writeSelectedGitRepository,
} from "./gitSelectedRepository.js";

function createLocalStorageMock(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => values.delete(key)),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  };
}

function storageKey(workspaceKey: string): string {
  return `zcode-git-selected-repository:${workspaceKey}`;
}

describe("gitSelectedRepository", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createLocalStorageMock();
    vi.stubGlobal("window", { localStorage: storage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("写入后按 workspace 读回选中的仓库", () => {
    writeSelectedGitRepository("workspace-a", "/workspace-a/repo");

    expect(readSelectedGitRepository("workspace-a")).toBe("/workspace-a/repo");
  });

  it("不同 workspace 之间互相隔离", () => {
    writeSelectedGitRepository("workspace-a", "/workspace-a/repo");
    writeSelectedGitRepository("workspace-b", "/workspace-b/sub");

    expect(readSelectedGitRepository("workspace-a")).toBe("/workspace-a/repo");
    expect(readSelectedGitRepository("workspace-b")).toBe("/workspace-b/sub");
  });

  it("写 null 或空串表示清除该项", () => {
    writeSelectedGitRepository("workspace-a", "/workspace-a/repo");
    writeSelectedGitRepository("workspace-a", null);
    expect(readSelectedGitRepository("workspace-a")).toBeNull();

    writeSelectedGitRepository("workspace-a", "/workspace-a/repo");
    writeSelectedGitRepository("workspace-a", "");
    expect(readSelectedGitRepository("workspace-a")).toBeNull();
  });

  it("未设置或脏数据一律返回 null", () => {
    expect(readSelectedGitRepository("workspace-never-set")).toBeNull();

    storage.setItem(storageKey("workspace-bad-json"), "{oops");
    expect(readSelectedGitRepository("workspace-bad-json")).toBeNull();

    storage.setItem(storageKey("workspace-number"), JSON.stringify(42));
    expect(readSelectedGitRepository("workspace-number")).toBeNull();

    storage.setItem(storageKey("workspace-empty"), JSON.stringify(""));
    expect(readSelectedGitRepository("workspace-empty")).toBeNull();
  });

  it("window 或 localStorage 不可用时不抛错", () => {
    vi.stubGlobal("window", undefined);
    expect(() => writeSelectedGitRepository("workspace-a", "/repo")).not.toThrow();
    expect(readSelectedGitRepository("workspace-a")).toBeNull();

    // window 上没有 localStorage（部分受限环境）。
    vi.stubGlobal("window", {});
    expect(() => writeSelectedGitRepository("workspace-a", "/repo")).not.toThrow();
    expect(readSelectedGitRepository("workspace-a")).toBeNull();

    // localStorage 访问即抛错（隐私模式）：getStorage 的 try/catch 兜底。
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("access denied");
      },
    });
    expect(() => writeSelectedGitRepository("workspace-a", "/repo")).not.toThrow();
    expect(readSelectedGitRepository("workspace-a")).toBeNull();
  });
});
