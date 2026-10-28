# hba-uigen — UI 原型面板插件(HBA FR-2 迁移)

HBA `ui_gen` 多屏 UI 原型生成能力迁移到 ZCode 插件形态。面板 + 手写 MCP stdio
server + Python sidecar,全部零外部依赖(Node 内置 / Python 标准库)。

功能覆盖 PRD FR-2:

| 需求 | 状态 | 落点 |
|---|---|---|
| FR-2-1 需求输入生成 | P0 ✅ | panel 需求输入 + `uigen_generate` |
| FR-2-2 多屏画布(缩放/拖拽/跳转热点) | P0 ✅ | panel 画布网格 + 热点叠加层 |
| FR-2-3 HTML/JSX/Vue 产物 | P0 ✅ | 每屏三产物 + 格式切换/复制 |
| FR-2-4 390px 手机预览 | P0 ✅ | 390×844 iframe 实时预览 |
| FR-2-5 演示播放(顺序/暂停/步进) | P0 ✅ | 播放栏 + 空格/左右方向键 |
| FR-2-6 本地目录导入 | P1 ✅ | `uigen_import_dir` |
| FR-2-7 历史版本 | P1 ✅ | `uigen_list_versions` / `uigen_get_version` |
| FR-2-8 导出 | P1 ✅ | `uigen_export`(产物 + manifest.json) |

## 架构(文字图)

```
ZCode 宿主(host)
│  plugin.json: ui.surfaces[{id:"hba-uigen", server:"hba-uigen",
│                            resourceUri:"ui://hba-uigen/panel.html",
│                            mimeType:"text/html;profile=mcp-app"}]
│
├── 面板 iframe(ui/panel.html,内联 ui/bridge.js)
│      │  MCP JSON-RPC 2.0 over window.parent.postMessage
│      │  (initialize → notifications/initialized → ui/initialize)
│      │  callTool(name,args) / onResourceUpdate(cb) / onProgress(cb)
│      ▼
├── MCP server(plugins/hba-uigen/server.mjs,stdio,零依赖)
│      │  tools: uigen_generate / uigen_list_versions / uigen_get_version
│      │        uigen_export / uigen_import_dir
│      │  resources: ui://hba-uigen/{panel.html,bridge.js,state.json}
│      │  notifications/progress + notifications/message(生成进度)
│      │  子进程 JSON(stdin/stdout)
│      ▼
└── Python sidecar(sidecar/uigen_sidecar.py,标准库)
       │  try: import app.ui_gen(HBA_ROOT) → 复用 HBA prompts 元数据
       │  except: 降级内置演示生成器(与 server.mjs 内置演示器行为一致)
       ▼
   版本存储 <store>/​.hba/uigen/ 或 $UIGEN_STORE_DIR
   versions.json + <versionId>/{meta.json, screens/sN.{html,jsx,vue}}
```

生成链路:`server.mjs` 优先拉起 sidecar(`uigen_generate`);sidecar 不可用
(python 缺失/超时/崩溃)时回退到 server.mjs 内置演示生成器,保证端到端可跑。
store 布局在 server.mjs 与 sidecar 间共享(`UIGEN_STORE_DIR` 穿透子进程)。

## 桥协议发现记录(解剖 D:\ZCode\resources\glm\packages\pdf-plugin)

从官方 pdf-plugin(`.zcode-plugin/plugin.json`、`dist/server.mjs`、`dist/ui/bundle-0.txt`)
与 `resources/app.asar` 反推,证据与结论:

1. **清单 schema**(pdf-plugin `.zcode-plugin/plugin.json` 原文证实):
   `ui.surfaces = [{ id, title:{"zh-CN","en-US"}, icon, server, resourceUri,
   availability:"session" }]`;`mcpServers.<name> = { type:"stdio", command, args,
   cwd, env, isolation:"workspace" }`,args 用 `${ZCODE_PLUGIN_ROOT}` /
   `${ZCODE_PROJECT_DIR}` 占位符。本插件 plugin.json 按此结构书写。
2. **面板资源经 MCP resources/read 提供**,URI 形如 `ui://<server>/<path>`
   (pdf 为 `ui://pdf/panel.html`),MIME 为 `text/html;profile=mcp-app`
   (bundle 中常量 `HTML_MIME = "text/html;profile=mcp-app"`,server.mjs 中同名)。
3. **面板是 MCP client,不是自定义 RPC**:bundle 内嵌 MCP client SDK,
   `connect(new Transport(window.parent, window.parent))`,传输层为
   `window.parent.postMessage(msg, "*")` + `window "message"` 事件,信封即标准
   JSON-RPC 2.0(`jsonrpc:"2.0"`),并有 zod 校验(`Ignoring non-JSON-RPC message`)。
   可用方法含 `tools/call`、`resources/read`、`notifications/progress`、
   `notifications/resources/updated` 等(在 bundle 中逐一出现)。
4. **自定义握手**:`super.connect()`(即 MCP initialize + initialized)完成后追加
   请求 `ui/initialize` `{ appInfo, appCapabilities, protocolVersion }`
   (bundle 原文:`this.request({method:"ui/initialize",params:{appInfo,...}})`)。
5. **宿主侧桥**(app.asar):`PluginUiBridge` 与 RPC 方法族
   `mcp/uiCallTool`、`mcp/uiReadResource`、`mcp/uiListResources`、
   `mcp/uiSubscribeResource`、`mcp/uiUnsubscribeResource`、`mcp/uiRegisterAppTools`、
   `mcp/uiUnregisterAppTools`、`mcp/uiClaimAppToolCall`、`mcp/uiResolveAppToolCall`、
   `mcp/uiSampling`、`mcp/uiOpenInstance`、`mcp/uiValidateInstance`、
   `mcp/uiCloseInstance`;事件 op 含 `pluginUi.resourceUpdated`、
   `pluginUi.resourceListChanged`、`pluginUi.instanceClosed`、`pluginUi.appToolCall`、
   `pluginUi.followUp`、`pluginUi.pin/unpin` 等。appTools 是"模型调用面板内工具"
   的注册通道(claim/resolve 两段式),本插件暂不使用。
6. **面板状态持久化**:`getHostCapabilities()?.experimental?.["zcode/surface"]?.stateKey`
   → localStorage(窗口位置记忆),可选增强,本插件未接。

**落地**:`ui/bridge.js` 按上述协议实现适配层,接口
`callTool(name,args)` / `onResourceUpdate(cb)` / `onProgress(cb)` / `connect()`。
`ui/panel.html` 内联同一份 bridge 代码(单文件面板)。握手超时(默认 2.5s)或
`window.parent === window` 时降级 `standalone` 本地演示后端,面板功能不受影响。

**集成阶段校验项**(本机无宿主环境,未能实测的部分):
- `ui/initialize` 的 `appCapabilities` 具体 schema(推断自 bundle 字段名,
  `displayModes:["inline","fullscreen"]`),需在 ZCode 宿主里确认参数兼容性;
- 宿主 proxy 是否把 `tools/call` 直接路由到 `mcpServers.hba-uigen`(机制推断如此);
- `notifications/progress` 的 `progressToken` 透传(`params._meta.progressToken`);
- appTools(registerAppTools)如需"模型唤起面板操作",为后续增强项。

## HBA ui_gen 复用边界(只读参考)

- HBA 真实生成栈:`app/ui_gen/` FastAPI(`routers/` 挂 `/api/ui-gen`,WS
  `/ws/generate`、`/ws/generate-app`)、`services/model_bridge.py`(LLM 流式)、
  `prompts/{html_css,html_tailwind,react_tailwind,vue_tailwind,planner,...}`、
  `db/models.py`(Project/Screen/ScreenVersion/FlowEdge)。
- **已复用**:`prompts/` 三个 `SYSTEM_PROMPT` 为纯字符串模块(其 `__init__.py`
  全部为空,不触发 fastapi 依赖),sidecar 在 `HBA_ROOT` 可用时 import 并回传
  prompt 元数据(`engine:"demo+hba-prompts"`,含 `MOBILE_WIDTH=390` 常量);
  产物格式(html/jsx/vue)、390px 视口、多屏 + 热点(对应 HBA `FlowEdge`)的
  概念模型均对齐 HBA 设计。
- **未复用(依赖缺失即降级)**:`services/model_bridge.py` 的 LLM 真实生成、
  WS 协议、SQLModel 存储、`diff_apply.py` 迭代编辑。这些需要 fastapi/sqlmodel/
  structlog/LLM provider,超出零依赖约束;sidecar 的 `try_hba()` 任何 import
  失败都静默降级为演示生成器(行为与 server.mjs 内置演示器一致:同屏幕命名表、
  同卡片文案、同热点几何 y=774/h=70、同产物模板结构)。
- 后续如接入真实生成:在 sidecar `cmd_generate` 内把 `demo_generate(...)` 替换为
  HBA `UiGenModelBridge.stream_generate` 调用即可,接口返回结构保持不变。

## 运行方式

```bash
# MCP server(stdio JSON-RPC 2.0,换行分隔;stdin 结束且无在途请求时退出)
node plugins/hba-uigen/server.mjs

# Python sidecar(子命令:generate/list_versions/get_version/export/import_dir)
python sidecar/uigen_sidecar.py generate '{"prompt":"借阅 App","format":"html","screenCount":3}'
echo '{"dir":"./protos"}' | python sidecar/uigen_sidecar.py import_dir

# 测试(两套都要过)
node --test tests/uigen/test-server.mjs
python tests/uigen/test_sidecar.py        # 亦兼容: python -m pytest tests/uigen/test_sidecar.py

# 面板(集成态走 ZCode 宿主;独立调试可静态托管)
cd plugins/hba-uigen && python -m http.server 8931   # 打开 http://127.0.0.1:8931/ui/panel.html
```

环境变量:

| 变量 | 含义 | 默认 |
|---|---|---|
| `UIGEN_STORE_DIR` | 版本存储目录 | `<cwd>/.hba/uigen` |
| `UIGEN_SIDECAR` | sidecar 脚本路径 | `<plugin>/../../sidecar/uigen_sidecar.py` |
| `UIGEN_PYTHON` | python 解释器 | `python`/`py`/`python3` 依次探测 |
| `UIGEN_SIDECAR_TIMEOUT` | sidecar 超时(ms) | 20000 |
| `UIGEN_FORCE_DEMO` | 置 1 跳过 sidecar 用内置演示器 | (未设) |
| `HBA_ROOT` | HBA 仓库根(启用 HBA prompts 复用) | plugin.json 传 `${ZCODE_PROJECT_DIR}/HBA` |

存储布局(server.mjs 与 sidecar 一致):
`versions.json`(索引,新版本在后)、`<versionId>/meta.json`(含全部产物)、
`<versionId>/screens/sN.{html,jsx,vue}`;`uigen_export` 默认导出到
`<versionId>/export/`,产物 + `manifest.json`。

## 遗留事项

1. **桥协议集成校验**:上文"集成阶段校验项"4 条需在真实 ZCode 宿主里跑一遍
   (panel ↔ host 的 `ui/initialize` 参数、progressToken 透传、资源订阅推送)。
   bridge 已做超时降级,协议差异不会白屏。
2. **真实 LLM 生成**:当前生成为演示生成器(结构完整、可预览/播放/导出);
   接 HBA `UiGenModelBridge` 需放开零依赖约束或经 sidecar 外挂依赖环境。
3. **打包形态**:plugin.json 的 `mcpServers.args` 指向 `${ZCODE_PLUGIN_ROOT}/server.mjs`,
   sidecar 在插件目录外(`hba-on-zcode/sidecar/`);正式分发时把 sidecar 拷入插件
   目录或用 `UIGEN_SIDECAR` 指定,README 已注明。
4. **appTools / pin / followUp** 等宿主增强通道未接(非 FR-2 范围)。
5. **演示播放**为定速 2.2s/屏顺序播放,无自定义时长/转场(FR-2-5 范围内)。
6. **导入**仅认 `*.html`(与 HBA import_local 的多格式能力相比收敛);
   JSX/Vue 导入产物为占位包装,原 HTML 内嵌注释保留。
