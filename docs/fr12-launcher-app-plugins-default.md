# FR-12 新会话右侧面板默认显示「应用插件」区

需求(用户定夺,2026-10-29):**打开新会话→右侧面板只有「新标签页」,没有「应用插件」——能不能默认就把这些都显示完,而不是新会话只显示「新标签页」。**

「新标签页」「应用插件」是 launcher 的两个分区标题(sidePane.openTab / settings.plugins.store.ui.title):新会话(草稿态,首条消息未发、activeTaskId=null)打开右侧面板时,launcher 只渲染「新标签页」分区(文件/浏览器/终端/审查等内置行),「应用插件」分区被整体隐藏。本批次 = 该分区默认常驻 + 草稿态可直接打开面板。

## 范围

- **改**:launcher(含空白页)「应用插件」分区不再随空会话隐藏,所有会话态默认显示全部条目(UI 原型/运行/PDF/演示文稿等推荐清单);草稿态点击条目直接打开面板。
- **不改**:正式会话既有行为(条目点击、市场「打开 UI」、工具卡片面板路由);插件 manifest `availability: "session"`;fr8 面板项目级语义(tab id 会话段 `*`、ui/message 绑当前活跃会话)。

## 机制(4 处宿主改动 + 契约放宽,全在 packages/ui)

1. **分区常驻** `app-shell/AnimatedSidePanePanel.tsx`:删掉 `{activeTaskId ? (<>…应用插件…</>) : null}` 草稿门,分割线+「应用插件」标题+条目+「查看所有插件」入口无条件渲染。
2. **条目常驻** `plugin-ui/components/PluginUiLauncherItems.tsx`:早退条件从 `sessionId === null || entries.length === 0` 收敛为 `entries.length === 0`——草稿态列出全部条目,仅确实无推荐条目才显示「暂无推荐的应用插件」。**续修(r13 实测发现)**:`plugin-ui/adapters/useRecommendedUiPlugins.ts` 内还有三层 sessionId 门(推荐清单 `useUiPluginRecommendations(sessionId !== null)` 不拉取、插件目录 `initialize` 不跑、loading 恒 false)——r13 里分区虽显示但条目恒为空(「暂无推荐的应用插件」)。三门全部放开:读取/初始化本就是 workspace 级,与会话无关;补 `useRecommendedUiPlugins.test.ts` 草稿用例(sessionId=null 列条目+安装可用)。
3. **请求契约放宽** `plugin-ui/contract.ts`:`OpenPluginUiSideTabRequest.parentSessionId: string | null`——null = 草稿态未绑定会话(宿主建 tab 前补建);`buildPluginUiSidePaneTabId` 面板分支恒 `*`(草稿空会话不改变 tab id,与正式会话打开收敛到同一 tab),工具卡片分支缺会话直接 throw(id 嵌会话段,属调用方编程错误)。`sidePane/pluginUiSidePaneTab.ts` 的 `OpenScopedPluginUiSideTabRequest` 用交集把 parentSessionId 收窄回 string(不能用 Omit——请求是 toolCall/surface 两形态 union,Omit 丢判别字段)。
4. **草稿托管会话** `hooks/useAppPanels.ts` `resolvePluginUiHostSession` + `handleOpenPluginUi`:parentSessionId 为空时先经 `zcodeSessionService.createSession({persistence: "deferred"})` 补建一个 **deferred 托管会话**再开 tab;同一工作区复用同一个(Map 按 workspaceKey 缓存)。deferred 会话是产品既有机制("未发送前的草稿 session 只用于让 toolbar 和 agent runtime 共用同一份状态"):**不进任务索引/侧栏**,随 runtime 生命周期消亡——不会在任务列表多出幽灵会话。会话只作面板宿主绑定(资源读取/工具调用/投影 lease,见 CONTRACT.md"复用…会话 lease"),面板 tab 仍是项目级(fr8)。补建失败走既有提示「请在当前项目的可用会话中打开插件界面」,不落半开 tab。

## 为什么必须补建会话(协议事实)

面板即 MCP App:沙箱 prepare 走 `readMcpResource`(经会话 record 的 app→agent 协议)、面板 `tools/call` 经 `callMcpToolForUi`(Agent 单一拥有调用)、启动屏障还要等会话投影快照(`rows !== null` 才 enable)。插件面板在协议层绑死会话 record,空会话打不开——所以"草稿打开"不是把 gate 一删就完,必须给面板一个真实(但不进侧栏)的会话宿主。deferred 正是为这种"先有 runtime 状态、后有首发"的场景设计。

## 边界(如实)

- 草稿里点面板「添加到对话」:ui/message 在无活跃会话时回退绑定托管会话(既有 fr8 回退逻辑),消息会把托管会话提升为可见会话并落在其中(不丢失);发首条消息后消息路由回到正式会话。属罕见路径,记为已知限制。
- 托管会话随应用退出消失(不持久化);面板 UI 状态本身已按 `.hba/*` 落盘(面板状态项目级共享 B 方案),重开面板即恢复。
- 插件市场「打开 UI」维持既有语义(不建会话,无会话时提示);只有 launcher 条目在草稿态走补建路径。

## 补丁与验证

- 补丁:`fork/patches/fr12-01-launcher-app-plugins-default.patch`(11 文件:AnimatedSidePanePanel.tsx、useAppPanels.ts、PluginUiLauncherItems.tsx、contract.ts、contract.example.ts、contract.test.ts、pluginUiSidePaneTab.ts、useAppPanels{Scope,BrowserViewLifecycle,WorkflowArtifactOpen,InterfaceMode}.test.ts)。`git apply --reverse --check` 通过(当前树);生成时按台账与并行 fr9-01/fr10-01/fr11-01 的触碰面核对零交集。
- **编号说明:fr9-01/fr10-01/fr11-01 已被同日并行批次(Git 拉取/文件树重命名删除/MCP 保活)占用,本批次顺延 fr12-01;代码注释标签统一 `HBA fr12`。**
- 测试:plugin-ui contract 7/7(新增 fr12 用例:草稿空会话不改变面板 tab id、工具卡片缺会话 throw)+ workspaceSidePane 121/121 + marketPluginUi 7/7 = 135 全绿;`pnpm run typecheck` 0 错误。
- 既有失败(与本批无关,已对照实验):`useAppPanelsScope.test.ts` 6 条仍红——断言的是 fr8 之前 browser-permissions 等按 owner 隔离的旧语义(B 关闭 all 不删 A、隐藏 tab 保留等),fr8 把这些类型改为项目级后未随迁;用回退本批改动重跑同样 6 条失败,确认非本批引入,列为 fr8 遗留待还。
- useAppPanels 四个单测补了 `@/i18n/IntlProvider.js` 的 vi.mock(hook 新增 useZCodeIntl,与既有 useServices mock 同风格)。

## 验证步骤(重打包/热替换后)

1. 打开项目 → 点「新建任务」(新会话,先不发消息)→ 打开右侧面板:launcher 应同时看到「新标签页」区(文件/浏览器/终端/审查)和「应用插件」区(UI 原型/运行/PDF…全部列出,不再只显示「新标签页」)。
2. 在新会话里点「运行」/「UI 原型」的「打开」:面板直接打开并可用;任务列表**不**多出空会话。
3. 面板开着时发首条消息(会话正式建立)→ 面板原样在(fr8 项目级);面板日志右键「添加到对话」发进当前会话。
4. 对照:正式会话打开面板行为不变;插件市场「打开 UI」无会话时仍是提示文案。
