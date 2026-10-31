// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RewardsProvider, useOpenRewards } from "@/rewards/RewardsProvider.js";

const h = vi.hoisted(() => ({
  state: {
    theme: "zai-light",
  },
  external: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/store/StoreProvider.js", () => ({
  useZCodeStore: (select: (s: typeof h.state) => unknown) => select(h.state),
}));
vi.mock("@/hooks/usePlatform.js", () => ({ usePlatform: () => ({ openExternal: h.external }) }));
vi.mock("@/i18n/IntlProvider.js", () => ({ useZCodeIntl: () => ({ locale: "en-US" }) }));
vi.mock("@/rewards/RewardsWebview.js", () => ({
  RewardsWebview: () => createElement("div", { "data-testid": "rewards-view" }),
}));

function Trigger() {
  const open = useOpenRewards();
  return createElement("button", { onClick: () => void open?.() }, "open rewards");
}
const app = (desktop = true) =>
  createElement(RewardsProvider, { desktop, children: createElement(Trigger) });
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

// VCode 无登录入口：奖励页不再 gating 登录态，点击即打开。
it("桌面端点击直接打开奖励页", () => {
  render(app());
  fireEvent.click(screen.getByText("open rewards"));
  expect(screen.getByTestId("rewards-view")).toBeTruthy();
});

it("Web 端点击直接走外链", () => {
  render(app(false));
  fireEvent.click(screen.getByText("open rewards"));
  expect(h.external).toHaveBeenCalledTimes(1);
  expect(h.external.mock.calls[0][0]).toMatch(
    /^https:\/\/[^/]+\/en\/rewards\?embedded=app&theme=zai-light$/,
  );
});
