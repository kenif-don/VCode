# HBA 白标 Fork 工作流(ZCode 底座,W0)

本目录是 HBA→ZCode 迁移(PRD 5.1 / 5.4)的 Fork 白标基线工作区:上游基线锁定、构建、白标改造点、核心 diff 清单与季度 rebase 流程。原则(PRD 5.1):**核心层最小改动,差异全进插件层**;核心层仅保留少量交互调整(FR-5 终端入口、FR-3 worktree 入口),保证跟随上游 rebase 时优先零冲突(PRD 7.5)。

- 上游:https://github.com/zai-org/ZCode(Apache-2.0)
- 本目录补丁:`fork/patches/`(git diff 统一格式,`git apply` 可用,已逐一验证)
- 配套方案文档:`../docs/fr5-terminal-patch.md`、`../docs/fr3-git-worktree-plan.md`

---

## 1. 上游基线锁定(版本标签策略)

| 项 | 值 | 证据 |
|---|---|---|
| 上游仓库 | `zai-org/ZCode` | GitHub API 核实(公开仓库) |
| 基线 commit | `3c5b227` | GitHub tarball 根目录名 `zai-org-ZCode-3c5b227`(2026-10-28 下载并完整解压;完整 SHA 待 `git clone` 后补录,标注**待源码确认**——tarball 不含 pax 全 SHA) |
| 基线版本号 | `3.16.2`(`package.json` name `zcode`) | 源码根 `package.json`(证据:已核实) |
| 许可证 | Apache-2.0 | 源码根 `LICENSE`(证据:已核实) |

**标签策略**(PRD 7.3"基线版本锁定并记录于仓库"):

1. fork 仓库以独立仓库存在,HBA 插件包以子目录形式放入(独立版本号,PRD 5.4);
2. 合入上游基线后立即打标签 `baseline/zcode-v<上游 version>+<日期>`,例如 `baseline/zcode-v3.16.2-20261028`,并在本表登记 commit;
3. 之后的白标改动**只以 `fork/patches/` 中的 patch 表达**,不再往核心层随手提交散改;
4. 每季度评估 rebase 一次(PRD 7.3 / R1),rebase 完成打新 baseline 标签,旧标签保留作回滚点(PRD 9.4 回滚路径:"回退到上游基线标签重建")。

> 参考:本机安装包 `D:\ZCode\resources\app.asar` 内部版本字符串 `"version":"2.37.1"` 与源码 3.16.2 不一致(安装包为更早构建,仅作 asar 逆向证据来源,不作为基线)。**待源码确认**:上游 tag 命名规则(`v*`?)以 `git tag -l` 实测为准。

## 2. 源码获取与本地布局

```bash
# 完整源码(本次核实用):GitHub tarball,已解压至
#   C:\Users\76437\AppData\Local\Temp\zcode-src\zai-org-ZCode-3c5b227\
# 正式 fork 用 git clone(便于季度 rebase):
git clone https://github.com/zai-org/ZCode.git hba-zcode-fork
cd hba-zcode-fork && git checkout 3c5b227 && git tag baseline/zcode-v3.16.2-20261028
```

仓库结构(证据:已核实,`packages/`、`apps/` 一览):`packages/desktop`(Electron 桌面端,含 `electron-builder.config.js`)、`packages/ui`(渲染层)、`packages/server`、`packages/services`(含 `git/` 服务)、`packages/shared`、`apps/zcode-cli`(CLI/内核)等 pnpm workspace 包。

## 3. 构建(工具链与命令,均引自源码 package.json,证据:已核实)

| 项 | 值 |
|---|---|
| Node | `>=24.0.0`(`.nvmrc` = 24,`engines.node`) |
| 包管理 | `pnpm@10.33.2`(`packageManager` 字段) |
| 工作区 | pnpm workspaces(`pnpm -r`) |

常用命令(根目录):

```bash
pnpm install                      # 依赖安装(desktop postinstall 会重建 node-pty)
pnpm run build                    # pnpm -r build:全 workspace 构建
pnpm run build:desktop-agent:bytecode   # 可选:桌面 agent 字节码
pnpm run bundle:desktop -- --win  # 桌面打包(pnpm --filter @zcode/desktop run bundle --
                                  #   → packages/desktop/scripts/bundle.mjs → electron-builder,
                                  #   带重试与产物闭包校验;目标平台参数 --win / --mac)
pnpm run dev:desktop              # 本地开发(desktop dev = scripts/dev-desktop-env.mjs production)
pnpm run typecheck                # 全 workspace tsc -b 校验
pnpm run test:unit                # vitest 单元测试(排除 desktop e2e)
```

- `@zcode/desktop` 包内:`pnpm run build` = `prepare:runtime-assets` + `build:no-runtime-assets`(`scripts/run-production-build.mjs`,tsup/vite 产出 `out/main|host|preload|renderer`);`pnpm run bundle` = `scripts/bundle.mjs` 产安装包。
- 产物身份(应用名/appId)由 `packages/desktop/scripts/desktop-product-identity.mjs` 决定,见下节。
- **待确认**:完整安装包 CI 流程(Win 签名、NSIS 定制 `packages/desktop/build/installer.nsh`)本次未实测,首次构建需人工走查。

## 4. 白标改造点清单(PRD 5.4:替换应用名称、图标与默认模型配置;去除 Z.ai 与 ZCode 商标)

| # | 改造点 | 位置(证据:已核实) | 动作 |
|---|---|---|---|
| 1 | 应用名 / appId | `packages/desktop/scripts/desktop-product-identity.mjs`:`PRODUCTION_IDENTITY`(appId `dev.zcode.app`、productName `ZCode`、linuxExecutableName `zcode`;`PREVIEW_IDENTITY` 同文件) | 改为 HBA 名称与 appId(如 productName `HBA`、appId `dev.hba.app`);`packages/desktop/electron-builder.config.js` 经 `resolveDesktopProductIdentity` 消费该文件,勿绕过 |
| 2 | 图标 | `packages/desktop/build/`:`icon.icns`、`icon.ico`、`icon.png`、`icon_windows.png`、`icon_installer.icns/.ico/.png`、`icons/`、`dmg_background*.png` | 全部换 HBA 图标(尺寸/命名保持一致);安装器与 dmg 背景同步 |
| 3 | 默认 provider / 模型 | 构建期 `scripts/builtin-provider-config.mjs`(读 `ZCODE_ENV` 与 `.env.production`);智能体 `model` 占位符按 `../docs/fr1-agents.md` §1.3 在打包前替换 | 内置默认供应商/模型改为白标默认;6 个智能体定义的 `【provider:model,…】` 占位替换 |
| 4 | NOTICE / 许可证(必须保留) | 根 `LICENSE`(Apache-2.0)、`NOTICE.md`、`THIRD-PARTY-NOTICES.md`;打包期 `scripts/third-party-notices.mjs`(`stageElectronNotices`、`noticesFileName`)随安装包分发 | **不删不改署名**;第三方许可证清单随包分发(PRD 5.4 合规要点);第三方组件许可证检查进发布门禁(PRD 8.8) |
| 5 | 去 Z.ai / ZCode 商标字样 | UI 文案与配置:`packages/ui/src/WelcomeScreen.tsx`、`packages/ui/src/login/*`、`packages/ui/src/settings/ModelProviderSection.tsx`、`packages/ui/src/settings/model-provider-section/codingPlanPricingCards.ts`、`packages/ui/src/lib/productDocs.ts`、`packages/ui/src/lib/appTelemetry.ts`、`packages/ui/src/i18n/locales/{zh-CN,en-US}.ts`、`packages/ui/src/assets/provider-icons/model-provider-logo-sources.json` 等(grep `Z\.ai|ZCode` 命中清单) | 商标性使用全部替换为 HBA;**但 LICENSE/NOTICE/THIRD-PARTY-NOTICES 中的上游版权与名称声明依法保留**(Apache-2.0 条款) |
| 6 | 更新/登录等远程端点 | `packages/desktop/dev-app-update.yml`、`app-update.yml`(安装包 resources)、登录/用量上报(`useUsageStats.ts`、`codingPlanUsageSources.ts`) | 白标包默认关闭或指向 HBA 端点;不留 Z.ai 通道(**待产品确认**关闭策略) |

## 5. 核心 diff 最小化原则(PRD 5.1 / 7.5)

1. 能以插件表达的能力**全部进 HBA 插件包**(`../plugins/hba-uigen`、`../plugins/hba-run`、hba-agents),核心层零改动;
2. 核心层仅保留交互调整类小改,当前全部收敛在 `fork/patches/` 4 个补丁(基线 3c5b227 上 `git apply` 验证通过,合计 16 个文件触点(12 修改 + 4 新增)/ +568 / -11 行):

| 补丁 | 内容 | 文档 |
|---|---|---|
| `patches/fr5-01-remove-topbar-terminal-button.patch` | FR-5-1 移除顶部栏终端按钮(1 文件,-10 行) | `../docs/fr5-terminal-patch.md` |
| `patches/fr5-02-bottom-open-terminal-button.patch` | FR-5-2 底部"打开终端"按钮 → 右侧面板终端页签打开/聚焦(5 文件,+172 行,含 3 个新文件) | 同上 |
| `patches/fr3-01-git-worktree-create-service.patch` | FR-3-2 worktree 创建服务层(shared 类型 + IGitService + gitCliRepo `git worktree add`) | `../docs/fr3-git-worktree-plan.md` |
| `patches/fr3-02-gitpane-worktree-entry.patch` | FR-3-2 GitPane 入口按钮 + 创建对话框 + 新会话打开 + i18n | 同上 |

3. 新增核心改动必须进 `patches/` 并在本表登记;每个补丁独立可应用、可回退(`git apply -R`);
4. 代码规范、提交规范沿用上游约定(oxlint / oxfmt,`pnpm run lint`、`pnpm run fmt`),降低合并成本(PRD 7.5)。

```bash
# 应用(在 fork 仓库根目录,按序):
git apply fork/patches/fr5-01-remove-topbar-terminal-button.patch
git apply fork/patches/fr5-02-bottom-open-terminal-button.patch
git apply fork/patches/fr3-01-git-worktree-create-service.patch
git apply fork/patches/fr3-02-gitpane-worktree-entry.patch
# 一次性校验:git apply --check 各补丁;四个补丁叠加已验证无冲突。
```

## 6. 季度 rebase 流程(PRD 7.3"每季度评估 rebase 一次",R1)

1. **评估**:对比上游新 tag 与当前 baseline,列出影响面(重点:`packages/ui` 头部/侧栏/composer 结构、`packages/services/git`、`packages/shared/src/git.ts`——即 4 个补丁的触点);
2. **拉取**:`git fetch upstream && git rebase baseline/zcode-v… upstream/<新 tag>`(或 merge 上游 tag 到 fork 主线);
3. **重放补丁**:`git apply --check` 逐个检查 → 冲突时人工改到对应文件后 `git apply --3way` 或 `git am -3`;补丁是唯一核心差异,**优先保证 patches 零冲突**(PRD 7.5);
4. **回归**:第 3 节构建命令全跑 + `pnpm run test:unit` + FR-5/FR-3 验收对照(TC-TRM-01、TC-GIT-02,见对应文档);
5. **打标签**:新 `baseline/zcode-v<ver>-<date>` 并登记本文档 §1 表格;
6. 上游接口破坏性改动导致补丁失效时,改动收敛回 patches 重新出补丁,禁止在 fork 里留散改。

## 7. 合规红线(发布门禁,PRD 8.8 / R7)

- 安装包内保留 Apache-2.0 版权声明与 NOTICE;第三方许可证清单随包分发;
- 商标去除仅限商标性使用,不删版权与署名文本;
- 许可与 NOTICE 检查通过后方可发布(与"安装包许可与 NOTICE 检查"门禁对齐)。

## 8. 待确认清单

| # | 事项 | 状态 |
|---|---|---|
| 1 | 基线完整 SHA 与上游 tag 命名(`git clone` 后 `git tag -l` 补录) | 待源码确认 |
| 2 | Windows 签名 / NSIS 安装器定制与 macOS 签名(`ZCODE_ENABLE_MAC_SIGN`)实测 | 未实测 |
| 3 | 白标应用名/appId/图标最终稿(HBA 侧设计资产) | 待设计输入 |
| 4 | 默认 provider/模型(白标默认值)与登录/更新端点关闭策略 | 待产品确认 |
| 5 | `packages/ui` 中 Z.ai/ZCode 字样的完整替换清单(含埋点与 provider 图标资源)随白标 PR 逐项走查 | 进行中(本表 §4-5 为初版清单) |
