# e2e — HBA→ZCode 迁移验收用例(Playwright)

按 PRD TC 清单编写的 GUI 黑盒验收用例骨架。被测系统为 ZCode 桌面端 Web 模式
(`zcode --web`),Playwright 通过 `baseURL` 驱动。**零第三方依赖声明之外的代码**:
仅 `@playwright/test` 一个 devDependency,用例本身不再引任何库。

## 目录

```
e2e/
├── playwright.config.ts      # baseURL → zcode --web;chromium desktop + 390px 移动视口
├── support/testids.ts        # data-testid 契约(冻结),宿主/插件面板落地时挂属性
└── specs/
    ├── agents.spec.ts        # TC-AGT-01..04(主路径:TC-AGT-02)
    ├── ui-proto.spec.ts      # TC-UIP-01..05(主路径:TC-UIP-01)
    ├── run-panel.spec.ts     # TC-RUN-01..03(主路径:TC-RUN-01、TC-RUN-02)
    ├── terminal.spec.ts      # TC-TRM-01(主路径)
    ├── git-panel.spec.ts     # TC-GIT-01/02(主路径:TC-GIT-01)
    ├── perf.spec.ts          # TC-PERF-01/02(500 轮打开 ≤2s、面板首帧 ≤500ms)
    └── stability.spec.ts     # TC-STB-02 断网 30s 恢复(TC-STB-01 走 scripts/poc)
```

## 前置条件

1. **安装 Playwright**(当前环境网络受限,未预装;在可联网环境执行):

   ```bash
   cd hba-on-zcode/e2e
   npm i -D @playwright/test
   npx playwright install chromium
   ```

   TypeScript 支持:`@playwright/test` 自带类型,无需额外装 `typescript`
   (编辑器/CI 如需 `tsc --noEmit`,再补 `npm i -D typescript`)。

2. **启动被测宿主**:

   ```bash
   zcode --web
   # 启动日志会给出地址,例如 http://127.0.0.1:3777
   export ZCODE_WEB_URL=http://127.0.0.1:<实际端口>
   ```

   也可设 `ZCODE_WEB_START=1` 让 Playwright 自动拉起 `zcode --web`
   (已有实例会复用)。

3. **安装被测插件与智能体**:
   - `plugins/hba-uigen/`、`plugins/hba-run/` 装入 ZCode 插件目录;
   - `agents/*.md` 装入 `<repo>/.zcode/agents/`(或 `~/.zcode/agents/`)。

4. **挂 data-testid**:宿主 UI 与两个插件面板按 `support/testids.ts` 冻结的
   命名挂 `data-testid` 属性。当前面板使用 `id` 选择器(见
   `plugins/hba-uigen/ui/panel.html`、`plugins/hba-run/ui/panel.html`),
   未挂 testid 前用例会定位失败 —— 这是「待宿主集成」状态的预期表现。

5. **准备夹具**(按 TC 需要):
   - TC-PERF-01:500 轮会话夹具

     ```bash
     node scripts/poc/session-fixtures.mjs --out scripts/poc/fixtures --rounds 500
     node scripts/poc/session-fixtures.mjs --verify --out scripts/poc/fixtures
     # 将 fixtures/session.json 导入宿主会话存储(导入通道由宿主提供)
     ```

   - TC-GIT-01:制造脏状态

     ```bash
     echo "// modified" >> src/modified.ts        # 1 个修改文件
     echo "export {};" > src/untracked.ts          # 1 个未跟踪文件
     ```

## 运行

```bash
cd hba-on-zcode/e2e
npx playwright test                              # 全部
npx playwright test specs/run-panel.spec.ts      # 单文件
npx playwright test -g "TC-RUN-02"               # 按 TC 编号
npx playwright test --project=chromium-mobile-390  # 390px 视口项目
npx playwright show-report report                # 查看 HTML 报告
```

TC-REG-01(冒烟回归连续 2 轮全绿)的执行方式:连续跑两遍全量用例,
两遍均 exit 0 即达标:

```bash
npx playwright test && npx playwright test
```

## 用例编写约定

- test 标题一律以 TC 编号开头(`TC-XXX-NN 标题`),便于按编号检索与门禁统计;
- 每条用例内用「步骤 N:」注释标注操作、「断言:」注释标注通过标准的对应判定;
- 定位一律 `getByTestId`,testid 从 `support/testids.ts` 导入,禁止散落字符串;
- 反向断言(如 TC-TRM-01「顶部无终端按钮」)显式 `toHaveCount(0)`;
- 性能用例把实测值 `test.info().attach`,便于并入 docs/testing-plan.md 基准表。

## 当前状态

| 用例文件 | TC | 状态 |
|---|---|---|
| agents.spec.ts | TC-AGT-02(主)、01/03/04 | 待宿主集成 |
| ui-proto.spec.ts | TC-UIP-01(主)、02/03/04/05 | 待宿主集成 |
| run-panel.spec.ts | TC-RUN-01/02(主)、03 | 待宿主集成 |
| terminal.spec.ts | TC-TRM-01(主) | 待源码(FR-5 宿主终端整合未落地) |
| git-panel.spec.ts | TC-GIT-01(主)、02 | 待源码(FR-3 Git 面板未落地) |
| perf.spec.ts | TC-PERF-01/02 | 待宿主集成(PERF-01 的合成夹具口径已自动化,见 scripts/poc) |
| stability.spec.ts | TC-STB-02 | 待宿主集成(STB-01 走 scripts/poc/stability-poc.mjs) |

「待宿主集成」= 用例步骤与断言完整,等待宿主 UI 挂 testid / 插件面板接线后即可执行;
「待源码」= 步骤与断言按接口契约预写,等待对应功能源码(FR-3 / FR-5)落地后接线。
在此之前不安装 Playwright(环境网络受限),代码保持可直接 `npm i -D @playwright/test`
后运行的完整语法。

已可运行的自动化(不依赖宿主)在 `tests/`(node:test / pytest)与
`scripts/poc/`(夹具/性能/稳定性 POC),映射见 `../docs/testing-plan.md`。
