# HBA→ZCode Fork 补丁落地验证报告

- 日期:2026-10-28
- 验证目标:将 fork 的 4 个补丁真实应用到 ZCode 源码(基线 3c5b227,v3.16.2),并通过类型检查/编译验证
- 结论:**4/4 补丁应用成功,typecheck 全绿(0 错误,0 修复),desktop 打包全链路成功**

## 1. 环境

| 项 | 值 |
| --- | --- |
| 源码副本 | `C:\Users\76437\AppData\Local\Temp\zcode-src\zai-org-ZCode-3c5b227`(93MB tarball 解压,临时工作副本) |
| 基线 | zcode 3.16.2 @ commit 3c5b227 |
| OS | Windows 10.0.26300 x64(Git Bash) |
| Node | v24.19.0(仓库 engines `>=24.0.0`,满足) |
| pnpm | 10.33.2(与 `packageManager: pnpm@10.33.2` 一致,corepack 0.35.0 可用) |
| git 工作副本 | 源码目录内 `git init` 后两次提交:`ba0bdaa6`(baseline)→ `2698c34b`(apply 4 patches),便于复核差异 |

## 2. 补丁应用结果:4/4 全部干净应用

按指定顺序执行 `git apply --check` → `git apply`:

| 顺序 | 补丁 | --check | apply | 触碰文件 |
| --- | --- | --- | --- | --- |
| 1 | fr5-01-remove-topbar-terminal-button.patch | OK | OK | `packages/ui/src/WorkspaceHeaderSections/WorkspaceHeaderActionSection.tsx` |
| 2 | fr5-02-bottom-open-terminal-button.patch | OK | OK | 新增 `packages/ui/src/WorkspaceOpenTerminalButton.tsx`、`packages/ui/src/store/terminalEntryStore.ts`、`packages/ui/src/hooks/useTerminalEntryBridge.ts`;修改 `hooks/useAppPanels.ts`、`v4/ConversationComposer.tsx` |
| 3 | fr3-01-git-worktree-create-service.patch | OK | OK | `packages/shared/src/git.ts`、`packages/services/src/git/{git.ts,gitService.ts,repo/gitCliRepo.ts,repo/gitCliTypes.ts}` |
| 4 | fr3-02-gitpane-worktree-entry.patch | OK | OK | 新增 `packages/ui/src/GitWorktreeDialog.tsx`;修改 `GitPane.tsx`、`app-shell/AnimatedSidePanePanel.tsx`、`i18n/locales/{en-US,zh-CN}.ts` |

- 4 个补丁对基线**零 fuzz、零冲突**,无需手工调适,**补丁文件未做任何修改**(保持原 .patch 不变,亦无需重新导出)。
- 叠加后 `git status`:12 个修改文件 + 4 个新增文件,与 4 个补丁声明的改动面完全一致。

### 补丁引用符号静态核对(防上下文漂移,全部存在)

- fr5-02:`runUserAction`(`lib/userActionTelemetry.ts:307`)、`ControlHintTooltip`(`title`/`side` props)、Button `size="icon-md"`/`"lg"` 变体、i18n key `terminal.show`、`useAppPanels` 内 `revealSidePaneForCurrentOwner`/`commitOpenedSidePaneState`/`createTerminalSidePaneTitle`/`setActiveSidePaneTab`/`openTerminalSidePane` 签名匹配、ui 包已依赖 `zustand@^5.0.12`。
- fr3-02:`CreateTaskRequest.targetWorkspace.workspacePath`(`app-shell/types.ts`)、`AnimatedSidePanePanel` 的 `onCreateTask` prop、`GitForkIcon`(lucide-react)。
- fr3-01:`gitCliRepo` 内 `ensureRepositoryAvailable`/`fileExists`/`hasOperationInProgress`/`validateBranchName` 及 `commandProvider.run` 返回形态均匹配。

## 3. typecheck 结果:通过(0 错误,无需修复)

命令:`pnpm run typecheck`(root package.json 官方脚本)

覆盖(全部成功,exit 0):
- `tsc -b`:`packages/shared/tsconfig.testing.json`、`packages/rpc`、`packages/provider`、`packages/provider-node`、`packages/shared`、`packages/services`、`packages/client`、`packages/server`、`packages/zcode-server-cli`、**`packages/ui`**、`packages/web`、`apps/dev-docs`、`packages/e2e-report`、`packages/desktop/tsconfig.main.json`、`tsconfig.host.json`、`tsconfig.e2e.json`
- `tsc -p packages/desktop/tsconfig.remote-main.json --noEmit`
- `tsc -p packages/zcode-cua --noEmit`

补丁触碰的三个包(`packages/shared`、`packages/services`、`packages/ui`)全部在检查范围内。

- **错误数:0**。补丁代码无需任何类型修正,故 .patch 文件未更新。
- **反向验证(证明 typecheck 确实覆盖补丁代码)**:向 `packages/ui/src/WorkspaceOpenTerminalButton.tsx`(补丁新增文件)注入 `const __typecheckProbe: number = "deliberate-error";`,`tsc -b packages/ui` 如期报 `TS2322`(定位到该文件);随后回滚注入,重新 `tsc -b packages/ui` 恢复 exit 0。排除"构建缓存跳过补丁文件"的可能。

## 4. install / 打包结果

### pnpm install:成功(exit 0,3m24s)

- `pnpm install` 整体成功,workspace 依赖全部就位;`prepare` 钩子(husky + `pnpm build:cua`,后者即 `tsc --noEmit` 对 `packages/zcode-cua`)成功。
- 如实记录的非阻塞问题:
  - `cpu-features`(ssh2 可选原生依赖)构建失败:`buildcheck` 报 `Unable to detect compiler type`(本机无 MSVC 编译器探测);安装继续,不阻塞。
  - `ssh2` 可选 crypto 原生绑定构建失败:node-gyp 从 npmmirror 下载 node headers 404(`cdn.npmmirror.com/binaries/electron/v24.19.0/node-v24.19.0-headers.tar.gz`);ssh2 回退纯 JS 实现,`install: Done`,不阻塞。
  - `apps/zcode-cli` engine 警告:期望 node `24.14.0`(精确),当前 v24.19.0 —— 仅告警。
  - Electron 二进制 postinstall 成功;node-pty 使用 Windows 预编译产物,跳过 electron-rebuild。

### 打包:全部成功

| 档位 | 命令 | 结果 |
| --- | --- | --- |
| 最快一档(生产构建) | `pnpm --filter @zcode/desktop run build:no-runtime-assets` | **exit 0**;产物 `packages/desktop/out/{main,host,preload,renderer,plugin-sandbox,scheduler}` + 各 `.build-ready` 标记;renderer(rolldown/vite)8220 modules transformed,built in 14.19s(仅有 chunk >500kB 的常规体积告警) |
| 完整桌面打包 | `pnpm run bundle:desktop -- --os win --arch x64` | **exit 0**,全链路:prepare runtime assets → 生产构建 → asar → electron-builder NSIS → 体积审计 |
| dry-run(管线确认) | `pnpm run bundle:desktop -- --os win --arch x64 --skip-prepare --skip-build --dry-run` | 打印最终打包命令 `pnpm exec electron-builder --config electron-builder.config.js --win --x64` |

- 产物:`packages/desktop/dist/ZCode-3.16.2-win-x64.exe`(NSIS 安装包,155.8 MiB)+ `win-unpacked/`、`.blockmap`、`latest.yml`;`audit-bundle-size` 通过(155.8 MiB < 500 MiB 上限)。
- 打包耗时约 5 分钟(其中 electron-builder 约 277s,含 NSIS 工具链下载 2 次成功)。

## 5. 环境限制说明

1. **仅编译级验证**:本报告覆盖补丁应用、类型检查与打包;未做运行时/功能/e2e 验证(按钮交互、worktree 创建对话框、终端打开/聚焦语义等 UI 行为未在真实应用中点验)。desktop e2e(`test:e2e`)未运行。
2. **平台范围**:打包仅验证 win/x64 本机目标;mac/linux 交叉目标未验证(bundle 默认 mac/arm64,本机未跑)。
3. **临时工作副本**:源码位于 `%TEMP%\zcode-src\`,可能被系统清理;git 基线/补丁两次提交仅用于本次复核,不构成上游历史。
4. **网络**:npm registry 与 GitHub(electron-builder-binaries)可通;npmmirror 的 node headers 路径 404(导致 ssh2 可选绑定构建跳过,见上)。
5. **可选原生依赖**:`cpu-features`、`ssh2` crypto 绑定未编译(缺 MSVC/header),影响面为 ssh2 的可选性能优化路径,不影响类型检查与打包产物生成。
6. 代码签名使用本机 signtool 自签流程(electron-builder 默认),非正式发布证书。

## 6. 最终补丁清单(全部未修改,原样有效)

| 文件 | md5 | 状态 |
| --- | --- | --- |
| `fork/patches/fr5-01-remove-topbar-terminal-button.patch` | 1404dd116471338bd2082b363a8930c3 | 未修改,`git apply --check` 可用 |
| `fork/patches/fr5-02-bottom-open-terminal-button.patch` | e7722c432ac0737c3966c4558e6914d6 | 未修改,`git apply --check` 可用 |
| `fork/patches/fr3-01-git-worktree-create-service.patch` | 329fb4fa5009a1d06a5e660df1642084 | 未修改,`git apply --check` 可用 |
| `fork/patches/fr3-02-gitpane-worktree-entry.patch` | a0aa95891d72079da9379c0c6c0f27c0 | 未修改,`git apply --check` 可用 |

注:因 4 个补丁一次应用成功且 typecheck 零错误,不存在"修正后重新导出"的情况;4 个 .patch 与验证开始前完全一致,仍保持 git diff 格式,可对基线 3c5b227 直接 `git apply`。

## 7. 复现步骤

```bash
cd <zcode-src>                       # zai-org-ZCode-3c5b227
git init && git add -A && git commit -m "baseline"
git apply /path/to/fork/patches/fr5-01-remove-topbar-terminal-button.patch
git apply /path/to/fork/patches/fr5-02-bottom-open-terminal-button.patch
git apply /path/to/fork/patches/fr3-01-git-worktree-create-service.patch
git apply /path/to/fork/patches/fr3-02-gitpane-worktree-entry.patch
pnpm install                         # Node >=24,pnpm@10.33.2
pnpm run typecheck                   # 期望 exit 0
pnpm run bundle:desktop -- --os win --arch x64   # 可选:完整打包
```

## 附:fr7-01 左下角 footer 简化 + 语言/主题默认值(2026-10-28)

- 补丁:`fork/patches/fr7-01-sidebar-footer-simplify-defaults.patch`(8 文件,100+/422-,含 1 个测试删除)
- 产品诉求:左下角隐藏登录者信息按钮与其点击展开菜单(ID 注释行/界面语言/主题/界面模式/缩放/登录登出一并隐藏);使用统计改为图标入口,与手机连接、设置同一行且行内图标左对齐;界面语言默认中文、主题默认跟随系统。
- 触碰文件:
  - `packages/ui/src/WorkspaceSidebarFooter.tsx`(删 profile 菜单,统计图标入行)
  - `packages/ui/src/useTheme.ts`、`packages/ui/src/store/index.ts`(主题默认 zai-dark→system)
  - `packages/ui/src/i18n/IntlProvider.tsx`、`packages/shared/src/validationAppSettings.ts`(语言默认 system→zh-CN,新增一次性迁移 `localePreferenceDefaultZhMigrationInitialized`:旧落盘的 system 统一迁 zh-CN,之后显式选择保留)
  - `packages/services/src/setting/settingService.ts`(迁移标记接入落盘判定)
  - `packages/services/test/settingService.test.ts`(默认值断言更新 + 迁移用例新增)、`packages/ui/test/rewardsMenuIcon.test.ts`(随功能删除)
- 验证:`pnpm run typecheck` 0 错误;受影响单测全绿(settingService 46、intlProvider/useTheme/footer tooltip/entitlement 32、marketing/mobile layout/home-only/settings shell 43、shared appSettings+validation 等 120)。全量 `test:unit` 中另有 Windows 路径类既有环境失败(如 `services/src/project/contract.test.ts` 的 `/owner` vs `\owner`),与本补丁无关。

## 附:fr9-01 Git 面板「拉取」功能(2026-10-29)

- 补丁:`fork/patches/fr9-01-git-pull.patch`(10 文件,+327/-1,git diff 格式)
- 产品诉求:对话区右上角 Git 区块与 GitPane(审查)头部增加「拉取」按钮,点击拉取当前分支的远程最新更新。
- 语义(与 HBA web 拉取一致):先 `git pull --ff-only`;无法快进(本地与远程分叉)时退化为 `git pull --no-rebase --no-edit` 合并拉取;合并冲突以结构化结果上报,提示用户在审查面板处理或交智能体合并。
- 触碰文件:
  - `packages/shared/src/git.ts`(`GitPullRequest`/`GitPullResult`/`GitPullOutcome`/`GitPullIssueCode`)
  - `packages/services/src/git/git.ts`、`repo/gitCliTypes.ts`(`IGitService.pull` + repo 接口)
  - `packages/services/src/git/repo/gitCliRepo.ts`(pull 实现:HEAD 对比区分 up-to-date/fast-forwarded;stderr 分类 local-changes/no-upstream/conflict/diverged;超时/输出上限与 push 同档)
  - `packages/services/src/git/gitService.ts`(pull 转发)
  - `packages/ui/src/hooks/useGitPull.ts`(新增;两处 UI 共用,按 outcome/issue 映射 toast;用 `useOptionalServices` 无 ServiceProvider 时渲染不炸、动作触发再降级)
  - `packages/ui/src/v4/ConversationStatusPanel.tsx`(Git 区块新增「拉取」行,夹在分支切换与「提交或推送」之间)
  - `packages/ui/src/GitPane.tsx`(头部按钮组新增「拉取」,在「刷新」左侧)
  - `packages/ui/src/i18n/locales/{zh-CN,en-US}.ts`(`git.action.pull` + `git.pull.toast.*` / `git.pull.error.*` 共 10 键×2)
- 验证:`git apply --check`(正向,pre-fr9 树)与 `git apply --reverse --check`(当前树)均通过;受影响单测全绿——services git 三件套 gitCliRepo 11 + gitCommandProvider 3 + gitService 18 = 32,v4ConversationStatusPanel 59 + GitReview 1 + gitActionMenuDisplay 7 + gitRepositoryRefresh 5 = 72;typecheck 触碰文件 0 错误(见下注)。
- **注(树状态)**:验证树内存在另一条并行开发线(文件树重命名/删除:`services/src/file/*`、`workspace-file-tree/types.ts`)的半成品,`pnpm run typecheck` 全量会报 2 处 `WorkspaceFileTree.tsx` labels 缺 `rename/delete`——属该在建功能、非 fr9 触碰面,其完成自会消解;另 web/main.tsx 的 fileService mock 与该线的 IFileService 新方法失配(早于 fr9 存在),已本地补 `deletePath/renamePath` 两个 `unsupported` 桩止血,**未入 fr9 补丁**(干净基线上无此失配,入补丁反而会引入多余属性)。
- 复现:按 §7 顺序叠上 fr7-01、fr8-01 后 `git apply fr9-01-git-pull.patch`,`pnpm run typecheck`。

## 附:fr10-01 文件树重命名/删除(hover 按钮 + 右键菜单)(2026-10-29)

- 补丁:`fork/patches/fr10-01-filetree-delete-rename.patch`(12 文件,+476/-18,git diff 格式)
- 产品诉求:右侧面板「文件」树的条目悬浮时浮现 ✎ 重命名 / 🗑 删除 两个小按钮(默认透明,hover/键盘聚焦浮现,与 VS Code 文件树一致),右键菜单同步补「重命名」「删除」两项;删除走 destructive 确认弹窗,重命名走输入弹窗。
- 语义:删除=非空目录需显式 recursive 才删(空目录 rmdir 正常删);重命名=同目录改名,UI 只传新名称、目标路径由服务端拼接(避 Windows/远程 Linux 分隔符差异),目标已存在抛错不静默覆盖,大小写不敏感文件系统上改大小写(stat 命中自身 ino)放行;删除确认/重命名弹窗集中在树组件(虚拟列表行卸载不影响弹窗),重命名预览中的文件后预览自动切到新路径;git deleted 虚拟行禁用两项操作。
- 触碰文件:
  - `packages/services/src/file/file.ts`(`IFileService.deletePath`/`renamePath` 接口)
  - `packages/services/src/file/fileService.ts`(实现:rm/rmdir/rename + 同名守卫 + ino 同文件判定)
  - `packages/services/test/fileService.test.ts`(新增 11 用例:文件/空目录/非空目录/递归删除、原地改名/目录改名/大小写改名/防覆盖/非法名)
  - `packages/ui/src/workspace-file-tree/WorkspaceFileTreeRowView.tsx`(hover 浮现 ✎/🗑 按钮——absolute 右侧覆盖 Git 徽标、按钮按下抑制行拖拽;右键菜单「重命名」「删除」destructive 变体)
  - `packages/ui/src/workspace-file-tree/WorkspaceFileTreeRenameDialog.tsx`(新增;重命名弹窗,IME Enter 安全,仿 TaskRenameDialog)
  - `packages/ui/src/workspace-file-tree/WorkspaceFileTree.tsx`(handlers:useWorkspaceServices 取 fileService 天然支持远程工作区;删除走 useConfirmDialog destructive;labels 补 rename/delete)
  - `packages/ui/src/workspace-file-tree/{WorkspaceFileTreeList,WorkspaceFileTreeStickyFolders,types}.ts(x)`(onRename/onDelete 穿参;labels 类型补两字段)
  - `packages/ui/src/i18n/locales/{zh-CN,en-US}.ts`(`workspaceFileTree.rename/renamePlaceholder/renameFailed/deleteConfirmTitle/deleteConfirmFileDescription/deleteConfirmDirectoryDescription/deleteFailed` 7 键×2)
  - `packages/web/src/main.tsx`(home-only fileService mock 补 `deletePath/renamePath` unsupported 桩——fr9 注记所述失配的正式归属,随本补丁入册)
- 验证:`git apply --check`(正向,反向撤除后)与 `git apply --reverse --check`(当前树)均通过;补丁生成时已剔除并行 fr9-01 的 `git.pull.*` i18n 污染 hunk(zh-CN/en-US 各 1 个);受影响单测全绿——fileService 73(62+11 新增)、workspaceFileTree 43、workspaceFileTreeData 13、useFileContextActions 4、i18n 一致性 18 = 151;全量 typecheck(shared/rpc/provider/services/client/server/ui/web/desktop 三配置 + remote-main + zcode-cua)0 错误。
- 注:fr9-01「注(树状态)」提到的 labels 缺 rename/delete 半成品即本特性,现已完成并随 fr10-01 消解;web/main.tsx 桩亦由本补丁正式入册,叠 fr9-01 再叠 fr10-01 无冲突(fr10 的 web/main.tsx hunk 与 fr9 无交集)。
- 复现:按 §7 顺序叠上 fr7-01、fr8-01、fr9-01 后 `git apply fr10-01-filetree-delete-rename.patch`,`pnpm run typecheck`。

## 附:fr11-01 MCP 连接池 workspace 级 server 保活(2026-10-29)

- 补丁:`fork/patches/fr11-01-mcp-workspace-server-keepalive.patch`(2 文件,+41/-7,git diff 格式)
- 产品诉求:运行面板启了服务后关闭面板,过一会重开面板运行状态全丢(且服务进程被漏杀/孤儿)。根因:面板/会话租约归零后连接池 30s 空闲回收把 hba-run MCP server 杀掉,运行状态只存在 server 内存里。目标 = A 方案保活:面板开关不再影响 server 生命周期,状态与派生进程跨面板存续。
- 语义:`isolation: "workspace"` 的 server 是工作区级共享服务,不再随租约归零空闲回收(`scheduleClose` 对 workspace entry 直接跳过),仅走显式关闭路径——`disconnectServer`、`connectConfiguredServers` 的 replace 收敛(配置移除)、`pool.close()`(应用退出)。session 级 server 语义不变(仍空闲回收)。
- 触碰文件:
  - `apps/zcode-cli/packages/adapters/src/mcp/pool.ts`(`release`/`scheduleClose` 增 explicit 参数;release 隐式路径=会话/租约关闭,显式路径=disconnect/配置收敛)
  - `apps/zcode-cli/packages/adapters/tests/mcp-connection-pool.test.ts`(旧语义断言「全部租约释放后 adapter.close 被调」改写为 fr9 契约「常驻直到 pool.close」;新增「显式 disconnect 立即关闭 workspace server」用例)
- 验证:池测试 17/17 全绿(含 2 个新契约用例);mcp-process-lifecycle 7 过 3 跳过;全量 adapters 套件的 50 个失败经**基线对照**(stash 本补丁重跑同样文件)确认为 Windows 环境既有失败(路径分隔符/权限/编码/SQLite 类),与本补丁无关;hba-run server 测试 12/12。
- 配套(非本补丁,hba-run 插件侧):`plugins/hba-run/server.mjs` 漏杀竞态修复(killTree 改 Promise、shutdown 等 taskkill 回调完成再 exit + 3s 兜底)——此前 process.exit 抢跑导致服务漏杀成孤儿,即"服务没被关闭"的根因。standalone 生命周期实测:修复后连接关闭即杀净服务树。
- 复现:按 §7 顺序叠上 fr7-01、fr8-01、fr9-01、fr10-01 后 `git apply fr11-01-mcp-workspace-server-keepalive.patch`,`pnpm run typecheck`;注意 fr9-01/fr10-01 当时在树上未提交,叠放顺序以台账为准。

## 附:fr12-01 新会话右侧面板默认显示「应用插件」区(2026-10-29)

- 补丁:`fork/patches/fr12-01-launcher-app-plugins-default.patch`(11 文件,+185/-59,git diff 格式)
- 产品诉求:打开新会话(草稿态)→ 右侧面板只有「新标签页」分区、没有「应用插件」分区。用户定夺:默认就把这些都显示完,而不是新会话只显示「新标签页」。
- 语义:launcher「应用插件」区不再随空会话隐藏(条目常驻);草稿点击条目时宿主按需补建 **deferred 托管会话**(产品既有"未发送前草稿 session"机制,不进任务索引/侧栏)绑定面板宿主,同一工作区复用一个;面板 tab 仍项目级(fr8),正式会话行为不变。
- 触碰文件:
  - `packages/ui/src/app-shell/AnimatedSidePanePanel.tsx`(删 `{activeTaskId ? … : null}` 草稿门,「应用插件」区无条件渲染)
  - `packages/ui/src/plugin-ui/components/PluginUiLauncherItems.tsx`(早退条件收敛为 `entries.length === 0`,草稿态列条目)
  - `packages/ui/src/plugin-ui/contract.ts`(`parentSessionId: string | null`;面板 id 恒 `*`,工具卡片缺会话 throw)+ `contract.example.ts`(空值兜底)+ `contract.test.ts`(新增 fr12 契约用例 2 断言)
  - `packages/ui/src/plugin-ui/sidePane/pluginUiSidePaneTab.ts`(OpenScopedPluginUiSideTabRequest 交集收窄 parentSessionId;不能用 Omit——union 判别字段会被丢)
  - `packages/ui/src/hooks/useAppPanels.ts`(resolvePluginUiHostSession:zcodeSessionService.createSession persistence:"deferred" 按 workspaceKey 复用;handleOpenPluginUi 空会话先补建再开 tab,失败 toast needsSession)
  - `packages/ui/test/useAppPanels{Scope,BrowserViewLifecycle,WorkflowArtifactOpen,InterfaceMode}.test.ts`(补 `@/i18n/IntlProvider.js` vi.mock,与既有 useServices mock 同风格)
- 验证:contract 7/7(含新用例)+ workspaceSidePane 121/121 + marketPluginUi 7/7 = 135 全绿;全量 typecheck 0 错误;`git apply --reverse --check` 通过(当前树),触碰面与并行 fr9-01/fr10-01/fr11-01 零交集(逐一比对生成的 diff 文件清单)。
- 既有失败(非本批,已对照实验):useAppPanelsScope.test.ts 6 条红——断言 fr8 前 browser-permissions owner 隔离旧语义,fr8 改项目级后未随迁;回退本批改动重跑同样 6 条失败。**编号注意:fr9-01/fr10-01/fr11-01 已被同日并行批次占用,本批顺延 fr12-01。**
- 配套文档:`docs/fr12-launcher-app-plugins-default.md`(含草稿「添加到对话」回退托管会话的已知限制)。
- 复现:按 §7 顺序叠上 fr7-01、fr8-01、fr9-01、fr10-01、fr11-01 后 `git apply fr12-01-launcher-app-plugins-default.patch`,`pnpm run typecheck`。
- **打包(2026-10-29 午,r13)**:`pnpm run bundle:desktop -- --os win --arch x64` 全链路 exit 0(生产构建→asar→NSIS→体积审计 156.4 MiB<500 MiB)。产物 `dist/VCode-3.16.2-hba-panels-r13-win-x64.exe`(164,038,343 字节,sha256 52510f32456787bf0dd41913471c5e29bd4b5cdcbd07a58f096b1f66d2a9e708)。三点如实注记:①**产物名 VCode 而非 ZCode**——树内并行「白标改名」批次(ZCode→VCode,electron-builder.config.js/desktop package.json/brand-icon)在打包时点在树上,一并入包,typecheck 亦含其改动;若要纯 fr12 产物需从改名前 checkpoint 分叉重建。②**插件种子已同步**:`apps/zcode-cli/packages/hba-{run,uigen}-plugin` 的 server.mjs/ui/panel.html/bridge.js/README 换为 hba-on-zcode/plugins 当前源码(实时刷新/主题 token/ANSI/漏杀修复/画布改造),plugin.json/package.json/seed.json 未动(版本目录 0.1.0/0.1.1 不变)——不同步就打包会在安装后重新播种**回滚**用户已热部署的插件修复。③产物探针:renderer bundle 含 fr12 唯一串(`plugin-ui tool card side tab needs parentSessionId`),win-unpacked `resources/glm/packages/hba-run-plugin/ui/panel.html` 含 `pollConfigsThrottled`(插件修复在包内)。r13 同时包含同日并行 fr9-01(Git 拉取)、fr10-01(文件树重命名/删除)、fr11-01(MCP 保活)及 hba-run 面板修复(实时刷新/主题 token/ANSI/窄面板/运行列表条)——即 r12 之后全部工作。


## 附:fr13 白标批次——VCode 名称 + HBA 图标 + 删左上角任务导航箭头(2026-10-29)

- 用户三项:①左上角左右箭头完整删除;②图标换 HBA 图标;③名称改 VCode 需完整更换。对应 README §4 白标清单 #1/#2/#5,详见 `docs/fr13-whitelabel-vcode.md`。
- 产物构成(两补丁 + 两脚本,顺序敏感):`patches/fr13-01-remove-tasknav-arrows.patch`(箭头整套含 props 链路死代码与 2 条孤儿 i18n 词条;键盘「后退/前进」快捷键按产品未要求保留)→ `branding/apply-whitelabel.mjs`(ZCode→VCode 独立词全量改名约 740 文件 + 产品身份 dev.vcode.app/VCode/vcode + 进程名前缀 vcode;**版权/署名行依法豁免**:About 版权行、Modified by 出处、LICENSE/NOTICE、THIRD-PARTY-NOTICES 原样;zcode:// 协议、~/.zcode、URL、ZCODE_*、@zcode/* 功能标识保留)→ `patches/fr13-02-whitelabel-brand-icons.patch`(启动壳×3/About data URI/登录/引导/分享卡/空态/logo 组件重写为 HBA 徽标;删旧资产 Z.svg;logo-zai.svg 保留=Z.ai OAuth 供应商品牌)→ `branding/generate-icons.py`(icons/hba-icon-1024.png 生成全套 ico(7 档)/icns/png(9 档)铺满 build/、public/logo/icons/、web favicon data URI,三处 icon.ico 字节一致满足 webRemoteControlBootstrapShell 断言)。
- **编号让位**:同日并行批次已占用 fr9-01(Git 拉取)/fr10-01(文件树)/fr11-01(保活)/fr12-01(launcher),白标批次顺延 **fr13**。
- 验证:`pnpm run typecheck` 0 错误;重点单测全绿(desktopLogoStyle/rootStartupLoading/workspaceShellRemoteMobileLayout/mobile-ui contract/webRemoteControlBrand+BootstrapShell/about/desktopApplicationMenu/i18n×7/services zcode*×4/shared+provider+provider-node 2339);干净 worktree 四步管线重放与开发树逐字节一致(并行会话文件除外)。全量 `test:unit`:2051 文件 19714 过/151 红,红项全部归因既有问题:jsdom 无 matchMedia 且 fr7-01 主题默认 system 致 store 初始化崩(约百条,建议 syncSystemThemeListener 加 typeof 守卫)、makensis 按 ANSI 解 UTF-8 中文注释(Bad text encoding,已用基线 installer.nsh 对照复现)、adapters 50 条与 useAppPanelsScope 6 条(并行会话已基线对照定为既有)、contract.test.ts 路径、PowerShell 计时——均非白标改动引入。
- **产物(r13,并行会话 12:24 打包即含本批全部三项,无需另行出包)**:产物探针实测 `app.asar`:desktop-top-nav-back=0(箭头零残留)、taskNav.back=0、旧 ZCode 徽标 SVG 路径=0、brand-icon×7、iconDataUri×3、vcode-logo-breathe×5、「关于 ZCode」=0/「关于 VCode」=1、ZCode Desktop App=0、dev.vcode.app×2;resources/icon_windows.png 与品牌源一致;安装包与 VCode.exe 提取图标均为 HBA 六边形徽标;dist 名 `VCode-3.16.2-hba-panels-r13-win-x64.exe`(164,038,343 字节,sha256 52510f32…9e708)。r13 打包时点在白标收尾(注释级改名)之前,差异仅源码注释文案,不影响运行时。
- 多会话同树:本批 diff 导出按显式 pathspec/hunk 过滤,与 fr9-12 零交集(校验逐字节比对时将其排除);开发树上并行未提交改动未混入本批补丁。


## 附:fr14 自动化/插件市场入口迁底部图标行(2026-10-29)

- 用户诉求:两入口从「新建任务」下方移到底部图标行,仅图标;自动化在统计左侧,插件市场在统计右侧。
- 落点:footer 行新顺序 自动化 | 使用统计 | 插件市场 | 手机连接 | 设置(全部 ControlHintTooltip + ghost icon-lg;active 映射 aria-pressed/bg-selected;handler 可选,Settings 复用 footer 不受影响);顶部导航删两个文字按钮;testid 沿用(e2e 选择器不破坏)。
- 验证:typecheck 0;受影响 9 文件 95/95 全绿(新增 workspaceSidebarFooterEntryRow.test.ts 3 用例:顺序/仅图标/点击路由/条件渲染/选中态);`git apply --reverse --check` 通过;TaskGroupedView 的分组视图自动化入口不在诉求范围未动。
- 补丁:`patches/fr14-01-footer-entry-row-icons.patch`(5 文件),复现叠加于 fr13 管线之后;文档 `docs/fr14-footer-entry-row.md`。
- 注:workspaceSidebarWebRemoteMobileLayout.test.ts 的 footer 是桩(旧测试经顶部文字查找),故顶部移除断言与 footer 行为分两文件验证。
- **续修(r13 用户实测回执,2026-10-29)**:r13 里「应用插件」区已显示但条目为空(「暂无推荐的应用插件」)——`useRecommendedUiPlugins` 内另有三层 sessionId 门:推荐清单 `useUiPluginRecommendations(sessionId !== null)` 不拉取、插件目录 `store.initialize` 不执行、loading 恒 false,草稿态直接落空态文案。三门放开(读取/初始化本就是 workspace 级),补 `useRecommendedUiPlugins.test.ts` 草稿用例;该文件并入 fr12-01 补丁(现 13 文件)。测试:useRecommendedUiPlugins 9/9(含新用例)+ useUiPluginRecommendations 2/2 + contract 7/7,typecheck 0 错。**r14 产物 = `dist/VCode-3.16.2-hba-panels-r14-win-x64.exe`(164,035,976 字节,sha256 c74a4aaedb44e4c41b222ef922ece421a068151e4f0e7e032110966c376c358f)**,r13 取代;r13 验收回执即本条续修的输入。


## 附:fr15 白标 UI 批次——六项产品修正(2026-10-29)

- 用户六项(r14 装后反馈):①自动化打不开;②左上角图标不要;③新会话大图标调小+离发送框加间距;④创建项目弹框去项目名输入与项目类型下拉,只选文件夹,二次选择移出弹框;⑤对话区右上角任务列表/Git 无内容不显示,git 拉取+分支常驻,非 git 项目不显示对应按钮;⑥设置弹框删智谱默认项/内部套餐/自定义供应商 Label,默认自配供应商。
- 落点:①fr14 回归修复(onClick 直传事件当 automationId,改零参调用+回归断言);②标题栏切换按钮面板图标常驻+设置页 WindowsTopLeftLogo 移除;③问候徽标 400px 水印→80px 堆叠徽标,底部间距加大;④创建态仅源文件夹(名字服务自动命名、设备不在弹框二次选择;编辑/远程固定目录保留名字),远程走菜单「新建远程连接」;⑤新增右上角 git 快捷簇(拉取+分支+有变更的更改入口+更多操作,git 项目常驻),状态胶囊维持有内容才显示;⑥供应商导航渲染层过滤只留自定义供应商(去分组标签/智谱预置/套餐连接),模板选择器去智谱组,使用统计去「个人套餐」页签——hook/套餐逻辑保留,深度拆除留待后续。
- 验证:typecheck 0;回归 547/547(modelProvider 全系/projectCreation 重写/projectEditorLayout 四态拆分/状态面板/composerMenu/usage/空态/footer)+ 关联面 73/73;`git apply --reverse --check` 干净重放树与开发树双向通过。
- 测试契约:projectCreation 删 18 个下线交互用例(设备流/项目名)并立 folder-only 契约;projectEditorLayout 按创建|编辑-本地|编辑-远程分态校验(远程编辑不提供目录追加入口为既有产品规则)。
- 补丁:`patches/fr15-01-whitelabel-ui-batch.patch`(14 文件 46 hunks,干净重放树生成,零混入并行 fr9-12 改动);文档 `docs/fr15-whitelabel-ui-batch.md`。复现顺序敏感性见文档(locale 区 fr10 与 fr13-01 相邻,冲突时 `git apply -3`)。


## 附:fr15-02 分支弹层补齐 git 操作(2026-10-29)

- 用户追加诉求:新建对话区的分支弹层加「拉取 / 提交或推送」,与右上角任务列表面板的 git 面板一致。
- 落点:GitBranchSwitcher 弹层 footer 新增拉取(useGitPull,转圈反馈)+「提交或推送」(GitActionMenu status-row 同款触发器,点击收起弹层);所有 showFooterActions 弹层统一生效,GitActionMenu 对话框内嵌切换器不受影响。
- 验证:typecheck 0;git 侧 6 文件 82/82;`git apply --reverse --check` 通过。补丁 `patches/fr15-02-branch-switcher-git-actions.patch`(2 文件纯新增)。

## 附:fr11-02 插件 MCP 配置透传 isolation/protocolVersion(2026-10-29)

- 补丁:`fork/patches/fr11-02-plugins-mcp-isolation-passthrough.patch`(2 文件,+64/-8,git diff 格式;fr11-01 保活批次的配套修复)
- 背景:r14 实测运行面板关开后状态仍全丢。根因不是 fr11-01 缺失(r14 的 zcode.cjs 已含守卫,已验证),而是**宿主插件配置解析器 `resolveMcpServerConfig`(adapters/src/plugins/mcp.ts)重建配置对象时把 plugin.json 的 `isolation`/`protocolVersion` 两字段丢弃**——hba-run 声明的 `isolation: "workspace"` 到运行时退化为默认 "session",fr11-01 的 `mcpIsolation === "workspace"` 守卫对插件 server 从未生效,面板/会话关闭照旧 30s 空闲回收,server 进程死、运行状态丢(且 session 级 key=leaseId,各会话各起一个 server)。
- 修复:baseConfig 补 `isolation`(仅透传合法枚举 session|workspace,非法值回落 undefined)与 `protocolVersion`(legacy|auto|2026-07-28)透传;manifest 的 mcpServers 本就是 `unknown` 松散类型,无需改 schema。
- 触碰文件:
  - `apps/zcode-cli/packages/adapters/src/plugins/mcp.ts`(resolveMcpServerConfig baseConfig)
  - `apps/zcode-cli/packages/adapters/tests/plugins.test.ts`(新增"passes plugin manifest isolation/protocolVersion through to runtime MCP config"用例:workspace/session 透传、非法值不透传)
- 验证:新用例过;plugins.test 80 项中 79 过 1 失败(失败的"injects explicit VCode proxy env"在改动前基线即红,与本补丁无关);mcp-connection-pool 17/17;主仓全量 typecheck 0 错 + adapters 包 tsc 0 错。**盲区教训:fr11-01 的池测试直构 config 注入 isolation,未覆盖插件 manifest→resolvePluginMcpServers 解析链,导致"池层修了但插件层丢字段"漏网。**
- 生效:需随下一次打包(修复在 zcode-cli 运行时,热部署不了);插件侧(panel.html/server.mjs 后续批次)已按热部署配方替换 `~/.zcode/cli/plugins/cache/zcode-plugins-official/hba-run/0.1.0/`。
- 复现:按台账顺序叠 fr11-01 后 `git apply fr11-02-plugins-mcp-isolation-passthrough.patch`,跑 plugins/mcp-connection-pool 测试。


## 附:fr4-01 插件 UI 直插输入框(ui/insert-input-text)+ 运行面板四项(2026-10-29)

- 用户诉求(运行面板四项):①日志右键「添加到对话」弹「插件想以你的身份发送消息」确认框,要求能直插输入框就直插、不要再弹框;②日志区上下左右间距取消;③日志区标题后加 重启/启动/停止 按钮(已启动显示 重启/停止,未启动显示 启动);④标题区改运行配置下拉框,选中项即标题,可切换查看不同日志。
- ①根因与方案:插件桥(MCP Apps)只有 `ui/message`(以用户身份发送,无手势时宿主弹可编辑确认框),没有「插入输入框」通道;宿主内部虽有 `requestComposerTextInsert` 机制(Lexical `appendText`/`focus`)但未暴露给插件。故新增 VCode 扩展桥方法 `ui/insert-input-text { text }`(仿 `ui/set-widget-state` 的 `bridge.setRequestHandler` 注册方式):端口层注册 → `createPluginUiInteractions.onInsertInputText` 经 window CustomEvent `zcode/plugin-ui-insert-input-text`(cancelable,preventDefault=已接住,与 workspaceFileDrag「加入对话」事件同构)→ `ConversationComposer` 监听(仅接 sessionId 匹配本 composer 的请求;`appendText` 追加末尾+光标随尾+草稿持久化+焦点回输入框)。不涉及 main/preload;能力声明未加,页面以 -32601 探测降级。
- 触碰文件(7):
  - 新增 `packages/ui/src/plugin-ui/domain/pluginUiInsertInputText.ts`(事件契约:常量/Detail/dispatch/isEvent)
  - `packages/ui/src/plugin-ui/index.ts`(导出)
  - `packages/ui/src/plugin-ui/app/pluginUiInteractionPorts.ts`(`PluginUiInteractionCallbacks.onInsertInputText` + `ui/insert-input-text` 处理器注册,loose schema `text: string.min(1)`)
  - `packages/ui/src/plugin-ui/adapters/pluginUiInteractions.ts`(onInsertInputText → dispatch;无 composer 接住回 -32601)
  - `packages/ui/src/plugin-ui/adapters/pluginUiManagedPage.ts` + `pluginUiHostTypes.ts`(latest ref 转接 + interactions Pick 类型扩展,缺一不可——否则回调到不了端口层)
  - `packages/ui/src/v4/ConversationComposer.tsx`(插入事件监听 effect,独立于 listenAddToChatEvents:触发方刚点过面板,composer 此刻多半失焦,恰恰要在失焦时插入并把焦点要回来)
- 验证:`git apply --check` 零冲突**双向通过**(纯净基线 ba0bdaa6 与当前开发树各验一次;与 fr5-02 在 ConversationComposer 的两处改动 [行 82/2470 附近] 无上下文交集,无顺序依赖,任意顺序可叠);`tsc -b packages/ui` 基线/打补丁双跑均 exit 0;反向验证:向新增文件注入 `const __typecheckProbe: number = "deliberate-error"` 如期 TS2322(证明 typecheck 覆盖补丁代码),回滚后恢复;`git apply --reverse` 干净回退,基线树零残留。
- 插件侧(hba-run,热部署,已生效):panel.html「插入到输入框」三级策略——`ui/insert-input-text` 直插 → 老宿主降级 `ui/update-model-context`(插件上下文附到对话输入区,发送时与正文一并送达模型)→ 剪贴板;**全程不弹框,不再使用 `ui/message`**。②日志区贴边(work/body/console padding、console 边框与圆角清零);③标题行 启动/重启/停止 按 `runningRunOf(选中配置)` 切换(首帧默认态:重启/停止隐藏);④标题换 `#cfg-select` 配置下拉,切换即换日志(优先活运行,无活运行回放该配置最近一次历史日志:run_history→run_output,带切换竞态防护)。
- 插件测试:`node --test tests/run/test-server.mjs` 12/12(server.mjs 本批未改);独立模式浏览器实测截图:日志区四边贴边、下拉框+按钮状态切换正确。
- 生效:直插输入框需随下一次打包(宿主桥方法,热部署不了);当前 r14 安装包上自动降级为「插件上下文」附入(仍不弹框)。插件已按热部署配方替换 `~/.zcode/cli/plugins/cache/zcode-plugins-official/hba-run/0.1.0/ui/panel.html`,并同步打包种子 `apps/zcode-cli/packages/hba-run-plugin/{ui/panel.html,server.mjs,README.md}`(server.mjs 种子原缺 GBK 解码/漏杀修复,一并拉齐,防下次打包重新播种回滚)与本机 `resources/glm/packages/hba-run-plugin/`。
- 复现:`git apply fork/patches/fr4-01-plugin-ui-insert-input-text.patch`(纯净基线可直接叠,无顺序依赖);重开运行面板,日志区选中文字右键「插入到输入框」。
