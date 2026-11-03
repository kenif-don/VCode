# fr20 删除 VCode 登录入口链(2026-10-31)

产品决策:**VCode 没有登录功能**——模型访问靠设置页配置的 provider/API key,不走交互式登录。但登录流程(WelcomeScreen OAuth/API Key 登录入口 + 启动门禁)仍然存活,运行时会按 5 种 reason 之一弹出「选择 API Key / Z.AI / 登录方式」页面。本次把登录入口链删干净;风格先例为 fr18(删可见入口链 + 断激活路径 + 清 i18n 与专属测试;深层鉴权管线有意保留休眠,核心层最小改动、rebase 冲突面最小)。

启动门禁 `welcomeScreenOpenReason`(Root.tsx)原有 5 种触发 reason,全部移除:

1. `startup-provider-required`:启动时 provider registry 未解析出带模型的 provider 就弹登录页(`useProviderAvailabilityLoginEntryGuard` 的 `shouldOpenLoginEntry = !providerFamilyDomain || (!user && !hasUsableProvider)`)——这是「有时候会弹登录页」的真相;
2. `session-expired`:JWT 过期广播/重启 marker 触发的「重新登录」弹窗链(`oauthCachedSessionRestore` + `zcodeJwtInvalidRestartMarker`);
3. `logout-provider-required`:登出后回调弹登录窗(`onProviderFamilyDomainClearedAfterLogout`);
4. `provider-request`:store `requestLoginEntry()`(设置页 ZAI/BigModel Connect、Coding Plan 购买续接、Rewards、MarketingTouch 共 4 处调用);
5. `manual-login`:侧栏 footer / 设置页 `onLogin` 链。

## 范围

- **改(整删)**:
  - 登录 UI 本体:`packages/ui/src/WelcomeScreen.tsx`、`packages/ui/src/login/`(LoginApiKeyForm + helpers)、`packages/ui/src/hooks/useOAuth.ts`(唯一消费方是 WelcomeScreen,随链删除);
  - 启动门禁与过期恢复:`root/useProviderAvailabilityLoginEntryGuard.ts`、`root/oauthCachedSessionRestore.ts`、`root/zcodeJwtInvalidRestartMarker.ts`;
  - 购买登录续接:`settings/codingPlanUpgradeLoginRecovery.ts`(`CodingPlanUpgradeDialogTarget` 类型迁入 `CodingPlanUpgradeDialog.tsx`,begin/resolve 再导出删除);
  - store 登录入口状态:`store/index.ts` 的 `LoginEntryPurpose/LoginEntryAttempt(loginEntryRequest/loginEntryAttempt/requestLoginEntry/clearLoginEntryRequest/markLoginEntryAttemptStatus)` 与 `markApiKeyLoginSuccess/apiKeyLoginSuccessSeq/lastApiKeyLoginModel`;
  - Root.tsx 手术:摘除 `WelcomeScreenOpenReason` 全链(类型/state/guard 调用/`handleOpenLoginEntry`/`handleWelcomeScreenComplete`/`loginEntryRequest` effect/渲染分支/onLogin 传参);`handleWelcomeScreenComplete` 的「登录后创建默认 workspace」副作用**并入正常启动路径**——兜底 workspace effect(ensureConversationWorkspace + 选中)现在无条件接管首启创建,这是关键回归点;
  - 启动门禁收口:`rootStartupGate.ts` 删 `welcomeScreenOpen` 参数与 `shouldEnableProviderAvailabilityLoginEntryGuard`,`shouldResolveProviderStartupState` 只保留 `providerStartupSyncPending`(family domain 迁移 + provider 视图水合仍在门禁内);`launchToInputReport.ts` 删 `welcomeScreenOpen` 参数;
  - OAuth 失效最小化:`useRootOAuthEffects.ts` 删 `onReauthenticationRequired` 参数与过期弹窗文案,`reauthentication-required`/JWT 撤销广播只做本地清理(`setUser(null)` + `clearProviderFamilyDomain`),失败路径只记录日志不再写 `oauthError`(唯一读取方 WelcomeScreen 已删);
  - Connect(OAuth 连接)按钮链:`ModelProviderSection.tsx` 删 `handleCodingPlanLogin`/`requestLoginEntry`;`Detail.tsx` 删 3 处 `onCodingPlanLogin` 与 `resolvePurchaseChoiceSelectionIntent`(断连态购买横幅改为直接打开官网 webview,账号登录由 webview 内部承接);`StatusCards.tsx`/`CodingPlanStatusActions.tsx` 删 `onLogin/loginActionVisible/loginActionPlacement/reloginOnFailure/loginButtonId/providerName` 死 props 与登录/重登按钮渲染,凭据失败态只留手动「重试」;`ApiKeyInput` 等 API key provider 配置界面**保留**;
  - Rewards/MarketingTouch 解绑:`RewardsProvider` 摘登录 gating(点击直接开奖励页);`MarketingTouchProvider` 匿名领取改直接取消,不再拉登录;
  - 命令面板:`quickPickCommands.ts` 删 `login` 命令与 handler(`quickPickCommandIcons.tsx` 同步删图标映射);`logout` 命令保留;
  - onLogin props 死链全链清理至组件签名:App → Root → RootWorkspaceContent → WorkspaceShellLayout → project-sidebar → WorkspaceSidebarFooter;Root → WorkspaceSettingsLayer → SettingsPage → footer;
  - test-ids:删 `TID_LOGIN_*`(9 个)与 `TID_OAUTH_*`(3 个)——TID_OAUTH_* 只被应用登录面引用,与 MCP OAuth 无关;
  - i18n:en-US/zh-CN 成对删 `login.*` 35 组 + `welcome.*` 6 组(登录页遗留、改动前已悬空)+ `app.login` + `quickPick.command.login` + `settings.modelProvider.startPlan.login` + `settings.modelProvider.codingPlan.connect`。`apps/zcode-cli` 的终端命令文案 `loginRequired/loginSetup` 未动。
- **不改(有意保留,休眠)**:MCP OAuth(`apps/zcode-cli/.../mcp/oauth*.ts`、official-mcp-auth)——MCP 服务器授权与应用登录无关;`packages/services/src/oauth/`(oauthService 被 useCredentials/ModelProviderSection/Coding Plan 用);`useWebRemoteControlAuthSync`(挂在 oauthService 上,未连带删);CLI `/login` 命令链(`auth-login*.ts`、cli/login-command.ts,仅终端手动触发不弹窗);`packages/web/src/auth/`(web 端登录视图,桌面不走);OccupationOnboarding 引导全套;`handleLogout` 功能本体(Coding Plan 断开用,只摘「回调弹登录窗」);`oauthError/setOAuthError/markOAuthSuccess/isRestoringOAuthSession` store 字段(深层管线,现无读取方但保留以小改核心层);`oauthActions.ts` 的 `startPresetSubscriptionLogin`(改动前即无调用方的历史遗留,非本次引入,未顺手删)。删除入口 + 断掉激活路径后,上述管线在桌面端不可达也不可见。

## 变更内容(补丁 1 个)

| 补丁 | 文件 | 规模 |
| --- | --- | --- |
| `fork/patches/fr20-01-remove-login-entry-chain.patch` | 94 文件(删 34:源码 8 / ui 单测 9 / e2e spec 与 helper 17;改 60,含 Root/store/设置页 provider 区/双 locale/多份单测与 e2e) | +145 / −7097 |

补丁用**快照法**生成(改前/改后对清单文件 `cp --parents` 快照,`diff -urN` 后改路径头为 `a/ b/`),已对当前工作区做 `git apply -R --check` 反向校验通过(即补丁内容与改动逐字节对应);**完整栈 round-trip 叠加验证待补**——工作区有约 920 个其他补丁(fr9~fr19)在途文件,无法现在做干净栈验证。

## 测试契约同步

- **整删单测 9 个**(被测对象已删):`loginPage`、`loginDialogProviders`、`loginFailureCancel`、`loginApiKeyForm`、`rootOAuthReauthentication`、`oauthCachedSessionRestore`、`zcodeJwtInvalidRestartMarker`、`providerAvailabilityLoginEntryGuard`、`useOAuth`。
- **改断言单测**:`storeOAuthRestoreState`(删 loginEntry 生命周期 2 例)、`rootStartupGate`(删守卫开关例,`shouldResolveProviderStartupState`/`shouldShowRootStartupLoading` 收口)、`rootLaunchReport`(删 WelcomeScreen 不上报例)、`rootUpdateReadyOverlay`(删 WelcomeScreen mock、rootStartupGate mock 收口)、`rewardsProvider`(重写为「点击直接打开」2 例)、`marketingTouchProvider`(fixture 摘 requestLoginEntry)、`quickPickCommands`(删 login 命令断言)、`modelProviderPresetSubscriptionAction`(删 3 个 Connect→登录入口例)、`modelProviderCodingPlan`(删 4 个购买登录续接例与 `resolvePurchaseChoiceSelectionIntent` 例,Connect/重新登录断言翻转为不存在,凭据失败态改为「重试」)、`rootOAuthCallbackCancellation`/`rootAccountRefreshLifecycle`(react hook mock 补 `useCallback`、摘 `onReauthenticationRequired` 实参)、`workspaceShellRemoteMobileLayout`(摘 onLogin fixture 字段)。
- **browser fixture**:`account-provider-key-retry` fixture+test 整删(重新登录 force-OAuth 流程已删);`start-plan-followup` fixture+test 改为 unavailable/expired 只点「重试」。
- **e2e**:整删 17 个走登录入口链/已失效头像菜单面的文件:`oauth-login-failure-cancel`、`oauth-credential-recovery`、`subagent-coding-plan-login-catalog-stale`、`coding-plan-upgrade-webview-refresh-provider`、`provider-readiness-agent-startup`、`windows-agent-metric-probe-absence`、`manual-review/pending` 下 `jwt-expiry-reauthentication`/`access-token-401-auto-logout`/`jwt-401-auto-logout`/`oauth-completion-race`/`project-location-decrypt-recovery`、`general-coding-mode`、`marketing-touch-rewards`、`coding-plan-upgrade-personal-system-busy`、`helpers/coding-plan-upgrade.ts`、`account-provider-key-retry(.fixture.tsx/.test.mjs)`。其中 `general-coding-mode`/`marketing-touch-rewards`/`coding-plan-upgrade` helper/`project-location-decrypt-recovery` 依赖的头像菜单(`login-trigger`)在早前白标补丁中已不存在,运行时本就不可达,属既有死用例清理。
- **e2e 改断言**:`conversation-session.ts`/`v4-conversation.ts` helper 删 `loginWithApiKey` 兜底与 TID_LOGIN 依赖;8 个消费方 spec(off-peak-limit-pre-gate、composer-provider-identity、composer-compression、project-upgrade-order、project-behavior、remote-project-policy、task-groups、virtual-project、wsl-required-update)摘登录分支;`marketing-touch-anonymous` 保留匿名边界分支,登录/logout/WelcomeScreen 跳过逻辑删除,匿名领取断言改为「直接取消、不提交 claim」;`e2ecase-regression`/`coding-plan-team-usage` 的「头像菜单→使用统计」改直达 footer 使用统计按钮,`settings-ui-polish` 删 UP-01(头像菜单偏好顺序)。e2e 未在本次运行(需构建产物 + webdriver),已由 `tsc -p packages/desktop/tsconfig.e2e.json --noEmit` 0 错误保证编译期一致。

## 验证(实测)

- `npx tsc -b packages/ui`:**0 错误**;`npx tsc -p packages/desktop/tsconfig.main.json --noEmit`:**0 错误**;`npx tsc -p packages/desktop/tsconfig.e2e.json --noEmit`:**0 错误**。
- `pnpm run test:architecture`(架构治理 4 件套):**35 过 / 0 失败 / 1 跳过**(与 fr18 基线一致,跳过项为既有)。
- 定向单测 13 文件(storeOAuthRestoreState / rootStartupGate / rootLaunchReport / rootUpdateReadyOverlay / rewardsProvider / marketingTouchProvider / quickPickCommands / modelProviderPresetSubscriptionAction / modelProviderCodingPlan / rootOAuthCallbackCancellation / rootAccountRefreshLifecycle / codingPlanUpgradeDialogProvider / workspaceShellRemoteMobileLayout)除下述既有失败外**全部通过**(`modelProviderCodingPlan` 182/182)。
- 真实门禁范围全量(`npx vitest --project unit --run`,两次运行数字一致):**2018 文件 1976 过 / 40 失败;19427 用例 19233 过 / 146 失败 / 48 跳过**。失败 40 文件与本次改动面**零交集**——本次直接触碰且仍存在的 13 个单测文件除下述既有失败外全部通过;40 个失败文件按族谱归因:
  - `window.matchMedia` store 族(6 文件:storeOAuthRestoreState、codingPlanQuotaResetAutoPlayBroadcast、useCodingPlanQuotaResetUi、fileManagerNavigationPreference、interfaceMode、notificationEnabledBroadcast):失败栈均为 `createZCodeStore → syncSystemThemeListener/applyTheme → window.matchMedia`,该代码路径与 HEAD **逐字节一致**(`git diff HEAD` 无 useTheme/syncSystemThemeListener/applyTheme 改动),失败用例含本次未触碰的用例——工作区既有失败(疑为早前补丁给 store 创建期挂系统主题监听后未补测试 shim);
  - 消息流工具块族(6 文件:agentToolCallBlock、nodeReplToolCallBlock(+Interaction)、planGuidanceToolCallBlock、readSessionContextToolCallBlock、switchModeToolCallBlock)与 composer/面板族(5 文件:composerTeamMenu、messageChangeSummaryPanel、reasoningLayout、useAppPanelsScope、workspaceHeaderActionSection):fr18 已记录的既有失败面;
  - provider/营销 mock 在途面(2 文件:providerLogoAssets、codingPlanUpgradeMockServer):资源断言/mock 请求序列断言,与登录链无交集;
  - desktop 主进程与安装器/环境族(13 文件)及 services/server/web 族(8 文件):本次未触碰这些包的运行时代码(desktop src 零改动,tsc main/e2e 均 0 错误)。
- 符号终扫(grep `WelcomeScreen|LoginApiKeyForm|requestLoginEntry|welcomeScreenOpenReason|loginEntryRequest|markApiKeyLoginSuccess|codingPlanUpgradeLoginRecovery|oauthCachedSessionRestore|zcodeJwtInvalidRestartMarker|TID_LOGIN` 于 `packages/` + `apps/zcode-cli/packages/bootstrap/src`):**零残留**;扩展扫描(`useProviderAvailabilityLoginEntryGuard`/`loginEntryAttempt`/`onCodingPlanLogin`/`resolvePurchaseChoiceSelectionIntent` 等)同样零残留;`packages/web/src/auth` 的 `onLogin` 为 web 端自有视图 prop(保留清单),`apps/zcode-cli` 内 `useOAuth` 为 CLI 局部变量(重名巧合)。
- i18n:`id: "login.` 使用方为 **0**,双 locale `login.*` 键为 **0**。
- 补丁校验:`git apply -R --check fr20-01-...patch` 通过(反向应用即回到改前 94 文件状态)。

### 既有失败(与本次无关,证据)

- `packages/ui/test/storeOAuthRestoreState.test.ts` 6 例失败于 `window is not defined`(`createZCodeStore` → `applyTheme` → `getSystemTheme` → `window.matchMedia`,单测 node 环境无 window):失败代码路径与 HEAD **逐字节一致**(`git diff HEAD` 确认 `useTheme.ts` 零改动、store 的 applyTheme 调用未动),失败用例含本次未触碰的「默认不处于 OAuth 启动恢复中」等——属工作区既有失败(fr18 全量记录中 OAuth 面即为既有失败区)。

<!-- FULL-UNIT-RESULT -->

## 复现(在 fr19 之后叠加)

```bash
git apply fork/patches/fr20-01-remove-login-entry-chain.patch
```

## 验证步骤(重打包/热替换后)

1. 首次启动(全新 profile):**不应再出现**「欢迎来到 VCode / 连接账号 / 使用 API key」登录页与「选择 API Key / Z.AI」弹窗;直接进入引导或工作区,默认 workspace 正常创建(关键回归点:原「登录后创建默认 workspace」已并入启动兜底路径)。
2. 启动时若 provider 尚未配置:不再被登录页阻塞,工作区照常打开;在设置页配置 provider/API key 后模型可用。
3. 设置页 ZAI/Coding Plan 卡片:不再有「连接 / 登录 / 重新登录」按钮;「重试」(凭据失败)、解绑(断开连接并重启)、购买/升级(官网 webview 内自行处理账号)照旧;API key 输入等 provider 配置界面照旧。
4. 命令面板(Cmd/Ctrl+K):不再有「连接」命令;「断开连接」命令保留。侧栏 footer 仅:自动化 | 使用统计 | 插件市场 | 设置。
5. 回归:点击奖励页入口直接打开(不再要求登录);营销触达匿名边界(无 Authorization 头、匿名领取直接取消)照旧;MCP OAuth、终端 `/login`、web 端登录视图不受影响。
