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
