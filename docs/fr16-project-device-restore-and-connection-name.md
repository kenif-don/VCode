# fr16 创建项目弹框还原设备下拉 + 新建远程连接自定义名称(2026-10-29)

用户两项(r16 装后反馈修正,2026-10-29):① fr15 第④项删多了——创建项目弹框精简时把「项目类型(设备)下拉」一起删了,应**只删项目名输入**,设备选择(本机项目/远程服务器项目)要还原;「不在项目中工作/新建远程连接」维持留在菜单,不回弹框。② 新建远程连接的弹框加「自定义名称」——否则添加完还要去 设置面板 再改一次自定义名称,在添加时一次性解决最好。

## 范围

- **改**:创建项目弹框还原设备(项目类型)下拉——本机/远程服务器/添加远程设备…,含远程设备下「这台设备上已有项目？」入口;新建连接表单增加「自定义名称」字段(SSH/WSL/Docker;Server 类型表单自带「显示名称」,不重复出字段),连接成功后一次写入设备名与本次连接的线路名。
- **不改**:项目名输入维持删除(服务按目录自动命名,saveProject 不传 name);编辑既有项目与远程固定目录确认仍保留名字输入;目录步「设备名称」改名行与 设置·远程设备 的改名入口保留不动。

## 变更内容(补丁 `fork/patches/fr16-01-project-device-restore-and-connection-name.patch`,11 文件)

1. **创建项目弹框设备下拉还原**(`project-sidebar/ProjectEditor.tsx`):设备块门从 `{devices && project ?` 放回 `{devices ?`,创建态重新可选 本机/远程设备/添加远程设备…,「这台设备上已有项目？」入口随块回来;项目名输入保持 `project || fixedFolder` 门(仅编辑既有项目与远程固定目录确认可见)。
2. **新建远程连接自定义名称**(`RemoteConnectionDialogContent.tsx` + `remote-connection-flow/index.ts`):
   - `RemoteConnectionSettingsStep` 新增可选 `customName`/`onCustomNameChange`,渲染「自定义名称」输入(留空使用默认名称);未传 setter 不渲染——编辑连接弹窗(已有连接名/设备名两字段)不受影响;kind=server 不渲染。
   - 连接成功识别到 Source 后 `applyCustomName` 一次写入:`renameSource`(设备名——侧栏远程菜单/项目弹框设备下拉/设置·远程设备 卡片展示的就是它)+ `renameProfile`(本次线路的连接名),彻底免去事后去 设置·远程设备 手动改名;名称与现值相同则跳过该次写入,失败仅记日志不打断连接(输入框保留,目录步/设置改名入口兜底),成功后清空输入避免下一次连接沿用同一名称。
3. **i18n / test-ids**:`remote.customName`、`remote.customNamePlaceholder`、`remote.customNameHint`(zh-CN / en-US);`@zcode/shared/test-ids` 新增 `TID_REMOTE_CUSTOM_NAME_INPUT`。

## 测试契约同步

- `projectCreation.test.ts`:fr15 把设备流/已有项目共 18 个用例整体删除,且把文件改出重复块(第 406 行 `});(` 粘贴事故,同一套用例被注册两遍)。本批按 fr15-01 补丁反向还原基线后,以「无名字输入、保留设备流」为契约改编恢复:设备选择/切换确认/添加设备往返/离线连接/快照刷新不顶掉所选设备/共享 Host 无添加入口/仅列已识别设备/已有项目系列(离线意图、迟到列表丢弃、只读 legacy、取消不登记、错误文案、无 Source 管理的共享 Host)全部回归;名字输入相关探针改为目录行/设备选择;新契约用例「创建表单无名字输入但有设备下拉,保存不传 name」。
- `projectEditorLayout.test.ts`:新增创建态布局契约「设备在目录之前且无名字输入」;「已有项目」入口用例回到创建态并恢复 entry-before-browse 顺序断言。
- `remoteNewConnectionForm.test.ts`:新增「自定义名称」3 用例——字段受控渲染+提示文案、连接成功后 renameSource("source-1","测试服务器")+renameProfile("profile-1","测试服务器") 并清空输入、留空不改名。
- `projectFolderTrust.test.ts` / `projectEditorOwner.test.ts`:fr15 删名字输入时漏改的同批旧契约(直接在创建态对 `virtual-project-name` 打字/探针,fr15 状态下 5+1 条已红)——一并改编到最终契约:名字交互删除,表单探针换保存按钮,保存断言改「不传 name」。
- **补丁台账**:fr15-01 补丁文件保持原样(如实记录 r15/r16 实发内容);fr16-01 与其在 ProjectEditor 与两个测试文件上重叠并取代之——**整体回滚顺序必须先 `git apply -R fr16-01` 再 `git apply -R fr15-01`**;fr15-01 的 `--reverse --check` 在叠加 fr16-01 后不再单独通过(重叠区被取代),其余补丁互不重叠不受影响。

## 验证(实测)

- `pnpm run typecheck`:**0 错误**。
- 本批直面单测:projectCreation **44/44** + projectEditorLayout **7/7** + projectEditorOwner **3/3** + projectFolderTrust **11/11** + remoteNewConnectionForm **15/15**(含新 3)= **80/80**;相关远程连接面(editConnectionProfileDialog / remoteConnectionFlowRecovery / sshDialogFlow / remoteConnectionDialogContentLayout / remoteConnectionWizard / remoteConnectionFieldsPlaceholder / remoteI18nPlaceholderValues)**205/205**。
- 全量 `pnpm run test:unit`(日志本地留档 `scratch/unit-test-fr16.log`,按 `*.log` gitignore 惯例不入库):19716 通过 / 157 失败(2052 文件)。**失败归因**(以 `git apply -R fr16-01` 精确回退到 fr15 状态后重跑对照):本批已顺手修复 fr15 漏改的 projectFolderTrust 5 条 + projectEditorOwner 1 条;其余失败与 fr15 状态**逐文件等同**——useAppPanelsScope 6 条系 fr8 遗留(fr12 文档已记),agentToolCallBlock 17/17、useCodingPlanQuotaResetUi 26/26、storeOAuthRestoreState 8/8、powershell/installer/paths 等为本机既有环境问题,均与本批改动无关。
- fr16-01 补丁在 fr15 实发状态上正向应用、在当前树反向应用双向 `git apply` **零 fuzz**(scratch round-trip 核对;反向产物哈希 = fr15-01 post-image 哈希 `6fd53024`/`43c3a073`/`01565749`,与补丁 index 声明一致)。

## 复现(在 fr15-02 之后叠加)

```bash
git apply fork/patches/fr16-01-project-device-restore-and-connection-name.patch
```

## 验证步骤(重打包/热替换后)

1. 创建项目弹框:应看到 设备下拉(本机 + 远程设备 + 添加远程设备…)+ 源文件夹区,**没有**项目名输入;选远程设备能浏览其目录并创建项目(本机/远程服务器两种项目类型可选)。
2. 菜单「新建远程连接…」:连接表单带「自定义名称」输入;填「测试服务器」完成添加后,侧栏远程菜单、项目弹框设备下拉、设置·远程设备 卡片都显示「测试服务器」,编辑连接的连接名/设备名同为该值——无需再去设置面板改名。
3. 名称留空添加:设备名保持默认,目录步「设备名称」改名行照旧可用;编辑既有项目的弹框仍有名字输入。
