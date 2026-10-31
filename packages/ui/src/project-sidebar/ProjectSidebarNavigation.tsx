import type { ProjectSidebarProps } from "@/project-sidebar/contract.js";
import { NewTaskButtonGroup } from "@/NewTaskButtonGroup.js";
import { WebRemoteControlDeviceHeader } from "@/web-remote-control/WebRemoteControlDeviceHeader.js";

/** 顶部导航只展示 Shell 的选中状态，路由仍由 Shell 唯一持有。 */
export function ProjectSidebarNavigation({
  props,
  onCreate,
}: {
  // 自动化/插件市场入口已迁至底部图标行（WorkspaceSidebarFooter），不再从这里进入。
  props: Pick<ProjectSidebarProps, "isWebRemoteControl" | "webRemoteControlWorkspaceSwitcher">;
  onCreate(): void;
}) {
  const deviceNavigation = props.webRemoteControlWorkspaceSwitcher?.deviceNavigation;
  return (
    <div
      data-testid="sidebar-primary-navigation"
      className={`flex flex-col gap-1 px-2 py-3 ${props.isWebRemoteControl && !deviceNavigation ? "max-md:pt-11" : ""}`}
    >
      {/* Relay V2 远控：当前电脑是项目与任务的上一级，放在导航首行；手机端占用原顶部留白。 */}
      {deviceNavigation ? <WebRemoteControlDeviceHeader navigation={deviceNavigation} /> : null}
      <NewTaskButtonGroup onCreateTask={onCreate} />
    </div>
  );
}
