# fr17 删右上角 Git 快捷簇 + 进程面板 Git 操作区常驻(2026-10-29)

用户定夺(r17 装后反馈,配图):对话区右上角那条 Git 快捷簇(拉取 + 分支切换 + 更改入口 +「提交或推送」)**不要了**——右侧进程面板里的 Git 操作区就已经满足要求;但该 Git 操作区要**一直显示**:只要是 git 项目就一直显示,而不是有变更才显示。

## 范围

- **改**:删除对话区右上角的 Git 快捷簇(`GitControlCluster`,含拉取/分支切换/更改入口/「提交或推送」一整条);进程面板(状态面板/胶囊)里的 Git 操作区改为 git 项目**常驻显示**——去掉「worktree 有行级变化才展示 Git Tools」的门控。
- **不改**:进程面板 Git 操作区自身内容(更改入口、分支切换、拉取、提交或推送)与分支弹层 footer 的拉取/提交或推送(fr15-02)不动;非 git 空会话仍不留空壳;办公模式仍无 Git 区。

## 变更内容(补丁 `fork/patches/fr17-01-remove-git-quick-cluster-pin-git-section.patch`,4 文件)

1. **删 Git 快捷簇**(`v4/ConversationStatusPanel.tsx`):`GitControlCluster` 组件与渲染位整体移除,`showGitCluster` 门控删除,右上角只剩进程面板(状态胶囊/面板)。
2. **Git 操作区常驻**(`v4/conversationStatusPanelModel.ts`):`buildGitModel` 去掉 `added + removed <= 0 → null` 的「有变更才显示」门控——git model 对任何 git 仓库非空,`hasContent` 随之恒真,面板(含 Git 操作区)对 git 项目始终可见,clean repo 同样给出 更改(+0/-0)、分支切换、拉取、提交或推送。

## 测试契约同步

- `v4ConversationStatusPanelModel.test.ts`:「does not show git tools for a clean repository without worktree line changes」按新定夺反转为「shows git tools for a clean repository…」(hasContent=true、git model 为 `{added:0, removed:0, isClean:true}`)。
- `v4ConversationStatusPanel.test.ts`:mini 壳用例去掉「git-control-cluster / mock-git-action-menu」快捷簇断言(簇已删,mini 态只剩一行 git 摘要)。

## 验证(实测)

- `pnpm run typecheck`:**0 错误**。
- 状态面板三件套(v4ConversationStatusPanel 59 + Model + GitReview)**88/88**;布局/SessionPane 面(v4SessionPaneLayoutParity / v4AssistantPreviewCards / ComposerContinuity / ReadOnly / ErrorBanner)**75/75**。
- fr17-01 补丁在 fr16 状态上正向应用、当前树反向应用双向 `git apply` **零 fuzz**(scratch round-trip;a-side = fr15-01 post-image `d87c74bb`/`fb680c92` 与两文件 HEAD 原像,无其他补丁重叠)。

## 复现(在 fr16-01 之后叠加)

```bash
git apply fork/patches/fr17-01-remove-git-quick-cluster-pin-git-section.patch
```

## 验证步骤(重打包/热替换后)

1. 打开任意 git 项目的空会话(无任务无变更):右上角**只有**进程面板(胶囊),点击展开应直接看到 Git 操作区——更改(+0/-0)、分支切换、拉取、提交或推送;不再出现那条独立的 Git 快捷簇。
2. 有变更时:Git 操作区的更改入口显示 +a/-r,点开审阅;「提交或推送」照旧打开 GitActionMenu。
3. 非 git 项目空会话:右上角仍什么都不显示(不留空壳)。
