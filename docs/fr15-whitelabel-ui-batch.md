# fr15 白标 UI 批次:六项产品修正(2026-10-29)

用户六项(安装 r14 后反馈):①自动化打不开;②左上角图标不要;③新会话大图标调小并与
发送框加间距(图1);④创建项目弹框精简——不要项目名输入与项目类型(设备)下拉,只选
文件夹,「不在项目中工作/新建远程连接」留在菜单,不在弹框二次选择(图2);⑤对话区右上角
任务列表/Git 无任务无变更时不显示,但 git 拉取+分支要一直显示,非 git 项目不显示对应按钮;
⑥设置弹框删智谱默认选项、内部套餐等全部干掉、去「自定义供应商」Label,默认就是用户自配。

## 变更内容(补丁 `fork/patches/fr15-01-whitelabel-ui-batch.patch`,14 文件)

1. **自动化打不开(回归修复,fr14 引入)**:`WorkspaceSidebarFooter` 的 onClick 直传
   `OpenAutomationsMain`,点击事件被当成 `automationId` 传入 → 改 `() => onOpenAutomations()`;
   测试补「无参调用」回归断言。
2. **去左上角图标**:标题栏侧栏切换按钮改为面板图标常驻(不再显示应用图标/悬停翻转);
   设置页 Windows 左上角 logo(`WindowsTopLeftLogo`)一并移除。
3. **新会话大图标**:问候语上方品牌徽标由 400px 水印式大图改为 80px 圆角小徽标,图标在上、
   问候在下,底部间距 40→64px(sm: 32→48),不再与文字叠放/紧贴发送框。
4. **创建项目弹框**:创建态只保留「源文件夹」——项目名输入删除(服务按目录自动命名,
   saveProject 不传 name)、设备下拉删除(不在弹框做本地/远程二次选择;远程走菜单
   「新建远程连接」);编辑既有项目与远程固定目录确认保留名字输入。
   > **更正(2026-10-29,fr16)**:设备下拉删多了——用户定夺「仅删除项目名称就行」,
   > 设备(项目类型:本机/远程服务器)下拉与「已有项目」入口由 `fr16-01` 还原(见
   > `fr16-project-device-restore-and-connection-name.md`);本批补丁保留 r15/r16 实发
   > 记录不动,叠加 fr16-01 后以还原后行为为准,回滚须先撤 fr16-01 再撤 fr15-01。
5. **右上角 git 快捷簇**:新增常驻簇(git 项目才显示)= 拉取 + 分支切换 + 有变更时的更改
   入口(+a/-r) + 更多 Git 操作;状态胶囊维持「有任务/变更等内容才显示」,空会话不再留空壳;
   非 git 项目无 git 按钮;任务列表(进程)区本就无任务不渲染。
6. **设置供应商清理**:导航只列用户自定义供应商(智谱预置组与套餐连接入口隐藏),
   「自定义供应商」分组标签去掉;模板选择器去智谱模板组;使用统计去「个人套餐」页签
   (只留应用用量)。实现走渲染层过滤(`ModelProviderSection.visibleNavigationGroups`),
   hook 层语义与套餐逻辑保留(深度拆除留待后续批次)。

## 验证

typecheck 0 错误;回归 547/547(modelProvider 全系/projectCreation 重写后/projectEditorLayout
按创建|编辑|本地|远程四态拆分/composerMenu/状态面板×2/usage/空态/footer/桌面 logo);
另跑设置壳/登录供应商/草稿面 73/73。`git apply --reverse --check` 在干净重放树与开发树双向通过。
测试契约同步:projectCreation 删 18 个已下线交互用例(设备流/项目名),新增 folder-only 契约;
projectEditorLayout 转编辑态校验名字/设备布局、创建态校验目录浏览。

## 复现(在 fr14 之后叠加;注意 fr9-12 补丁与 fr13-01 在 locale 区有顺序敏感,
建议顺序:fr9-01→fr10-01→fr11-01→fr12-01→fr13-01→apply-whitelabel→fr13-02→
generate-icons→fr14-01→fr15-01;若 fr10 locale hunk 冲突可 `git apply -3` 局部三方合并)

`git apply fork/patches/fr15-01-whitelabel-ui-batch.patch`


## 追加:fr15-02 分支弹层补齐 git 操作(2026-10-29)

用户追加:新建对话区的分支切换弹层(图:搜索分支/分支列表/创建并检出新分支/Git 图谱)也要有
「拉取 / 提交或推送」按钮,与对话区右上角任务列表面板内的 git 面板一致。

- 补丁 `fork/patches/fr15-02-branch-switcher-git-actions.patch`(2 文件,纯新增 44 行):
  `GitBranchSwitcher` 的弹层 footer 在「创建并检出新分支 / Git 图谱」之前新增——拉取
  (useGitPull,拉取中显示转圈)与「提交或推送」(GitActionMenu,status-row 同款触发器,
  点击收起弹层再开对话框)。所有走 showFooterActions 的分支弹层统一生效(合成区芯片、
  右上角面板与 git 快捷簇的分支弹层),GitActionMenu 对话框内嵌的分支切换器(showFooterActions=false)不受影响。
- 验证:typecheck 0;gitBranchSwitcher/gitActionMenu/状态面板 6 文件 82/82(测试 mock 补
  ArrowDownToLineIcon、GitActionMenu、useGitPull 桩);`git apply --reverse --check` 通过。
