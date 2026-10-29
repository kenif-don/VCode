# FR-1:HBA 子智能体迁移至 ZCode 定义格式

本文档记录 FR-1 的迁移映射、产物清单、与 HBA 原文的差异点与遗留事项。

## 1. 范围与来源

- **源(HBA,只读)**:`D:\ai_workspace\AI IDE\HBA\seed\agents\` 下 6 个智能体文件,均已逐一核实存在:
  `coder.md`、`reviewer.md`、`architect.md`、`planner.md`、`browser_tester.md`、`ui-gen-assistant.md`。
  (同目录另有 `master.md`、`explorer.md`、`debater.md`、`test_platform.md`,不在 FR-1 范围。)
- **目标(ZCode)**:`hba-on-zcode\agents\` 下 6 个自定义子智能体 Markdown(`~/.zcode/agents/*.md` 或 `<repo>/.zcode/agents/*.md` 同构格式)。
- **格式基准**:`D:\ZCode\resources\glm\packages\pdf-plugin\agents\visual-judge.md`(真实样例);关键字段语义经 ZCode 程序内 agent schema 核对:
  - `color` 合法值:`red / blue / green / yellow / purple / orange / pink / cyan`;
  - `permissionMode` 合法值:`acceptEdits / auto / bypassPermissions / default / dontAsk / plan`;
  - `maxTurns` 为正整数;`background`、`injectAgentsMd` 为布尔;`tools` 为字符串数组;
  - `model` 按 `provider:model` 解析,`thoughtLevel` 作为 reasoningLevel 传给所选模型;
  - 内置智能体名 `Explore`、`general-purpose` 不可占用。
- **HBA 内置指令的实际位置**:`HBA\app\agent\builtin_prompts.py`(group/unified 模式的内置 description、tools、prompt 均在此;seed 文件里的 `<!-- Built-in ... instructions ... provided by HBA -->` 注释即指向它)。seed 文件正文只含附加提示词。

## 2. 字段映射表(HBA YAML → ZCode frontmatter)

| HBA 字段/来源 | ZCode 字段 | 映射规则 |
|---|---|---|
| `name` | `name` | 原样直移;两处按 ZCode 命名规则与任务书改名:`browser_tester` → `browser-tester`、`ui-gen-assistant` → `ui-prototype`。约束:仅字母/数字/连字符、与文件名一致、不占用 `Explore`/`general-purpose` |
| `role: member` | (无对应字段) | 丢弃;成员身份与"只读约束"等行为边界写入正文「角色与工具边界」一节 |
| `model: __PROVIDER_MODEL__` | `model` | 沿用占位写法,占位文本改为 `【provider:model,按部署环境填写】`(YAML 双引号包裹);**部署时必须替换**为真实 `provider:model` |
| `thinking_level` | `thoughtLevel` | 值域映射 `low/medium/high/max`;本次原值直移:`coder`/`reviewer`/`architect`/`planner`/`browser-tester` = low,`ui-prototype`(源 ui-gen-assistant)= medium;校验器与 HBA 原值交叉核对 |
| (无) | `description` | 必填,一句话职责;取 HBA 内置 description(`builtin_prompts.py`)原文 |
| (无) | `color` | 自选(ZCode 合法色板内),见一览表 |
| (HBA 后端内置 tools 表) | `tools` | 按 FR-1 任务书白名单直移(见下);HBA 后端专有工具名(`codegraph_*`/`ssh_*`/`evidence_*`/`browser_*`/`edit_screen`/`review_screen` 等)在 ZCode 无对应,不迁移 |
| (无) | `permissionMode` | 全部 `default`;reviewer/architect/planner 在正文「角色与工具边界」中声明只读约束 |
| (无) | `maxTurns` | 合理默认(按角色工作量):planner 30、reviewer 40、architect 40、browser-tester 60、coder 80、ui-prototype 80 |
| (无) | `background` | 全部 `false`(前台执行并向调用方回报,对齐 HBA lead→member 的委派-回报模型) |
| (无) | `skills` / `injectAgentsMd` / `systemPrompt` | 未设置:`skills` 无 HBA 对应概念;`injectAgentsMd` 用平台默认;系统提示词正文直接写在 frontmatter 之后(与 visual-judge 样例一致) |

**正文(systemPrompt)映射**:正文 = 新增「## 角色与工具边界」一节 + HBA 原文件 frontmatter 之外的全部正文(原样保留)。

- 「角色与工具边界」包含:角色(HBA 内置 description)、工具边界(白名单;reviewer/architect/planner 另有只读约束)、行为边界(HBA\app\agent\builtin_prompts.py 内置指令的要点摘录)、以及"下文正文原样保留并优先遵守"的说明。
- HBA 原文正文(含 `<!-- Built-in ... -->` 注释与全部附加提示词)逐字保留,校验器做逐字节包含比对。

**tools 白名单(FR-1 任务书)**:

| 智能体 | tools |
|---|---|
| coder | Read, Write, Edit, Bash, Grep, Glob |
| reviewer | Read, Grep, Glob, Bash |
| architect | Read, Grep, Glob, WebSearch |
| planner | Read, Grep, Glob, TodoWrite |
| browser-tester | Read, Bash, WebFetch, WebSearch |
| ui-prototype | Read, Write, Edit, Bash, Glob |

## 3. 六个智能体一览

| 目标文件 | name | HBA 来源 | color | thoughtLevel | maxTurns | background | permissionMode |
|---|---|---|---|---|---|---|---|
| agents/coder.md | coder | coder.md | blue | low | 80 | false | default |
| agents/reviewer.md | reviewer | reviewer.md | red | low | 40 | false | default(正文只读约束) |
| agents/architect.md | architect | architect.md | purple | low | 40 | false | default(正文只读约束) |
| agents/planner.md | planner | planner.md | green | low | 30 | false | default(正文只读约束) |
| agents/browser-tester.md | browser-tester | browser_tester.md | orange | low | 60 | false | default |
| agents/ui-prototype.md | ui-prototype | ui-gen-assistant.md | pink | medium | 80 | false | default |

职责一句话(即 frontmatter description,取自 HBA 内置描述):

- **coder**:代码开发 Agent。根据 planner 的任务列表实现代码并自跑受影响测试子集,保持最小正确 diff。
- **reviewer**:代码审查 Agent。根据 planner 的任务列表和测试用例对 coder 的 diff 进行审查。
- **architect**:技术架构 Agent。负责需求拆解、方案设计和 PRD 编写。
- **planner**:需求转化者。将模糊需求分解为明确、可执行的任务列表,并为 coder 定义完成标准。
- **browser-tester**:浏览器自动化 Agent。驱动 headless Chromium 执行 UI 操作、截图、断言,完成用户描述的浏览器测试任务。
- **ui-prototype**:UI 原型助手:帮助规划页面结构、生成/迭代原型页面、评审已生成页面。

## 4. 与 HBA 原文的差异点

1. **文件名与 name 改名**:`browser_tester` → `browser-tester`、`ui-gen-assistant` → `ui-prototype`(FR-1 任务书指定;ZCode name 仅允许字母/数字/连字符,且需与文件名一致)。其余 4 个 name 原样。
2. **frontmatter 重构**:删除 `role`;新增 `description`(必填)、`color`、`permissionMode`、`maxTurns`、`background`;`model` 占位文本由 `__PROVIDER_MODEL__` 换为 `【provider:model,按部署环境填写】`。
3. **正文开头新增「角色与工具边界」一节**:内容为任务书要求的角色/工具边界说明 + HBA 内置指令(`HBA\app\agent\builtin_prompts.py`)的角色描述与行为要点**摘录**(非逐字全文),用于补偿 HBA 后端注入的内置指令。其余正文逐字保留——包括 coder 的「失败可见性优先于"不报错"」「任务分级与验证强度(防止过度测试)」、reviewer 的「审查"失败可见性"」「复审强度分级」、planner 的「验收标准必须包含失败行为」,均原样保留、未改写。
4. **原 `<!-- Built-in ... provided by HBA (group mode/unified mode) ... -->` 注释原样保留**作为出处标记;在 ZCode 中它不再是功能性说明(HBA 内置 description/tools 已落位到 frontmatter,内置指令要点已摘录进「角色与工具边界」)。
5. **tools 与 HBA 后端工具表的差异**:HBA coder 有 `patch`/`rm`/`evidence_*`/`ssh_*` 等,HBA architect 实际带 `write`/`edit`;ZCode 白名单按 FR-1 任务书(architect 为只读集合 Read/Grep/Glob/WebSearch),故 reviewer/architect/planner 在正文声明只读约束。browser-tester 的 `browser_*` 工具组由 Bash(配合环境的浏览器自动化能力)替代;ui-prototype 的 `edit_screen`/`review_screen`(内容哈希 CAS、版本行)由 Edit/Read 复查替代。
6. **thinking_level 原值直移**(low×5、medium×1),未上调,保持 HBA 行为基线;ZCode 侧字段名为 `thoughtLevel`。
7. **HBA 内置提示词全文未逐字迁移**:coder/reviewer/planner 的 seed 正文之外,测试纪律、输出格式、browser 会话生命周期、ui-gen 整套生成/批量一致性/引用判定等内置规则只做了要点摘录,详见遗留事项。

## 5. 遗留事项

1. **model 占位必须替换**:`【provider:model,按部署环境填写】` 在部署时换成真实 `provider:model`(ZCode 按 `provider:model` 解析;参考 HBA 开发配置 `HBA\.hba\dev\config\agents\coder.md` 中 `agnes:agnes-3.0-flash` 的形式)。占位符本身无法解析为可用模型。
2. **HBA 内置提示词仅摘录**:`HBA\app\agent\builtin_prompts.py` 的内置 prompt(coder 的 Test discipline 全文、reviewer 的 Verdict/checklist 输出格式全文、planner 的输出格式全文、browser_tester 的 session 生命周期规则、ui-gen-assistant 的整套生成/批量一致性/引用判定流程)只摘录了要点;若需完整还原成员行为,需另行整段迁移——其中大量规则绑定 HBA 专有工具,不能直接照搬。
3. **HBA 专有工具能力缺口**:`codegraph_*`(代码图谱)、`evidence_*`、`ssh_*`(远程)、`browser_*`、`edit_screen`/`review_screen` 在 ZCode 无对应内置工具;如需对应能力,应改走 ZCode 插件/MCP/技能(例如浏览器自动化走 browser-use 插件)。
4. **编排层不在 FR-1 范围**:HBA 的 `master`(lead)、群组委派/汇报流程在 ZCode 侧的对应物属后续 FR;`explorer`、`debater`、`test_platform` 也未迁移。
5. **`injectAgentsMd` 未显式设置**(用平台默认);若希望成员遵循工作区 `AGENTS.md` 约定,可按需置 `true`。
6. **`maxTurns`/`background` 是 ZCode 侧新增默认值**:HBA 无此语义;maxTurns 为按角色工作量的保守上限,超限行为以平台为准,必要时调大。
7. **thoughtLevel 档位随模型而异**:ZCode 实际可选档位由所选模型决定,部署换模型时可按需校准(low/medium/high/max)。

## 6. 校验器

- 位置:`hba-on-zcode\tests\agents\validate-agents.mjs`(Node 内置模块,零外部依赖)。
- 运行:`cd hba-on-zcode && node tests/agents/validate-agents.mjs`(退出码 0=全绿,1=有失败)。
- 检查项:6 个文件齐全且无多余文件;frontmatter 可解析;name 仅字母/数字/连字符、与约定名和文件名一致、不占用内置名、全局唯一;description 非空;tools 与白名单集合一致且无重复;thoughtLevel 属于 low/medium/high/max 且与 HBA `thinking_level` 映射一致;color 属于 ZCode 色板;model 为占位符或 `provider:model` 形式;permissionMode=maxTurns=background 形态合法;提示词正文非空且含「角色与工具边界」;HBA 原文正文逐字节包含于迁移正文(HBA 目录可读时启用,不可读则跳过并提示)。
- 最近一次运行结果(2026-10-27):**139 项通过 / 0 项失败(全绿)**,含 HBA 原文保真比对与 thinking_level 交叉核对。
