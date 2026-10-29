/**
 * data-testid 契约(W0/W6 冻结)
 *
 * e2e 用例全部通过 page.getByTestId(...) 定位。被测 UI(ZCode 宿主 + hba-uigen
 * / hba-run 插件面板)落地时必须提供以下 data-testid 属性;命名一经冻结,
 * 改名需同步修改本文件与 spec。
 *
 * 现状:插件面板(plugins/hba-uigen/ui/panel.html、plugins/hba-run/ui/panel.html)
 * 当前用 id 选择器,尚未挂 data-testid → 对应用例标记 test.fixme,状态
 * 「待宿主集成/待插件补 testid」。宿主侧(设置页/消息流/Git 面板/终端)同理。
 */

export const T = {
  // ---- 会话与消息流(TC-AGT-02/03, TC-PERF-01) ----
  sessionList: "session-list",
  sessionItem: "session-item",
  messageList: "message-list",
  messageItem: "message-item", // 属性 data-role=user|assistant|agent-result
  messageInput: "message-input",
  messageSend: "message-send",
  agentPicker: "agent-picker", // 子智能体选择入口
  agentOption: "agent-option", // 属性 data-agent=coder|reviewer|...
  subagentResultCard: "subagent-result-card", // 子会话产出回注卡片
  subagentSessionLink: "subagent-session-link", // 并行子会话跳转(TC-AGT-03)

  // ---- 设置页智能体校验(TC-AGT-01) ----
  settingsAgentsPanel: "settings-agents-panel",
  agentRow: "agent-row", // 属性 data-agent=<name>
  agentValidationBadge: "agent-validation-badge", // 文案 ok / fail

  // ---- UI 原型面板 hba-uigen(TC-UIP-01..05) ----
  uigenReqInput: "uigen-req-input",
  uigenFormatSelect: "uigen-format-select",
  uigenScreenCount: "uigen-screen-count",
  uigenGenerateBtn: "uigen-generate-btn",
  uigenProgress: "uigen-progress",
  uigenPreviewFrame: "uigen-preview-frame", // 390px 预览 iframe
  uigenPreviewViewport: "uigen-preview-viewport", // iframe 内 390px 容器
  uigenScreenCard: "uigen-screen-card", // 属性 data-screen=<id>
  uigenDemoPlayBtn: "uigen-demo-play-btn",
  uigenDemoPauseBtn: "uigen-demo-pause-btn",
  uigenDemoNextBtn: "uigen-demo-next-btn",
  uigenDemoActive: "uigen-demo-active", // 当前演示屏标记 data-screen=<id>
  uigenImportDirBtn: "uigen-import-dir-btn",
  uigenImportDone: "uigen-import-done",
  uigenVersionList: "uigen-version-list",
  uigenVersionItem: "uigen-version-item", // 属性 data-version=<id>
  uigenRollbackBtn: "uigen-rollback-btn",
  uigenRollbackDone: "uigen-rollback-done",

  // ---- 运行面板 hba-run(TC-RUN-01..03) ----
  runConfigList: "run-config-list",
  runConfigItem: "run-config-item", // 属性 data-config=<id>
  runConfigNewBtn: "run-config-new-btn",
  runConfigSaveBtn: "run-config-save-btn",
  runConfigDeleteBtn: "run-config-delete-btn",
  runConfigName: "run-config-name",
  runConfigCommand: "run-config-command",
  runConfigCwd: "run-config-cwd",
  runConfigEnv: "run-config-env",
  runConfigPreviewUrl: "run-config-preview-url",
  runBtn: "run-btn",
  runStopBtn: "run-stop-btn",
  runStatus: "run-status", // 文案 running / stopped / exited / failed
  runConsole: "run-console",
  runOutputLine: "run-output-line",
  runPreviewLink: "run-preview-link", // 预览联动入口

  // ---- 终端整合 FR-5(TC-TRM-01) ----
  topTerminalBtn: "top-terminal-btn", // 反向断言:不允许存在
  bottomTerminalBtn: "bottom-terminal-btn",
  terminalPanel: "terminal-panel", // 属性 data-side=right
  terminalInput: "terminal-input",

  // ---- Git 面板 FR-3(TC-GIT-01/02) ----
  gitPanel: "git-panel",
  gitStatusList: "git-status-list",
  gitStatusItem: "git-status-item", // 属性 data-path=<相对路径>
  gitDiffView: "git-diff-view",
  gitDiffFile: "git-diff-file", // 属性 data-path=<相对路径>
  gitWorktreeCreateBtn: "git-worktree-create-btn",
  gitWorktreeDialog: "git-worktree-dialog",
  gitWorktreeSessionBtn: "git-worktree-session-btn",
} as const;

export type TestId = (typeof T)[keyof typeof T];
