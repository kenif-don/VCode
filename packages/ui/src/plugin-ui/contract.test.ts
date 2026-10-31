import { createPluginUiSidePaneTab } from "./sidePane/pluginUiSidePaneTab.js";
import { describe, expect, it } from "vitest";
import { exampleOpenSideTab, examplePresentation } from "./contract.example.js";
import {
  PLUGIN_UI_CARD_DEFAULT_HEIGHT_PX,
  buildPluginUiSidePaneTabId,
  buildPluginUiSurfaceKey,
  readPluginUiScopeRef,
  type PluginUiSessionActions,
  type PluginUiSessionCommandPort,
} from "./contract.js";

describe("plugin-ui contract", () => {
  it("侧栏与渲染面同时隔离 workspace/session/plugin", () => {
    const request = {
      workspacePath: "/repo",
      parentSessionId: "s1",
      pluginId: "p",
      toolCallId: "c1",
      resourceUri: "ui://p/widget",
      title: "Widget",
    };
    expect(buildPluginUiSidePaneTabId(request)).toBe(
      "plugin-ui:%2Frepo:s1:p::ui%3A%2F%2Fp%2Fwidget:c1",
    );
    expect(buildPluginUiSidePaneTabId({ ...request, pluginId: "other" })).not.toBe(
      buildPluginUiSidePaneTabId(request),
    );
    const scope = { workspacePath: "/repo", sessionId: "s1", pluginId: "p" };
    const surface = { kind: "surface" as const, surfaceId: "panel" };
    expect(buildPluginUiSurfaceKey(scope, surface)).not.toBe(
      buildPluginUiSurfaceKey({ ...scope, pluginId: "other" }, surface),
    );
    expect(buildPluginUiSurfaceKey(scope, surface)).not.toBe(
      buildPluginUiSurfaceKey({ ...scope, workspaceIdentity: "ssh:a" }, surface),
    );
    // HBA fr8/fr19：面板（surface）跟随项目，key 不随会话变化（换锚重绑保持连续）；
    // 工具卡片（toolCall）仍按会话隔离。
    expect(buildPluginUiSurfaceKey({ ...scope, sessionId: "s2" }, surface)).toBe(
      buildPluginUiSurfaceKey(scope, surface),
    );
    const toolCall = { kind: "toolCall" as const, toolCallId: "c1" };
    expect(buildPluginUiSurfaceKey(scope, toolCall)).not.toBe(
      buildPluginUiSurfaceKey({ ...scope, sessionId: "s2" }, toolCall),
    );
  });

  it("作用域解析：surfaceId 优先，两者都缺为 null", () => {
    expect(readPluginUiScopeRef({ toolCallId: "c1" })).toEqual({
      kind: "toolCall",
      toolCallId: "c1",
    });
    expect(readPluginUiScopeRef({ toolCallId: "c1", surfaceId: "p" })).toEqual({
      kind: "surface",
      surfaceId: "p",
    });
    expect(readPluginUiScopeRef({})).toBeNull();
  });

  it("示例请求生成 session 作用域的 tab", () => {
    const tab = exampleOpenSideTab({
      parentSessionId: "s1",
      toolCallId: "c1",
      pluginId: examplePresentation.pluginId,
      resourceUri: examplePresentation.resourceUri,
      title: "Widget",
      workspacePath: "/repo",
    });
    expect(tab.type).toBe("plugin-ui");
    expect(tab.id).toContain(":s1:");
    expect(tab.id).toContain(encodeURIComponent(examplePresentation.pluginId));
    expect(tab.remoteSessionId).toBeNull();
    const surfaceTab = exampleOpenSideTab({
      parentSessionId: "s1",
      surfaceId: "panel",
      serverName: examplePresentation.serverName,
      pluginId: examplePresentation.pluginId,
      resourceUri: examplePresentation.resourceUri,
      title: "Panel",
      workspacePath: "/repo",
    });
    expect(surfaceTab.id).toContain(":surface:panel");
    expect(surfaceTab.serverName).toBe(examplePresentation.serverName);
  });

  it("文档窗口实例独立，序列化恢复不重复拼接作用域", () => {
    const input = {
      workspaceKey: "/repo",
      workspacePath: "/repo",
      parentSessionId: "s1",
      pluginId: "pdf",
      resourceUri: "ui://pdf/panel.html",
      surfaceId: "pdf",
      title: "PDF",
      instanceId: "first",
      serverName: "pdf",
    };
    const first = createPluginUiSidePaneTab(input);
    const second = createPluginUiSidePaneTab({ ...input, instanceId: "second" });
    expect(first.id).not.toBe(second.id);
    const restored = JSON.parse(JSON.stringify(first));
    expect(readPluginUiScopeRef(restored)).toEqual(readPluginUiScopeRef(input));
    expect(createPluginUiSidePaneTab(restored).id).toBe(first.id);
    // HBA fr7：面板（surface）跟随项目，跨会话共用同一 tab id。
    expect(createPluginUiSidePaneTab({ ...input, parentSessionId: "s2" }).id).toBe(first.id);
  });

  it("默认卡片高度符合宿主约定", () => {
    expect(PLUGIN_UI_CARD_DEFAULT_HEIGHT_PX).toBe(240);
  });

  it("HBA fr12：草稿（会话待宿主补建）不改变面板 tab id，工具卡片必须带会话", () => {
    const surfaceRequest = {
      workspacePath: "/repo",
      parentSessionId: null,
      pluginId: "p",
      surfaceId: "panel",
      serverName: "p",
      resourceUri: "ui://p/panel.html",
      title: "Panel",
    };
    // 面板 tab id 的会话段恒为 "*"：草稿打开与正式会话打开收敛到同一 tab。
    expect(buildPluginUiSidePaneTabId(surfaceRequest)).toBe(
      buildPluginUiSidePaneTabId({ ...surfaceRequest, parentSessionId: "s1" }),
    );
    // 工具卡片 id 嵌会话段，草稿空会话属调用方编程错误，直接拒绝。
    expect(() =>
      buildPluginUiSidePaneTabId({
        workspacePath: "/repo",
        parentSessionId: null,
        pluginId: "p",
        toolCallId: "c1",
        resourceUri: "ui://p/widget",
        title: "Widget",
      }),
    ).toThrow("parentSessionId");
  });

  it("4a-0 / S3：会话动作只剩 sendFollowUp，命令端口是 sendText + uploadAttachment（widgetState 不再经会话命令）", () => {
    const port: PluginUiSessionCommandPort = {
      sendText: async () => "sent",
      uploadAttachment: async (input) => ({
        ref: "ref",
        fileName: input.fileName,
        mime: input.mime,
        bytes: 0,
      }),
    };
    const actions: PluginUiSessionActions = { sendFollowUp: async () => {} };
    expect(Object.keys(port)).toEqual(["sendText", "uploadAttachment"]);
    expect(Object.keys(actions)).toEqual(["sendFollowUp"]);
  });
});
