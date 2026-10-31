import { readFile } from "node:fs/promises";
import {
  clearAppData,
  getE2EAppDataPaths,
  waitForDefaultWorkspaceReady,
} from "#e2e/helpers/desktop-app";

const byId = (id: string) => $(`[data-testid="${id}"]`);
function origin() {
  const value = process.env.ZCODE_CODING_PLAN_UPGRADE_MOCK_BASE_URL;
  if (!value) throw new Error("Missing isolated marketing fixture");
  return value;
}
async function state() {
  return (await (await fetch(`${origin()}/__e2e/marketing/state`)).json()) as {
    events: Array<{ campaign_id: string; action_type: string }>;
    requestDetails: Array<{ method: string; path: string; headers: { authenticated: boolean } }>;
  };
}
async function reset(options: Record<string, boolean> = {}) {
  const response = await fetch(`${origin()}/__e2e/marketing/reset`, {
    method: "POST",
    body: JSON.stringify(options),
  });
  expect(response.ok).toBe(true);
}
async function expectAnonymous() {
  const credentials = JSON.parse(await readFile(getE2EAppDataPaths().credentialsFile, "utf8"));
  // 只判断凭据是否存在，失败输出也不得带出凭据内容。
  expect(Boolean(credentials.zcodejwttoken)).toBe(false);
}

describe("Marketing Touch anonymous boundaries", () => {
  before(async () => {
    // VCode 无登录入口：全新 profile 默认就是匿名态，不再走头像菜单退出登录。
    await waitForDefaultWorkspaceReady();
    const popup = byId("cloud-content-dialog");
    if (await popup.isExisting()) await popup.$('[data-slot="dialog-close"]').click();
    await reset();
    await expectAnonymous();
  });
  beforeEach(async function () {
    // 启动时先不投放，避免营销弹窗遮挡首屏。
    await reset();
    await browser.reloadSession();
    await waitForDefaultWorkspaceReady();
    await expectAnonymous();
    await reset({
      popup: this.currentTest!.title.includes("popup"),
      banner: this.currentTest!.title.includes("banner"),
    });
    await browser.execute(() => window.dispatchEvent(new Event("online")));
  });
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });
  it("MTE-08 anonymous popup: queries and reports cancellation without Authorization", async () => {
    await byId("cloud-content-dialog").waitForDisplayed({ timeout: 15_000 });
    await byId("cloud-content-dialog").$('[data-slot="dialog-close"]').click();
    await byId("cloud-content-dialog").waitForExist({ reverse: true });
    await browser.waitUntil(async () => (await state()).events.length === 1);
    const ledger = await state();
    expect(ledger.events).toEqual([{ campaign_id: "independent", action_type: "cancel" }]);
    const requests = ledger.requestDetails.filter((request) =>
      request.path.startsWith("/api/v1/marketing/touch"),
    );
    expect(requests.some((request) => request.method === "GET")).toBe(true);
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(1);
    expect(requests.every((request) => !request.headers.authenticated)).toBe(true);
  });
  it("MTE-05 anonymous banner: closes normally and cancels claim without submitting it", async () => {
    const banner = byId("marketing-banner");
    await banner.waitForDisplayed({ timeout: 15_000 });
    // 空文案 fixture 使用 App 的本地化回退名称，不能只匹配英文。
    await banner.$('button[aria-label="Close"], button[aria-label="关闭"]').click();
    await banner.waitForExist({ reverse: true });
    await browser.waitUntil(async () => (await state()).events.length === 1);
    const closed = await state();
    expect(closed.events).toEqual([{ campaign_id: "banner-1", action_type: "cancel" }]);
    expect(
      closed.requestDetails
        .filter((request) => request.path.endsWith("/touch/action"))
        .every((request) => !request.headers.authenticated),
    ).toBe(true);
    await fetch(`${origin()}/__e2e/marketing/redeliver-banner`, { method: "POST" });
    await browser.execute(() => window.dispatchEvent(new Event("online")));
    await banner.waitForDisplayed({ timeout: 15_000 });
    await banner.$('button[aria-label="Open"], button[aria-label="打开"]').click();
    // VCode 无登录入口：匿名点击领取直接取消，不弹任何登录界面也不提交 claim。
    await browser.pause(2_000);
    const after = await state();
    expect(after.events).toEqual(closed.events);
    expect(
      after.requestDetails.filter((request) => request.path.endsWith("/billing/claim")),
    ).toHaveLength(0);
    await expectAnonymous();
  });
});
