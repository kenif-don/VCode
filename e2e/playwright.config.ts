import { defineConfig, devices } from "@playwright/test";

/**
 * HBA→ZCode 迁移验收 e2e 配置(W0/W6)
 *
 * 被测系统:ZCode 桌面端 Web 模式(`zcode --web`),Playwright 通过 baseURL 驱动。
 * baseURL 取值顺序:
 *   1. 环境变量 ZCODE_WEB_URL(以 `zcode --web` 启动时输出的地址为准)
 *   2. 占位默认 http://127.0.0.1:3777(仅兜底,实跑前必须覆盖)
 *
 * 可选:设置 ZCODE_WEB_START=1 时由 Playwright 拉起 `zcode --web`
 * (reuseExistingServer:true,本地已有实例直接复用)。
 *
 * 运行方式见 e2e/README.md。用例文件:specs/*.spec.ts,按 TC 编号命名 test 标题。
 */

const ZCODE_WEB_URL = process.env.ZCODE_WEB_URL ?? "http://127.0.0.1:3777";

export default defineConfig({
  testDir: "./specs",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // 宿主为单实例桌面应用,串行执行避免会话/面板状态串扰
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "report" }]],
  use: {
    baseURL: ZCODE_WEB_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // TC-UIP-01 的 390px 手机预览也用此项目在 iframe 内断言;独立移动端视口备用
      name: "chromium-mobile-390",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
  ],
  ...(process.env.ZCODE_WEB_START === "1"
    ? {
        webServer: {
          command: "zcode --web",
          url: ZCODE_WEB_URL,
          reuseExistingServer: true,
          timeout: 120_000,
        },
      }
    : {}),
});
