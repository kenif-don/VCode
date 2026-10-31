import { describe, expect, it } from "vitest";
import { shouldReportLaunchToInput } from "@/lib/launchToInputReport.js";

describe("shouldReportLaunchToInput", () => {
  it("门禁已清除、未上报过 → 上报", () => {
    expect(
      shouldReportLaunchToInput({
        isStartupRenderBlocked: false,
        alreadyReported: false,
      }),
    ).toBe(true);
  });

  it("门禁仍阻塞 → 不上报", () => {
    expect(
      shouldReportLaunchToInput({
        isStartupRenderBlocked: true,
        alreadyReported: false,
      }),
    ).toBe(false);
  });

  it("已上报过 → 不重复", () => {
    expect(
      shouldReportLaunchToInput({
        isStartupRenderBlocked: false,
        alreadyReported: true,
      }),
    ).toBe(false);
  });
});
