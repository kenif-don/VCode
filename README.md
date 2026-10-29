# hba-on-zcode — HBA 迁移 ZCode 底座第一期交付仓库

本仓库是 HBA(AI Agent 桌面驾驶舱)迁移至 ZCode 底座第一期的交付物集合。整体策略为 **Fork ZCode 白标 + 插件化**:核心层少改、差异全进插件层,HBA 的 Python 资产经 MCP sidecar 保留。第一期范围为五项工作:FR-1 六个子智能体、FR-2 UI 原型面板、FR-3 Git 面板(采用内置 + 补差异)、FR-4 运行面板、FR-5 终端整合;PRD 总量 16 人周,2 人配置约 7~8 周,M0 POC 设 Go/No-Go 门禁。当前(2026-10-28 第一批开发)已落盘:六个智能体定义(FR-1)、hba-uigen 与 hba-run 两个面板插件(FR-2 / FR-4)、UI 生成 Python sidecar 及配套自动化测试,全部零外部依赖(Node 内置模块 / Python 标准库)。

## 目录结构

| 路径 | 说明 |
|---|---|
| `agents/` | FR-1 六个子智能体定义(ZCode Markdown + frontmatter 格式):`coder.md`、`reviewer.md`、`architect.md`、`planner.md`、`browser-tester.md`、`ui-prototype.md` |
| `docs/fr1-agents.md` | FR-1 迁移映射、字段映射表、与 HBA 原文差异点、遗留事项 |
| `docs/migration-guide.md` | 部署迁移指南(智能体/插件/sidecar 安装、数据位置、白标构建、回滚) |
| `docs/batch-report-2026-10-28.md` | 第一批开发报告(WBS W0-W7 对照、测试结果、关键决策、遗留) |
| `plugins/hba-uigen/` | FR-2 UI 原型面板插件(需求生成多屏原型、画布、390px 预览、演示、版本、导入/导出) |
| `plugins/hba-uigen/.zcode-plugin/plugin.json` | 插件清单(mcpServers + ui.surfaces) |
| `plugins/hba-uigen/server.mjs` | 手写 MCP stdio server(5 工具、3 资源,零依赖) |
| `plugins/hba-uigen/ui/panel.html` | 单文件面板(内联桥适配层,独立降级可跑) |
| `plugins/hba-uigen/ui/bridge.js` | 面板 ↔ 宿主 MCP 桥适配层(独立文件,亦作为资源提供) |
| `plugins/hba-uigen/README.md` | 架构、桥协议发现记录、HBA ui_gen 复用边界、环境变量、遗留事项 |
| `plugins/hba-run/` | FR-4 运行面板插件(运行配置、一键运行/停止、输出流、任务历史、预览联动) |
| `plugins/hba-run/.zcode-plugin/plugin.json` | 插件清单(mcpServers + ui.surfaces) |
| `plugins/hba-run/server.mjs` | 手写 MCP stdio server(9 工具、2 资源,含跨平台进程管理) |
| `plugins/hba-run/ui/panel.html` | 单文件面板(配置列表/表单、输出控制台、历史表、预览按钮) |
| `plugins/hba-run/README.md` | 架构、run.json schema、桥协议结论、Windows 进程树终止方案、遗留事项 |
| `sidecar/uigen_sidecar.py` | UI 生成 Python 适配器(标准库零依赖;优先复用 HBA prompts,失败降级演示生成器) |
| `tests/agents/validate-agents.mjs` | FR-1 智能体定义校验器(139 项断言,零依赖) |
| `tests/uigen/test-server.mjs` | hba-uigen MCP server 集成测试(node:test,10 项) |
| `tests/uigen/test_sidecar.py` | sidecar 端到端测试(7 项,直跑 / pytest 双形态) |
| `tests/run/test-server.mjs` | hba-run MCP server 集成测试(node:test,11 项,真实 spawn) |
| `scripts/poc/` | W0 POC 脚手架:500 轮会话夹具、消息列表性能测量、杀进程稳定性驱动(均实测通过) |
| `e2e/` | Playwright 端到端骨架(7 specs 覆盖六条主路径,待宿主运行) |
| `fork/` | 白标 Fork 工作流、上游补丁(fr3/fr5 共 4 个)与验证报告(基线 zai-org/ZCode@3c5b227, v3.16.2) |

## 工作项(FR)状态一览

| FR | 内容 | 状态 | 依据与备注 |
|---|---|---|---|
| FR-1 | 六个子智能体迁移 | **已完成** | `agents/` 6 个定义 + 校验器 139 项断言全绿 + `docs/fr1-agents.md`;`model` 为部署占位符,安装时替换 |
| FR-2 | UI 原型面板 | **进行中** | `plugins/hba-uigen/` + `sidecar/` 全部落盘,测试 10/10、7/7,FR-2-1~8 均有落点;待真实 LLM 生成接线与宿主内集成校验(P0) |
| FR-3 | Git 面板 | **补丁就绪** | 采用内置 Git 面板 + 补差异;`fork/patches/fr3-01/02`(worktree 创建服务 + GitPane 入口)已应用至上游源码并通过 typecheck(0 错误),见 `fork/patch-verify-report.md`;待宿主 GUI 黑盒 |
| FR-4 | 运行面板 | **进行中** | `plugins/hba-run/` 全部落盘,测试 11/11,FR-4-1~5 均有落点;待宿主内集成校验(P0) |
| FR-5 | 终端整合 | **补丁就绪** | 入口收敛核心层小改;`fork/patches/fr5-01/02`(移除顶部按钮 + 底部打开右侧终端)已应用并通过 typecheck,见 `fork/patch-verify-report.md`;待宿主 GUI 黑盒(TC-TRM-01) |

## 快速开始

环境要求:Node.js 18+(用到内置 `node:test`)与 Python 3(仅标准库,无需 pip 安装任何依赖)。以下命令均在仓库根目录 `hba-on-zcode/` 下执行,**已于 2026-10-28 逐条实测通过**:

```bash
# FR-1 智能体定义校验:139 项断言,退出码 0 = 全绿(1 = 有失败)
node tests/agents/validate-agents.mjs

# FR-2 hba-uigen MCP server 集成测试:node:test 10/10
node --test tests/uigen/test-server.mjs

# FR-2 Python sidecar 端到端测试:7/7(等价形式: python -m pytest tests/uigen/test_sidecar.py)
python tests/uigen/test_sidecar.py

# FR-4 hba-run MCP server 集成测试:node:test 11/11(真实 spawn 子进程,约 6 秒)
node --test tests/run/test-server.mjs
```

最近一次全量实测结果(2026-10-28):**139/139 断言、10/10、7/7、11/11 全部通过,无失败**。

单独运行组件(详见各插件 README):

```bash
# hba-uigen MCP server(stdio,换行分隔 JSON-RPC 2.0)
node plugins/hba-uigen/server.mjs

# Python sidecar 生成一次原型(默认写 <cwd>/.hba/uigen,可用 UIGEN_STORE_DIR 改)
python sidecar/uigen_sidecar.py generate '{"prompt":"借阅 App","format":"html","screenCount":3}'

# hba-run MCP server(stdio)
node plugins/hba-run/server.mjs
```

安装与部署(把智能体和插件装进 ZCode、sidecar 环境变量、数据位置、白标与回滚)见 [`docs/migration-guide.md`](docs/migration-guide.md)。

## 开发规范

1. **零依赖约束**:插件 server 与全部测试只用 Node 内置模块;sidecar 与其测试只用 Python 标准库;不引入任何 npm / pip 依赖。依赖 HBA 外部栈(fastapi/sqlmodel/LLM provider)的能力不直接迁移,经 sidecar 外挂或降级(见 `plugins/hba-uigen/README.md` 的复用边界)。
2. **目录归属**:
   - `agents/` 只放 ZCode 子智能体定义;`name` 仅字母/数字/连字符,与文件名一致,不占用内置名(`Explore`、`general-purpose`)。
   - `plugins/<name>/` 一插件一目录:清单固定 `.zcode-plugin/plugin.json`,服务端入口 `server.mjs`,面板资源在 `ui/`;插件自带 README 记录架构、协议结论与遗留。
   - `sidecar/` 放 Python 适配器;`tests/` 按 FR 分目录(`tests/agents/`、`tests/uigen/`、`tests/run/`),新测试只放 `tests/` 或 `e2e/` 下。
3. **业务数据不进仓库**:运行配置与历史(`.hba/run.json`)、UI 原型版本(`.hba/uigen/`)写工作区数据目录,与 ZCode 自身会话库分离。
4. **测试纪律**:提交前跑对应测试套件,失败即修复,不允许带病提交;禁止修改已有断言让测试变绿(与 `agents/coder.md`、`agents/reviewer.md` 正文的验证纪律一致)。
5. **文档即事实**:README / 文档中引用的文件名、测试数字、命令必须与仓库实际内容一致,新增交付物同步更新目录结构表与状态表。

## 文档索引

| 文档 | 内容 |
|---|---|
| [`docs/fr1-agents.md`](docs/fr1-agents.md) | FR-1 字段映射、六个智能体一览、与 HBA 原文差异点、遗留事项 |
| [`docs/migration-guide.md`](docs/migration-guide.md) | 部署迁移指南 |
| [`docs/batch-report-2026-10-28.md`](docs/batch-report-2026-10-28.md) | 开发收口报告(WBS 进度、测试数字、关键决策、遗留) |
| [`docs/testing-plan.md`](docs/testing-plan.md) | 测试策略、20 条 TC 映射、发布门禁 |
| [`docs/fr3-git-worktree-plan.md`](docs/fr3-git-worktree-plan.md) | FR-3 worktree 入口改动方案 |
| [`docs/fr5-terminal-patch.md`](docs/fr5-terminal-patch.md) | FR-5 终端入口收敛改动方案 |
| [`fork/README.md`](fork/README.md) | 白标 Fork 工作流(基线锁定、构建、rebase) |
| [`fork/patch-verify-report.md`](fork/patch-verify-report.md) | 补丁应用/typecheck/打包验证记录 |
| [`plugins/hba-uigen/README.md`](plugins/hba-uigen/README.md) | FR-2 架构、桥协议发现记录、HBA ui_gen 复用边界 |
| [`plugins/hba-run/README.md`](plugins/hba-run/README.md) | FR-4 架构、run.json schema、Windows 进程树终止方案 |
