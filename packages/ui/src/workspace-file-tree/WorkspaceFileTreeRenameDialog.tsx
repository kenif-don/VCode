import { useRef } from "react";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { isImeComposingKeyEvent } from "@/lib/imeComposition.js";
import { logger } from "@/logger.js";

/** 文件树条目重命名弹窗。文案独立于 taskList.rename，IME Enter 只确认候选不触发提交。 */
export function WorkspaceFileTreeRenameDialog({
  open,
  value,
  onOpenChange,
  onChange,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  value: string;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { intl } = useZCodeIntl();
  const compositionActiveRef = useRef(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-hidden rounded-2xl p-0">
        <div className="flex min-w-0 flex-col gap-6 p-6">
          <DialogHeader className="space-y-2">
            <DialogTitle>{intl.formatMessage({ id: "workspaceFileTree.rename" })}</DialogTitle>
          </DialogHeader>
          <div className="flex min-w-0 flex-col space-y-4">
            <Input
              value={value}
              size="lg"
              placeholder={intl.formatMessage({
                id: "workspaceFileTree.renamePlaceholder",
              })}
              onChange={(event) => {
                onChange(event.target.value);
              }}
              onCompositionEnd={() => {
                compositionActiveRef.current = false;
              }}
              onCompositionStart={() => {
                compositionActiveRef.current = true;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  if (
                    isImeComposingKeyEvent({
                      compositionActive: compositionActiveRef.current,
                      nativeEvent: event.nativeEvent,
                    })
                  ) {
                    logger.debug("[WorkspaceFileTree] ignore rename enter during IME", {
                      valueLength: value.length,
                    });
                    return;
                  }
                  event.preventDefault();
                  onConfirm();
                }
              }}
            />
          </div>
          <DialogFooter className="flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="h-10 min-w-0 px-5"
              onClick={onCancel}
            >
              {intl.formatMessage({ id: "common.cancel" })}
            </Button>
            <Button
              type="button"
              size="lg"
              className="h-10 min-w-0 px-5"
              onClick={onConfirm}
            >
              {intl.formatMessage({ id: "common.confirm" })}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
