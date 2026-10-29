# fr6 验证报告 — HBA 面板内置化(hba-uigen / hba-run)与 Windows 安装包

源码树:C:\Users\76437\AppData\Local\Temp\zcode-src\zai-org-ZCode-3c5b227(ZCode v3.16.2 基线 3c5b227,含 fr5-01/02、fr3-01/02)
提交:3dec819b "apply: hba fork patches fr6-01 fr6-02"(基线 2698c34b)
日期:2026-10-28

## 一、改动清单(补丁,均位于 fork\patches\)

### fr6-01-builtin-plugins-packaging.patch(183,041 字节)

| 文件 | 改动 |
| --- | --- |
| apps/zcode-cli/packages/hba-uigen-plugin/(新增 6 文件) | .zcode-plugin/plugin.json、README.md、package.json、server.mjs、ui/bridge.js、ui/panel.html。插件源与 D:\ai_workspace\AI IDE\hba-on-zcode\plugins\hba-uigen 逐字节一致(diff -r 验证),仅补 package.json(对齐 bootstrap 一致性单测);版本 0.1.1(含 tools/list _meta.ui 修复) |
| apps/zcode-cli/packages/hba-run-plugin/(新增 5 文件) | 同构,版本 0.1.0 |
| apps/zcode-cli/packages/bootstrap/src/app/official-plugin-definitions.ts | OFFICIAL_PLUGIN_DEFINITIONS 追加 hba-uigen、hba-run 两个 definition:componentTypes ["ui"]、defaultEnabled true、requiredSeedPaths(.zcode-plugin/plugin.json、server.mjs、ui/panel.html,另 ui/bridge.js)、rootCandidates(packages/hba-uigen-plugin 等 4 级)、listing(displayName_i18n "UI 原型"/"HBA 运行面板" 等)。DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS 由定义自动导出 |
| apps/zcode-cli/packages/bootstrap/src/app/bundled-plugins.ts | includedTopLevelPaths(种子文件顶层白名单)新增 "server.mjs"、"ui" |
| packages/desktop/scripts/prepare-agent-node-bundle.mjs | officialPluginPackages 新增两条目(requiresRuntime false + requiredSeedPaths 完整性断言,stagedPath packages/hba-*-plugin);includedOfficialPluginTopLevelPaths 同步新增 "server.mjs"、"ui" |
| packages/shared/src/plugin-marketplaces.ts | DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS 新增 hba-uigen@zcode-plugins-official、hba-run@zcode-plugins-official(与 bootstrap 定义机械对照的那份名单) |
| pnpm-lock.yaml | +4 行:两个零依赖空 importer |

### fr6-02-builtin-panels-launcher.patch(5,516 字节)

| 文件 | 改动 |
| --- | --- |
| packages/ui/src/plugin-ui/adapters/useUiPluginRecommendations.ts | 新增导出 BUILTIN_UI_PLUGIN_RECOMMENDATIONS(两个内置 {pluginId, surfaceId} 常量)与 mergeUiPluginRecommendations()(内置条目固定在前,按 pluginId+surfaceId 去重,云端为空/未含/读取失败均保留内置);useUiPluginRecommendations 的成功与失败分支都改走 merge。渲染链(PluginUiLauncherItems 两种 variant、插件市场 UI 分段排序)消费同一数据源,无需改动 |
| packages/ui/test/useUiPluginRecommendations.test.ts | 断言改用 mergeUiPluginRecommendations 对照;失败用例更名为"失败仍保内置推荐" |

补丁验证:在 fr5 基线(2698c34b)干净 worktree 上 `git apply --check` fr6-01 通过并 apply 成功,随后 `git apply --check` fr6-02 通过并 apply 成功(顺序 fr6-01 → fr6-02)。

## 二、typecheck / 打包 / 单测(真实结果)

- pnpm install:成功(5.9s),pnpm-lock.yaml 仅新增 2 个空 importer。
- pnpm run typecheck:exit 0,全绿(tsc -b 全部工程 + remote-main + zcode-cua)。
- 单测(选跑受影响面):
  - packages/ui/test/useUiPluginRecommendations.test.ts:2 passed。
  - apps/zcode-cli bootstrap plugins.test.ts 三条机械一致性用例全部 passed:「Settings 默认启用集合与 CLI 的官方插件声明一致」「keeps every bundled plugin package, manifest, and seed version aligned」「declares the ui component type exactly for bundled plugins with UI surfaces」。
- pnpm run bundle:desktop --os win --arch x64:exit 0。prepare 日志出现 `staged official plugin packages/hba-uigen-plugin`、`packages/hba-run-plugin`;win-unpacked\resources\glm\packages 目录含两个 hba 插件包(与 pdf-plugin 等并列);体积审计 155.8 MiB(限 500 MiB)。
- 安装包:D:\ai_workspace\AI IDE\hba-on-zcode\dist\ZCode-3.16.2-hba-panels-win-x64.exe
  - 大小:163,379,298 字节(155.8 MiB)
  - sha256:79428a7d2cac7611083876b502953b1ce384c39caad207fddff8d405d24b5347

## 三、冒烟(win-unpacked 隔离启动,任务指定 4 个 ZCODE_DESKTOP_* 变量)

1. 进程与主窗口:通过。进程存活,MainWindowTitle=ZCode(主窗口 3226x1930 物理),主界面渲染完整(侧栏/任务列表/输入区/问候语),截图见 fork\fr6-shots\。
2. 播种生效,但落点是 %USERPROFILE%\.zcode 而非隔离 home——如实说明:任务给定的 4 个变量只隔离桌面端 home/userdata/session;agent 存储根由 homedir()\.zcode 解析(desktopRuntimeEnv 不改写 ZCODE_HOME)。实测证据:
   - 首启 45 秒内物化 C:\Users\76437\.zcode\cli\plugins\cache\zcode-plugins-official\hba-uigen\0.1.1(含 .zcode-plugin-seed.json 标记,hash bad079f0...,source filesystem)与 ...\hba-run\0.1.0(ac3485c5...);会话启动时幂等重播种(10:52 时间戳,marker 一致跳过重写)。
   - CLI 端到端(ELECTRON_RUN_AS_NODE + resources\glm\zcode.cjs plugins list):hba-uigen@zcode-plugins-official [enabled](mcp: plugin:hba-uigen:hba-uigen)、hba-run@zcode-plugins-official [enabled](mcp: plugin:hba-run:run),cache 路径指向上述目录。
   - config.json(enabledPlugins):裸播种不落显式 true——产品语义是 enabledPlugins[id] ?? defaultEnabled,解析结果即启用;显式 true 仅在市场安装时写入。该机 cli\config.json 现存显式项只有旧 dev 市场两个 id(fr5 遗留)。此项与任务预期"enabledPlugins 为 true"不符,按实际语义如实报告。
   - 补充验证(隔离 home):把 USERPROFILE 重定向到隔离 home 后经 agent 入口(resolveZCodePlugins/首启播种同一条代码路径)执行,缓存与插件数据落在 zcode-fr6-home\home\.zcode\cli\plugins\...,两插件 [enabled];另做了一次"全新 profile + 重定向 USERPROFILE"的完整 app 启动,2 分钟内未弹出窗口(疑为全新 profile 的 onboarding 路径卡住),该项记为未完成,未继续深挖。
3. PrintWindow 截图:通过(先清 LIB/LIBPATH 再 Add-Type user32,flag 2)。截图存 fork\fr6-shots\。
4. launcher 两面板入口:通过(超出"尽力而为"要求)。正式会话右侧面板 launcher「新标签页」的"应用插件"区,前两行即 **UI 原型**(描述"UI 原型")与 **运行**(描述"HBA 运行面板"),动作按钮为「打开」(installed+enabled 直开链路),排在 PDF/演示文稿等官方面板之前(内置推荐置顶生效);插件市场"应用插件"分段同样将 UI 原型排第一。证据图 01-launcher-two-panels.png。
5. 点击链路与面板:点击「打开」开出 surface 标题页签「UI 原型」(resolveSurface → onOpenPluginUi 链路走通);但本机残留旧 dev 市场副本(hba-uigen/hba-run@dev-hba-on-zcode-fc91674a)与内置件 manifest 同名、server 同名,进程侧只见 dev 副本 server 拉起,面板页显示 "MCP App page stopped";对照实验:同场打开 PDF 面板(无重名)完整渲染("打开你的 PDF 文件"),证明面板管线正常。
6. 种子功能探针(MCP stdio 直连种子缓存,不依赖 app):hba-uigen 5 个工具(uigen_generate/uigen_list_versions/uigen_get_version/uigen_export/uigen_import_dir)全部携带 _meta.ui,resources/read ui://hba-uigen/panel.html 返回 42,785 字节 HTML;hba-run 9 个工具(run_config_list/run_config_save/run_config_delete/run_config_duplicate/run_start/run_stop/run_status/run_output/run_history)全部携带 _meta.ui,ui://run/panel.html 返回 26,219 字节。种子内容功能完好。

清理:win-unpacked 进程树全部 taskkill(两轮共 32 个进程,均按可执行路径精确匹配,未触碰 D:\ZCode 正式实例);隔离 home 与冒烟脚本已删除;证据截图保留 fork\fr6-shots\。
副作用(如实):冒烟实例按产品行为把官方插件种子写入了共享的 %USERPROFILE%\.zcode(即 hba 两个官方缓存目录 + 官方市场分片),与未来安装本包后首次启动的落点一致、幂等无害;未手工改动 .zcode 任何既有内容。

## 四、用户替换步骤

1. 关闭 ZCode(确认托盘无残留;正在跑的任务自行收尾)。
2. 运行 D:\ai_workspace\AI IDE\hba-on-zcode\dist\ZCode-3.16.2-hba-panels-win-x64.exe,原位替换安装(保持 "ZCode" 身份,不改名,现有数据/登录/配置保留)。
3. 重开 ZCode → 打开任意项目任务 → 右侧面板(顶栏"面板"按钮 → 新标签页)的"应用插件"区即见「UI 原型」与「运行/ HBA 运行面板」两个入口,点击「打开」即用。
4. 建议(非必须):在插件市场卸载旧 dev 市场副本 hba-uigen、hba-run(dev-hba-on-zcode-fc91674a),否则与内置件工具重复、面板实例互相遮蔽。

## 五、已知限制

- 自动更新:本构建日志确认 [auto-update] disabled for this desktop product flavor——此产品 flavor 禁用 auto-update,不会被官网通道覆盖(即不会"自动变回"官方版)。
- 基线版本:构建基于 v3.16.2(源 3c5b227)。若旧安装是 3.16.3,替换后客户端版本为 3.16.2(数据兼容,功能以本报告为准);需要更新基线时重打包即可。
- 生成引擎仍是演示模式:hba-uigen 优先查找 sidecar\uigen_sidecar.py(可用环境变量 UIGEN_SIDECAR 指定路径),缺失或运行失败自动回退内置演示生成器。
- 旧 dev 市场副本并存:dev-hba-on-zcode-fc91674a 的两个插件与内置件 manifest 同名(hba-uigen/hba-run)、MCP server 同名(plugin:hba-uigen:hba-uigen、plugin:hba-run:run),会工具重复并遮蔽内置面板实例(冒烟中的 "MCP App page stopped" 即此形态);卸载 dev 副本后恢复。
- 种子落点:%USERPROFILE%\.zcode(cli\plugins\cache、cli\config.json)。任务给定的 4 个 ZCODE_DESKTOP_* 变量不重定向 agent 存储根;需要全隔离时另设 USERPROFILE(或 ZCODE_HOME 语义的 homedir)。
- enabledPlugins 显式 true 只由市场安装写入;内置默认启用走 defaultEnabled(解析为启用,不落盘)。设置页停用后会落显式 false,行为不受影响。
- 小瑕疵:hba-uigen\server.mjs 内部 SERVER_VERSION 常量仍为 "0.1.0"(initialize 展示字段),与清单/包/种子的 0.1.1 不一致,不影响种子版本对齐(一致性单测通过);可在插件源下轮顺手修正。
- 面板标题文案:hba-run 的 surface 标题 zh-CN 声明为"运行",launcher 行以 surface 标题为题、listing 名"HBA 运行面板"为描述位(与任务描述的"面板标题已声明为 HBA 运行面板"略有出入,以插件源最新版为准)。
