# FR-3 Git 面板方案:worktree 隔离会话入口

目标(PRD 6.3 / 表 6-3 / FR-3-2,原文):采用 ZCode 内置 Git 面板(产品名"审查"),仅补齐差异——**"补齐 worktree 隔离会话入口:从 UI 创建独立 worktree 并在新会话中打开"(P1)**。G3:"Git 面板体验不低于 HBA 现状,并补齐 worktree 隔离会话入口";S5:"创建 worktree 隔离会话进行高风险实验"。

基线:上游 `zai-org/ZCode` commit `3c5b227`(version 3.16.2),源码本地路径 `C:\Users\76437\AppData\Local\Temp\zcode-src\zai-org-ZCode-3c5b227\`(下文相对路径以此为根)。改动落盘于 `fork/patches/fr3-01-*.patch`、`fork/patches/fr3-02-*.patch`(基线上 `git apply --check` 通过)。

---

## 1. 现状(证据:已核实于源码)

### 1.1 GitPane(审查面板)

- 组件 `packages/ui/src/GitPane.tsx`(546 行):来源切换(未暂存/已暂存/分支对比/上一轮/冲突)、虚拟列表变更卡片 `GitPaneChangeCard`、diff 懒加载、右键菜单(复制路径/文件管理器中显示/文件树中定位);
- 渲染点:右侧面板 git 页签 `packages/ui/src/app-shell/AnimatedSidePanePanel.tsx`(`tab.type === "git"` → `<GitPane …>`);页签创建 `packages/ui/src/lib/workspaceSidePane.ts`(`createGitSidePaneTab`/`activateGitSidePane`,由 `useAppPanels.ts` 的 `handleToggleGit`/`handleOpenGit` 调度);
- 分支/提交/推送入口:`packages/ui/src/GitActionMenu.tsx`(含 `GitCommitDialog`/`GitPushDialog`/`GitBranchSwitcher`),挂在 `packages/ui/src/v4/ConversationStatusPanel.tsx`;分支切换已带 worktree 感知错误(`git.branchSwitcher.error.branchInOtherWorktree`,"目标分支已在其他 worktree 中被检出");
- 数据层:`packages/ui/src/hooks/useGitRepository.ts` → `gitService`(`packages/services/src/git/gitService.ts`,接口 `packages/services/src/git/git.ts` 的 `IGitService`)→ `GitCliRepo`(`packages/services/src/git/repo/gitCliRepo.ts`,经 `providers/gitCommandProvider.ts` 调 git CLI)。

### 1.2 worktree 相关既有能力(证据)

| 能力 | 现状 | 位置 |
|---|---|---|
| linked-worktree 识别 | 已有:`GitWorkspaceRepositoryKind = "not-repository" | "main-tree" | "linked-worktree"`(经 `.git/worktrees/` 结构判别) | `packages/shared/src/git.ts`、`packages/services/src/git/repo/gitCliRepo.ts`(worktree 判别注释段) |
| 分支被其它 worktree 占用识别 | 已有:git 报错 `is already used by worktree at` → issue `branch-in-other-worktree` | `packages/services/src/git/repo/gitCliHelpers.ts` |
| worktree 创建 | **无**:`IGitService` 20 个方法无 worktree 建/删/列 | `packages/services/src/git/git.ts`(证据:接口全文核实) |
| 流程内 worktree 隔离 | 声明了未实现:workflow agent `isolation:"worktree"` 直接抛 `not implemented yet` | `apps/zcode-cli/packages/bootstrap/src/app/script-workflow-runtime.ts`(throw 处) |
| 内置技能 | `using-git-worktrees` 技能存在("确保存在隔离 workspace,优先使用原生工具,否则回退 git worktree") | `packages/ui/src/lib/builtinSkillI18n.ts` |

结论:FR-3-2 需要**新增** worktree 创建能力(服务层)与 UI 入口;恰好可参照同层 `createBranchAndSwitch` 的校验/报错映射模式,以及既有 `linked-worktree` 识别(创建后 Git 面板/分支切换即天然兼容)。

### 1.3 新会话打开机制(证据)

- `packages/ui/src/app-shell/types.ts`:`CreateTaskOptions.targetWorkspace: { projectId?; hostId?; workspacePath; workspaceIdentity? }`——"新任务落在哪个 workspace;缺省取活动 workspace"(跨项目发起已有成熟路径);
- `packages/ui/src/app-shell/WorkspaceShellLayout.tsx`:`handleCreateTaskInChat`(带 targetWorkspace 时跳过活动 workspace 只读检查,交 root 动作校验目标);
- `packages/ui/src/App.tsx` `handleStartDraftInWorkspace`:确保目标 workspace 打开(`addTab`/`activateTabByPath`)后 `store.startDraft(...)`——即"以某路径为工作区开新会话"的底层实现;
- `AnimatedSidePanePanel` 已接收 `onCreateTask` prop(现供工作流相关面板使用),GitPane 可直接复用。

## 2. 方案(创建流程与 UI 交互建议)

**流程**:GitPane 入口按钮 → 对话框(名称/新分支/起始引用)→ `gitService.createWorktree`(底层 `git worktree add -b <branch> <repoRoot>/.hba/worktrees/<name> [<startPoint>]`)→ 成功后 `onCreateTask({ targetWorkspace: { workspacePath: <worktreePath> } })` 在 worktree 目录打开新会话 → 新会话内 Git 面板/分支切换经既有 `linked-worktree` 识别正常工作。

**命名规则(建议,按任务书 `.hba/worktrees/<name>` 约定)**:

| 项 | 规则 | 说明 |
|---|---|---|
| worktree 目录 | `<repoRoot>/.hba/worktrees/<name>` | 与 HBA 业务数据 `.hba/` 同根;`<name>` 白名单 `[A-Za-z0-9._-]`(服务层强校验,防路径穿越) |
| 新分支 | `hba/<name>`(对话框可改) | 经 `git check-ref-format --branch` 校验(复用 `validateBranchName`) |
| 起始引用 | 缺省 HEAD | 可填分支/标签/提交 |

**UI 交互建议**:

1. **入口按钮位置**:GitPane 头部右侧按钮组,与"刷新"按钮并排(`GitForkIcon` + 文案"Worktree 会话",i18n `git.worktree.create`)——审查面板是 PRD 指定的入口面(表 6-3"补充入口"),头部常驻可见、不挤占变更列表;
2. **对话框**(新组件 `GitWorktreeDialog`):名称(必填,失焦即时校验)、新分支(占位显示缺省 `hba/<name>`)、起始引用(可选);主按钮"创建并打开会话";失败时错误行显示首个 issue 的 message(重名/非法名/分支占用/冲突/操作进行中);
3. **降级**:`onCreateTask` 未接通时仅创建 worktree 不开会话(按钮仍可用);远程 workspace 的 worktree 本期不支持(见待确认)。

## 3. 修改点列表(精确到文件/组件/函数)

### 3.1 服务层(fr3-01)

| # | 文件 | 符号 | 改动 |
|---|---|---|---|
| 1 | `packages/shared/src/git.ts` | `GitCreateWorktreeRequest` / `GitCreateWorktreeIssueCode` / `GitCreateWorktreeIssue` / `GitCreateWorktreeResult`(**新增**) | 请求/结果类型;issue 码:`invalid-name`、`path-exists`、`branch-exists`、`conflicts-present`、`operation-in-progress`、`command-failed` |
| 2 | `packages/services/src/git/git.ts` | `IGitService.createWorktree`(**新增方法**) | `createWorktree(params: GitCreateWorktreeRequest): Promise<GitCreateWorktreeResult>` |
| 3 | `packages/services/src/git/gitService.ts` | `createGitService` 返回对象 | 委托 `repo.createWorktree(workspacePath, name, branchName?, startPoint?)`(与 `createBranchAndSwitch` 同形态) |
| 4 | `packages/services/src/git/repo/gitCliTypes.ts` | `GitCliRepo.createWorktree`(**新增方法**) | 接口签名 |
| 5 | `packages/services/src/git/repo/gitCliRepo.ts` | `createWorktree` 实现(插在 `createBranchAndSwitch` 后) | 名称白名单校验 → 分支名校验(`validateBranchName`)→ 冲突/进行中守卫(`hasOperationInProgress`)→ 目标路径存在校验(`fileExists`)→ `commandProvider.run(["worktree","add","-b",branch,worktreePath,(startPoint)])` → 失败按 stderr 映射 issue → 成功 `invalidate(workspacePath)` 并返回 `{ ok, worktreePath, branchName, summary }` |

### 3.2 UI 层(fr3-02)

| # | 文件 | 符号 | 改动 |
|---|---|---|---|
| 6 | `packages/ui/src/GitWorktreeDialog.tsx`(**新文件**) | `GitWorktreeDialog` | §2 对话框;成功后 `onCreateTask?.({ targetWorkspace: { workspacePath: result.worktreePath } })` 并关闭 |
| 7 | `packages/ui/src/GitPane.tsx` | `GitPane` | props 增 `onCreateTask?`;头部右侧按钮组增 worktree 入口按钮(`GitForkIcon`);组件尾部挂 `GitWorktreeDialog` |
| 8 | `packages/ui/src/app-shell/AnimatedSidePanePanel.tsx` | git 页签渲染处 | `<GitPane … onCreateTask={onCreateTask} />` 透传 |
| 9 | `packages/ui/src/i18n/locales/zh-CN.ts` / `en-US.ts` | `git.worktree.*` 键(**新增**) | 入口文案、对话框标题/字段/提交按钮、错误文案 |

## 4. 补丁文件

| 文件 | 规模 | 内容 |
|---|---|---|
| `fork/patches/fr3-01-git-worktree-create-service.patch` | 5 文件 / +180 −0 | §3.1(类型 + 接口 + 实现) |
| `fork/patches/fr3-02-gitpane-worktree-entry.patch` | 5 文件 / +216 −1 | §3.2(入口 + 对话框 + 接线 + i18n,含 1 个新文件) |

```bash
git apply fork/patches/fr3-01-git-worktree-create-service.patch
git apply fork/patches/fr3-02-gitpane-worktree-entry.patch
# 已在基线 3c5b227 文件副本上验证 git apply --check 通过;与 fr5 两补丁叠加无冲突。
```

## 5. 验收对照 TC-GIT-02(P1,端到端:worktree 创建成功并打开新会话)

| # | 验收点(PRD 表 8-2 TC-GIT-02 / 表 8-3 FR-3 DoD) | 验证方式 |
|---|---|---|
| 1 | worktree 创建成功 | 从 GitPane 入口创建 `feature-x`:`git worktree list` 出现 `<repoRoot>/.hba/worktrees/feature-x`;新分支 `hba/feature-x` 存在(`git branch --list`) |
| 2 | 打开新会话 | 创建后自动打开新会话,其工作区为 worktree 目录(会话内文件树/终端 cwd/Git 面板均指向该目录;新会话 Git 面板显示 clean 或该分支初始状态) |
| 3 | 隔离性 | 新会话内改动只落在 `hba/feature-x`,主工作区分支与暂存区不受影响(反向验证:主工作区 Git 面板不出现该改动) |
| 4 | 失败路径 | 名称非法(含 `/`)、目标路径已存在、分支已存在:对话框显示对应错误,不产生半成品目录 |
| 5 | 既有功能回归(TC-GIT-01,表 8-3"差异、提交、图谱、分支操作与仓库一致") | 创建前后审查面板分组/差异/提交/分支切换均与 `git status` 一致;分支切换到已在其它 worktree 检出的分支仍提示 `branch-in-other-worktree` |

自动化建议(端到端):脚本化点击入口 → 填名创建 → 断言 `git worktree list` 输出 + 新会话 workspacePath === worktree 路径 + 在新会话执行一次文件改动并断言主仓 `git status` 干净。

## 6. 证据(已核实) vs 推断

- **证据(已核实,源码 commit 3c5b227)**:§1 全部现状(GitPane/渲染点/`IGitService` 方法清单/`createBranchAndSwitch` 模式/`linked-worktree` 识别/`branch-in-other-worktree` 映射/workflow isolation 未实现 throw/`CreateTaskOptions.targetWorkspace`/`handleStartDraftInWorkspace`);TC-GIT-02 验收语句(PRD 表 8-2);
- **推断(设计选择,待评审确认)**:命名规则 `.hba/worktrees/<name>` + 分支 `hba/<name>`(任务书约定 + 建议);入口按钮位于 GitPane 头部右侧;对话框字段与降级行为;issue 码表。

## 7. 待确认项

1. **`.hba/worktrees/` 的 git 忽略处理**:worktree 目录位于主工作树内,会在主仓 `git status` 显示为未跟踪内容;建议创建时同步写入 `.git/info/exclude`(不污染用户 `.gitignore`),本补丁**未包含**该步,待确认后补;
2. **worktree 清理入口**(删除 worktree/分支)不在本期(PRD 仅要求创建+打开);高频使用后建议追加;
3. **远程 workspace**(SSH/WSL/Docker,`workspaceIdentity`/`remoteSessionId`)的 worktree 创建:本期仅本地;远程需在远端执行 git 并经 `targetWorkspace` 远端会话链路,复杂度另估;
4. 分支命名前缀 `hba/` 是否固定(HBA 工作流习惯)待产品确认;
5. 本补丁未做本地编译(`pnpm run typecheck`)与端到端实测,属实施阶段必做;`git worktree add` 的 Windows 长路径(仓库深路径 + `.hba/worktrees`)建议在 Windows CI 验证一次;
6. FR-3 其余差异项(FR-3-3 千文件级状态刷新性能、文件引用直达预览交互对齐)不在本文档范围。
