# fr13 白标批次:VCode 名称 + HBA 图标 + 删除左上角任务导航箭头(2026-10-29)

用户三项产品诉求(2026-10-29):

1. ZCode 左上角的左右箭头不要了,**完整删除**;
2. 把图标换成 HBA 中的图标;
3. 名称改为 **VCode**,需要完整更换。

对应 fork/README §4 白标清单的 #1(应用名/appId)、#2(图标)、#5(去商标字样)。

---

> **编号注意(多会话同树)**:同日并行会话已占用 fr9-01(Git 拉取)、fr10-01(文件树改名/删除)、
> fr11-01(MCP 保活)、fr12-01(launcher 应用插件常驻);本白标批次顺延为 **fr13**。
> 产物侧:r13 安装包(并行会话 12:24 打包)已包含本批次全部三项改动(见产物探针),无需另行出包。

## 1. 变更内容

### fr13-01 删除左上角任务导航箭头(补丁 `fork/patches/fr13-01-remove-tasknav-arrows.patch`)

顶栏 logo 旁的「任务后退/前进」箭头按钮(`DesktopTopOverlay`,`ArrowLeftIcon/ArrowRightIcon`
一对,`desktop-top-nav-back` 测试钩子)整套删除,含贯穿 props 链路的死代码:

| 文件 | 改动 |
| --- | --- |
| `packages/ui/src/DesktopTopOverlay.tsx` | 删两枚箭头按钮 + 9 个 props(goBack/goForward 标签、canTaskNav*、canGo*、onGoBack/onGoForward、hideTaskNavigationButtons)+ 两个 tooltip 文案 |
| `packages/ui/src/app-shell/types.ts` | 删 WorkspaceShellLayoutProps 8 个导航字段 |
| `packages/ui/src/app-shell/WorkspaceShellLayout.tsx` | 删 primaryNavigationBack/canPrimaryNavigationBack 计算与 DesktopTopOverlay/WorkspaceSidebar 两处传参 |
| `packages/ui/src/project-sidebar/contract.ts` | 删 6 个未消费的可选导航 props |
| `packages/ui/src/App.tsx` | 删标签 hook 与向下传参 |
| `packages/ui/test/desktopLogoStyle.test.ts`、`workspaceShellRemoteMobileLayout.test.ts` | 夹具同步收窄 |
| `packages/ui/src/i18n/locales/{zh-CN,en-US}.ts` | 删孤儿词条 `taskNav.back`/`taskNav.forward` |

**保留**(产品未要求删除的功能面):键盘快捷键「后退/前进」(`navigateBack/navigateForward`
命令与快捷键设置项)、任务导航 store、内嵌浏览器的网页后退/前进(`EmbeddedBrowserPaneParts`
等,属浏览器导航非任务导航)。若需连快捷键一并下线,另起需求。

### 名称 → VCode(脚本 `fork/branding/apply-whitelabel.mjs`)

- 产品身份(`desktop-product-identity.mjs`):productName `ZCode`→`VCode`、appId
  `dev.zcode.app`→`dev.vcode.app`、linuxExecutableName/PackageName `zcode`→`vcode`;
  Preview 同步(`VCode Preview`/`dev.vcode.app.preview`/`vcode-preview`)。产物名变
  `VCode-3.16.2-win-x64.exe`,exe 变 `VCode.exe`,开始菜单/卸载项/窗口标题同步。
- 独立词 `ZCode`→`VCode` 全量替换(约 740 文件):i18n 双语全部文案、About 对话框
  (标题/应用名)、桌面菜单标签、错误提示、HTML `<title>`、NSIS 安装器日志名与
  DetailPrint、android 远控 App 文案、e2e/单测断言等。标识符(useZCodeIntl、
  ZCodeStartupLogoBadge、helpZCodeEndpoint、@zcode/*、ZCODE_* 等)因 \b 词界规则天然不受影响。
- 进程名前缀(任务管理器可见)`zcode-*`→`vcode-*`(process-names.ts)。
- `packages/desktop/package.json` productName/author/description,`electron-builder.config.js`
  author/maintainer/兜底名同步 VCode。

**依法保留**(Apache-2.0,fork/README §7 红线):版权/署名行不动——About 的
`版权所有 © ${year} ZCode。`/`Copyright © ${year} ZCode.`、THIRD-PARTY-NOTICES.md、
`Modified by ZCode` 出处标注、LICENSE/NOTICE 全部原样。**功能性标识保留**:URL
(`zcode.z.ai`)、深链协议 `zcode://`、数据目录 `~/.zcode`、`ZCODE_*` 环境变量、
`@zcode/*` 包名、`.zcode-install-manifest` 清单名(升级兼容)。

### HBA 图标(脚本 `fork/branding/generate-icons.py` + 补丁 `fr13-02-whitelabel-brand-icons.patch`)

图标源 = `fork/branding/icons/hba-icon-1024.png`(HBA 六边形 H 徽标,透明圆角 RGBA)。
生成并铺满既有位置(尺寸/命名与上游一致):

- `packages/desktop/build/icons/{16..1024}.png`、`icon.png`、`icon_installer.png`、
  `icon_windows.png`、`icon.ico`(7 档)、`icon_installer.ico`、`icon.icns`、`icon_installer.icns`;
- `public/logo/icons/*`(9 档 PNG + icon.ico + icon.icns)、`public/icon_512@2x.png`;
- `packages/web/public/favicon.ico`(测试要求与 build/icon.ico 字节一致);
- `packages/web/index.html` favicon 内嵌 data URI 重生成(bootstrap 测试要求与 32x32.png 一致);
- 应用内品牌资产 `packages/ui/src/assets/brand-icon.png` + `packages/desktop/src/renderer/brand-icon.png`。

应用内 logo 全部换 HBA 徽标(fr9-02):React 徽标组件 `ZCodeStartupLogoBadge` 改渲染品牌图
(呼吸动画改 CSS keyframes `vcode-logo-breathe`,styles.css)、桌面/renderer/web 三个启动壳
的 ZCode SVG 换品牌图、About 自绘页(注入 icon data URI,CSP 只放行 data:)、
登录页/引导页 logo 壳、移动端 `ZCodeAppLogo`、高速分享卡 wordmark(徽标+VCode 字样)、
草稿空态 logo、云内容样例的品牌标。旧品牌资产 `assets/Z.svg` 删除
(`logo-zai.svg` 保留——它是 Z.ai OAuth 供应商图标,属供应商品牌非应用品牌)。

## 2. 重放管线(rebase/复现唯一入口)

```bash
# 在干净的 zcode 源码树根目录(基线 3c5b227 + fr3/5/6/7/8 各补丁之后):
git apply fork/patches/fr13-01-remove-tasknav-arrows.patch   # 1) 删箭头
node fork/branding/apply-whitelabel.mjs .                   # 2) 改名(幂等)
git apply fork/patches/fr13-02-whitelabel-brand-icons.patch  # 3) 品牌图标代码
python fork/branding/generate-icons.py .                    # 4) 图标资产(需 Pillow)
```

- 步骤 2/4 为「可重放的补丁」:改名触碰 740 文件,固化 patch 会在季度 rebase 时大面积冲突,
  重跑脚本零冲突(fork/README §5 核心 diff 最小化原则的白标专项例外,已登记)。
- **已验证**:干净 worktree 上四步重放后,与开发树逐字节一致(2026-10-29 校验通过;
  开发树上另有并行会话未提交的 git 拉取/插件改动,与 fr9 无关,校验时排除)。
- 顺序约束:fr9-02 的上下文是**改名后**的文本,必须在步骤 2 之后应用;步骤 4 幂等。

## 3. 验证

- `pnpm run typecheck` 0 错误;全量 `pnpm run test:unit` 与重点单测
  (desktopLogoStyle/rootStartupLoading/workspaceShellRemoteMobileLayout/contract/
  webRemoteControlBrand/BootstrapShell/about/desktopApplicationMenu/i18n×7/
  services zcode*×4/shared+provider+provider-node 2339 测)全绿。
- 产物级验证见 `fork/patch-verify-report.md` 附录「fr13 白标批次」。

## 4. 已知边界(不在本批范围)

- `packages/desktop/bundled-agents/**` 为预构建 agent 束,内部字符串未改名(不随源码构建);
- `apps/zcode-cli` 的 SEA 二进制名(`zcode`)、`packages/android` 包名 `com.example.zcode_mobile`
  为内部标识,未改;
- macOS `dmg_background*.png` 无 HBA 等价设计稿,待设计输入(不影响 win-x64 交付);
- 更新/登录端点策略(fork/README §4-6)仍待产品确认,`dev-app-update.yml` 未动;
- 数据目录 `~/.zcode` 与升级清单名保持不变(数据/升级兼容,非商标露出)。
