# 同步报告：upstream v3.17.1（2026-10-31 季度 sync）

三目录终态交付：官方纯净源（只读）→ 真源（合并树）→ 差异补丁库（可重放）。

## 1. 三目录布局

| 目录 | 角色 | HEAD/内容 |
|---|---|---|
| `D:\ai_workspace\AI IDE\zcode-upstream-pristine` | 官方纯净源（只读，本次未改动） | `a60ba6a7` = v3.17.1，git worktree (detached) |
| `D:\ai_workspace\AI IDE\hba-zcode-fork` | 真源（打包/运行用） | `2b7a59b7` merge commit（双亲 `0f28b17e` + `a60ba6a7`），标签 `baseline/zcode-v3.17.1-20261031` |
| `D:\ai_workspace\AI IDE\hba-on-zcode\fork\patches\sync-v3.17.1\` | 新补丁库（8 个补丁，v3.17.1 上零冲突重放） | 见 §6 映射表 |

回滚锚点：`pre-sync/v3.17.1-20261031` → `0f28b17e`（合并前检查点，含嫁接 replace `ba0bdaa6→3c5b227`，保留勿删）。

## 2. 冲突统计与分类处置（47 个 UU 全解，零未合并路径）

合并暂存态：5196 文件变更（1009 增 / 2055 删 / 1906 改 / 226 改名），+216250/−609803 行。

47 个未解冲突按政策三分类（**A 主导 7 / B 主导 1 / C 主导 39**；多数 C 内含 A 成分——"以官方为底重施摘除"）：

### A 覆盖删除（7，保我方删除）
| 文件 | 处置 |
|---|---|
| `conversation-session-side-pane-late-close.test.ts` | **整删**——上游新增 e2e，借头像菜单登录入口做 App 重挂；登录入口已删，运行时必失败的死用例 |
| `conversation-session-virtual-project.test.ts` | 删上游恢复的 VP12（借手机连接入口）+ 保我方"无登录刷新屏障" |
| `coding-plan-team-usage.test.ts` | 保我方 CTP-03（footer 使用统计直达），删上游头像菜单用例 CTP-02B |
| `conversation-session-project-behavior.test.ts` | 删 `loginWithApiKey` 门禁与 helper 引用；收上游 `restartIntoWorkspacePreservingProfile` 重构（保双方） |
| `conversation-session-remote-project-policy.test.ts` | 删登录等待分支，收上游 `project-section` 稳定选择器 |
| `bootstrap/tests/session-persistence.test.ts` | **B 实质**：接受上游删除 `hydrates persisted history` 用例（我方仅改过其断言品牌）→ 登记重落点 |
| i18n 双 locale / `Root.tsx` / `store/index.ts`（前一代理已解，复核） | 以官方为底重施 fr20 摘除，`login.*`/`welcome.*`/`webRemoteControl.trigger 等 fr18 78 组`零残留 |

### B 上游删、我方改 → 接受删除 + 重落点登记（1 + 若干复核）
- `session-persistence` 的 `hydrates persisted history when resuming a session in a fresh app`：我方改动仅品牌改名，接受删除。
- 重落点清单见 §7。

### C 双方都改 → 手工合并保双方（39）
重点处置：
1. **插件注册四件套**：`bundled-plugins.ts`（保 hba `server.mjs/ui` 顶层白名单 + 收上游 EXDEV 降级）、`official-plugin-definitions.ts`（保 hba-uigen/hba-run + 收 zcode-site 0.4.2 与上游版本 bump：visualize 0.1.1 / node-repl-host 0.7.0 / 文档四件套 0.2.x）、`plugin-marketplaces.ts`、`prepare-agent-node-bundle.mjs`。合并后 `plugins.test.ts` 一致性用例通过（含修正 hba-uigen definition 版本 0.1.1→0.3.0 对齐 manifest/package、pluginCount 期望 15→17）。
2. **`adapters/src/mcp/pool.ts`**：我方 fr9-01 `explicit`（workspace 不随租约回收）与上游 `immediate`（session 立即关）合并为 `release(serverName, { explicit?, immediate? })` 双语义对象参数。
3. **`adapters/src/plugins/mcp.ts`**：isolation 收上游"仅信任官方市场声明"门禁（`official &&`），保我方 fr11-02 `protocolVersion` 透传；测试 fixture 从 `dev-market` 改 `zcode-plugins-official` 反映合并语义。
4. **`zcode-protocol/browser-control-broker.ts` 等 4 个 marker-less UU**（前一代理已手工合并未 add）：复核为"上游内容 + VCode 品牌"干净合并，`git add` 收编。
5. **`vitest.config.ts`**：保我方 `unit`/`fork-isolated` 项目入口（含 contract.test.ts、gen-ui、gitSelectedRepository 等源码旁单测）+ 叠加上游 `engineering` 显式清单项目；unit 侧 exclude engineering 清单避免重复执行。
6. **`apps/zcode-cli/vitest.config.ts`**（非冲突，我方新增）：补 `testTimeout/hookTimeout 30_000` 与根配置同政策——v3.17.1 工作流收尾变慢后 session-persistence 专家工作流用例稳定落在 5.0~5.4s，默认 5s 必超时。
7. **`wdio.conf.ts` 4 hunk**：保 fr18-03 剪裁与 VCode 品牌；收上游 ttft-otlp fixture；剔除 fr18-03 已删的 auth-gate fixture 死引用。
8. **`e2eUnreadContextContract.test.ts`**：收上游窗口合同扩展，删 `web-remote-unread` 条目（fr18-03 已删该用例）。
9. **mobile e2e helper 集**（`mobile-pairing.ts`、`web-remote-unread.ts`、`web-remote-visibility-browser.ts`、`web-remote-control-session-events-fixture.ts`）：上游 v3.17.1 新增 10 个 e2e（composer-settlement、id-compatibility、shared-cli 等）编译期依赖这些被 fr18-03 删的 helper → **恢复 helper（测试工具非运行时入口），保上游 e2e 可编译**；运行时激活路径仍零（见 §4）。此为对 fr18-03 的小幅回撤，记录在案。

### 品牌收敛（非冲突但必需）
上游 v3.17.1 新增/改动文件带 ZCode 字样 143 个 → 合并后重跑 `fork/branding/apply-whitelabel.mjs .` 收敛（79 文件 +162/−162，纯品牌行），UI 字符串层 ZCode 残留 = 0（剩余命中全为 `useZCode*` 等标识符，按脚本设计不动）。

## 3. 覆盖删除清单（上游新增/复活的登录与手机入口 → 一律删）

| 上游新增入口 | 处置 |
|---|---|
| `conversation-session-side-pane-late-close.test.ts`（头像菜单登录重挂 e2e） | 整删 |
| CTP-02B 头像菜单 Team Plan 标签 e2e（`coding-plan-team-usage`） | 删（保我方 footer 直达 CTP-03） |
| VP12 手机连接入口导航 e2e（`conversation-session-virtual-project`） | 删 VP12 用例 |
| `project-behavior` / `remote-project-policy` / `task-groups` 等 e2e 的 `login-use-api-key-button` 等待分支 | 删登录分支 |
| `refreshProjectSidebar` 的登录恢复段（project-behavior） | 改无登录直等 |
| `start-plan-followup` / `account-provider-key-retry` browser fixture 的登录续接 | 按 fr20 剪除（沿用改法） |
| data-sync「数据与统计」设置区的登录提示/连接手机 CTA | **审计结论：不存在**——data-sync 功能壳（`packages/ui/src/data-sync/`）基于本机 Source Server 设备管理快照，无账号门控 UI、无登录 CTA、无手机配对入口；按政策保留功能壳（疑似账号门控见 §7） |

**审计为零的激活路径**（grep `restorePreviouslyEnabled` / `WorkspaceWebRemoteControlTrigger` / `WebRemoteControlDialog` / 自启动恢复 / 无 UI 自动重连）：
- `restorePreviouslyEnabled` 仅存于 `webRemoteControlManager.ts` 的**方法定义与认证变更回调**（上游深层管线，休眠）；`syncWebRemoteControlWorkspaces` 的启动自动恢复调用点保持我方删除（fr18 断点未被上游复活）。
- `WorkspaceWebRemoteControlTrigger`、`WebRemoteControlDialog`、`domain/presentation.ts`：文件级零残留。
- `Root.tsx` 中 `WebRemoteControlDialog` 仅存注释说明（非引用）。

## 4. 定制存活检查（全部通过）

| 检查项 | 结果 |
|---|---|
| 登录符号零残留（WelcomeScreen / LoginApiKeyForm / requestLoginEntry / welcomeScreenOpenReason / loginEntryRequest / markApiKeyLoginSuccess / codingPlanUpgradeLoginRecovery / oauthCachedSessionRestore / zcodeJwtInvalidRestartMarker） | **0 命中** |
| 扩展登录符号（useProviderAvailabilityLoginEntryGuard / loginEntryAttempt / onCodingPlanLogin / TID_LOGIN / loginWithApiKey） | **0 命中**（packages/ + apps/zcode-cli/packages 源码与测试） |
| 手机激活符号（WorkspaceWebRemoteControlTrigger / WebRemoteControlDialog / restorePreviouslyEnabled 调用点） | **0 激活路径**（定义休眠保留，启动恢复调用点保持删除） |
| i18n `login.*` `welcome.*` `app.login` `quickPick.command.login` `startPlan.login` `codingPlan.connect` 双 locale | **0 键** |
| i18n fr18 `webRemoteControl.trigger/dialog/qr/status/bot` 78 组 | **0 键**（保留 mobileShell 深层词条=休眠管线，我方原有） |
| hba 四件套注册（bundled-plugins / official-plugin-definitions / plugin-marketplaces / prepare-agent-node-bundle） | **4/4 健在**，hba-run/hba-uigen 各处注册完整 |
| hba 插件资产（server.mjs / panel.html / bridge.js / sidecar） | **健在** |
| fr3~fr19 关键符号（GitWorktreeDialog / gitRepoDiscovery / useGitPull / useGitRepositories / gitSelectedRepository / WorkspaceOpenTerminalButton / useTerminalEntryBridge / terminalEntryStore / pluginUiInsertInputText / requireSessionForMcpUi 回退 / fr19 surface `*` 语义 / Composer leadingActionsNode / useAppPanels handleOpenOrFocusTerminalTab） | **全部健在** |
| fr20 首启建 workspace 兜底（`Root.tsx` `ensureConversationWorkspace` 正常启动路径） | **在**（`Root.tsx:1124`，含防迟到默认项目抢占的守卫） |
| zcode-site 登录/账号硬依赖审计 | **无**（src/scripts/commands 无 login/oauth/jwt 匹配）→ 按政策保留 |
| 白标资产（desktop/build 图标全套 / brand-icon.png / Z.svg 已删 / logo-zai.svg 保留 / 产品身份 VCode·dev.vcode.app） | **保我方** |

## 5. 验证结果（实测命令与数字）

| 验证 | 命令 | 结果 |
|---|---|---|
| 依赖 | `pnpm install`（proxy 127.0.0.1:10808） | **成功** 1m1s；恢复上游随 App 单测退役删除的 `@testing-library/{dom,react}`+`jsdom`（我方 fr14/fr15 定制测试仍依赖，见 §7）；electron 未走 ignore-scripts |
| 类型 | `npx tsc -b packages/ui` | **0 错误** |
| 类型 | `npx tsc -p packages/desktop/tsconfig.main.json --noEmit` | **0 错误** |
| 类型 | `npx tsc -p packages/desktop/tsconfig.e2e.json --noEmit` | **0 错误**（过程中发现并修复 `side-pane-late-close` 死引用 + `git-snapshot.test.ts` 字符串断裂） |
| 架构 | `pnpm run test:architecture` | **51 用例：50 过 / 0 失败 / 1 跳过**（exit 0） |
| 合并面核心 | `apps/zcode-cli` 下 `plugins.test.ts`（bootstrap+adapters） | 128 用例：**124 过 / 4 失败**；4 失败全部为**基线既有**（基线 worktree 同命令 8 失败 ⊇ 当前 4，`comm` 差集为空）——Windows 环境失败（win32 chmod 无 exec 位 / 路径分隔符 /大小写不敏感 env）+ 基线即红的 proxy env 用例；本次还**修复了基线的 4 个失败**（pluginCount×2、版本对齐、document disable 超时） |
| 合并面核心 | `mcp-*/config/account-config` 8 文件 | **177 过 / 0 失败 / 7 跳过**（exit 0） |
| 冲突触碰测试 | session-persistence + git-snapshot + context-builder + runtime-trace + subagent-explore + subagent-prompt-assembly | 197 用例：181 过 / 15 失败 / 1 跳过；**15 失败全部 ⊆ 基线失败集**（comm 差集为空），且比基线**少 1 个**（`returns an authorized metadata-only local video path` 基线红、当前绿） |
| 全量单测 | `npx vitest --project unit --run` | **19 文件 110 用例全过 / 0 失败**（exit 0）。注意口径巨变：上游 v3.17.1 执行"App 单测退役"（`retired-app-unit-evidence` 治理），root unit 从基线 2018 文件裁至 19 文件（157 工程测试迁入 `--project engineering` 显式清单）；上游另将 bootstrap/adapters 测试归入 `apps/zcode-cli` 独立 vitest 入口 |
| FR 验收点 | TC-TRM-01 / TC-GIT-02 | 单测/类型层通过（`gitRepoDiscovery.test.ts`、`gitSelectedRepository.test.ts`、`display.test.ts`、`WorkspaceOpenTerminalButton` 链 tsc 0 错）；**GUI 黑盒登记待验**（见 §7） |

基线对照方法论：建临时 worktree `0f28b17e`（合并前检查点）+ `pnpm install --ignore-scripts` + 构建 `apps/zcode-cli/packages/*` dist，跑同批测试逐文件 `comm` 差集归因。**结论：本次合并零新增失败。**（该 worktree 用毕已删。）

## 6. 补丁库 `fork/patches/sync-v3.17.1/`（8 个，v3.17.1 上零冲突重放）

生成方法：`git diff --binary a60ba6a7..master` 全量 885 文件，按"纯白标改名识别 + 功能规则"互斥分区（每文件恰属一个补丁，故任意顺序重放均零冲突；README 给定顺序 01→08）。

| # | 补丁 | 文件数 | 内容 |
|---|---|---|---|
| 01 | `01-core-interactions.patch` | 56 | fr3 worktree/git 发现、fr5 终端入口、fr9 git pull、fr14 footer 图标行、fr15 分支弹层、fr16 设备还原、fr17 git 簇移除、Composer/StatusPanel 面板交互 |
| 02 | `02-builtin-plugins.patch` | 22 | fr6 hba-uigen/hba-run 插件包 + 注册四件套 + fr11 MCP pool isolation/protocolVersion |
| 03 | `03-whitelabel.patch` | 302 | fr13 白标：ZCode→VCode 全量改名（614 纯改名文件中的非功能组）+ 图标/品牌资产 + 产品身份 + 默认主题/语言收敛 |
| 04 | `04-remove-mobile.patch` | 41 | fr18 删手机连接：触发器/弹框/激活断点 + 39 文件遗留 e2e/fixture 剪裁 |
| 05 | `05-remove-login.patch` | 152 | fr20 删登录入口链：WelcomeScreen/login/*、Root/store 手术、设置页 provider 区、命令面板、双 locale 词条、e2e 登录链剪裁 |
| 06 | `06-services.patch` | 283 | services/server/web/zcode-server-cli/core 协议层等运行时改动 |
| 07 | `07-plugin-ui.patch` | 24 | fr19 插件面板会话容错 + 上游 mcp-ui 面（contract/sidePane/sampling） |
| 08 | `08-test-config.patch` | 5 | vitest.config 双入口 + wdio.conf + pnpm-lock/ui package.json |

**旧补丁（fr3~fr20，27 个）→ 新栈映射表**（旧栈原地保留作历史，fr 文档"复现"命令不改）：

| 旧补丁 | 新落点 |
|---|---|
| fr3-01/02（git worktree/gitpane） | 01-core-interactions |
| fr4-01（plugin-ui insert input） | 07-plugin-ui |
| fr5-01/02（终端入口） | 01-core-interactions |
| fr6-01/02（hba 插件内置化） | 02-builtin-plugins |
| fr7-01（sidebar footer 简化） | 01-core-interactions |
| fr8-01（sidePane 项目级） | 06-services（workspaceSidePane 归 06；测试在 01/05 见 groups 明细） |
| fr9-01（git 自动刷新）/fr9-02（mcp workspace keepalive 并入 fr11） | 01-core-interactions / 02-builtin-plugins |
| fr10-01（filetree 删除重命名） | 01-core-interactions |
| fr11-01/02（mcp pool isolation） | 02-builtin-plugins |
| fr12-01（launcher 默认启用） | 06-services |
| fr13-01/02 + `branding/apply-whitelabel.mjs` + `branding/generate-icons.py` | 03-whitelabel（**脚本仍保留**：季度 rebase 后重跑脚本收敛新增文件，再出新栈） |
| fr14-01（footer 图标行） | 01-core-interactions |
| fr15-01/02/03（UI 批次） | 01-core-interactions（render loop 修复在 06） |
| fr16-01（设备还原/连接命名） | 01-core-interactions |
| fr17-01（git 簇移除） | 01-core-interactions |
| fr18-01/02/03（删手机连接） | 04-remove-mobile |
| fr19-01（插件面板会话容错） | 07-plugin-ui |
| fr20-01（删登录入口链） | 05-remove-login |

**零冲突重放证明**：临时 worktree `git worktree add <temp> v3.17.1` → 按序 `git apply` 8 个补丁 → 全部 **check OK + apply OK，零 fuzz 零冲突** → `git add -A && git write-tree` 得 `6faf2aba704e2e7313c2bd99d3cf2806f8cdb9dc`，与 `master^{tree}` 差 23 个文件**仅 100755→100644 执行位**（Windows `core.filemode=false` 下 checkout 保留上游 755，我方基线即为 644；内容 blob 全同）→ `git update-index --chmod=-x` 归一后 **`6d61629a5ba2cd15a83144a5d69aaa55bee0ddfd` == `master^{tree}`，树哈希逐字节一致 ✓**。worktree 用毕已删。

## 7. 遗留事项

1. **测试重落点清单**（B 类接受删除后，仍有价值的我方断言待未来补回）：
   - `session-persistence`：`hydrates persisted history when resuming a session in a fresh app`（我方改名版被上游删除；如需恢复，以上游版为底重放我方断言）。
   - fr20 整删的 9 个登录单测 + 17 个 e2e 的非登录断言（如 `workspaceSidePane` 项目级共享/迁移覆盖、设置面断言）——按 fr20 政策登记不重写。
   - fr18-03 整删的 39 文件中若有独立于手机入口的断言，按原 patch注释清单回捞。
2. **data-sync 疑似账号门控，待产品决策**：上游 v3.17.1 新增「数据与统计」同步设置区（`packages/ui/src/data-sync/`，跨设备同步配置/插件/命令/钩子/子代理，带设备列表、mobile 渠道文档）。本次审计**未发现登录提示/连接手机入口**（UI 壳基于本机 Source Server 设备快照），故功能壳整体保留。但其依赖 Source Server 远程设备链路，深层是否隐性要求账号态（如 source-settings attachment 需设备在线配对）**建议产品决策是否整体移除**。
3. **上游 App 单测退役带来的口径变化**：root `--project unit` 从 2018 文件缩到 19 文件；原 40 失败基线清单大部分文件已被上游删除（不再存在）。bootstrap/adapters 测试迁至 `apps/zcode-cli` 独立入口，且其 4 个失败为 Windows 环境既有（chmod exec 位 / 路径分隔符 / win32 大小写不敏感 env / proxy env 基线红）。若需全绿需上游侧修复或平台条件跳过——**未在本次处理**。
4. **恢复的 4 个 mobile e2e helper**（`mobile-pairing.ts` 的 `openMobilePairingPage`+`seedMobileFixtureLogin`、`web-remote-unread.ts`、`web-remote-visibility-browser.ts`、`web-remote-control-session-events-fixture.ts`）：支撑上游新增 10 个 e2e 编译；这些 e2e 走配对 URL 直达（深层管线，无 UI 入口激活）。**如产品决定彻底移除手机能力，需连同这 10 个上游 e2e 一并删除**。
5. **e2e 未实跑**：全部 e2e（wdio/webdriver）本次仅 `tsc -p tsconfig.e2e.json` 0 错保证编译期一致；需构建产物 + webdriver 环境实跑。
6. **GUI 黑盒验收待做**（对照 fr18/fr20 验证步骤）：首启无登录直进工作区+默认 workspace 创建、footer 仅「自动化|使用统计|插件市场|设置」、设置页无 Connect/登录按钮、命令面板无 login、无手机连接图标与后台拉起、TC-TRM-01 终端入口、TC-GIT-02 worktree 入口。
7. **zcode-site 插件需构建产物**：`requiredSeedPaths` 含 `dist/server.mjs`+`dist/ui/panel.html`（gitignored），源码检出态需 `node scripts/build.mjs` 后 `plugins.test` 版本对齐用例才绿（本次已本地构建；CI/新检出需纳入 build 步骤）。
8. **`pnpm-lock.yaml` 含恢复的 testing-library/jsdom**（上游删除、我方测试依赖）——后续 rebase 会再次遇到该删除，届时按同法恢复或迁移测试环境。

## 8. 意外发现（上游改动逼定制变形）

1. **上游删除 root `unit` 测试项目**改为 `engineering` 显式清单（157 文件）+ App 单测退役治理 → 我方 `vitest.config.ts` 从"改 include"变为"双项目并存"（unit/fork-isolated 保我方 + engineering 收上游），unit exclude engineering 清单防重复。
2. **`release()` 签名冲突**：上游给 MCP pool lease 加 `immediate` 语义与我方 fr9-01 `explicit` 同参数位冲突 → 合并为 options 对象 `{ explicit?, immediate? }`，三处调用点分别标注语义。
3. **isolation 信任收窄**：上游 v3.17.1 把插件 manifest 的 `isolation` 声明收窄为"仅官方市场可信"（防非官方插件跨会话共享状态）→ 我方 fr11-02 的透传测试 fixture 必须从 `dev-market` 改官方市场才能反映合并语义；hba 插件走官方注册不受影响。
4. **上游新增 10 个 mobile e2e 反向依赖 fr18-03 已删 helper** → 被迫恢复 4 个 helper（否则 e2e tsc 红）；这是对 fr18-03 的可见回撤，已记录。
5. **v3.17.1 工作流收尾变慢**使 session-persistence 用例越过默认 5s 超时线 → `apps/zcode-cli/vitest.config.ts` 补 30s 超时政策（与根配置一致）。
6. **hba-uigen definition 版本漂移**（0.1.1 vs manifest 0.3.0）被上游新增的版本对齐一致性用例暴露 → 修正 definition 至 0.3.0。

## 9. 补丁库维护记录

- **2026-10-31 折叠 fr13 白标收尾**：`03-whitelabel.patch` 追加 `packages/desktop/test/fixtures/installer-nsh-smoke.nsi`（夹具里 `ZCode.exe`→`VCode.exe` 两处——与 03 内 `test-installer-nsh-smoke.mjs` 是一对，同步时只改了脚本漏了夹具；主线上对应提交 `0a25fc94`，补丁文件数 302→303）。复验：8 个补丁在纯净 v3.17.1 按序重放**零 fuzz 零冲突**，重放树 `ca4c607c` 与 `master^{tree}`（`b4d0a07e`）**内容零差异**（仅 23 个 100755→100644 执行位惯例差异，同 §6 说明）。
- **2026-11-02 折叠 hba 面板 display mode 修复**：`02-builtin-plugins.patch` 重切（3 处 `availableDisplayModes: ["inline"]` → `["inline","fullscreen"]`，文件清单不变仍 22 个）——上游 v3.17.1 展示模式新规则下 inline-only 页面被侧栏闸门拒绝（`pluginUiPagePlane` 只在 allowed 集含 `fullscreen` 时给 sidebar 锚点候选），hba-run/hba-uigen 面板握手即被禁侧栏；主线上对应提交 `d5dca043`。复验：8 补丁零 fuzz 零冲突，重放树 `2c457d9b` 对 `0a25fc94^{tree}`（`b4d0a07e`）仅差本次 3 个面板文件（修复本体，预期）；对当前 `master^{tree}`（`8b878417`）3 个面板文件零差异，另有 6 个内容差异全部来自 `5a5842ff`（Windows git 仓发现修复，**尚未折叠进补丁库**，属该提交会话的遗留）+ 23 个执行位惯例差异。
