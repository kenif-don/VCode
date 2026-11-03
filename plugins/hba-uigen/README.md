# hba-uigen — HBA 原型库浏览器面板插件(HBA FR-2 迁移)

HBA 原版「原型库浏览器」迁移到 ZCode 插件形态。面板 + 手写 MCP stdio
server,零外部依赖(Node 内置模块)。

面板**死绑当前 ZCode 工作区(= 项目)**:原型根恒等于工作区根
(`$ZCODE_WORKSPACE_ROOT`,缺省 `cwd`),没有「绑定目录 / 更换目录」概念,
打开即可扫。扫描项目目录建树——**目录 = 模块**(空目录也算),
**`html/htm/jsx/tsx/vue` = 页面**——支持单页浏览、页面/元素引用插入对话
输入框、技能库管理。磁盘文件是唯一内容真源,`<store>/index.json` 只是
列表缓存。

**AI 做原型的通道 = 对话 + `ui-prototype` 子智能体 + MCP 工具**
(`uigen_save_page` 写文件、`uigen_rescan` 刷新树等),面板本身只是浏览器:
浏览、引用、技能管理。子智能体如何选用技能、如何解析引用尾注,
见仓库根 `agents/ui-prototype.md` 的「技能使用协议」「引用尾注协议」。

功能覆盖(对应 HBA 原型库浏览器定位):

| 能力 | 状态 | 落点 |
|---|---|---|
| 工作区死绑 + 目录扫描建树 | P0 ✅ | server 扫描/对账逻辑 + `uigen_rescan`/`uigen_list_pages` |
| 单页浏览(读写磁盘页面) | P0 ✅ | `uigen_get_page`/`uigen_save_page`/`uigen_delete_page` + 面板单页视图 |
| 页面/模块/元素引用插入对话 | P0 ✅ | 面板引用 chip → 三级降级插入输入框 |
| 技能库管理 | P0 ✅ | `uigen_list_skills`/`uigen_get_skill`/`uigen_save_skill`/`uigen_delete_skill` + 启动播种 16 个 HBA 内置技能 |
| 画布布局持久化 | P1 ✅ | `uigen_canvas_save`/`uigen_canvas_get`(工作区级,跨重开恢复) |

## 架构(文字图)

```
ZCode 宿主(host)
│  plugin.json: ui.surfaces[{id:"hba-uigen", server:"hba-uigen",
│                            resourceUri:"ui://hba-uigen/panel.html",
│                            mimeType:"text/html;profile=mcp-app"}]
│  mcpServers.hba-uigen: stdio,node ${ZCODE_PLUGIN_ROOT}/server.mjs,
│                        cwd=${ZCODE_PROJECT_DIR},
│                        env.ZCODE_WORKSPACE_ROOT=${ZCODE_PROJECT_DIR}
│
├── 面板 iframe(ui/panel.html,内联 ui/bridge.js)
│      │  MCP JSON-RPC 2.0 over window.parent.postMessage
│      │  (initialize → notifications/initialized → ui/initialize)
│      │  callTool(name,args) / onResourceUpdate(cb) / onProgress(cb)
│      │  左页面树(220px,可折叠)+ 右画布;单页视图大卡异步取内容
│      ▼
└── MCP server(plugins/hba-uigen/server.mjs,stdio,零依赖)
       │  11 工具(见「工具面」):树/页面读写 5 + 技能库 4 + 画布 2
       │  resources: ui://hba-uigen/{panel.html,bridge.js,state.json}
       │  notifications/resources/updated(state.json 变更推送)
       │  notifications/message(扫描部分失败等诊断日志)
       ▼
   磁盘(唯一真源)
   ├── 工作区根($ZCODE_WORKSPACE_ROOT)= 原型根,扫描建树
   └── <store>/ = $UIGEN_STORE_DIR 或 <cwd>/.hba/uigen
         ├── index.json      列表缓存 {root,entries:[{id,name,type,framework,updatedAt}]}
         ├── canvas-layout.json  画布布局 {layout,updatedAt,bytes}
         └── skills/<id>.yaml    技能库(启动从 <plugin>/skills/seed/ 播种)
```

## 扫描规则(树怎么来)

一次遍历原型根 → 与缓存对账,规则与 HBA `reconcile.py` 口径对齐:

- **扩展名白名单**:`.html` / `.htm` / `.jsx` / `.tsx` / `.vue`(小写比较),
  分别映射 framework `html_tailwind` / `react_tailwind` / `vue_tailwind`;
  白名单外的文件静默忽略。
- **剪枝**:`node_modules` / `.git` / `.hg` / `.svn` 与任何 `.` 开头的目录
  (只剪目录,不剪隐藏文件)。
- **超限跳过**:单文件 >500KB 或 stat 失败 → 计入 `skipped`,不进树,
  不让整轮扫描失败。
- **目录 = 模块,空目录也算**;**文件 = 页面**,`name` 取去扩展名的 stem
  (与 HBA `Screen.name` 口径一致);根下文件无父模块。
- 符号链接:逃出根的不进、链接到目录的只建模块行不跟进(防链接环);
  readdir 失败只记 `errors` 放弃该子树,不中断整轮扫描。
- 每层按名称排序、父先子后,顺序稳定;`<store>/index.json` 每次
  list/rescan/save/delete 后对账更新;**本轮扫描有错误时保留缓存里
  「本轮没见到」的旧条目**(防读目录失败被误判成磁盘删除)。

id 形态 = 相对工作区根的 posix 路径(`login/register.html`;模块 =
目录相对路径),路径解析带逃逸校验(`..`、绝对路径一律拒绝)。

## 工具面(11 个,与 `server.mjs` 的 `TOOLS` 数组一一对应)

| 工具 | 作用 |
|---|---|
| `uigen_rescan` | 重扫工作区根并更新缓存,返回 `{root, tree, stats}` |
| `uigen_list_pages` | 返回模块/页面树 `{root, tree, stats}`(对账后读缓存) |
| `uigen_get_page` | 按 id 读单页/模块;页面返回 `content`(utf-8 失败回退 latin-1),模块 `content=null` |
| `uigen_save_page` | 新建/更新/重命名页面或模块:新建缺省写空 HTML 占位;`content` 写文件;`name` 重命名并返回新 id;id 必须留在工作区内 |
| `uigen_delete_page` | 删页面;删非空模块需 `recursive:true` |
| `uigen_list_skills` | 技能清单(缺省仅 `is_active=true`;`includeInactive:true` 返回全部) |
| `uigen_get_skill` | 读单个技能全字段(含 `instructions`/`examples`) |
| `uigen_save_skill` | 新建/更新技能 YAML(`instructions` 必填非空;新建 id 为 `skill-<slug>`) |
| `uigen_delete_skill` | 删技能 YAML(内置技能下次启动重新播种,HBA 语义) |
| `uigen_canvas_save` | 持久化工作区级画布布局到 `<store>/canvas-layout.json`(剥掉历史 `ui` 字段) |
| `uigen_canvas_get` | 读画布布局 + 工作区 `{root,name}`(供面板顶栏) |

树节点形态:`{id, name, type: "module"|"page", children, framework}`,
`id` = 相对工作区的 posix 路径。资源 `ui://hba-uigen/state.json` 与
`uigen_list_pages` 同形,写盘后经 `notifications/resources/updated` 推送。

## 技能库

- **存储**:`<store>/skills/*.yaml`(字段顺序与 HBA `skills/seed/*.yaml`
  逐字一致),序列化按 `id/name/description/...` 落盘。
- **启动播种**:server 启动时从 `<plugin>/skills/seed/*.yaml` 播种
  **16 个 HBA 内置技能**,语义照抄 HBA `db/seed.py`:
  - store 缺 → 按 seed 原值写入(含 `is_active`/`scope`);
  - 两边都有 → **内容字段**(name/description/instructions/examples/
    parameters/param_values/category/sort_order)**用 seed 覆盖,
    `is_active`/`scope` 保留 store 值**(用户启停不被冲掉);
  - store 有、seed 缺 → 不动(用户自建技能不删)。
  - seed 解析失败 console.error 跳过,不炸启动。
- **消费**:`uigen_list_skills` 缺省只回启用技能;AI 挑技能、取正文的
  协议见 `agents/ui-prototype.md`「技能使用协议」。

## 引用插入对话通道

面板把页面/模块/元素引用收进底部 chip 暂存区,「插入到对话」按
**三级降级**(照抄 hba-run `insertSelectionToInput`),全程不弹框:

1. `ui/insert-input-text`(VCode 扩展桥方法):文本直接进对话输入框,
   用户改完自己发;
2. 老宿主降级 `ui/update-model-context`:以插件上下文附在对话输入区,
   发送时与正文一并送达模型;
3. 剪贴板兜底(独立模式 / 两级都不可用 / 等输入框就绪超时)。

composer 未就绪(`-32601` 且非「方法不存在」)→ 等待重试(10s 上限、
500ms 一步);通道方法不存在 → 该通道作废直接降级;成功后清空 chip 区。
引用尾注格式(`[引用页面: …]` / `[引用模块: …]` /
`[引用元素: … @ 结构path]`)与消费方优先级语义见
`agents/ui-prototype.md`「引用尾注协议」。

## 预览崩溃守卫(三条)

历史教训固化为铁律,改动预览链路必须遵守:

1. **iframe 一律不带 `sandbox` 属性** —— 宿主插件沙箱 WebView 对嵌套
   sandbox iframe 会崩;
2. **启动时不写 `srcdoc`** —— 单页视图 iframe 模板进单页时才克隆挂载,
   内容异步取回后才写;全览卡只显示名称占位(同屏只允许一张卡写
   `srcdoc`);
3. **预览前剥离 `<script>`** —— 写入 iframe 的内容先正则剥掉全部
   `<script>…</script>`(面板内原型不执行脚本)。

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

## 运行方式

```bash
# MCP server(stdio JSON-RPC 2.0,换行分隔;stdin 结束且无在途请求时退出)
node plugins/hba-uigen/server.mjs

# 测试(集成测试:拉起真实 server 走 stdio,15 项)
node --test tests/uigen/test-server.mjs

# 面板(集成态走 ZCode 宿主;独立调试可静态托管)
cd plugins/hba-uigen && python -m http.server 8931   # 打开 http://127.0.0.1:8931/ui/panel.html
```

环境变量:

| 变量 | 含义 | 默认 |
|---|---|---|
| `ZCODE_WORKSPACE_ROOT` | 工作区根 = 原型根(面板死绑,无绑定概念) | `cwd` |
| `UIGEN_STORE_DIR` | store 目录(缓存/画布/技能库) | `<cwd>/.hba/uigen` |

存储布局:`<store>/index.json`(列表缓存)、`<store>/canvas-layout.json`
(画布布局)、`<store>/skills/<id>.yaml`(技能库)。

## 遗留事项

1. **桥协议集成校验**:上文"集成阶段校验项"4 条需在真实 ZCode 宿主里跑一遍
   (panel ↔ host 的 `ui/initialize` 参数、progressToken 透传、资源订阅推送、
   引用插入三级降级实测)。bridge 已做超时降级,协议差异不会白屏。
2. **打包形态**:plugin.json 的 `mcpServers.args` 指向
   `${ZCODE_PLUGIN_ROOT}/server.mjs`;技能 seed 在插件目录内
   (`skills/seed/`)随插件分发,正式打包时随插件目录一并拷贝。
3. **appTools / pin / followUp** 等宿主增强通道未接(模型唤起面板操作为
   后续增强项)。
4. **热部署**:内置插件缓存会被宿主启动时从安装目录种子整目录重播种,
   换代码必须种子源 + 缓存两处一起替换(配方与实测教训见
   `docs/panel-state-sharing.md`)。
