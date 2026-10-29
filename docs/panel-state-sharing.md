# 面板状态项目级共享（B 方案，2026-10-28）

目标：右侧面板状态从「跟随会话」改为「跟随项目」——同项目所有会话/窗口的面板共享一份状态，打开面板即恢复。
数据层本来就是项目级（`.hba/run.json`、`.hba/uigen/` 落盘 + `isolation: "workspace"` 单 server 进程），本次补的是**面板 UI 状态**的持久化与恢复，全部走插件层，不动宿主。

## hba-run

- 服务端新增内部工具 `run_ui_state`：无参=读（无则 `state: null`），带 `state`（JSON 对象）=写；落盘 `<workspace>/.hba/run-ui-state.json`。
- 面板持久化并恢复：选中配置、当前运行（含日志回放，`run_output` 对活运行与历史记录均可回放；记录已滚出历史则回落空控制台）、自动滚动开关、配置栏折叠态。
- 状态变更（选择/切换/开关/侧栏/增删改配置）500ms 防抖保存；恢复期间不回写。

## hba-uigen

- 复用既有 `uigen_canvas_save / uigen_canvas_get`（`layoutJson` 本就是自由 JSON，落盘 `<workspace>/.hba/uigen/canvas-layout.json`）。
- 布局记录扩展 `ui` 字段：`{ versionId, selectedScreenId, format, prompt }`（当前版本、选中屏、卡片格式页签、需求草稿）；画布布局（zoom/grid/viewport/侧栏/卡片位）沿用原实现。
- 启动恢复：先恢复布局，再异步载入 `ui.versionId` 的版本内容并按 `selectedScreenId` 选中；恢复不清卡片布局（`state.cards` 就是这张画布的）。版本已被删除时维持空画布。
- 保存触发点复用既有防抖（800ms）：选屏、格式切换、版本载入、生成、拖拽、缩放等；需求草稿输入也进防抖。

## 并发说明

同项目两个面板实例同时打开时不做实时镜像（避免互相覆盖视图态）；以最后一次写入为准，各自重开面板时恢复到共享状态。实现上有防抖+「读回远端状态前不覆盖」（uigen `layoutLoaded` 门）保护。

## 部署与验证

- 热部署（重要教训，2026-10-28 实测）：内置插件的缓存
  `C:\Users\<user>\.zcode\cli\plugins\cache\zcode-plugins-official\hba-run\0.1.0\`
  与 `hba-uigen\0.1.1\` 会被 ZCode 启动时的**重新播种**从安装目录种子
  `D:\ZCode\resources\glm\packages\hba-run-plugin|/hba-uigen-plugin\` 整目录覆盖
  （实测 17:39 一次重启即回滚了缓存改动，旧种子缺 `export main()` 会直接让 server 秒退）。
  **因此换代码必须种子源+缓存两处一起替换**，只动缓存会在下次重启被回滚；
  只动种子源则要等下次重启才生效。两处都**不要**动 `plugin.json`/`package.json`/`.zcode-plugin-seed.json`，
  缓存版本目录名必须保持 0.1.0 / 0.1.1。种子源更新后，下次启动会按新种子重播种一次缓存（内容相同，自愈）。
- 生效条件：**重启 ZCode**（`run_ui_state` 工具在 server 进程里；server 进程随应用/工作区连接池常驻）。
  面板 HTML 是面板每次打开时从磁盘读的，但工具是旧进程就没有。
- 本次旧文件备份在 `dist/cache-backup-20261028/`。
- 验证步骤：同一项目下会话 A 打开运行面板 → 选中某配置、收起配置栏、关掉自动滚动、跑一个任务并选中它的输出 → 切到会话 B（或新开窗口）再打开运行面板 → 应原样看到上述状态与日志。uigen 面板同理：排好画布、选中版本与屏幕、切到 JSX、写一半需求草稿 → 换会话打开 → 全部恢复。

## 测试

- `node --test tests/run/test-server.mjs`：12/12（新增 `run_ui_state` 落盘/覆盖/非法参数用例）。
- `node --test tests/uigen/test-server.mjs`：11/11（canvas 持久化用例覆盖扩展后的自由 JSON）。
