# fr18 删手机连接(整体)与设置弹框底部引导入口(2026-10-30)

用户定夺:任务列表底部、设置按钮左侧的**手机连接**图标及其整体功能、点击后弹出的连接弹框**都不要了**——该能力(ZCode Web 远控/手机配对)依赖登录,改为 VCode 后没有对应登录功能,不可用;**设置弹框底部的引导**相关功能也不要了——新用户引导/迁移向导与 ZCode 官方深度绑定。

## 范围

- **改(fr18-01 手机连接)**:
  - 底部图标行删除手机连接入口:`WorkspaceWebRemoteControlTrigger`(图标+状态着色+弹框开关)整文件删除,footer 死 props 链(`workspacePath`/`workspaceIdentity`/`workspaceRemoteSessionId`/`activeTaskId`/`isDesktop`)与 project-sidebar、SettingsPage 两处调用方传参一并清理;
  - **连接弹框整套删除**:`web-remote-control/WebRemoteControlDialog.tsx`、`domain/presentation.ts`;`web-remote-control/index.ts` 只留手机端仍用的 `WebRemoteControlTaskViewReporter` 与 contract 类型;`contract.test.ts` **重写**为剩余契约(模块清单 + 设备导航示例)——managed 模块契约测试是架构治理硬性要求(`test:architecture`),不能随弹框删除;
  - **激活路径切断**:桌面主进程 `syncWebRemoteControlWorkspaces` 里 `restorePreviouslyEnabled`(启动时自动恢复上次开启的远控会话、已配对手机可无 UI 重连)调用移除——弹框删除后这是仅剩的自动激活入口;
  - ui 包公共导出删死导出(`WebRemoteControlDialog`、`WebRemoteControlFeatureProvider`/`useWebRemoteControlFeatureEnabled`,外部无消费方);
  - i18n:`webRemoteControl.*` 失效词条 78 组(触发器/弹框/状态标签/二维码/失败文案/机器人渠道卡片等)自 zh-CN、en-US 成对删除。
- **改(fr18-02 引导)**:
  - 设置左栏底部"引导"虚线按钮(Rocket)删除;通用区底部"引导 → 打开引导"行删除;
  - `onOpenOnboardingDialog` prop 链(GeneralSectionContent)与 SettingsPage 内 `requestOnboardingDialog` 收口移除;
  - i18n:`settings.onboarding`/`settings.onboardingDescription`/`settings.onboardingOpen` 成对删除。
- **不改(有意保留,休眠)**:手机端 Shell(`WebRemoteControlMobileShell` 及 v4 各处 `webRemoteControlWorkspaceSwitcher` 线程)、中继协议(`shared/web-remote-relay`)、桌面远控管理器(`webRemoteControlManager`/IPC/状态轮询)等深层管线——按核心层最小改动原则(PR 5.1/7.5,季度 rebase 冲突面最小化)不动;删除入口+断掉启动恢复后**无任何激活路径**(配对入口已删、登录不存在),这些代码不可达也不可见。首次启动的 OccupationOnboarding 向导本体与 `openOnboarding` 快捷键(Cmd/Ctrl+Shift+O)未动——本次仅移除**设置弹框内**的引导入口;如需连向导一并移除请另行立项。

## 变更内容(补丁 3 个,按序叠加)

| 补丁 | 文件 | 规模 |
| --- | --- | --- |
| `fork/patches/fr18-01-remove-mobile-connect-feature.patch` | 19 文件(删 8:触发器/弹框/presentation/5 个专属单测;改 11,含 contract.test.ts 重写) | +19 / −2145 |
| `fork/patches/fr18-02-remove-settings-onboarding-entries.patch` | 5 文件(SettingsPage/settingsPageHelpers/双 locale/1 测试) | +1 / −62 |
| `fork/patches/fr18-03-remove-mobile-connect-stale-tests.patch` | 39 文件(删 30:10 个 e2e 用例/2 个专属单测/4 个专属助手/14 个回放与案例 fixture;改 9:剪 7 处清单与配置、剪 mobile-pairing 助手、剪 virtual-project VP12、剪 sidebar-user-id mock 桩) | +2 / −6063 |

## 测试契约同步

- `workspaceSidebarFooterEntryRow.test.ts`:入口行顺序断言改"自动化 → 使用统计 → 插件市场 → 设置",触发器 mock 与死 props 移除。
- `workspaceSidebarFooterWebRemoteControlTooltip.test.ts`:触发器 mock 与"触发器不套双层 tooltip"用例移除(其余用例实测为用量徽标契约,保留)。
- 专属单测删除:`webRemoteControlDialogLayout`、`webRemoteControlLoginEntry`、`webRemoteControlTriggerPresentation`、`workspaceWebRemoteControlTrigger(+Telemetry)`。
- `web-remote-control/contract.test.ts`:原用例测的是弹框 presentation 助手(已删),按 adopt 骨架重写为"模块清单 + 设备导航示例"两条契约用例(2/2 通过)。
- `settingsDataBaseDirControl.test.ts`:fixture 去掉 `onOpenOnboardingDialog`。
- 桌面单测不受影响(`webRemoteControlManagerV2` 直调 manager 方法仍在;`desktopMainIpcPlatform` 只 mock 平台面)。
- **fr18-03 遗留用例清理**(用户追加定夺:已删入口的用例一并清掉):
  - 删除走手机连接入口/远控功能的 e2e 用例 10 个:`conversation-session-r3-mobile`、`r3-mobile-permission`、`r3-soak-dual`、`virtual-project-mobile`、`web-remote-project-directory`、`web-remote-unread`、`web-remote-control-auth-gate`、`web-remote-control-session-events`、`bots/feishu-bound-groups-ui`、`bots/feishu-runtime-error-ui`(后两个与 `virtual-project` 的 VP12 均为借道入口导航的他功能用例)。
  - `conversation-session-virtual-project.test.ts` 只删借道入口的 VP12 一个用例,其余 10 个虚拟项目用例保留。
  - 删除专属单测 2 个(`webRemoteControlAuthGateFixture`、`mobileReplayFixture`)与专属助手/fixture 4 个(`web-remote-control-auth-gate-fixture`、`web-remote-control-session-events-fixture`、`web-remote-unread`、`web-remote-visibility-browser`)、回放与案例 fixture 14 个(cases/upstream 各 6 + auth-config 2)。
  - 剪裁:`mobile-pairing.ts` 只留 `redactMobileDiagnosticText`(单测仍在用),`mobilePairingDiagnostics` 去掉 `openMobilePairingPage` 用例;`wdio.conf.ts` 去掉 auth-gate fixture 生命周期与 r3-mobile 超时预算、web-remote-unread 窗口排除子句;`codingPlanE2EMockEnv`/`e2eStartupCredentials`/`coding-plan-mock-env` 清单各剪去已删 spec;`sidebar-user-id.test.mjs` 剪掉触发器 mock 桩;`command-center-focus.test.ts` 注释去掉手机连接字样。
  - 保留:`conversation-session-r3-soak-reconnect`/`r3-transport-loss` 等 SSH 远程用例、`mobile-message-evidence`/`remote-tool-execution-evidence` 助手及其单测(SSH 远程功能面);`e2eUnreadContextContract` 保留 compact 小窗口契约(改题后仅删 web-remote-unread 示例)。

## 验证(实测)

- `tsc -b packages/ui`、`tsc -p packages/desktop/tsconfig.main.json --noEmit`:**0 错误**。
- 定向测试 5 文件(workspaceSidebarFooterEntryRow / workspaceSidebarFooterWebRemoteControlTooltip / settingsDataBaseDirControl / settingsPageIntegratedTerminalShell / workspaceSidebarWebRemoteMobileLayout)**51/51 通过**;`web-remote-control/contract.test.ts` 2/2。
- `pnpm run test:architecture`(架构治理 4 件套):**35 过 / 0 失败 / 1 跳过**。
- fr18-01 → fr18-02 在累计状态上顺序 `git apply --check` **零 fuzz**,叠加结果与当前树逐字节一致(round-trip)。
- 真实门禁范围全量(根配置 `vitest --project unit`,覆盖 `packages/ui/test`):**1044 文件 1026 过 / 18 失败**;失败的 18 文件(107 用例,消息流工具块/composer/面板/OAuth 等 fr9-17 在途面)在 **pre-fr18 状态下失败集逐条相同**——对照实验(还原 fr18 改动后重跑)证实为工作树既有失败,与本次改动无关;本次触碰面(footer/设置引导/词条/web-remote-control 契约)在全量中全部通过。
- 桌面远控相关单测(mobilePairingDiagnostics / webRemoteControlManagerV2 / webRemoteControlManagerExternalRelay / desktopMainIpcPlatform)**98/98 通过**。
- fr18-03:`tsc -p packages/desktop/tsconfig.e2e.json` 与 `tsconfig.main.json` **0 错误**;受影响单测 4 件(mobilePairingDiagnostics / e2eUnreadContextContract / e2eStartupCredentials / codingPlanE2EMockEnv)**90/90 通过**;删除面符号终扫**零残留**;补丁正向 `git apply` 与反向 `git apply -R` 双向零 fuzz。

## 复现(在 fr17-01 之后叠加)

```bash
git apply fork/patches/fr18-01-remove-mobile-connect-feature.patch
git apply fork/patches/fr18-02-remove-settings-onboarding-entries.patch
git apply fork/patches/fr18-03-remove-mobile-connect-stale-tests.patch
```

## 验证步骤(重打包/热替换后)

1. 底部图标行只剩:自动化 | 使用统计 | 插件市场 | 设置;无手机连接图标,任何入口都打不开连接弹框;重启后不应有远控后台拉起(日志无 `[WorkspaceWebRemoteControlTrigger]`/`restorePreviouslyEnabled` 痕迹)。
2. 设置弹框:左栏底部无"引导"按钮;通用区底部无"引导/打开引导"行;其余设置项照旧。
3. 回归:使用统计/自动化/插件市场/设置入口与设置页各分区正常;新用户首次启动引导仍会出现(本次未移除,如需移除另行立项)。
