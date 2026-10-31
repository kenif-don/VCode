import { describe, expect, it } from "vitest";
import { redactMobileDiagnosticText } from "./e2e/helpers/mobile-pairing.js";

describe("手机配对失败证据脱敏", () => {
  it("移除完整链接和单独出现的 query/hash 配对材料", () => {
    const url = "https://mobile.test/remote/?pairingKey=query-secret#token=hash-secret";
    const value = redactMobileDiagnosticText(`goto ${url}; query-secret; hash-secret`, url);
    expect(value).toContain("https://mobile.test/remote/");
    expect(value).not.toContain("query-secret");
    expect(value).not.toContain("hash-secret");
    expect(value).not.toContain("pairingKey=");
  });
  it("保留资源路径以定位加载错误，去掉其他 URL 的查询参数", () => {
    const value = redactMobileDiagnosticText(
      "failed https://cdn.test/assets/main.js?signature=private: ERR_CONNECTION_RESET",
      "https://mobile.test/remote/?key=one-time-key",
    );
    expect(value).toBe("failed https://cdn.test/assets/main.js ERR_CONNECTION_RESET");
  });
});

