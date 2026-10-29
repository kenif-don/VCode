# FR-8 右侧面板跟随项目（工作台面板项目级共享）

需求（用户定夺，2026-10-29）：**右侧栏面板状态被同项目所有会话共享**——A 会话打开了运行面板、浏览器，切到 B 会话"没有任何改变"。即面板跟随项目，而不是会话。

## 范围（两类）

**跟随项目（本次改动）**：工作台面板——插件面板（hba-run / hba-uigen 等 `plugin-ui` **surface** tab）、浏览器（`browser` / `browser-use` / `browser-permissions`）、终端（`terminal`）、文件管理（`file-manager`）、代码查看（`code-viewer`）、白板（`whiteboard`）、新标签页（`new-tab`）。

**保持会话级（内容属于某个对话，共享会串内容）**：plan 详情、划词对话（selection-side-chat）、工作流（workflow-*）、子智能体（subagent-*）、后台 bash 输出（bash-output）、model-trajectory、插件**工具卡片** tab（toolCall）。

## 机制（5 处宿主改动，全部在 packages/ui）

1. **可见性** `lib/workspaceSidePane.ts` `isSidePaneTabVisibleInScope`：工作台面板类型不再比对 ownerTaskId，同工作区即可见；`plugin-ui` 按 `surfaceId && !toolCallId` 区分面板（项目级）与工具卡片（会话级）。
2. **tab 身份** `plugin-ui/contract.ts` `buildPluginUiSidePaneTabId`：面板 tab id 的会话段用 `*`（`plugin-ui:<ws>:*:<pluginId>:surface:<surfaceId>`），跨会话唯一 → 打开/去重复用同一 tab、同一活沙箱（沙箱 surface key 仍按创建会话派生，实例不重建）；工具卡片 id 不变。
3. **去重按工作区**：`activateBrowserSidePane`（无 URL 复用）、`openBrowserPermissionsSidePane`、`findBrowserSidePaneTabByUrl`、`openCodeViewerSidePane`、`toggleBrowserSidePane` 放开 owner 比对；`openBrowserUseSidePane` 仍按浏览器会话 tabId 去重（语义如此）。
4. **消息路由** `plugin-ui/adapters/usePluginUiSidePaneModel.tsx` + `PluginUiSidePane.tsx` + `app-shell/AnimatedSidePanePanel.tsx`：面板（surface）的 `ui/message` / `updateModelContext` 绑定**当前活跃会话**（`activeSessionId=sidePaneOwnerId`）；资源通知路由、租约、widgetState 仍绑定创建会话——推送链路（投影 store 增量按会话键分发）不受切换影响。
5. 归属戳（`stampSidePaneTabsOwnership`）保留作溯源，不再收窄可见性。

## 不改的部分

- 插件 manifest `availability` 仍为 `"session"`（宿主校验器只认它）；行为层面 surface tab 一律项目级，无需协议变更。
- 会话内容面板、工具卡片的可见性与身份。
- browser-use 每对话浏览器会话隔离（agent 冲突防护）不变，只共享 tab 的显示。

## 补丁与构建

- 补丁：`fork/patches/fr8-01-sidepane-project-scope.patch`（7 文件：workspaceSidePane.ts、plugin-ui/contract.ts、contract.test.ts、PluginUiSidePane.tsx、usePluginUiSidePaneModel.tsx、AnimatedSidePanePanel.tsx、test/workspaceSidePane.test.ts）。
- 验证：`test/workspaceSidePane.test.ts` 121/121 + `plugin-ui/contract.test.ts` 6/6 全绿（旧语义断言已改写到 fr8 契约；期间抓到并修掉一个真 bug：无 URL 浏览器去重在不带 workspaceKey 的调用路径上会失效，改为工作区任一侧缺省即匹配）、`pnpm run typecheck` 零错误。
- 构建：全 workspace build + `packages/desktop` bundle → `dist/ZCode-3.16.2-hba-panels-r12-win-x64.exe`（r11 是 fr7 之前的包）。

## 验证步骤（装 r12 后）

1. 同项目会话 A：打开运行面板 + 浏览器（再开个终端/文件管理更佳）。
2. 切到会话 B：右侧面板**原样不变**——同样的 tab、同样的内容（运行面板选中态/日志、浏览器页面都在）。
3. 在 B 里对运行面板日志右键「添加到对话」→ 发进 **B** 的对话（当前活跃会话）。
4. 在 B 里点 launcher 的「运行」→ 激活的是同一个 tab（不新开）。
5. 会话级内容检查：A 的 plan/工作流 tab 在 B 里不可见（保持隔离）。
