import { describe, expect, it } from "vitest";
import {
  isSessionRecordLive,
  requireSession,
  requireSessionForMcpUi,
  type ZCodeProtocolAgentServerContext,
  type ZCodeProtocolSessionRecord,
} from "../src/zcode-protocol/server-types.js";

function makeRecord(): ZCodeProtocolSessionRecord {
  return {} as unknown as ZCodeProtocolSessionRecord;
}

function makeContext(
  entries: Array<[string, ZCodeProtocolSessionRecord]>,
): ZCodeProtocolAgentServerContext {
  return { sessions: new Map(entries) } as unknown as ZCodeProtocolAgentServerContext;
}

describe("mcp-ui 会话锚点兜底（HBA fr19）", () => {
  it("锚定会话存活时原样返回", () => {
    const record = makeRecord();
    const context = makeContext([["s1", record]]);
    expect(requireSessionForMcpUi(context, "s1", { operation: "mcp/uiCallTool" })).toBe(record);
  });

  it("锚定会话缺失时回退到存活记录", () => {
    const alive = makeRecord();
    const context = makeContext([["s2", alive]]);
    expect(requireSessionForMcpUi(context, "s1", { operation: "mcp/uiCallTool" })).toBe(alive);
  });

  it("多个存活记录时取最近创建的", () => {
    const older = makeRecord();
    const newer = makeRecord();
    const context = makeContext([
      ["s2", older],
      ["s3", newer],
    ]);
    expect(requireSessionForMcpUi(context, "s1")).toBe(newer);
  });

  it("全部会话消失时仍按 sessionUnavailable 失败", () => {
    const context = makeContext([]);
    expect(() => requireSessionForMcpUi(context, "s1")).toThrow("Session is not active: s1");
    expect(() => requireSession(context, "s1")).toThrow("Session is not active: s1");
  });

  it("isSessionRecordLive：直连按同一性，回退代理按在表判断", () => {
    const record = makeRecord();
    const replaced = makeRecord();
    // 直连命中。
    expect(isSessionRecordLive(makeContext([["s1", record]]), "s1", record)).toBe(true);
    // 会话被替换后旧记录失效。
    expect(isSessionRecordLive(makeContext([["s1", replaced]]), "s1", record)).toBe(false);
    // 回退代理：只要仍在活跃表即有效。
    expect(isSessionRecordLive(makeContext([["s2", record]]), "s1", record)).toBe(true);
    // 回退代理被移除后失效。
    expect(isSessionRecordLive(makeContext([]), "s1", record)).toBe(false);
  });
});
