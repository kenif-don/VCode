# FR-5 终端整合方案(核心层小改:入口收敛)

目标(PRD 6.5 / G5,原文):**移除顶部栏终端按钮(FR-5-1);底部新增打开终端按钮,点击后在右侧面板打开终端标签页,再次点击聚焦已有终端(FR-5-2);保留终端快捷键与多终端标签、复制粘贴、右键菜单等既有能力(FR-5-3)**。G5:"终端统一收敛到右侧面板,入口简化为底部按钮。"

基线:上游 `zai-org/ZCode` commit `3c5b227`(version 3.16.2),源码本地解压路径 `C:\Users\76437\AppData\Local\Temp\zcode-src\zai-org-ZCode-3c5b227\`(下文相对路径均以此为根)。改动落盘于 `fork/patches/fr5-01-*.patch`、`fork/patches/fr5-02-*.patch`(git diff 格式,基线上 `git apply --check` 通过)。

---

## 1. 现状(证据:已核实于源码)

ZCode 为终端双形态(PRD 6.5 原文"底部终端面板与右侧面板终端标签页"):

| 形态 | 入口 | 代码位置 |
|---|---|---|
| **底部终端面板**(多标签,`isTerminalOpen` 控制) | 顶部栏 toggleTerminal 按钮;快捷键 `CmdOrCtrl+J`;quickpick `toggle-terminal`;Windows 标题栏菜单 | 按钮组件 `packages/ui/src/WorkspaceTerminalToggleButton.tsx`(渲染点 `packages/ui/src/WorkspaceHeaderSections/WorkspaceHeaderActionSection.tsx` 的 `<WorkspaceTerminalToggleButton …>`);状态 `packages/ui/src/hooks/useAppPanels.ts`(`isTerminalOpen`,`handleToggleTerminal`,日志 `[App] 切换底部终端面板`);面板 `packages/ui/src/app-shell/AnimatedTerminalPanel.tsx`(ResizablePanel id `terminal`)→ `packages/ui/src/Terminal.tsx`(TabsList 多标签 `TerminalTabTrigger`);快捷键声明 `packages/shared/src/shortcutCommands.ts`(`{ id: "toggleTerminal", channel: "window", defaultBindings: ["CmdOrCtrl+j"] }`) |
| **右侧面板(sidePane)终端页签** | quickpick `add-terminal-tab`(handler `openTerminalTab`);sidePane 新页签启动器 `terminal` 条目 | 打开 API `packages/ui/src/hooks/useAppPanels.ts` 的 `handleOpenTerminalTab`(日志 `[App] 新建右侧终端 tab=…`,**每次新建页签**)→ `packages/ui/src/lib/workspaceSidePane.ts` 的 `openTerminalSidePane`/`createTerminalSidePaneTab`(类型 `TerminalSidePaneTab`,`id: terminal:<uuid>`);quickpick 定义 `packages/ui/src/quickpick/quickPickCommands.ts`(`add-terminal-tab`);启动器 `packages/ui/src/app-shell/AnimatedSidePanePanel.tsx`(`sidePane.launcher.terminal`,`onOpen: onOpenTerminalTab`) |

关键既有 API(证据):

- `activateSidePaneTab(current, tab)` / `setActiveSidePaneTab(current, tabId)`(`workspaceSidePane.ts`):前者"替换并激活",后者"仅激活"——聚焦已有终端用后者;
- `revealSidePaneForCurrentOwner()` / `commitOpenedSidePaneState(...)`(`useAppPanels.ts`):展开右侧面板并提交 tab 状态(所有 sidePane 打开动作的统一写路径);
- `createTerminalSidePaneTitle(current, workspaceAbsPath)`(`useAppPanels.ts`):终端页签标题生成。
- 快捷键 `CmdOrCtrl+J`(`toggleTerminal`)、多标签、复制粘贴、右键菜单(`Terminal.tsx` 的 `terminal.contextMenu.copy/paste`)均在上述两个形态内,FR-5 不触碰其行为(FR-5-3)。

app.asar 交叉验证(证据,`D:\ZCode\resources\app.asar` 字符串):`toggleTerminal` 快捷键 `CmdOrCtrl+j`、quickpick `add-terminal-tab`/`openTerminalTab`、日志 `[App] 新建右侧终端 tab`、`sidePane.launcher.terminal` 均与源码一致。

## 2. 行为定义(改造后)

1. **FR-5-1**:顶部栏不再渲染终端按钮(`WorkspaceTerminalToggleButton` 从 header action section 移除;组件文件保留不删,便于回滚与上游对照)。
2. **FR-5-2**:composer 左下(底部常驻操作区 `leadingActionsNode`:模式切换/CUA/后台任务同排)新增"打开终端"按钮:
   - 点击:右侧面板展开并**打开终端页签**(`openTerminalSidePane`,cwd = 当前 workspace);
   - 再次点击:已有任一终端页签时**只聚焦**(激活该页签),不再堆叠新建;
   - 已有页签判定:当前 scope 的 sidePane state 中 `type === "terminal"` 的第一个页签(多个终端页签时聚焦策略见待确认)。
3. **FR-5-3(不动)**:快捷键 `CmdOrCtrl+J` 仍切换底部终端面板(`handleToggleTerminal` 原样保留);quickpick `toggle-terminal`/`add-terminal-tab` 语义不变(`add-terminal-tab` 仍是"始终新建页签");多终端标签、复制粘贴、右键菜单零改动。

> 按钮落点说明(PRD 只写"底部"):选择 composer 左下 `leadingActionsNode` 的理由——(a) 该行是"底部"唯一常驻可见的操作按钮区,GUI 黑盒可直接点击(底部终端面板收起时为 0px 不可见,不能作为入口载体);(b) 与既有 CUA/后台任务入口同排,视觉一致。若 UI 定稿另有位置,仅替换插入点,按钮组件与桥接逻辑不变。

## 3. 修改点列表(精确到文件/组件/函数)

| # | 文件 | 组件/函数 | 改动 |
|---|---|---|---|
| 1 | `packages/ui/src/WorkspaceHeaderSections/WorkspaceHeaderActionSection.tsx` | `WorkspaceHeaderActionSection` | 删除 `WorkspaceTerminalToggleButton` import 与渲染块(含其上方 Bugfix 注释);顺带删除解构中不再使用的 `isTerminalOpen`/`onToggleTerminal`。props 类型(`WorkspaceHeaderActionSectionProps`)保留字段不动,调用方零改动 |
| 2 | `packages/ui/src/store/terminalEntryStore.ts`(**新文件**) | `useTerminalEntryStore` | 单例请求桥(`pendingRequest/requestOpen/consumeRequest`),形态照抄 `modelTrajectoryStore.ts`;按钮挂载深,避免把侧栏回调贯穿 composer 树 |
| 3 | `packages/ui/src/hooks/useTerminalEntryBridge.ts`(**新文件**) | `useTerminalEntryBridge` | 按 workspaceKey 匹配消费请求,形态照抄 `useModelTrajectoryOpenBridge.ts` |
| 4 | `packages/ui/src/WorkspaceOpenTerminalButton.tsx`(**新文件**) | `WorkspaceOpenTerminalButton` | 底部按钮(SquareTerminalIcon,tooltip 复用 i18n `terminal.show`="打开终端",遥测 `workbench.terminal/open`),点击派发 `terminalEntryStore.requestOpen` |
| 5 | `packages/ui/src/hooks/useAppPanels.ts` | 新增 `handleOpenOrFocusTerminalTab`;`useTerminalEntryBridge` 接线;return 导出 | 打开/聚焦语义:`current.tabs.find(tab => tab.type === "terminal")` 命中 → `setActiveSidePaneTab(current, existing.id)`;未命中 → `openTerminalSidePane(...)`(与 `handleOpenTerminalTab` 相同的 title/cwd/remoteSessionId);两者均先 `revealSidePaneForCurrentOwner()` |
| 6 | `packages/ui/src/v4/ConversationComposer.tsx` | `leadingActionsNode`(composer 左下操作簇) | 首位插入 `<WorkspaceOpenTerminalButton workspacePath workspaceIdentity />`;deps 已含两参数,无新增依赖 |

不改:`shortcutCommands.ts`、`quickPickCommands.ts`、`Terminal.tsx`、`AnimatedTerminalPanel.tsx`、`workspaceSidePane.ts`、`WorkspaceTerminalToggleButton.tsx`(组件保留)。

## 4. 补丁文件

| 文件 | 规模 | 内容 |
|---|---|---|
| `fork/patches/fr5-01-remove-topbar-terminal-button.patch` | 1 文件 / +0 −10 | 上表 #1 |
| `fork/patches/fr5-02-bottom-open-terminal-button.patch` | 5 文件 / +172 −0 | 上表 #2~#6(含 3 个新文件) |

```bash
git apply fork/patches/fr5-01-remove-topbar-terminal-button.patch
git apply fork/patches/fr5-02-bottom-open-terminal-button.patch
# 已在基线 3c5b227 的 12 文件副本上验证 git apply --check 通过;与 fr3 两补丁叠加无冲突。
```

差异最小化:全部改动 6 文件(3 新增),不触碰终端实现与快捷键;rebase 冲突面仅 header action section 一处渲染块与 composer 左下一簇。

## 5. 验收对照 TC-TRM-01(P0,GUI 黑盒:顶部无终端按钮,底部按钮打开右侧终端)

| # | 验收点(PRD 表 8-2 TC-TRM-01 / 表 8-3) | 验证方式 |
|---|---|---|
| 1 | 顶部栏无终端按钮 | 打开任务页头部:原 `WorkspaceTerminalToggleButton`(`data-testid` `TID_TERMINAL_TOGGLE`)不再出现;可从源码断言 `WorkspaceHeaderActionSection.tsx` 无该组件引用 |
| 2 | 底部按钮打开右侧终端 | 点击 composer 左下"打开终端"按钮 → 右侧 sidePane 展开并出现终端页签(日志 `[App] 新建右侧终端 tab=…`),终端在当前 workspace cwd 起壳 |
| 3 | 再次点击聚焦已有终端 | 第二次点击不新建页签(tab 数不变),原终端页签被激活(日志 `[App] 聚焦右侧终端 tab=…`) |
| 4 | 回归:快捷键与多标签不受影响(表 8-3 FR-5 DoD) | `CmdOrCtrl+J` 仍开/合底部终端面板;quickpick"添加终端页签"仍可新建多个页签;终端内复制/粘贴/右键菜单可用 |
| 5 | 只读工作区行为不变 | 只读原因(`readOnlyReason`)下按钮禁用(与旧顶部按钮一致的降级);`isOfficeMode` 下不打开新终端(与 `handleOpenTerminalTab` 同一守卫) |

自动化建议(GUI 黑盒):断言 header 区域不存在 `[aria-label="切换终端"]` 按钮 → 点击底部按钮 → 断言 sidePane 出现 `Terminal` tab → 再点断言 tab 计数不变且 activeTab 为该终端。

## 6. 证据(已核实) vs 推断

- **证据(已核实,源码 commit 3c5b227)**:§1 全部代码位置与日志串;`setActiveSidePaneTab`/`openTerminalSidePane` 签名;快捷键 `CmdOrCtrl+j`;quickpick 命令 id;app.asar 字符串交叉验证。
- **推断(实现选择,待评审确认)**:按钮落点 composer 左下(PRD 仅写"底部",无 UI 稿);多个终端页签时"聚焦已有"取 `tabs` 中第一个 `type==="terminal"`;复用 i18n `terminal.show` 作为按钮文案;遥测 `featureId: "workbench.terminal"` 沿用旧按钮。

## 7. 待确认项

1. **按钮最终落点**:PRD 未附 UI 稿;若定稿在其它"底部"位置(如输入框工具条另一侧),仅替换 `ConversationComposer.tsx` 插入点,`WorkspaceOpenTerminalButton` 与桥接不变;
2. **Windows 标题栏菜单**(`packages/ui/src/WindowsCaptionMenuButton.tsx` 的 `terminal.toggle` 菜单项)与 quickpick `toggle-terminal` 是否同步收敛到右侧面板——当前方案按 FR-5-3"保留快捷键"保守处理为不动(仍是切换底部面板);若产品要求快捷键也改为右侧面板,改动点为 `handleToggleTerminal` 一处(待产品确认);
3. 多终端页签聚焦策略(第一个 / 最近激活 / 弹出选择);
4. 本补丁未做本地编译与 e2e 实测(需 `pnpm install` + `pnpm run typecheck` + GUI 黑盒跑 TC-TRM-01),属实施阶段必做回归。
