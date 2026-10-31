import brandIconUrl from "@/assets/brand-icon.png";
import { cn } from "@/components/lib/utils.js";

/** HBA 品牌徽标(图标自带底色与圆角,深浅主题通用)。 */
export function ZCodeAboutLogo({ className }: { className?: string }) {
  return (
    <img
      src={brandIconUrl}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn("shrink-0 object-cover", className)}
    />
  );
}

/** 品牌文字组合(徽标 + VCode),沿用原 wordmark 槽位尺寸(约 52px 宽)。 */
export function ZCodeWordmarkLogo({ className }: { className?: string }) {
  return (
    <span
      className={cn("flex items-center gap-1.5 text-current", className)}
      aria-hidden="true"
    >
      <img
        src={brandIconUrl}
        alt=""
        draggable={false}
        className="size-3.5 shrink-0 rounded-[3px]"
      />
      <span className="text-[12px] font-semibold leading-none tracking-tight">VCode</span>
    </span>
  );
}
