import type { ReactNode } from "react";
import brandIconUrl from "@/assets/brand-icon.png";
import { cn } from "@/components/lib/utils.js";

interface RootStartupLoadingProps {
  label: string;
  children?: ReactNode;
  busy?: boolean;
}

export function RootStartupLoading({ label, children, busy = true }: RootStartupLoadingProps) {
  return (
    <div
      // Web 端全局 html/body/#root 为 Electron 透明背景让路，React 接管后会替换 HTML 启动壳。
      // 这里必须由阻塞态自身承接主题背景，否则远控链接会在 Root 恢复期间继续露出浏览器白底。
      className="flex h-full min-h-dvh flex-col items-center justify-center gap-6 bg-background text-foreground"
      role="status"
      aria-busy={busy}
      aria-label={label}
      data-testid="root-startup-loading"
    >
      <ZCodeStartupLogoBadge />
      {children}
    </div>
  );
}

/** 初始化与引导共用品牌图标(HBA 徽标)。图标自带底色与圆角,容器只负责裁圆角、投影与呼吸动画。 */
export function ZCodeStartupLogoBadge({
  animated = true,
  size = "default",
}: {
  animated?: boolean;
  size?: "default" | "titlebar";
}) {
  return (
    <div
      data-desktop-logo-badge={size === "titlebar" ? "true" : undefined}
      className={cn(
        "relative flex items-center justify-center overflow-hidden",
        size === "titlebar" ? "size-5 rounded shadow-sm/20" : "size-24 rounded-3xl shadow-xl/20",
      )}
    >
      <img
        src={brandIconUrl}
        alt=""
        aria-hidden="true"
        className={cn(
          "size-full object-cover",
          animated && "animate-[vcode-logo-breathe_3s_ease-in-out_infinite]",
        )}
      />
    </div>
  );
}
