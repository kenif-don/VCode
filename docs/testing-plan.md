# HBA→ZCode 迁移测试计划(W0/W6)

被测系统:ZCode 桌面端(Web 模式 `zcode --web`,Playwright 可驱动)。
第一期功能:FR-1 六子智能体(`agents/`)、FR-2 UI 原型面板(`plugins/hba-uigen/`)、
FR-3 Git 面板(源码未落地)、FR-4 运行面板(`plugins/hba-run/`)、FR-5 终端整合(宿主侧,源码未落地)。

本文件为测试策略总纲:TC 映射表、测试金字塔、性能/稳定性基准、Agent 驱动验收七步流程、发布门禁。
执行型自动化在 `tests/`(node:test / pytest)、`scripts/poc/`(POC 脚本)、`e2e/`(Playwright 骨架)。

## 0. 状态口径

| 状态 | 含义 |
|---|---|
| **已自动化可跑** | 存在当前环境可执行、覆盖 TC 核心通过标准的自动化,且已实测绿(GUI 残余断言另有 e2e 骨架并在备注注明) |
| **待宿主集成** | 自动化骨架完整,但核心判定依赖 `zcode --web` 宿主或插件面板挂 data-testid,当前无实测结果 |
| **待源码** | 依赖尚未落地的功能源码(FR-3 Git 面板、FR-5 终端整合宿主侧),e2e 骨架按接口契约预写,源码就位后即可接线 |

## 1. 测试策略映射表(TC → 自动化方式 → 文件 → 状态)

| TC 编号 | 级别 | 标题(通过标准) | 自动化方式 | 所在文件 | 当前状态 | 备注 |
|---|---|---|---|---|---|---|
| TC-AGT-01 | P0 | 六智能体定义加载与校验(设置页列出 6 项校验通过) | node:test 定义校验器(零依赖) | `tests/agents/validate-agents.mjs` | **已自动化可跑** | 6 定义 frontmatter/tools 白名单/name 合法性全绿;设置页 UI 列出断言在 `e2e/specs/agents.spec.ts`(待宿主) |
| TC-AGT-02 | P0 | 派发与结果回注(子会话产出回注主会话) | Playwright E2E | `e2e/specs/agents.spec.ts` | **待宿主集成** | 步骤/断言完整;依赖宿主子智能体派发与消息流 testid |
| TC-AGT-03 | P1 | 并行子智能体无串扰 | Playwright E2E | `e2e/specs/agents.spec.ts` | **待宿主集成** | 双路派发 + 交叉断言(回注互不包含对方标识) |
| TC-AGT-04 | P0 | 只读智能体写操作被拒 | 静态白名单(node:test)+ Playwright 运行时断言 | `tests/agents/validate-agents.mjs` + `e2e/specs/agents.spec.ts` | **待宿主集成** | reviewer 无 Write/Edit 的静态校验已绿;运行时拒绝行为待宿主 |
| TC-UIP-01 | P0 | 需求生成 HTML 原型(390px 预览渲染正确) | node:test + pytest(MCP/侧车链路) | `tests/uigen/test-server.mjs`、`tests/uigen/test_sidecar.py` | **已自动化可跑** | 生成 HTML 完整文档、`width=390`、热点几何断言全绿;预览 iframe 渲染断言在 `e2e/specs/ui-proto.spec.ts`(待宿主) |
| TC-UIP-02 | P0 | JSX/Vue 产物 | node:test 产物断言 | `tests/uigen/test-server.mjs` | **已自动化可跑** | `.jsx` 含 `export default`、`.vue` 含 `<template>` SFC、导出 3×html/3×jsx/3×vue 全绿 |
| TC-UIP-03 | P1 | 演示播放(顺序/暂停/步进) | Playwright E2E | `e2e/specs/ui-proto.spec.ts` | **待宿主集成** | 播放/暂停/步进三态断言骨架 |
| TC-UIP-04 | P1 | 本地目录导入 | node:test + pytest 导入链路 | `tests/uigen/test-server.mjs`、`tests/uigen/test_sidecar.py` | **已自动化可跑** | `uigen_import_dir` 过滤非 html、屏幕命名、回读产物断言全绿;GUI 导入按钮在 e2e 骨架 |
| TC-UIP-05 | P1 | 历史版本回滚 | 版本数据层(node:test)+ Playwright 回滚动作 | `tests/uigen/test-server.mjs` + `e2e/specs/ui-proto.spec.ts` | **待宿主集成** | `uigen_list_versions`/`uigen_get_version` 已绿;回滚动作与画布恢复待宿主 |
| TC-GIT-01 | P0 | 差异视图与仓库状态一致 | Playwright E2E | `e2e/specs/git-panel.spec.ts` | **待源码** | FR-3 Git 面板源码未落地;状态/差异一致性断言按契约预写 |
| TC-GIT-02 | P1 | worktree 会话创建 | Playwright E2E | `e2e/specs/git-panel.spec.ts` | **待源码** | 同上;创建→新会话→工作目录含 worktree 路径断言 |
| TC-RUN-01 | P0 | 运行配置增删改(持久化重开可见) | node:test MCP 契约 + 磁盘持久化 | `tests/run/test-server.mjs` | **已自动化可跑** | CRUD/复制/删除 + `.hba/run.json` 落盘断言全绿;面板重开可见在 `e2e/specs/run-panel.spec.ts`(待宿主) |
| TC-RUN-02 | P0 | 一键运行与停止(输出实时显示、停止后进程退出) | node:test 进程链路 | `tests/run/test-server.mjs` | **已自动化可跑** | `run_start` 流式输出、`run_output` 游标、`run_stop` 进程树 kill 断言全绿;GUI 按钮/控制台在 e2e 骨架 |
| TC-RUN-03 | P1 | 预览联动 | Playwright E2E | `e2e/specs/run-panel.spec.ts` | **待宿主集成** | popup URL 与 `previewUrl` 一致性断言骨架 |
| TC-TRM-01 | P0 | 终端入口收敛(顶部无终端按钮,底部按钮开右侧终端) | Playwright E2E(含反向断言) | `e2e/specs/terminal.spec.ts` | **待源码** | FR-5 终端整合宿主源码未落地;`toHaveCount(0)` 反向断言 + 右侧面板断言已预写 |
| TC-PERF-01 | P0 | 500 轮会话打开 ≤2s | POC 脚本(合成夹具实测)+ Playwright 端到端 | `scripts/poc/session-fixtures.mjs`、`scripts/poc/msg-list-perf.mjs`、`scripts/poc/sample-report.json` + `e2e/specs/perf.spec.ts` | **已自动化可跑** | POC 口径(合成 500 轮夹具)实测 P95=8.665ms ≤2000ms,PASS;宿主端到端口径在 e2e(待宿主) |
| TC-PERF-02 | P1 | 面板首帧 ≤500ms | Playwright 计时断言 | `e2e/specs/perf.spec.ts` | **待宿主集成** | `Date.now()` 包裹打开→首帧,阈值 500ms 断言骨架 |
| TC-STB-01 | P0 | 杀进程恢复 100 次成功率 ≥99% | POC 驱动器(启动→随机 kill→重启→校验恢复标记) | `scripts/poc/stability-poc.mjs` | **待宿主集成** | 驱动器已自测(dry-run 10/10,成功率 100%,负向检测有效);对 `zcode` 真实进程跑 `--times 100` 待宿主 |
| TC-STB-02 | P1 | 断网 30s 内恢复 | Playwright(`context.setOffline`) | `e2e/specs/stability.spec.ts` | **待宿主集成** | 断网态提示 + 30s 恢复计时断言骨架 |
| TC-REG-01 | P0 | 冒烟回归连续 2 轮全绿 | node:test + pytest 全量冒烟 ×2 | `tests/`(3 个 node 文件 + 1 个 pytest 文件) | **已自动化可跑** | **实测 2 轮全绿**:每轮 node:test 22/22 + pytest 7/7 |

**状态统计:已自动化可跑 8 条 | 待宿主集成 9 条 | 待源码 3 条(合计 20 条)**

## 2. 五层测试金字塔

自底向上,比例呈金字塔:底层快而多、顶层慢而精。每层标注工具与 TC 归属。

| 层 | 名称 | 测什么 | 工具/运行时 | 对应 TC / 文件 | 占比目标 |
|---|---|---|---|---|---|
| L1 | 单元 / 静态校验 | 纯函数、定义文件合法性、夹具完整性 | node:test、`node scripts/poc/session-fixtures.mjs --verify`(零依赖) | TC-AGT-01;`tests/agents/validate-agents.mjs`、`scripts/poc/session-fixtures.mjs` | ~40% |
| L2 | 服务 / 接口契约 | 插件 server 的 MCP JSON-RPC 契约(tools/resources/schemas/错误码) | node:test 拉起真实 `server.mjs` 走 stdio | TC-RUN-01/02、TC-UIP-02/04;`tests/run/test-server.mjs`、`tests/uigen/test-server.mjs` | ~25% |
| L3 | 集成链路 | 插件↔侧车↔磁盘存储全链路(生成、导出、导入、进程树、持久化) | node:test + pytest | TC-UIP-01/04、TC-RUN-01/02;`tests/uigen/test_sidecar.py` | ~15% |
| L4 | E2E GUI 黑盒 | 真实宿主 `zcode --web` 上的用户可见行为(含反向断言) | Playwright(@playwright/test) | TC-AGT-02/03/04、TC-UIP-03/05、TC-GIT-01/02、TC-RUN-03、TC-TRM-01、TC-PERF-02、TC-STB-02;`e2e/specs/*.spec.ts` | ~15% |
| L5 | 非功能 + 人工 | 性能、稳定性、视觉走查、UAT | POC 脚本 + 人工 | TC-PERF-01、TC-STB-01、TC-REG-01;`scripts/poc/*` | ~5% |

要点:
- L1–L3 零外部依赖(node:test / pytest),提交即跑,是 CI 回归的主体;
- L4 只覆盖"GUI 才能判定"的行为,禁止把接口断言搬进 E2E(慢、脆、贵);
- L5 的性能/稳定性先用 POC 脚本在合成数据上立基线,再由 E2E 在真实宿主上复测同一口径。

## 3. 性能与稳定性基准表

| 指标 | TC | 达标线 | 测量口径 / 工具 | 当前实测 | 判定 |
|---|---|---|---|---|---|
| 500 轮会话打开 | TC-PERF-01 | ≤2000ms | `scripts/poc/msg-list-perf.mjs`,合成 500 轮夹具(1542 条消息 / 1.64MB),全量加载冷路径 P95(30 次迭代) | **P95=8.665ms**(P50=6.967ms,max=8.731ms) | PASS(POC 口径) |
| 消息列表分页加载 | TC-PERF-01(辅助) | ≤2000ms | 同上,分页加载(50 条/页)+ 滚动补齐 P95 | P95=8.024ms | PASS |
| 面板首帧 | TC-PERF-02 | ≤500ms | `e2e/specs/perf.spec.ts`(打开→双 rAF→计时) | 待宿主 | — |
| 杀进程恢复 | TC-STB-01 | 100 次成功率 ≥99% | `scripts/poc/stability-poc.mjs --times 100`(启动→随机 kill→重启→恢复标记) | dry-run 自测 10/10=100%(恢复 41–415ms);负向(无标记)正确判 FAIL | 驱动器就绪,真实目标待宿主 |
| 断网恢复 | TC-STB-02 | 30s 内恢复 | `e2e/specs/stability.spec.ts`(`context.setOffline`) | 待宿主 | — |
| 冒烟回归 | TC-REG-01 | 连续 2 轮全绿 | `node --test tests/...` + `python tests/uigen/test_sidecar.py` | **2 轮全绿**:每轮 22/22 + 7/7 | PASS |

性能报告样例:`scripts/poc/sample-report.json`(含基线对比块:旧值 2000ms / 新值 8.665ms / 达标判定 PASS,
四个场景 full-load-cold、full-load-warm、paged-load-cold、first-paint 的 P50/P95 全量数据)。

## 4. Agent 驱动验收七步流程

每步明确:执行者(Agent/人工)、动作、入口条件、出口(放行)条件。上一步出口未达成不得进入下一步。

| # | 步骤 | 执行者 | 动作 | 入口条件 | 出口(放行)条件 |
|---|---|---|---|---|---|
| 1 | 开发自测 | coder | 跑受影响测试子集 + `scripts/poc` 自检(`--verify`、`--dry-run`);禁止为变绿改已有断言 | 代码改动完成 | 子集全绿;失败可见(不静默吞错);报告改动文件与影响面 |
| 2 | CI 回归 | planner/CI | 全量 `tests/`(node:test + pytest)跑 2 轮(TC-REG-01) | 步骤 1 放行 | 连续 2 轮 0 失败 |
| 3 | GUI 黑盒 | browser-tester | 启动 `zcode --web`,按 TC 清单跑 `e2e/specs/*.spec.ts`,记录 attach 计时值 | 步骤 2 放行 + 宿主 testid 接线 | P0 E2E 全过;失败输出复现步骤与截图/trace |
| 4 | 视觉走查 | ui-prototype + browser-tester | 390px 预览、演示播放、热点跳转、面板布局人工/Agent 目检,截图归档 | 步骤 3 放行 | 无明显错位/截断;截图入档 |
| 5 | 性能稳定 | browser-tester | 跑 `msg-list-perf`、`stability-poc --times 100`、`e2e` perf/stability | 步骤 4 放行 | 基准表全部达标(≤2s、≤500ms、≥99%、30s) |
| 6 | 报告缺陷 | reviewer | 汇总失败为缺陷单(S1 阻断/S2 严重/S3 一般/S4 建议),含复现步骤、期望/实际、日志 | 步骤 5 出现失败 | 缺陷入库并分级;无 S1/S2 未决 |
| 7 | 人工 UAT | 人工 | 按 TC 清单抽验 P0 全部 + P1 抽样,对照门禁清单签字 | 步骤 6 放行 | 门禁 4 项全达成,发布放行 |

## 5. 发布门禁

| 门禁项 | 标准 | 度量来源 | 当前状态 |
|---|---|---|---|
| P0 通过率 | **100%**(12 条 P0:AGT-01/02/04、UIP-01/02、GIT-01、RUN-01/02、TRM-01、PERF-01、STB-01、REG-01) | 映射表 + 各自动化报告 | 5/12 已自动化可跑全绿,7 条待宿主/源码 |
| P1 通过率 | **≥95%**(8 条 P1;8 条中任一失败即 87.5% < 95%,实际要求全过) | 同上 | 3/8 可跑部分全绿 |
| 缺陷 | **无 S1/S2 未决** | 步骤 6 缺陷单 | 待执行 |
| 恢复率 | **≥99%**(TC-STB-01,100 次杀进程恢复) | `stability-poc` 报告 JSON | 驱动器就绪,真实数据待宿主 |

放行规则:4 项门禁全部达成 + 七步流程完整走完(每步出口留痕),方可发布;任一 P0 失败或存在
S1/S2 未决缺陷一律阻断。

## 6. 运行手册(现在就能跑的)

```bash
cd hba-on-zcode

# L1 夹具生成 + 自检(TC-PERF-01 数据准备)
node scripts/poc/session-fixtures.mjs --out scripts/poc/fixtures --rounds 500
node scripts/poc/session-fixtures.mjs --verify --out scripts/poc/fixtures   # 19 项检查

# L5 性能基线(TC-PERF-01)
node scripts/poc/msg-list-perf.mjs --report scripts/poc/sample-report.json

# L5 稳定性驱动器自测(TC-STB-01)
node scripts/poc/stability-poc.mjs --dry-run --times 10 --concurrency 2

# L1–L3 回归(TC-REG-01 冒烟,连跑 2 轮)
node --test tests/run/test-server.mjs tests/uigen/test-server.mjs tests/agents/validate-agents.mjs
python tests/uigen/test_sidecar.py
# ↑ 重复执行 2 遍,均 exit 0 即 TC-REG-01 达标

# L4 E2E(待宿主:先 npm i -D @playwright/test && npx playwright install chromium)
cd e2e && npx playwright test
```

## 7. 与 PRD 的对应

- TC 清单 20 条全部纳入第 1 节映射表,编号与 PRD 一致;
- 性能/稳定性指标(TC-PERF-01 ≤2s、TC-PERF-02 ≤500ms、TC-STB-01 ≥99%、TC-STB-02 30s)
  即第 3 节基准表的达标线;
- 发布门禁四条即 PRD 验收口径(P0 100%、P1 ≥95%、无 S1/S2、恢复率 ≥99%)。
