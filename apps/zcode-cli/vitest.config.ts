import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Bugfix: 外部 zcode-cli 历史里同时存在 test/ 和 tests/ 目录；合入 apps 后需要同时保留两种约定，避免新增包测试被根 include 规则过滤掉。
    include: [
      "test/**/*.test.ts",
      "tests/**/*.test.ts",
      "packages/*/test/**/*.test.ts",
      "packages/*/tests/**/*.test.ts",
    ],
    // 与根 vitest.config.ts 同一政策：Windows 低配/高负载下默认 5s 会被真实 SQLite、
    // 真实进程与工作流用例提前打穿（v3.17.1 工作流收尾路径变慢后，本工作区
    // session-persistence 的专家工作流用例稳定落在 5.0~5.4s）。统一放宽到 30s。
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
