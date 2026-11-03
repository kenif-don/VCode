import { describe, expect, it } from "vitest";
import { buildPluginUiSurfaceKey } from "../contract.js";
import { resolvePluginUiLogicalScope } from "./pluginUiLogicalScope.js";
describe("logical MCP App identity", () => {
  it("does not merge ordinary calls and only merges explicit widgets with the same permission scope", () => {
    const a = { kind: "toolCall" as const, toolCallId: "a" },
      b = { ...a, toolCallId: "b" };
    expect(resolvePluginUiLogicalScope({}, a)).not.toEqual(resolvePluginUiLogicalScope({}, b));
    const widget = { widgetMeta: JSON.stringify({ "openai/widgetSessionId": "counter" }) };
    expect(resolvePluginUiLogicalScope(widget, a)).toEqual(resolvePluginUiLogicalScope(widget, b));
    expect(resolvePluginUiLogicalScope(widget, a)).not.toEqual(
      resolvePluginUiLogicalScope(
        { ...widget, csp: { connectDomains: ["https://fixture.invalid"] } },
        b,
      ),
    );
  });
  it("isolates same-named surfaces by server, resource and workspace; session is shared (HBA fr8/fr19)", () => {
    const scope = { kind: "surface" as const, surfaceId: "panel" };
    const base = {
      workspacePath: "/w",
      sessionId: "s",
      pluginId: "p",
      serverName: "m",
      resourceUri: "ui://app",
    };
    const key = buildPluginUiSurfaceKey(base, scope);
    for (const changed of [
      { serverName: "other" },
      { resourceUri: "ui://other" },
      { workspaceIdentity: "other" },
    ])
      expect(buildPluginUiSurfaceKey({ ...base, ...changed }, scope)).not.toBe(key);
    // 面板跟随项目、跨会话共用：会话位不参与 key（换锚重绑保持 widgetState 连续）。
    expect(buildPluginUiSurfaceKey({ ...base, sessionId: "other" }, scope)).toBe(key);
  });
});
