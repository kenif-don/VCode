import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RootStartupLoading, ZCodeStartupLogoBadge } from "@/root/RootStartupLoading.js";

describe("RootStartupLoading", () => {
  it("静态品牌图标不渲染呼吸动画", () => {
    const html = renderToStaticMarkup(createElement(ZCodeStartupLogoBadge, { animated: false }));
    expect(html).toContain("<img");
    expect(html).toContain("brand-icon");
    expect(html).not.toContain("vcode-logo-breathe");
  });
  it("启动阻塞态使用整体呼吸的品牌图标而不是可见 loading 文案", () => {
    const html = renderToStaticMarkup(createElement(RootStartupLoading, { label: "加载中..." }));

    expect(html).toContain('data-testid="root-startup-loading"');
    expect(html).toContain('aria-label="加载中..."');
    expect(html).toContain("<img");
    expect(html).toContain("brand-icon");
    expect(html).toContain("vcode-logo-breathe");
    expect(html).not.toContain(">加载中...<");
  });
});
