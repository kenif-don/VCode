# 部署迁移指南(hba-on-zcode → ZCode)

本指南说明如何把本仓库的交付物部署到 ZCode:六个子智能体定义(FR-1)、hba-uigen 与 hba-run 两个面板插件(FR-2 / FR-4)、UI 生成 Python sidecar,以及业务数据位置、白标构建注意与回滚方案。适用两种形态:

- **(a) 标准 ZCode 宿主**:把智能体与插件安装进现有 ZCode 客户端;
- **(b) Fork 白标构建**:把上述内容随 HBA 插件包打进白标安装包(PRD 5.1 / 5.4)。

前提:ZCode 安装(或 Fork 构建产物);Node 运行时(插件 server 用 `node` 启动);Python 3(sidecar 可选,缺失时自动降级)。全部组件零外部依赖,无需 npm / pip 安装。

---

## 1. FR-1 六个智能体定义安装

### 1.1 方式 A:拷贝到 agents 目录(推荐起步)

ZCode 子智能体为 Markdown + frontmatter 文件,与本仓库 `agents/` 同构。安装位置二选一:

| 作用域 | 目录(Windows / POSIX) | 生效范围 |
|---|---|---|
| 用户级 | `~/.zcode/agents/`(Windows 即 `%USERPROFILE%\.zcode\agents\`) | 所有工作区 |
| 工作区级 | `<repo>/.zcode/agents/` | 仅该项目,可随仓库共享 |

拷贝清单(共 6 个文件,`name` 与文件名一致,**勿改名**——校验器按名核对,且不得占用内置名 `Explore`、`general-purpose`):

| 文件 | name | tools 白名单 | thoughtLevel |
|---|---|---|---|
| `coder.md` | coder | Read, Write, Edit, Bash, Grep, Glob | low |
| `reviewer.md` | reviewer | Read, Grep, Glob, Bash | low |
| `architect.md` | architect | Read, Grep, Glob, WebSearch | low |
| `planner.md` | planner | Read, Grep, Glob, TodoWrite | low |
| `browser-tester.md` | browser-tester | Read, Bash, WebFetch, WebSearch | low |
| `ui-prototype.md` | ui-prototype | Read, Write, Edit, Bash, Glob | medium |

### 1.2 方式 B:打包为 hba-agents 插件分发

PRD 6.1.1 规定"定义文件随 hba-agents 插件分发,同时支持用户在自己的用户目录覆盖":把 `agents/` 目录作为插件的 `agents` 组件(插件清单 `agents` 字段)放入插件目录随插件分发,用户仍可用用户级 agents 目录覆盖。插件目录与清单写法参照 `plugins/hba-uigen/.zcode-plugin/plugin.json` 形态。注意:hba-agents 插件目录当前尚未在本仓库落盘,此为分发形态建议,打包工作属 W7(集成与发布)。

### 1.3 model 占位替换(部署必做)

每个定义文件 frontmatter 中的:

```yaml
model: "【provider:model,按部署环境填写】"
```

是占位符,**无法解析为可用模型,部署时必须逐文件替换**为真实的 `provider:model`(按 `provider:model` 解析;可参考 HBA 开发配置 `HBA\.hba\dev\config\agents\coder.md` 中 `agnes:agnes-3.0-flash` 的形式,按部署环境的实际供应商/模型填写)。

相关联动字段:

- `thoughtLevel`(low/medium/high/max)随所选模型的推理档位可调,当前值为 HBA `thinking_level` 原值直移(low×5、medium×1),换模型时按需校准;
- `maxTurns`、`background`、`permissionMode` 为 ZCode 侧默认值(planner 30、reviewer/architect 40、browser-tester 60、coder/ui-prototype 80;`background: false`;`permissionMode: default`),按需调整;
- `description`、`color`、`tools` 一般无需改动(改动后用下节校验器核对)。

### 1.4 安装后校验

```bash
# 在 hba-on-zcode 仓库根目录执行:139 项断言,退出码 0 = 全绿
node tests/agents/validate-agents.mjs
```

校验器接受占位符或 `provider:model` 形式;若目标环境已替换模型,同样通过。装入宿主后可在 ZCode 设置页的子智能体列表确认 6 项可见(FR-1-1,需宿主环境)。

---

## 2. 插件安装(hba-uigen / hba-run)

### 2.1 插件目录结构(每插件自包含)

```
plugins/hba-uigen/                     plugins/hba-run/
├── .zcode-plugin/plugin.json          ├── .zcode-plugin/plugin.json
├── server.mjs                         ├── server.mjs
├── ui/panel.html                      ├── ui/panel.html
├── ui/bridge.js                       └── README.md
└── README.md
```

(hba-run 的桥适配层内联在 `ui/panel.html` 中;hba-uigen 另有独立 `ui/bridge.js` 并作为资源提供,`panel.html` 内联同一份代码。)

### 2.2 清单要点(plugin.json)

- **mcpServers**:`hba-uigen` 与 `run` 各注册一个 stdio MCP server:`{ type: "stdio", command: "node", args: ["${ZCODE_PLUGIN_ROOT}/server.mjs"], cwd: "${ZCODE_PROJECT_DIR}", env: {...}, isolation: "workspace" }`。占位符 `${ZCODE_PLUGIN_ROOT}`(插件安装目录)、`${ZCODE_PROJECT_DIR}`(工作区根)由宿主展开。
- **env 注入**:hba-uigen 传 `ZCODE_WORKSPACE_ROOT`、`HBA_ROOT`(默认 `${ZCODE_PROJECT_DIR}/HBA`);hba-run 传 `ZCODE_WORKSPACE_ROOT`(run.json 定位依据)。
- **ui.surfaces**:`[{ id, title: {zh-CN, en-US}, icon, server, resourceUri, availability: "session" }]`。面板资源 URI:`ui://hba-uigen/panel.html`、`ui://run/panel.html`。
- **面板资源由 server 经 `resources/read` 提供**,mimeType `text/html;profile=mcp-app`(server 侧注册)。hba-uigen 另供 `ui://hba-uigen/bridge.js`(text/javascript)、`ui://hba-uigen/state.json`(application/json);hba-run 另供 `ui://run/state`(application/json)。
- `license: "Apache-2.0"`,与白标合规一致。

### 2.3 安装方式

- **标准宿主**:经 ZCode 插件管理(Settings → Plugin Management → Discover)添加市场(支持本地目录 / Git URL / 文件)后安装并启用;启用状态存于 `~/.zcode/cli/config.json` 的 `plugins`。
- **Fork 白标**:两插件作为 HBA 插件包子目录随仓库构建、独立版本号(PRD 5.4),构建流水线随安装包分发,无需用户手动安装。

### 2.4 桥协议与集成校验点

面板是完整 MCP client,JSON-RPC 2.0 消息经 `window.parent.postMessage` 原样收发;握手 `initialize` → `notifications/initialized` → UI 扩展握手(`ui/initialize` / `ui/notifications/initialized`)。该协议为反推自官方 pdf-plugin 的结论,两个插件 README 的「桥协议」小节列有集成期需在真实宿主确认的校验点(hba-uigen 4 条、hba-run 4 条)。若宿主实际协议有出入,只需替换面板中的 Bridge 代码块;桥已做超时降级(2.5s 握手超时或 `window.parent === window` 时走 standalone 演示后端),协议差异不会白屏。

---

## 3. Python sidecar 部署(hba-uigen)

`sidecar/uigen_sidecar.py` 为纯标准库 Python 3 脚本(子命令:`generate`、`list_versions`、`get_version`、`export`、`import_dir`),由 `plugins/hba-uigen/server.mjs` 以子进程方式调用。

- **默认位置**:`<plugin>/../../sidecar/uigen_sidecar.py`(即本仓库布局)。**正式分发时**把 sidecar 拷入插件目录,或用环境变量 `UIGEN_SIDECAR` 指向任意路径。
- **解释器探测**:`UIGEN_PYTHON` 优先;否则 Windows 依次试 `python` / `py` / `python3`,POSIX 试 `python3` / `python`。
- **降级语义**:sidecar 缺失、超时或崩溃时,server 回退内置演示生成器(行为与 sidecar 演示模式一致),端到端功能不中断;`UIGEN_FORCE_DEMO=1` 强制走演示生成器。

环境变量一览:

| 变量 | 含义 | 默认 |
|---|---|---|
| `UIGEN_STORE_DIR` | 版本存储目录 | `<cwd>/.hba/uigen` |
| `UIGEN_SIDECAR` | sidecar 脚本路径 | `<plugin>/../../sidecar/uigen_sidecar.py` |
| `UIGEN_PYTHON` | python 解释器 | `python`/`py`/`python3` 依次探测 |
| `UIGEN_SIDECAR_TIMEOUT` | sidecar 超时(ms) | 20000 |
| `UIGEN_FORCE_DEMO` | 置 1 跳过 sidecar 用内置演示器 | (未设) |
| `HBA_ROOT` | HBA 仓库根(启用 HBA prompts 元数据复用) | plugin.json 传 `${ZCODE_PROJECT_DIR}/HBA` |

`HBA_ROOT` 不可用或依赖缺失时 sidecar 静默降级为演示生成器(engine 为 `demo`;可用时为 `demo+hba-prompts`),仅失去 HBA prompts 复用,功能不受影响。

---

## 4. 业务数据位置(与 ZCode 会话库分离)

### 4.1 run.json(hba-run)

- 位置:工作区根的 `.hba/run.json`。
- 工作区根解析顺序:`$ZCODE_WORKSPACE_ROOT`(plugin.json 注入 `${ZCODE_PROJECT_DIR}`)→ `$HBA_WORKSPACE_ROOT` → `process.cwd()`。
- 内容:`{ version, configs[], history[] }`;历史最多 50 条、每条输出快照最多 500 行;写盘时机为配置增删改/复制与每次 run 结束入库(临时文件 + rename 原子替换)。

### 4.2 uigen 版本数据(hba-uigen / sidecar)

- 位置:`$UIGEN_STORE_DIR`,默认 `<cwd>/.hba/uigen`(plugin.json 的 `cwd` 为工作区根,故默认即工作区内)。
- 布局(server.mjs 与 sidecar 共享同一约定):

```
<store>/
├── versions.json                 # 版本索引,新版本在后
└── <versionId>/
    ├── meta.json                 # 版本元数据(含全部产物)
    ├── screens/sN.{html,jsx,vue} # 每屏三产物(FR-2-3)
    └── export/                   # uigen_export 默认导出目录(产物 + manifest.json)
```

- 备份 / 迁移:拷贝 `.hba/` 目录即可;删除即清空业务数据,**不影响 ZCode 自身会话库**。历史版本(FR-2-7)保留于 store 内,`uigen_get_version` 可取回任一版本产物。

---

## 5. 白标构建注意(Fork ZCode)

按 PRD 5.4 / 7.5 执行:

1. **基线锁定**:以 ZCode 上游版本为基线打标签并记录于仓库,上游每季度评估 rebase 一次。
2. **合规(必须)**:保留 Apache-2.0 版权声明与 NOTICE 文件;去除 Z.ai 与 ZCode 商标字样(替换应用名称、图标与默认模型配置);第三方组件许可证清单随安装包分发。本仓库两个插件清单的 `license` 字段保持 `Apache-2.0`。
3. **最小核心 diff**:能以插件表达的能力全部进 HBA 插件包;核心层仅保留少量交互调整(FR-5 终端入口),保证 rebase 时优先零冲突。
4. **sidecar 随包**:安装包内置 Python 运行环境或要求系统 Python 3;sidecar 位置按 §3 处理(`UIGEN_SIDECAR` 或拷入插件目录)。
5. **模型配置**:智能体定义的 `model` 占位符在打包前替换为白标默认模型(§1.3)。

---

## 6. 回滚说明

| 对象 | 回滚动作 | 影响 |
|---|---|---|
| 插件(hba-uigen / hba-run) | 插件管理中禁用或卸载 | 面板与 MCP 工具即刻下线;无残留(hba-run 活运行随 server 退出而终止) |
| 智能体定义 | 删除 `~/.zcode/agents/` 下 6 个 `.md` | 恢复安装前状态,不影响内置智能体 |
| 业务数据 | 无需回滚;可保留或删除 `.hba/` | 数据独立于 ZCode 会话库,双向无牵连 |
| sidecar | 移除脚本或清空 `UIGEN_SIDECAR` | 自动降级演示生成器,面板功能不中断 |
| 白标构建 | 回退到上游基线标签重建 | 见 PRD 9.4:M0 POC 结论 No-Go 时整体方案切换 deepseek-harness 内核替换路线(工期重估 +2~4 周) |
| 单个原型版本 | 无需回滚整包 | store 内历史版本可随时取回(FR-2-7) |
