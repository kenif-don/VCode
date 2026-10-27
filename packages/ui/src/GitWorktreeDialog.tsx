import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import type { CreateTaskRequest } from "@/app-shell/types.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";

/**
 * FR-3-2 worktree 隔离会话创建对话框（GitPane 入口）。
 *
 * 流程：`git worktree add -b <branch> <repoRoot>/.hba/worktrees/<name>`（gitService
 * createWorktree）→ 创建成功后在 worktree 路径打开新会话（onCreateTask 带 targetWorkspace，
 * 与跨项目发起会话同一条路径）。worktree 与主工作区状态隔离，用于高风险实验。
 */
export function GitWorktreeDialog({
  open,
  onOpenChange,
  workspacePath,
  onCreateTask,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspacePath: string;
  onCreateTask?: (request?: CreateTaskRequest) => void;
}) {
  const { gitService } = useServices();
  const { intl } = useZCodeIntl();
  const [name, setName] = useState("");
  const [branchName, setBranchName] = useState("");
  const [startPoint, setStartPoint] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedBranchName = branchName.trim() || `hba/${name.trim()}`;
  const nameValid = /^[A-Za-z0-9._-]+$/.test(name.trim());

  const handleCreate = useCallback(async () => {
    const normalizedName = name.trim();
    if (!/^[A-Za-z0-9._-]+$/.test(normalizedName) || normalizedName === "." || normalizedName === "..") {
      setError(intl.formatMessage({ id: "git.worktree.error.invalidName" }));
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const result = await gitService.createWorktree({
        workspacePath,
        name: normalizedName,
        branchName: normalizedBranchName,
        ...(startPoint.trim() ? { startPoint: startPoint.trim() } : {}),
      });
      if (!result.ok) {
        setError(result.issues[0]?.message ?? intl.formatMessage({ id: "git.worktree.error.failed" }));
        return;
      }
      logger.info(
        `[GitWorktree] worktree 创建成功 workspace=${workspacePath} path=${result.worktreePath} branch=${result.branchName}`,
      );
      // 在 worktree 路径打开新会话;onCreateTask 缺省时仅创建 worktree(入口降级可用)。
      onCreateTask?.({
        targetWorkspace: { workspacePath: result.worktreePath },
      });
      setName("");
      setBranchName("");
      setStartPoint("");
      onOpenChange(false);
    } catch (cause) {
      logger.warn("[GitWorktree] worktree 创建失败", { workspacePath, error: cause });
      setError(
        cause instanceof Error
          ? cause.message
          : intl.formatMessage({ id: "git.worktree.error.failed" }),
      );
    } finally {
      setCreating(false);
    }
  }, [
    gitService,
    intl,
    name,
    normalizedBranchName,
    onCreateTask,
    onOpenChange,
    startPoint,
    workspacePath,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{intl.formatMessage({ id: "git.worktree.dialog.title" })}</DialogTitle>
          <DialogDescription>
            {intl.formatMessage({ id: "git.worktree.dialog.description" })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "git.worktree.name.label" })}
            </span>
            <input
              className="h-8 rounded-md border border-input-border bg-background px-2 text-ui-base"
              value={name}
              placeholder={intl.formatMessage({ id: "git.worktree.name.placeholder" })}
              disabled={creating}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "git.worktree.branch.label" })}
            </span>
            <input
              className="h-8 rounded-md border border-input-border bg-background px-2 text-ui-base"
              value={branchName}
              placeholder={normalizedBranchName}
              disabled={creating}
              onChange={(event) => setBranchName(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "git.worktree.base.label" })}
            </span>
            <input
              className="h-8 rounded-md border border-input-border bg-background px-2 text-ui-base"
              value={startPoint}
              placeholder="HEAD"
              disabled={creating}
              onChange={(event) => setStartPoint(event.target.value)}
            />
          </label>
          {error ? (
            <p role="alert" className="text-ui-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost" disabled={creating}>
              {intl.formatMessage({ id: "common.cancel" })}
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={creating || !nameValid}
            onClick={() => void handleCreate()}
          >
            {intl.formatMessage({ id: "git.worktree.submit" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
