# fr14:自动化/插件市场入口迁至底部图标行(2026-10-29)

用户诉求:「把左侧新建任务下面的自动化按钮放到最底部最左侧,仅显示图标不显示文字,
就是底部统计的左侧;插件市场也是,放在统计之后。就是把入口换一下。」

## 变更内容(补丁 `fork/patches/fr14-01-footer-entry-row-icons.patch`,5 文件)

- **底部入口行新顺序(全部仅图标 + 悬停提示/aria-label)**:
  自动化(CalendarClock) | 使用统计(BarChart3) | 插件市场(Blocks) | 手机连接 | 设置。
- `WorkspaceSidebarFooter.tsx`:行内新增两个图标按钮(沿用统计/设置的
  ControlHintTooltip + ghost icon-lg 规格);`automationsActive`/`pluginStoreActive`
  映射 `aria-pressed` + `bg-selected` 选中态;handler 为可选——Settings 复用 footer
  时不传即不显示,Settings 页不受影响。testid 沿用 `TID_AUTOMATIONS_OPEN` /
  `plugin-store-sidebar-open`(e2e 选择器不变)。
- `project-sidebar/ProjectSidebarNavigation.tsx`:删除「新建任务」下方两个文字入口
  (CalendarClock/Blocks 文字按钮)及其文案,顶部只剩设备头 + 新建任务。
- `project-sidebar/index.tsx`:footer 透传 4 个入口 props。
- 测试:`workspaceSidebarWebRemoteMobileLayout.test.ts` 改断言顶部导航已无两入口
  (该文件 footer 是桩);新增 `workspaceSidebarFooterEntryRow.test.ts` 直测入口行
  顺序/仅图标/点击路由/条件渲染/选中态(3 用例)。

## 验证

typecheck 0 错误;受影响单测 9 文件 95/95 全绿(含新增 3 用例);
`git apply --reverse --check` 通过。TaskGroupedView 内的自动化入口(分组视图)
不在本诉求范围,未动。

## 复现

在 fr13 四步管线之后叠加:
`git apply fork/patches/fr14-01-footer-entry-row-icons.patch`
