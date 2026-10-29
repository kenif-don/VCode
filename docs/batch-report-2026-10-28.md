# 第一批开发报告(2026-10-28)

HBA→ZCode 迁移第一期开发收口报告(2026-10-28,分四批执行:三路并行开发批 FR-1/FR-2/FR-4、三路并行批 POC/文档/Fork 方案、补丁验证批)。范围:以 `hba-on-zcode/` 仓库落盘内容为准,对照 PRD(HBA迁移ZCode底座PRD-v1.0)工作量分解 W0-W7 逐项核对;测试数字均为收尾全量回归实测(2026-10-28,全部命令在仓库根目录执行)。

## 进度总表(WBS 对照)

| WBS | 工作项(PRD 9.1) | 人周 | 状态 | 本批要点 |
|---|---|---|---|---|
| W0 | 基线与 POC(Fork 白标构建、CI、插件脚手架、稳定性/性能 POC) | 2.0 | **基本完成** | 源码基线 zai-org/ZCode@3c5b227(v3.16.2)已获取;`fork/README.md` 白标工作流;4 补丁应用 + typecheck 全绿 + win-x64 安装包打出;POC 脚手架落盘实测(fixtures 19/19、perf PASS、stability dry-run 10/10);M0 Go/No-Go 对真实 zcode 进程的实测仍待执行 |
| W1 | FR-1 子智能体 | 1.5 | **已完成** | 6 个定义 + 校验器 139/0 全绿 + `docs/fr1-agents.md` |
| W2 | FR-2 UI 原型面板 | 4.0 | **进行中** | hba-uigen 插件 + sidecar 全落盘;node:test 10/10、sidecar 7/7;FR-2-1~8 均有落点;待真实 LLM 生成接线与宿主内集成校验(P0) |
| W3 | FR-3 Git 面板 | 1.0 | **补丁就绪** | `fork/patches/fr3-01/02`(worktree 创建服务 + GitPane 入口,+396 行)已 `git apply` 零冲突、typecheck 0 错误;待宿主 GUI 黑盒(TC-GIT 系列) |
| W4 | FR-4 运行面板 | 2.0 | **进行中** | hba-run 插件全落盘;node:test 11/11;FR-4-1~5 均有落点;待宿主内集成校验(P0) |
| W5 | FR-5 终端整合 | 0.5 | **补丁就绪** | `fork/patches/fr5-01/02`(移除顶部按钮 + 底部打开右侧终端,+162/−10 行)已 `git apply` 零冲突、typecheck 0 错误;待宿主 GUI 黑盒(TC-TRM-01) |
| W6 | 测试与验收 | 2.5 | 进行中 | 4 套测试(28 用例 + 139 断言)全绿 ×2 轮冒烟;POC 3 脚本实测;e2e Playwright 骨架 7 specs 落盘;`docs/testing-plan.md` 20 条 TC 映射(8 已自动化/9 待宿主/3 待源码);E2E 实跑、GUI 黑盒、视觉走查待宿主 |
| W7 | 集成与发布 | 1.0 | 进行中 | `README.md`、`docs/migration-guide.md`、本报告、`fork/README.md`、`fork/patch-verify-report.md`;win-x64 安装包(ZCode-3.16.2-win-x64.exe,155.8MiB)已打出;白标替换(名称/图标/NOTICE/去商标)与签名未做 |

(对照 PRD 9.1:W0-W7 合计 14.5 人周,另有 W8 风险缓冲 1.5 人周,总量 16.0 人周;里程碑对应 M0=W0、M1=W1、M2=W2/W5、M3=W3/W4、M4=W6/W7。)

---

## W0 基线与 POC(2.0 人周)— 基本完成

- **交付物**:
  - **源码基线**:zai-org/ZCode@`3c5b227`(v3.16.2,Apache-2.0,tarball 93MB 获取并解压)——源码副本在系统临时目录,补丁在 `fork/patches/` 长期保存;
  - `fork/README.md`(白标 Fork 工作流:基线锁定、构建命令 `pnpm run bundle:desktop`、白标改造 6 项、季度 rebase);
  - `fork/patch-verify-report.md`(补丁应用/typecheck/打包验证记录,含复现步骤与 md5);
  - `scripts/poc/session-fixtures.mjs`、`msg-list-perf.mjs`、`stability-poc.mjs` + 500 轮夹具(1542 条消息/1.64MB)+ `sample-report.json`。
- **测试结果**(实测):夹具生成自检 **19/19 PASS**(负向验证篡改后正确报错);消息列表性能 **full-load P50=6.97ms/P95=8.67ms,PASS**(≤2000ms 判定线);稳定性驱动器 dry-run **10/10 成功率 100%**(负向验证 FAIL 判定正确);补丁应用 **4/4 零 fuzz**、`pnpm run typecheck` **0 错误**(含注入错误的反向验证)、`bundle:desktop --os win --arch x64` **全链路成功**(ZCode-3.16.2-win-x64.exe,155.8 MiB)。
- **关键决策**(PRD 2.3 / 5.1 / 9.4,已确认沿用):底座选定 ZCode(Apache-2.0,Fork 白标 + 插件化,核心少改、差异全进插件层);M0 第 1 周末设 Go/No-Go 门禁——会话恢复成功率 ≥99%(100 次杀进程重启)且 500 轮消息会话打开 ≤2 秒为 Go,否则整体切换 deepseek-harness 内核替换路线(工期重估 +2~4 周)。
- **遗留与下一步**:对真实 zcode 进程执行 M0 Go/No-Go 实测(`stability-poc.mjs --cmd` × 100、宿主端消息加载计时);白标替换与签名;CI 流水线。

## W1 FR-1 子智能体(1.5 人周)— 已完成

- **交付物**:
  - `agents/coder.md`、`reviewer.md`、`architect.md`、`planner.md`、`browser-tester.md`、`ui-prototype.md`(6 个 ZCode 子智能体定义,frontmatter + 系统提示词正文);
  - `tests/agents/validate-agents.mjs`(定义校验器,零依赖);
  - `docs/fr1-agents.md`(字段映射表、六个智能体一览、与 HBA 原文差异点、遗留事项)。
- **测试结果**:`node tests/agents/validate-agents.mjs` → **139 项通过 / 0 项失败(全绿)**,含 HBA 原文正文逐字节保真比对(`HBA\seed\agents\` 可读时启用)与 `thinking_level` 交叉核对。本批收尾(2026-10-28)实测与 `docs/fr1-agents.md` 记录的 2026-10-27 结果一致。
- **关键决策**(摘自 `docs/fr1-agents.md`):
  1. **改名**:`browser_tester` → `browser-tester`、`ui-gen-assistant` → `ui-prototype`(ZCode name 仅允许字母/数字/连字符且与文件名一致);其余 4 个 name 原样。
  2. **frontmatter 重构**:删除 `role`;新增 `description`(取 HBA 内置描述原文)、`color`、`permissionMode`(全部 default)、`maxTurns`(按角色工作量 30~80)、`background: false`(对齐 HBA lead→member 委派-回报模型);`model` 占位文本改为 `【provider:model,按部署环境填写】`。
  3. **正文结构**:新增「角色与工具边界」一节(角色/工具/行为边界,摘录自 `HBA\app\agent\builtin_prompts.py` 内置指令),HBA 原文件正文(含内置指令注释)逐字保留——coder 的「失败可见性优先于不报错」「任务分级与验证强度」、reviewer 的「审查失败可见性」「复审强度分级」、planner 的「验收标准必须包含失败行为」均原样迁移。
  4. **tools 白名单按 FR-1 任务书直移**:reviewer/architect/planner 为只读集合并在正文声明只读约束;HBA 后端专有工具(`codegraph_*`/`ssh_*`/`evidence_*`/`browser_*`/`edit_screen`/`review_screen`)不迁移。
  5. **`thinking_level` 原值直移**(low×5、medium×1,未上调,保持 HBA 行为基线)。
- **遗留与下一步**:
  - **model 占位部署时必须替换**(占位符无法解析为可用模型);`thoughtLevel` 随模型档位可校准;
  - HBA 内置提示词只摘录要点(Test discipline 全文、输出格式全文、browser 会话生命周期、ui-gen 整套生成/批量一致性/引用判定等未逐字迁移,且大量规则绑定 HBA 专有工具);
  - 编排层(`master` 群组委派)与 `explorer`/`debater`/`test_platform` 不在 FR-1 范围;
  - FR-1-2~1-5(派发/并行/权限强制/档位覆盖)属宿主行为,待宿主内验证(TC-AGT 系列)。

## W2 FR-2 UI 原型面板(4.0 人周)— 进行中

- **交付物**:
  - `plugins/hba-uigen/.zcode-plugin/plugin.json`(清单:mcpServers.hba-uigen + ui.surfaces);
  - `plugins/hba-uigen/server.mjs`(752 行,手写 MCP stdio server:5 工具 `uigen_generate` / `uigen_list_versions` / `uigen_get_version` / `uigen_export` / `uigen_import_dir`,3 资源 `ui://hba-uigen/{panel.html,bridge.js,state.json}`,进度与消息通知);
  - `plugins/hba-uigen/ui/panel.html`(1043 行,单文件面板:多屏画布、热点叠加、390×844 iframe 预览、演示播放栏、产物切换)、`ui/bridge.js`(365 行,面板↔宿主 MCP 桥适配层);
  - `sidecar/uigen_sidecar.py`(541 行,Python 标准库适配器,子命令 generate/list_versions/get_version/export/import_dir);
  - `tests/uigen/test-server.mjs`、`tests/uigen/test_sidecar.py`;
  - `plugins/hba-uigen/README.md`(架构、桥协议发现记录、HBA ui_gen 复用边界、环境变量表)。
  - 功能落点对照(README 内 FR-2-1~8 表):需求生成(P0)、多屏画布/缩放/热点(P0)、HTML/JSX/Vue 三产物(P0)、390px 手机预览(P0)、演示播放(P0)、本地目录导入(P1)、历史版本(P1)、导出含 manifest(P1)——8 项均落点。
- **测试结果**:
  - `node --test tests/uigen/test-server.mjs` → **10/10 通过**(握手、5 工具 schema、生成 + progress 通知、版本列表、完整产物、导出落盘、目录导入、面板资源 mcp-app 读取、state.json 订阅推送、未知方法/工具错误);
  - `python tests/uigen/test_sidecar.py` → **7/7 通过**(生成演示模式、必填校验、版本列表、版本读取、导出、目录导入、argv JSON 形式;`python -m pytest tests/uigen/test_sidecar.py` 同为 7 passed)。
- **关键决策**(摘自 `plugins/hba-uigen/README.md`):
  1. **桥协议结论**(解剖官方 pdf-plugin 与 app.asar 反推):面板是完整 **MCP client 而非自定义 RPC**——JSON-RPC 2.0 信封经 `window.parent.postMessage(msg, "*")` + `window "message"` 事件原样收发;握手为 `initialize` → `notifications/initialized` → 自定义 `ui/initialize { appInfo, appCapabilities, protocolVersion }`;面板资源经 `resources/read` 提供,URI 形如 `ui://<server>/<path>`,MIME 为 `text/html;profile=mcp-app`。`ui/bridge.js` 据此实现 `callTool` / `onResourceUpdate` / `onProgress` / `connect`;握手超时(2.5s)或 `window.parent === window` 时降级 standalone 本地演示后端,面板功能不受影响。
  2. **sidecar 优先 + 内置演示生成器降级**:`uigen_generate` 先拉起 Python sidecar,sidecar 不可用(python 缺失/超时/崩溃)回退 server.mjs 内置演示生成器,两者行为一致(同屏幕命名表、同卡片文案、同热点几何 y=774/h=70、同产物模板结构),保证端到端可跑;store 布局在 server 与 sidecar 间共享(`UIGEN_STORE_DIR` 穿透子进程)。
  3. **HBA ui_gen 复用边界**:只复用 `prompts/` 三个 `SYSTEM_PROMPT` 纯字符串模块(sidecar 在 `HBA_ROOT` 可用时 import,回传 `engine:"demo+hba-prompts"` 含 `MOBILE_WIDTH=390`);`model_bridge.py` LLM 生成、WS 协议、SQLModel 存储、`diff_apply.py` 依赖 fastapi/sqlmodel 等外部栈,**不复用**,超出零依赖约束。
- **遗留与下一步(P0)**:
  - **真实 LLM 生成接线**:在 sidecar `cmd_generate` 内把 `demo_generate(...)` 替换为 HBA `UiGenModelBridge.stream_generate` 调用(接口返回结构不变),需外挂依赖环境;
  - **宿主内集成校验**:`ui/initialize` 的 `appCapabilities` schema、宿主对 `tools/call` 的路由、`notifications/progress` 的 `progressToken` 透传、资源订阅推送,4 条需在真实 ZCode 宿主联测;
  - 打包形态:sidecar 拷入插件目录或用 `UIGEN_SIDECAR` 指定;
  - 已知收敛:导入仅认 `*.html`(JSX/Vue 导入为占位包装)、演示播放定速 2.2s/屏、appTools/pin/followUp 未接。

## W3 FR-3 Git 面板(1.0 人周)— 补丁就绪

- **方案**(PRD 6.3,已确认):采用 ZCode 内置 Git 面板(产品名"审查",已具备暂存/未暂存/未跟踪/冲突分组、差异视图、文件树、提交对话框含 AI 生成提交信息、提交图谱、分支切换与推送),仅补齐与 HBA 的差异;备选自研插件复刻 HBA 界面,仅当体验验收不通过时启用。
- **交付物**:`fork/patches/fr3-01-git-worktree-create-service.patch`(服务层 `IGitService.createWorktree` + `gitCliRepo` 实现)、`fork/patches/fr3-02-gitpane-worktree-entry.patch`(GitPane 入口按钮 + `GitWorktreeDialog` + 创建后以 `targetWorkspace` 打开新会话);方案文档 `docs/fr3-git-worktree-plan.md`(改动点 10 文件、命名规则 `<repoRoot>/.hba/worktrees/<name>` / 分支 `hba/<name>`)。
- **测试结果**:4 补丁叠加 `git apply --check` 通过、应用零冲突;`pnpm run typecheck` 全量 **0 错误**(tsc -b 覆盖 14 项目,含 packages/shared、packages/services、packages/ui 与 desktop)。
- **遗留与下一步**:宿主 GUI 黑盒跑 TC-GIT-01/02;`.hba/worktrees/` 的 git exclude 处理、worktree 清理入口(本期不做)、分支前缀 `hba/` 待产品确认;FR-3-3 千文件刷新性能实测。

## W4 FR-4 运行面板(2.0 人周)— 进行中

- **交付物**:
  - `plugins/hba-run/.zcode-plugin/plugin.json`(清单:mcpServers.run + ui.surfaces);
  - `plugins/hba-run/server.mjs`(900 行,手写 MCP stdio server + 运行管理器:9 工具 `run_config_list/save/delete/duplicate`、`run_start/stop/status/output`、`run_history`,2 资源 `ui://run/panel.html`、`ui://run/state`);
  - `plugins/hba-run/ui/panel.html`(815 行,单文件面板:配置列表 + 表单、运行/停止、输出控制台、任务历史表、预览按钮);
  - `tests/run/test-server.mjs`(539 行);
  - `plugins/hba-run/README.md`(架构、`.hba/run.json` schema、桥协议结论、Windows 进程树终止方案)。
  - 功能落点对照(FR-4-1~5):配置管理、一键运行/停止 + 实时输出、任务历史、预览联动、`.hba/run.json` 跨会话持久化——5 项均落点。
- **测试结果**:`node --test tests/run/test-server.mjs` → **11/11 通过**(握手与工具/资源清单、panel.html 资源读取、配置 CRUD + run.json 落盘、run_start 真实长跑 + run_output 游标 + run_stop 进程树终止校验、环境变量透传、自然退出/失败退出状态机、并发多 run、run_history 含历史输出回读、state 资源与订阅通知、工具校验错误)。其中进程树终止为真实校验:被运行命令先打印自身 `PID=<inner>`,`run_stop` 后断言该 pid 已不存在(`process.kill(pid,0)` 抛 ESRCH)。
- **关键决策**(摘自 `plugins/hba-run/README.md`):
  1. **Windows 进程树终止方案**:`spawn(command, { shell: true })` 的直接子进程是 `cmd.exe`,而 **`child.kill()` 在 Windows 只终止 cmd.exe 本身(TerminateProcess),孙进程存活且会触发 `exit` 事件提前结束状态机**——因此停止路径不用 `child.kill()`,而是:优雅期 `taskkill /pid <shellPid> /T`(向树内各进程发 WM_CLOSE)→ 超时(默认 2s,`run_stop` 的 `timeoutMs` 可调)后 `taskkill /pid <shellPid> /T /F` 整树强杀(按父子关系枚举,不依赖根进程存活)→ taskkill 本身失败才回退 `child.kill("SIGKILL")` 兜底。POSIX 路径:`detached: true` 独立进程组,`process.kill(-pid, "SIGTERM")` → 超时 `SIGKILL`。
  2. **桥协议结论**(与 hba-uigen 同源,反推自官方 pdf-plugin):JSON-RPC 2.0 经 `window.parent.postMessage` 原样收发;握手 `initialize`(`protocolVersion: "2025-06-18"`)→ `notifications/initialized` → `ui/notifications/initialized`;工具带 `_meta.ui = { resourceUri, surface, visibility }`,visibility 同时为 `"model"`(Agent 可调)与 `"app"`(面板可调);服务端以 `notifications/resources/updated { uri }` 推送更新;面板可发 `ui/notifications/size-changed`。Bridge 适配层集中封装于 panel.html,便于集成期一处替换。
  3. **输出与持久化设计**:每 run 独立环形缓冲 2000 行(seq 游标,`run_output` 按 `seq > since` 拉取,活运行与历史均可用);历史入库每条最多 500 行、共 50 条;写盘为临时文件 + rename 原子替换;状态机 `running / exited / failed`,`stopped: true` 区分用户主动停止。
- **遗留与下一步(P0)**:
  - **宿主内集成校验**:initialize 结果扩展字段(hostCapabilities 等)是否必需回传、`notifications/resources/updated` 是否要求先 subscribe 才转发、`ui/notifications/size-changed` / `request-teardown` 行为、iframe `window.open` 打开预览是否被宿主沙箱允许,4 条待联测;
  - 进程树强杀完备性:极端场景(优雅期枚举树的同时根进程自行退出)可能遗留孙进程,彻底方案可引入 Job Object 兜底;
  - 已知收敛:历史输出为截尾快照(完整日志可后续落盘 `.hba/logs/<runId>.log`)、`cwd` 不存在时 spawn 失败记 `failed` 但面板未预校验。

## W5 FR-5 终端整合(0.5 人周)— 补丁就绪

- **内容**(PRD 6.5):入口收敛,属核心层小改——FR-5-1 移除顶部栏终端按钮、FR-5-2 底部新增打开终端按钮(点击在右侧面板打开终端页签,再次点击聚焦已有终端)、FR-5-3 保留快捷键/多标签/复制粘贴/右键菜单。
- **交付物**:`fork/patches/fr5-01-remove-topbar-terminal-button.patch`(移除 `WorkspaceHeaderActionSection` 顶部按钮)、`fork/patches/fr5-02-bottom-open-terminal-button.patch`(新增 `terminalEntryStore` + `WorkspaceOpenTerminalButton` 挂 composer 底部 + `handleOpenOrFocusTerminalTab` 聚焦/新建逻辑);方案文档 `docs/fr5-terminal-patch.md`(改动 6 文件/新增 3 文件)。
- **测试结果**:同 W3——应用零冲突、typecheck **0 错误**(反向验证注入 TS2322 被 tsc 如期捕获,证明非缓存假绿)。
- **遗留与下一步**:宿主 GUI 黑盒跑 TC-TRM-01;按钮落点(composer 左下)与多终端聚焦策略待产品确认;Windows 标题栏菜单/quickpick 的 `toggle-terminal` 是否同步收敛待定。

## W6 测试与验收(2.5 人周)— 进行中

- **本批测试资产汇总**(全部实测通过,2026-10-28):

| 套件 | 命令 | 结果 | 覆盖 |
|---|---|---|---|
| FR-1 定义校验 | `node tests/agents/validate-agents.mjs` | 139/0 全绿 | 文件齐全、frontmatter、name/tools/thoughtLevel/color 等白名单、HBA 原文逐字节保真 |
| FR-2 server 集成 | `node --test tests/uigen/test-server.mjs` | 10/10 | MCP 契约:握手、5 工具、3 资源、进度通知、订阅、错误路径 |
| FR-2 sidecar 端到端 | `python tests/uigen/test_sidecar.py` | 7/7 | 生成/版本/导出/导入/store 布局/CLI 形态(演示模式) |
| FR-4 server 集成 | `node --test tests/run/test-server.mjs` | 11/11 | MCP 契约 + 真实进程管理(spawn/输出/进程树终止/状态机/并发/持久化) |

- **关键决策**:受零依赖约束,Node 侧测试用内置 `node:test`(非 PRD 8.1 提到的 vitest),Python 侧为直跑断言脚本并兼容 pytest 双形态;集成测试真实 spawn `server.mjs` 走 JSON-RPC,不在进程内 mock。测试临时目录建于系统 temp,结束清理(Windows 下 rm 带重试)。
- **POC 与 E2E 资产**(第二批落盘):`scripts/poc/` 三脚本已实测(见 W0);`e2e/` Playwright 配置 + 7 个 spec(agents/ui-proto/run-panel/terminal/git-panel/perf/stability,覆盖六条主路径,TC 编号与 data-testid 契约已冻结于 `e2e/support/testids.ts`);`docs/testing-plan.md` 完成 20 条 TC 映射(已自动化可跑 8 / 待宿主集成 9 / 待源码 3)。
- **遗留与下一步**:E2E 实跑(需 `zcode --web` + 安装 @playwright/test)、GUI 黑盒、视觉走查、TC-STB-01 对真实进程 100 次实测、宿主端 TC-PERF 复测均待宿主就位。

## W7 集成与发布(1.0 人周)— 进行中

- **本批交付**:`README.md`(项目定位、目录结构、FR 状态、快速开始、开发规范)、`docs/migration-guide.md`(智能体/插件/sidecar 安装、数据位置、白标注意、回滚)、`docs/batch-report-2026-10-28.md`(本报告)、`fork/README.md`、`fork/patch-verify-report.md`;win-x64 安装包已打出(`ZCode-3.16.2-win-x64.exe`,155.8 MiB,位于系统临时目录源码树 out/)。
- **测试结果**:随文档交付复核全部 4 套测试命令有效性(见 W6 汇总表,全绿)。
- **遗留与下一步**:白标替换(应用名/图标/默认模型)、Apache-2.0 NOTICE 保留与去商标检查、第三方许可证清单、macOS 打包、签名、发布门禁核对(PRD 8.8)。

---

## P0 遗留汇总(下一批必做)

1. **宿主内集成校验**:hba-uigen 桥协议 4 条(`ui/initialize` 参数 schema、`tools/call` 路由、`progressToken` 透传、资源订阅推送)与 hba-run 联测 4 条(initialize 扩展字段、订阅转发前提、size-changed/request-teardown、预览弹窗沙箱),在真实 ZCode 宿主逐条联测;两插件 Bridge 均已做降级,协议差异不会白屏,校验不通过时仅替换 Bridge 代码块。
2. **真实 LLM 生成接线**:sidecar `cmd_generate` 内以 HBA `UiGenModelBridge.stream_generate` 替换演示生成器(接口返回结构不变),需为 sidecar 外挂依赖环境;未接线前 FR-2 生成为结构完整的演示产物(可预览/播放/导出)。
3. **补丁落地后的宿主验收**:FR-3/FR-5 四个补丁已应用并通过 typecheck(见 `fork/patch-verify-report.md`),下一步在白标构建的宿主上跑 TC-GIT/TC-TRM GUI 黑盒,并执行 M0 Go/No-Go 实测(会话恢复 ≥99%、500 轮消息打开 ≤2s,用 `scripts/poc/stability-poc.mjs --cmd` 与宿主端性能计时)。
