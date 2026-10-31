import { useCallback, useState } from "react";
import type { GitPullResult } from "@zcode/shared";
import { toast } from "@/components/ui/toast.js";
import { useOptionalServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { getErrorMessage } from "@/lib/errorMessage.js";
import { logger } from "@/logger.js";

/**
 * 「拉取最新更新」动作：状态面板 Git 区块与 GitPane 头部共用。
 * 快进/合并/无更新的结果映射为友好 toast，冲突与失败原因按服务层 issue 分类提示。
 * 服务访问器用 optional 读取：无 ServiceProvider 的宿主/测试环境渲染不报错，动作触发时再降级提示。
 */
export function useGitPull(options: { workspacePath: string; onPulled?: () => void }) {
  const { workspacePath, onPulled } = options;
  const services = useOptionalServices();
  const { intl } = useZCodeIntl();
  const [pulling, setPulling] = useState(false);

  const runPull = useCallback(async (): Promise<GitPullResult | null> => {
    if (pulling) {
      return null;
    }
    const gitService = services?.gitService;
    if (!gitService) {
      toast(intl.formatMessage({ id: "git.pull.error.failed" }, { error: "git-service-unavailable" }));
      return null;
    }
    setPulling(true);
    try {
      const result = await gitService.pull({ workspacePath });
      logger.info("[GitPull] 拉取完成", {
        workspacePath,
        ok: result.ok,
        outcome: result.outcome,
        issue: result.issue,
        branchName: result.branchName,
      });
      if (result.ok) {
        const messageId =
          result.outcome === "merged"
            ? "git.pull.toast.merged"
            : result.outcome === "up-to-date"
              ? "git.pull.toast.upToDate"
              : "git.pull.toast.fastForwarded";
        toast(intl.formatMessage({ id: messageId }));
      } else {
        const issueMessageId =
          result.issue === "detached-head"
            ? "git.pull.error.detachedHead"
            : result.issue === "no-upstream"
              ? "git.pull.error.noUpstream"
              : result.issue === "local-changes-blocked"
                ? "git.pull.error.localChangesBlocked"
                : result.issue === "merge-conflict"
                  ? "git.pull.error.mergeConflict"
                  : "git.pull.error.failed";
        toast(
          intl.formatMessage({ id: issueMessageId }, { error: result.message ?? "" }),
        );
      }
      onPulled?.();
      return result;
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      logger.warn("[GitPull] 拉取失败", { workspacePath, error: message });
      toast(intl.formatMessage({ id: "git.pull.error.failed" }, { error: message }));
      onPulled?.();
      return null;
    } finally {
      setPulling(false);
    }
  }, [services, intl, onPulled, pulling, workspacePath]);

  return { pulling, runPull };
}
