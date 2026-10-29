# hba-run — HBA 运行面板插件(FR-4)

HBA→ZCode 迁移项目 FR-4:运行面板插件。提供运行配置管理、一键运行/停止(实时输出)、
任务历史、预览联动,配置持久化到工作区 `.hba/run.json`,跨会话保留。

零外部依赖(仅 Node 内置模块),Windows(git bash)+ POSIX 双平台进程管理。

## 文件结构

```
plugins/hba-run/
├── .zcode-plugin/plugin.json   # 插件清单:mcpServers.run + ui.surfaces
├── server.mjs                  # 手写 MCP stdio JSON-RPC 2.0 服务端(运行管理器)
├── ui/panel.html               # 单文件面板(含 bridge 适配层)
└── README.md
tests/run/test-server.mjs       # 集成测试(node:test,真实 JSON-RPC)
```

## 架构

```
┌────────────────────────────┐
│ ZCode 宿主                  │
│  ┌──────────────────────┐  │      ┌─────────────────────────────┐
│  │ panel.html (iframe)  │  │      │ server.mjs (MCP stdio)      │
│  │  MCP client          │──┼──────┼─ MCP server                  │
│  │  桥:postMessage      │  │ JSON │  tools/call → 运行管理器     │
│  └──────────────────────┘  │ RPC  │  spawn(shell:true)          │
│  (宿主代理 JSON-RPC 到      │ 2.0  │  环形缓冲 + 资源更新通知     │
│   mcpServers.run 的 stdio) │      │  .hba/run.json 持久化        │
└────────────────────────────┘      └─────────────────────────────┘
```

- **server.mjs**:手写 MCP stdio 传输(newline-delimited JSON-RPC 2.0),
  实现 `initialize`、`ping`、`tools/list`、`tools/call`、`resources/list`、
  `resources/templates/list`、`resources/read`、`resources/subscribe`、
  `resources/unsubscribe`,以及 `notifications/resources/updated` 推送。
- **运行管理器**:每个 run 独立 `child_process.spawn(command, { shell: true })`,
  stdout/stderr 按行切分进每 run 环形缓冲(2000 行,seq 游标),支持并发多个 run,
  状态机 `running / exited / failed`。
- **panel.html**:单文件面板。内嵌 `Bridge` 适配层(独立代码块,便于集成期替换),
  之上是配置列表 + 表单、运行/停止、输出控制台(自动滚动/清空/复制)、
  任务历史表、预览按钮。

## 工具清单(9 个,visibility: model + app)

| 工具 | 参数 | 说明 |
|---|---|---|
| `run_config_list` | — | 列出全部运行配置 |
| `run_config_save` | `id?`, `name`, `command`, `cwd?`, `env?`, `previewUrl?` | 新建/更新配置(带 id 为更新) |
| `run_config_delete` | `configId` | 删除配置(历史保留) |
| `run_config_duplicate` | `configId`, `name?` | 复制配置(新 id,默认名追加 " (copy)") |
| `run_start` | `configId` | 启动运行,返回 `runId`(含 pid/startedAt) |
| `run_stop` | `runId`, `timeoutMs?`(默认 2000) | 优雅停止,超时后强杀整棵进程树 |
| `run_status` | `runId?` | 单个或全部运行状态快照 |
| `run_output` | `runId`, `since?` | 游标式拉取输出行(`seq > since`),活运行与历史均可用 |
| `run_history` | `limit?` | 历史记录(新命令/起止时间/退出码/状态/输出行数),新→旧 |

工具结果统一 `{ content: [{type:"text", ...}], structuredContent: {...} }`;
工具级错误(配置不存在、参数缺失)返回 `isError: true` 结果而非 JSON-RPC error。

## 资源

| URI | mimeType | 内容 |
|---|---|---|
| `ui://run/panel.html` | `text/html;profile=mcp-app` | 面板 HTML(`resources/read` 由 server.mjs 从 `ui/panel.html` 读出) |
| `ui://run/state` | `application/json` | 状态快照(配置/活运行/历史计数),运行输出与状态变化时推送 `notifications/resources/updated` |

## .hba/run.json schema

```jsonc
{
  "version": 1,
  "configs": [
    {
      "id": "cfg-xxxx",              // 生成 id
      "name": "前端开发服务",
      "command": "npm run dev",
      "cwd": "packages/app",         // 空 = 工作区根目录;相对路径基于工作区根目录解析
      "env": { "PORT": "5173" },     // 合并到进程环境(覆盖同名变量)
      "previewUrl": "http://localhost:5173",
      "createdAt": "2026-10-27T...Z",
      "updatedAt": "2026-10-27T...Z"
    }
  ],
  "history": [                       // 最多 50 条,旧的先淘汰
    {
      "id": "run-xxxx",
      "configId": "cfg-xxxx",
      "configName": "前端开发服务",
      "command": "npm run dev",
      "cwd": "packages/app",
      "env": { "PORT": "5173" },
      "previewUrl": "http://localhost:5173",
      "startedAt": "...", "endedAt": "...",
      "exitCode": 0,                 // 被强杀时可能为 null/1
      "signal": null,
      "state": "exited",             // exited | failed(仅终止后的终态入库)
      "stopped": false,              // true = 用户 run_stop 终止
      "spawnError": null,
      "output": [                    // 最多 500 行(环形缓冲截尾)
        { "seq": 1, "stream": "stdout", "text": "..." }
      ]
    }
  ]
}
```

- 写盘时机:配置增删改/复制、每次 run 结束入库时(临时文件 + rename 原子替换)。
- 工作区根目录取 `$ZCODE_WORKSPACE_ROOT`(plugin.json 注入 `${ZCODE_PROJECT_DIR}`),
  测试/独立运行时回退 `process.cwd()`。
- **状态语义**:`running` 进程存活;`exited` 正常退出(exit 0)或用户停止;
  `failed` 非 0 退出、信号终止或 spawn 失败。`stopped: true` 标记用户主动停止,
  面板据此显示"已停止"而非"失败"。

## 桥协议结论(反推自 ZCode 官方 pdf-plugin,集成期需联测校验)

来源:`D:\ZCode\resources\glm\packages\pdf-plugin\` 的
`.zcode-plugin/plugin.json` + `dist/ui/panel.html`(600KB bundle)逆向分析:

1. **传输**:面板 iframe 是一个完整 MCP client。JSON-RPC 2.0 消息**原样**
   经 `window.parent.postMessage(msg, "*")` 发出,`window.addEventListener("message")`
   收取,`e.source === window.parent` 校验;无额外封包。
2. **握手**:`initialize`(`protocolVersion: "2025-06-18"`)→ `notifications/initialized`
   → `ui/notifications/initialized`(UI 扩展握手,initialize 结果中宿主附带
   `hostCapabilities`/`hostInfo`/`hostContext`)。
3. **调用**:标准 MCP `tools/call`、`resources/read`、`resources/subscribe`;
   服务端用 `notifications/resources/updated { uri }` 推送更新。
4. **面板资源**:服务端以 `mimeType: "text/html;profile=mcp-app"` 注册
   `ui://<name>/panel.html` 资源(pdf 的还带 `_meta: {"zcode/csp": {wasmUnsafeEval: true}}`),
   宿主通过 `resources/read` 取 HTML 装载进 iframe。
5. **UI 扩展通知**:面板可发 `ui/notifications/size-changed {width, height}`;
   宿主可发 `ui/notifications/request-teardown` 等。
6. **工具可见性**:工具 `_meta.ui = { resourceUri, surface, visibility }`,
   visibility 取值 `"model"`(Agent 可调)/ `"app"`(面板可调),本插件全部为两者。

**适配层**:`ui/panel.html` 内的 `Bridge` 代码块(callTool / readResource /
subscribe / onResourceUpdate / sendSizeChanged)按上述协议实现,集中封装、
便于集成期一处替换。以下点位需与真实宿主联测确认:
- initialize 结果的扩展字段(hostCapabilities 等)对宿主是否必需回传;
- `notifications/resources/updated` 在宿主侧是否要求先 subscribe 才转发;
- `ui/notifications/size-changed` / `request-teardown` 的确切行为;
- iframe `window.open` 打开预览是否被宿主沙箱允许(必要时改为宿主动作)。

## Windows 进程树终止方案

`spawn(command, { shell: true })` 在 Windows 上的直接子进程是 `cmd.exe`,
真正的目标进程是孙进程。**关键点:`child.kill()` 在 Windows 只会终止 cmd.exe
本身(TerminateProcess),孙进程存活且会触发 `exit` 事件提前结束状态机**——
因此本实现不在停止路径上调用 `child.kill()`,而是:

1. **优雅期**:`taskkill /pid <shellPid> /T`(不带 /F,向树内各进程发 WM_CLOSE,
   对 GUI 程序等价于温和关闭;控制台程序多数忽略);
2. **超时(默认 2s,`run_stop` 的 `timeoutMs` 可调)后强杀**:
   `taskkill /pid <shellPid> /T /F` 整树强杀(taskkill /T 按父子关系枚举,
   不依赖根进程存活);
3. taskkill 本身失败(如缺失)才回退 `child.kill("SIGKILL")` 兜底。

POSIX 路径:spawn 时 `detached: true` 建独立进程组,停止用
`process.kill(-pid, "SIGTERM")` → 超时 `SIGKILL`。

测试(`tests/run/test-server.mjs`)对此做了真实校验:运行命令先打印自身
`PID=<inner>`,`run_stop` 后断言该 pid 已不存在(`process.kill(pid,0)` 抛 ESRCH)。

## 面板功能(FR-4 对照)

- **FR-4-1 运行配置管理**:左侧列表 + 表单(名称/启动命令/工作目录/
  环境变量 KEY=VALUE 行/预览地址),新建/保存/删除/复制;双击配置直接运行。
- **FR-4-2 一键运行/停止**:运行按钮 / 活动运行 chip 上的停止按钮;
  输出控制台实时回流(自动滚动、清空、复制),资源更新通知 + 1.2s 轮询兜底。
- **FR-4-3 任务历史**:表格(配置/命令/起止时间/退出码/状态),查看历史输出
  (run_output 游标拉取,含已结束运行)。
- **FR-4-4 预览联动**:配置含预览地址且最近一次运行成功(未被停止)时,
  顶栏"打开预览"与历史行"打开预览"按钮可点。
- **FR-4-5 持久化**:配置与历史落盘 `.hba/run.json`,跨会话保留
  (历史输出为截尾快照,活运行的完整输出仅在环形缓冲内)。

## 测试

```
node --test tests/run/test-server.mjs
```

真实 spawn `server.mjs` 走 JSON-RPC,覆盖:握手/工具与资源清单、panel.html 资源读取、
配置 CRUD + `.hba/run.json` 落盘校验、run_start 真实长跑命令 + run_output 流式输出 +
run_stop 进程树终止校验、环境变量透传、自然退出/失败退出状态机、并发多 run、
run_history(含历史输出回读)、resources 读与订阅通知、工具校验错误。
临时工作目录在系统 temp 下创建,测试结束清理(Windows 下 rm 带重试)。

## 遗留事项

1. **桥协议为反推结论**,与宿主的联测校验点见「桥协议结论」小节;若宿主实际
   协议有出入,只需替换 `panel.html` 中的 `Bridge` 代码块。
2. **进程树强杀的完备性**:Windows 下未使用 Job Object。极端场景(优雅期
   taskkill 枚举树的同时根进程自行退出)可能遗留孙进程;常规 run_stop 路径
   (/T 两次)已由测试覆盖。彻底方案可引入 Job Object(kill-job 兜底)。
3. **历史输出截尾**:历史入库最多 500 行/条、50 条;活运行环形缓冲 2000 行。
   如需完整日志可后续落盘 `.hba/logs/<runId>.log`。
4. **run.json 并发写**:单 server 实例(isolation: workspace)串行写,当前安全;
   多工作区多实例各写各的文件,无共享。
5. **预览打开方式**:当前 `window.open`;若宿主沙箱限制弹窗,可改为发送
   ui 扩展通知请宿主打开(待联测确认)。
6. `cwd` 不存在时 spawn 会失败并记为 `failed`(spawnError 字段),面板未做
   预校验提示。
