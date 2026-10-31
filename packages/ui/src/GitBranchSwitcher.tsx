import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { GitRepositorySummary } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover.js";
import { cn } from "@/components/lib/utils.js";
import {
  GitBranchCreateDialog,
  GitBranchSwitchAssistDialog,
} from "@/git-branch-switcher/GitBranchDialogs.js";
import { useGitBranchSwitcher } from "@/hooks/useGitBranchSwitcher.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  matchesGitBranchPickerSearch,
  resolveGitBranchTriggerLabel,
  toGitRepositoryPickerValue,
} from "@/git-branch-switcher/display.js";
import {
  isCoarseTouchDevice,
  shouldRestoreChatInputFocusAfterPickerClose,
} from "@/lib/pickerFocus.js";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  FolderGit2Icon,
  GitBranchIcon,
  LoaderIcon,
  PlusIcon,
} from "lucide-react";

interface GitBranchSwitcherProps {
  workspacePath: string;
  gitSummary: GitRepositorySummary;
  dirtyFileCount: number;
  onRefreshGit: () => void;
  className?: string;
  triggerClassName?: string;
  popoverClassName?: string;
  branchListClassName?: string;
  markAsWorkspaceHeaderBranch?: boolean;
  compactForRemoteControl?: boolean;
  popoverSide?: "top" | "bottom" | "left" | "right";
  avoidPopoverCollisions?: boolean;
  /** 多仓选择器数据；多于一个时弹层打开先显示仓库列表，点仓库钻取进分支列表。 */
  repositories?: Array<{
    key: string;
    label: string;
    branchName?: string | null;
    added?: number;
    removed?: number;
  }>;
  activeRepositoryKey?: string | null;
  onSelectRepository?: (repoKey: string) => void;
}

export function GitBranchSwitcher({
  workspacePath,
  gitSummary,
  dirtyFileCount,
  onRefreshGit,
  className,
  triggerClassName,
  popoverClassName,
  branchListClassName,
  markAsWorkspaceHeaderBranch = false,
  compactForRemoteControl = false,
  popoverSide = "top",
  avoidPopoverCollisions = true,
  repositories,
  activeRepositoryKey,
  onSelectRepository,
}: GitBranchSwitcherProps) {
  const { intl, locale } = useZCodeIntl();
  const numberFormatter = new Intl.NumberFormat(locale);
  const commandListRef = useRef<HTMLDivElement | null>(null);
  const {
    open,
    setOpen,
    createDialogOpen,
    setCreateDialogOpen,
    createBranchName,
    setCreateBranchName,
    commitMessage,
    setCommitMessage,
    commitError,
    switchAssistStep,
    switchAssistState,
    branchesResult,
    loadingBranches,
    mutationPending,
    switchBranch,
    createBranchAndSwitch,
    openSwitchCommitDialog,
    closeSwitchAssistDialog,
    commitAndSwitchBranch,
  } = useGitBranchSwitcher({
    workspacePath,
    currentBranchName: gitSummary.branchName,
    headRefType: gitSummary.headRefType,
    onRefreshGit,
    // 弹层内点仓库行切仓时保持弹层打开；单仓（无仓库选择器）时保持旧行为直接关闭。
    keepOpenOnWorkspacePathChange: Boolean(repositories && repositories.length > 1),
  });

  const isVisible = gitSummary.isGitAvailable && gitSummary.isRepository;
  // 仓库列表只在多仓且有选择回调时出现；单仓弹层直接进分支列表。
  const showRepositoryPicker = Boolean(
    repositories && repositories.length > 1 && onSelectRepository,
  );
  // 两级钻取视图：多仓先看仓库列表，点仓库后钻进分支列表。
  const [pickerView, setPickerView] = useState<"repositories" | "branches">("branches");
  const userDrilledIntoRepositoriesRef = useRef(false);
  useEffect(() => {
    if (!open) {
      userDrilledIntoRepositoriesRef.current = false;
      return;
    }
    // 用户已主动钻入分支列表后，即使发现数据晚到（showRepositoryPicker 变 true）
    // 也不要把视图拉回仓库列表；只有弹层刚打开时按当前能力选初始视图。
    if (userDrilledIntoRepositoriesRef.current) {
      return;
    }
    setPickerView(showRepositoryPicker ? "repositories" : "branches");
  }, [open, showRepositoryPicker]);
  const displayedCurrentBranchName =
    branchesResult?.currentBranchName ?? gitSummary.branchName;
  const triggerLabel = useMemo(
    () =>
      resolveGitBranchTriggerLabel({
        headRefType: gitSummary.headRefType,
        currentBranchName: displayedCurrentBranchName,
        detachedLabel: intl.formatMessage({ id: "git.head.detached" }),
        fallbackLabel: intl.formatMessage({ id: "git.branchSwitcher.label" }),
      }),
    [displayedCurrentBranchName, gitSummary.headRefType, intl],
  );
  const currentBranchDirtyLabel = useMemo(
    () =>
      dirtyFileCount > 0
        ? intl.formatMessage(
            { id: "git.branchSwitcher.currentDirty" },
            { count: numberFormatter.format(dirtyFileCount) },
          )
        : null,
    [dirtyFileCount, intl, numberFormatter],
  );
  const switchAssistCurrentBranchLabel = useMemo(() => {
    if (!switchAssistState) {
      return triggerLabel;
    }

    return resolveGitBranchTriggerLabel({
      headRefType: gitSummary.headRefType,
      currentBranchName: switchAssistState.currentBranchName,
      detachedLabel: intl.formatMessage({ id: "git.head.detached" }),
      fallbackLabel: intl.formatMessage({ id: "git.branchSwitcher.label" }),
    });
  }, [gitSummary.headRefType, intl, switchAssistState, triggerLabel]);
  const branchSearchFilter = useCallback(
    (value: string, search: string) =>
      matchesGitBranchPickerSearch(value, search) ? 1 : 0,
    [],
  );

  useEffect(() => {
    if (!open || !branchesResult?.branches.length) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const selectedItem =
        commandListRef.current?.querySelector<HTMLElement>(
          '[data-branch-current="true"]',
        ) ?? null;
      selectedItem?.scrollIntoView({ block: "nearest" });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [branchesResult, open]);

  const handleContentKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Tab") {
        return;
      }

    const highlightedItem =
      event.currentTarget.querySelector<HTMLElement>(
        '[data-slot="command-item"][data-selected="true"]:not([data-disabled=true])',
      ) ??
      event.currentTarget.querySelector<HTMLElement>(
        '[data-slot="command-item"]:not([data-disabled=true])',
      );

    if (!highlightedItem) {
      return;
    }

      event.preventDefault();
      highlightedItem.click();
    },
    [],
  );

  if (!isVisible) {
    return null;
  }

  return (
    <>
      <div
        data-workspace-header-branch={markAsWorkspaceHeaderBranch ? "true" : undefined}
        className={cn("flex items-center px-1 pt-2", className)}
      >
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size={"default"}
              disabled={mutationPending}
              aria-label={intl.formatMessage({
                id: "git.branchSwitcher.trigger.ariaLabel",
              })}
              className={cn(
                "min-w-0 rounded-full text-ui-base/relaxed",
                // Bugfix: 手机远控聊天页底部空间很窄，分支名会挤压输入工具栏；远控模式只保留图标入口。
                compactForRemoteControl
                  ? "size-8 px-0"
                  : "max-w-full pl-3 pr-2",
                triggerClassName,
              )}
            >
              <GitBranchIcon
                data-branch-switcher-primary-icon="true"
                className="size-4 text-foreground-subtle"
              />
              {!compactForRemoteControl ? (
                <>
                  <span className="min-w-0 max-w-25 truncate text-left">{triggerLabel}</span>
                  {loadingBranches || mutationPending ? (
                    <LoaderIcon
                      data-branch-switcher-trailing-icon="true"
                      className="size-3.5 animate-spin text-foreground-subtle"
                    />
                  ) : (
                    <ChevronDownIcon
                      data-branch-switcher-trailing-icon="true"
                      className="size-3.5 text-foreground-subtle"
                    />
                  )}
                </>
              ) : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            side={popoverSide}
            avoidCollisions={avoidPopoverCollisions}
            className={cn("w-80 gap-0 bg-menu p-0", popoverClassName)}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              if (isCoarseTouchDevice()) {
                // 手机触控设备打开分支列表时，自动聚焦搜索框会拉起系统键盘遮挡列表。
                // 移动端保留触发器焦点，用户需要搜索时再手动点输入框；桌面端继续自动进入搜索。
                return;
              }

              const target = event.currentTarget;
              if (!(target instanceof HTMLElement)) {
                return;
              }
              const searchInput = target.querySelector<HTMLElement>(
                '[data-slot="command-input"]',
              );
              searchInput?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (
                !shouldRestoreChatInputFocusAfterPickerClose({
                  isCoarseTouchDevice: isCoarseTouchDevice(),
                })
              ) {
                return;
              }
              const input = document.querySelector<HTMLElement>(
                '[data-testid="chat-input"]',
              );
              input?.focus();
            }}
          >
            <Command
              className="bg-transparent p-0 text-foreground"
              filter={branchSearchFilter}
              onKeyDown={handleContentKeyDown}
            >
              <CommandInput
                placeholder={intl.formatMessage({
                  id:
                    pickerView === "repositories"
                      ? "git.branchSwitcher.searchRepositoryPlaceholder"
                      : "git.branchSwitcher.searchPlaceholder",
                })}
                className="h-8"
              />
              <CommandList ref={commandListRef} className={cn("max-h-72", branchListClassName)}>
                <CommandEmpty className="px-4 py-5 text-foreground-subtle">
                  {loadingBranches
                    ? intl.formatMessage({ id: "common.loading" })
                    : intl.formatMessage({ id: "git.branchSwitcher.empty" })}
                </CommandEmpty>
                {pickerView === "repositories" ? (
                  <CommandGroup
                    heading={intl.formatMessage({
                      id: "git.branchSwitcher.section.repositories",
                    })}
                    className="space-y-0.5 p-1 **:[[cmdk-group-heading]]:px-3 **:[[cmdk-group-heading]]:py-2 **:[[cmdk-group-heading]]:text-ui-base **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-foreground-subtle"
                  >
                    {(repositories ?? []).map((repository) => {
                      const isCurrent = repository.key === activeRepositoryKey;
                      return (
                        <CommandItem
                          key={repository.key}
                          value={toGitRepositoryPickerValue(repository)}
                          data-checked={isCurrent ? "true" : undefined}
                          disabled={mutationPending}
                          className={cn(
                            "items-start gap-3 rounded-lg px-3 py-2 text-ui-base",
                          )}
                          onSelect={() => {
                            // 钻取到分支列表：切仓后弹层保持打开，分支列表随
                            // workspacePath 变化重拉，不触发 switchBranch、不关闭弹层。
                            onSelectRepository?.(repository.key);
                            userDrilledIntoRepositoriesRef.current = true;
                            setPickerView("branches");
                          }}
                        >
                          <FolderGit2Icon className="mt-0.5 size-4 text-foreground-subtle" />
                          <div className="min-w-0 flex-1 flex items-center gap-2 text-left">
                            <span className="min-w-0 flex-1 truncate text-ui-base font-medium text-foreground">
                              {repository.label}
                            </span>
                            <span className="shrink-0 text-ui-sm opacity-60">
                              {repository.branchName ?? "—"}
                            </span>
                            <span className="shrink-0 font-mono text-ui-sm tabular-nums">
                              <span className="text-[var(--color-diff-added)]">
                                +{repository.added ?? 0}
                              </span>{" "}
                              <span className="text-[var(--color-diff-removed)]">
                                -{repository.removed ?? 0}
                              </span>
                            </span>
                          </div>
                          {/* 行尾下拉箭头：代表这行可点进下一级（分支列表）。 */}
                          <ChevronDownIcon
                            aria-hidden="true"
                            className="mt-0.5 size-4 shrink-0 text-foreground-subtle"
                          />
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ) : (
                  <>
                    {/* 分支视图顶部的返回行（仅多仓）：点击回到仓库列表。 */}
                    {showRepositoryPicker ? (
                      <CommandItem
                        value="__back-to-repositories__"
                        aria-label={intl.formatMessage({
                          id: "git.branchSwitcher.backToRepositories",
                        })}
                        className="items-center gap-3 rounded-lg px-3 py-2 text-ui-base"
                        onSelect={() => {
                          setPickerView("repositories");
                        }}
                      >
                        <ChevronLeftIcon className="size-4 text-foreground-subtle" />
                        <span className="min-w-0 flex-1 truncate text-ui-base font-medium text-foreground">
                          {repositories?.find(
                            (repository) => repository.key === activeRepositoryKey,
                          )?.label ?? "—"}
                        </span>
                      </CommandItem>
                    ) : null}
                    <CommandGroup
                      heading={intl.formatMessage({
                        id: "git.branchSwitcher.section.branches",
                      })}
                      className="space-y-0.5 p-1 **:[[cmdk-group-heading]]:px-3 **:[[cmdk-group-heading]]:py-2 **:[[cmdk-group-heading]]:text-ui-base **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-foreground-subtle"
                    >
                      {(branchesResult?.branches ?? []).map((branch) => {
                        const isCurrent =
                          branch.name === displayedCurrentBranchName;
                        return (
                          <CommandItem
                            key={branch.name}
                            value={branch.name}
                            data-checked={isCurrent ? "true" : undefined}
                            data-branch-current={isCurrent ? "true" : undefined}
                            disabled={mutationPending}
                            className={cn(
                              "items-start gap-3 rounded-lg px-3 py-2 text-ui-base",
                            )}
                            onSelect={() => {
                              void switchBranch(branch.name);
                            }}
                          >
                            <GitBranchIcon className="mt-0.5 size-4 text-foreground-subtle" />
                            <div className="min-w-0 flex-1 flex flex-col gap-1 text-left">
                              <div className="truncate text-ui-base font-medium text-foreground">
                                {branch.name}
                              </div>
                              {isCurrent && currentBranchDirtyLabel ? (
                                <p className="pt-0.5 text-ui-base text-foreground-subtle">
                                  {currentBranchDirtyLabel}
                                </p>
                              ) : null}
                            </div>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </>
                )}
              </CommandList>
            </Command>
            {/* footer 只保留「从当前分支新建分支」，且仅在分支视图出现。 */}
            {pickerView === "branches" ? (
              <div className="border-t border-border p-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  className="w-full justify-start px-2 text-foreground hover:bg-menu-hover hover:text-foreground"
                  disabled={mutationPending}
                  onClick={() => {
                    setOpen(false);
                    setCreateDialogOpen(true);
                  }}
                >
                  <PlusIcon className="size-4 text-foreground-subtle" />
                  {intl.formatMessage({
                    id: "git.branchSwitcher.createAction",
                  })}
                </Button>
              </div>
            ) : null}
          </PopoverContent>
        </Popover>
      </div>

      <GitBranchCreateDialog
        open={createDialogOpen}
        branchName={createBranchName}
        mutationPending={mutationPending}
        onOpenChange={(nextOpen) => {
          setCreateDialogOpen(nextOpen);
          if (!nextOpen) {
            setCreateBranchName("");
          }
        }}
        onBranchNameChange={setCreateBranchName}
        onCancel={() => {
          setCreateDialogOpen(false);
          setCreateBranchName("");
        }}
        onSubmit={() => {
          void createBranchAndSwitch();
        }}
      />

      <GitBranchSwitchAssistDialog
        step={switchAssistStep}
        state={switchAssistState}
        currentBranchLabel={switchAssistCurrentBranchLabel}
        commitMessage={commitMessage}
        commitError={commitError}
        mutationPending={mutationPending}
        onClose={closeSwitchAssistDialog}
        onOpenCommit={openSwitchCommitDialog}
        onCommitMessageChange={setCommitMessage}
        onSubmit={() => {
          void commitAndSwitchBranch();
        }}
      />
    </>
  );
}
