# fr19 插件面板会话容错(会话删除/归档不再挂死项目级面板)

## 背景(事故现象)

运行面板（hba-run）挂到项目级共享后（fr7/fr8），面板实例的宿主管道仍把会话钉在**创建会话**上：

1. 面板的 `mcp/ui*` 调用（tools/call、resources 等）携带 `sessionId=创建会话`，CLI 侧
   `requireSession` 在会话运行时消失（归档即从活跃注册表移除，删除连持久化记录一并清掉）后
   抛 `Session is not active: <id>`，面板整体报错挂死；
2. 资源推送链路（`notifications/resources/updated`）按订阅键中的会话路由，会话消失后更新被
   丢弃；任务删除事件还会把面板页面整页回收（`removeTask`）。

即 fr8 只把 ui/message/模型上下文改绑到"当前活跃对话"，租约、订阅、AppBridge 归属、
surface key 仍绑创建会话——"面板状态共享"≠"面板通道去会话化"。

## 修复（两层）

### CLI 侧（apps/zcode-cli/packages/bootstrap）

- `server-types.ts` 新增 `requireSessionForMcpUi`：锚定会话缺失时回退到同一 CLI 内任一
  存活会话记录（插件 server 声明 `isolation: "workspace"`，fr11 后连接池工作区级共享，
  任一存活记录的 app 都能到达同一 server）；归属校验仍按请求自带的 sessionId/scopeId 在
  `mcpUiInstances` 内完成，不放松。零存活记录仍按 sessionUnavailable 失败。
  另加 `isSessionRecordLive`（回退代理记录按"仍在活跃表"判断）。
- `mcp-ui/{protocol,appToolsProtocol,samplingProtocol}.ts` 全部 `mcp/ui*` 处理器换用该解析；
  `openMcpUiInstance` 的记录同一性守卫改用 `isSessionRecordLive`。

### 渲染侧（packages/ui）

- `contract.ts`：`buildPluginUiSurfaceKey` 对 surface 作用域的会话位改 `*`（与 fr8 tab id
  同口径）——换锚重绑不换 key，widgetState / surfaceStateKey / 页面实例保持连续；
  toolCall（工具卡片）仍按会话隔离。
- `usePluginUiSidePaneModel.tsx`：面板引入**会话锚点**（默认创建会话，保住工具结果行语义）；
  消亡信号两条——任务删除（`onSessionLost`）与订阅终态失败且错误含会话消亡特征
  （`Session is not active|Session not found|sessionNotFound`）——标记待换锚，活跃会话
  可用时重绑（活跃会话晚于消亡出现同样生效）。其余终态失败走 `store.retry()` 一次。
- `pluginUiManagedPage.ts`：任务删除对 surface 不再 `removeTask`，改 `onSessionLost`；
  `update()` 检测 `scope.sessionId` 变化时整体重绑（suspend+ensure，新租约/新订阅/新归属）。

## 语义变化

- 同插件同 surfaceId 的面板 key 不再按会话拆分：跨会话共用同一面板实例
  （`pluginUiBackground.test.ts` 断言同步改为共享语义）。
- 会话切换不重绑（避免 churn，与 fr8"推送链路不受切换影响"一致）；只在锚点消亡时重绑。

## 验证

- 单测：新增 `bootstrap/tests/mcp-ui-session-fallback.test.ts` 5 例；更新
  `contract.test.ts`/`pluginUiLogicalScope.test.ts`/`pluginUiBackground.test.ts` 断言。
  相关套件 156 例全绿（bootstrap mcp-ui 20 + ui 136），两包 `tsc --noEmit` 0 错误。
- 补丁：`patches/fr19-01-plugin-ui-session-anchor-fallback-rebind.patch`（12 文件）对当前树
  `git apply --check --reverse` 通过（精确对应本次增量）。

## 已知退化边界

工作区**一个会话都不剩**时，`mcp/ui*` 调用没有可回退的会话记录，面板操作仍报
`Session is not active`（推送同理）；任意会话（含新对话发出首条消息）出现后自愈。
彻底零会话可用需要引入工作区级合成锚点会话，涉及会话注册与权限链路，暂缓。

## 部署记录（2026-10-30）

- 构建：`pnpm run build` + `packages/desktop: node scripts/bundle.mjs --os win --arch x64`
  （产出 `dist/VCode-3.16.2-win-x64.exe` 156.4 MiB）。
- 部署：`dist/win-unpacked/resources/{app.asar, glm/zcode.cjs}` → `D:\ZCode\VCode\resources\`
  （SHA-256 校验一致）；部署前备份 `app.asar.bak-20261030-fr19`、`glm/zcode.cjs.bak-20261030-fr19`。
- 生效：zcode.cjs 对新建 CLI 会话即时生效；app.asar 需重启 VCode 生效。
