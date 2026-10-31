// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("lucide-react", () => {
  const createIcon = (name: string) => (props: Record<string, unknown>) =>
    createElement("svg", { "data-icon": name, ...props });

  return {
    ChevronDownIcon: createIcon("chevron-down"),
    ChevronLeftIcon: createIcon("chevron-left"),
    FolderGit2Icon: createIcon("folder-git-2"),
    GitBranchIcon: createIcon("git-branch"),
    LoaderIcon: createIcon("loader"),
    PlusIcon: createIcon("plus"),
  };
});

vi.mock("@/components/ui/button.js", () => ({
  Button: ({ children, ...props }: { children: ReactNode }) =>
    createElement("button", props, children),
}));

vi.mock("@/components/ui/command.js", () => ({
  Command: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  CommandEmpty: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
  CommandGroup: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
  CommandInput: (props: Record<string, unknown>) => createElement("input", props),
  // onSelect 映射到 onClick：jsdom 里没有 cmdk 的选中事件，用点击触发钻取断言。
  CommandItem: ({ children, onSelect, ...props }: { children: ReactNode; onSelect?: () => void }) =>
    createElement("div", { ...props, onClick: onSelect }, children),
  CommandList: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
}));

vi.mock("@/components/ui/popover.js", () => ({
  Popover: ({ children }: { children: ReactNode }) =>
    createElement("div", { "data-testid": "popover" }, children),
  PopoverContent: ({ children }: { children: ReactNode }) =>
    createElement("div", { "data-testid": "popover-content" }, children),
  PopoverTrigger: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/git-branch-switcher/GitBranchDialogs.js", () => ({
  GitBranchCreateDialog: () => null,
  GitBranchSwitchAssistDialog: () => null,
}));

const hookMocks = vi.hoisted(() => ({
  open: false,
  branchesResult: null as null | {
    currentBranchName: string | null;
    headRefType: string;
    branches: Array<{ name: string; isCurrent: boolean }>;
  },
}));

vi.mock("@/hooks/useGitBranchSwitcher.js", () => ({
  useGitBranchSwitcher: () => ({
    branchesResult: hookMocks.branchesResult,
    closeSwitchAssistDialog: vi.fn(),
    commitAndSwitchBranch: vi.fn(),
    commitError: null,
    commitMessage: "",
    createBranchAndSwitch: vi.fn(),
    createBranchName: "",
    createDialogOpen: false,
    loadingBranches: false,
    mutationPending: false,
    open: hookMocks.open,
    openSwitchCommitDialog: vi.fn(),
    setCommitMessage: vi.fn(),
    setCreateBranchName: vi.fn(),
    setCreateDialogOpen: vi.fn(),
    setOpen: vi.fn(),
    switchAssistState: null,
    switchAssistStep: "commit",
    switchBranch: vi.fn(),
  }),
}));

vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({
    intl: {
      formatMessage: ({ id }: { id: string }) => id,
    },
    locale: "zh-CN",
  }),
}));

const REPOSITORIES = [
  { key: "/workspace/root", label: "root", branchName: "main", added: 3, removed: 1 },
  // nested 的当前分支名避开分支列表里的 "feature"，避免钻取断言撞到仓库行上的分支名。
  { key: "/workspace/nested", label: "nested", branchName: "dev", added: 0, removed: 0 },
];

function createGitSummary() {
  return {
    branchName: "main",
    headRefType: "branch",
    isGitAvailable: true,
    isRepository: true,
  };
}

describe("GitBranchSwitcher", () => {
  // vitest 未开 globals，testing-library 不会自动注册 afterEach(cleanup)。
  afterEach(cleanup);

  beforeEach(() => {
    hookMocks.open = false;
    hookMocks.branchesResult = null;
  });

  it("marks the primary branch icon separately from trailing status icons", async () => {
    const { GitBranchSwitcher } = await import("@/GitBranchSwitcher.js");

    const html = renderToStaticMarkup(
      createElement(GitBranchSwitcher, {
        dirtyFileCount: 0,
        gitSummary: createGitSummary(),
        onRefreshGit: vi.fn(),
        workspacePath: "/workspace/zcode-cli",
      }),
    );

    expect(html).toContain('data-branch-switcher-primary-icon="true"');
    expect(html).toContain('data-branch-switcher-trailing-icon="true"');
    expect(html).toContain("main");
  });

  it("keeps the primary branch icon in compact remote mode", async () => {
    const { GitBranchSwitcher } = await import("@/GitBranchSwitcher.js");

    const html = renderToStaticMarkup(
      createElement(GitBranchSwitcher, {
        compactForRemoteControl: true,
        dirtyFileCount: 0,
        gitSummary: createGitSummary(),
        onRefreshGit: vi.fn(),
        workspacePath: "/workspace/zcode-cli",
      }),
    );

    expect(html).toContain('data-branch-switcher-primary-icon="true"');
    expect(html).not.toContain('data-branch-switcher-trailing-icon="true"');
    expect(html).not.toContain("main");
  });

  it("shows repository list first in multi-repo mode and drills into branches on select", async () => {
    hookMocks.open = true;
    hookMocks.branchesResult = {
      currentBranchName: "main",
      headRefType: "branch",
      branches: [
        { name: "main", isCurrent: true },
        { name: "feature", isCurrent: false },
      ],
    };
    const { GitBranchSwitcher } = await import("@/GitBranchSwitcher.js");
    const onSelectRepository = vi.fn();

    const baseProps = {
      dirtyFileCount: 0,
      gitSummary: createGitSummary(),
      onRefreshGit: vi.fn(),
      workspacePath: "/workspace/root",
      repositories: REPOSITORIES,
      onSelectRepository,
    };

    const { container, rerender } = render(
      createElement(GitBranchSwitcher, {
        ...baseProps,
        activeRepositoryKey: "/workspace/root",
      }),
    );

    // 初始视图是仓库列表：两仓都在、有行尾下拉箭头、无分支行、无新建分支 footer。
    // 图标计数只看弹层内部：触发器按钮自己也带一个 chevron-down。
    const popoverContent = container.querySelector('[data-testid="popover-content"]');
    expect(popoverContent).not.toBeNull();
    expect(screen.getByText("root")).toBeTruthy();
    expect(screen.getByText("nested")).toBeTruthy();
    expect(popoverContent?.querySelectorAll('[data-icon="folder-git-2"]')).toHaveLength(2);
    expect(popoverContent?.querySelectorAll('[data-icon="chevron-down"]')).toHaveLength(2);
    expect(screen.queryByText("feature")).toBeNull();
    expect(screen.queryByText("git.branchSwitcher.createAction")).toBeNull();
    expect(
      container.querySelector('input')?.getAttribute("placeholder"),
    ).toBe("git.branchSwitcher.searchRepositoryPlaceholder");

    // 点仓库行：回调收到 key，视图钻取到分支列表（含返回行 + 新建分支 footer）。
    fireEvent.click(screen.getByText("nested"));
    expect(onSelectRepository).toHaveBeenCalledWith("/workspace/nested");
    // 真实链路里父组件会把选中仓回传成新的 activeRepositoryKey，这里模拟该回写。
    rerender(
      createElement(GitBranchSwitcher, {
        ...baseProps,
        activeRepositoryKey: "/workspace/nested",
      }),
    );
    // 分支行用 data-branch-current 区分；"main" 文本同时出现在触发器上。
    expect(
      popoverContent?.querySelector('[data-branch-current="true"]')?.textContent,
    ).toContain("main");
    expect(screen.getByText("feature")).toBeTruthy();
    expect(screen.getByText("git.branchSwitcher.createAction")).toBeTruthy();
    const backRow = container.querySelector(
      '[aria-label="git.branchSwitcher.backToRepositories"]',
    );
    expect(backRow).not.toBeNull();
    expect(backRow?.textContent).toContain("nested");
    expect(
      container.querySelector('input')?.getAttribute("placeholder"),
    ).toBe("git.branchSwitcher.searchPlaceholder");

    // 点返回行：回到仓库列表。
    fireEvent.click(backRow as Element);
    expect(screen.queryByText("git.branchSwitcher.createAction")).toBeNull();
    expect(screen.getByText("root")).toBeTruthy();
  });

  it("opens branches view directly in single-repo mode without back row", async () => {
    hookMocks.open = true;
    hookMocks.branchesResult = {
      currentBranchName: "main",
      headRefType: "branch",
      branches: [{ name: "main", isCurrent: true }],
    };
    const { GitBranchSwitcher } = await import("@/GitBranchSwitcher.js");

    const { container } = render(
      createElement(GitBranchSwitcher, {
        dirtyFileCount: 0,
        gitSummary: createGitSummary(),
        onRefreshGit: vi.fn(),
        workspacePath: "/workspace/zcode-cli",
      }),
    );

    // 分支行用 data-branch-current 定位；"main" 文本同时出现在触发器上。
    expect(
      container
        .querySelector('[data-testid="popover-content"] [data-branch-current="true"]')
        ?.textContent,
    ).toContain("main");
    expect(screen.getByText("git.branchSwitcher.createAction")).toBeTruthy();
    expect(
      container.querySelector('[aria-label="git.branchSwitcher.backToRepositories"]'),
    ).toBeNull();
  });
});
