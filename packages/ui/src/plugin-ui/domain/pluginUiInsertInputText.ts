/**
 * 插件 UI「添加到对话」(VCode 扩展桥方法 `ui/insert-input-text`)的 composer 侧契约。
 *
 * 与 workspaceFileDrag 的「加入对话」事件同构:宿主渲染进程内的 window CustomEvent,
 * composer 以 preventDefault 表示已接住。区别于 `ui/message`(以用户身份发送,无手势时
 * 宿主弹「插件想以你的身份发送消息」确认框):本通道只把文本插进当前会话输入框末尾,
 * 不发送、不弹框,由用户自己编辑后发送。
 */
export const PLUGIN_UI_INSERT_INPUT_TEXT_EVENT = "zcode/plugin-ui-insert-input-text";

export interface PluginUiInsertInputTextDetail {
  /** 目标会话(面板绑当前活跃会话);composer 仅接住自己会话的插入请求。 */
  sessionId: string;
  /** 要插入的文本,追加到输入框末尾(光标跟随到末尾)。 */
  text: string;
}

export function isPluginUiInsertInputTextEvent(
  event: Event,
): event is CustomEvent<PluginUiInsertInputTextDetail> {
  return event.type === PLUGIN_UI_INSERT_INPUT_TEXT_EVENT;
}

/** 返回 true 表示有 composer 接住;false 时调用方应回 -32601 供页面降级。 */
export function dispatchPluginUiInsertInputText(detail: PluginUiInsertInputTextDetail): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const event = new CustomEvent(PLUGIN_UI_INSERT_INPUT_TEXT_EVENT, { cancelable: true, detail });
  return !window.dispatchEvent(event);
}
