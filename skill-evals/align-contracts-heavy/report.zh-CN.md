# align-contracts 重型代码对比评估

状态：手动审查型评估设计。runner 会生成代码快照和 HTML 对比报告；`eval:align-contracts:review` 可以再调用 AI 像人工 reviewer 一样给出通过、未通过、不确定的总结。

目标：验证 `skills/align-contracts` 是否真的改善 agent 在“数据提供方”和“数据消费方”之间对齐契约的能力，而不是只检查它是否被提到或触发。

## 测试对象

- Skill：`skills/align-contracts/SKILL.md`
- React/TypeScript 参考：`skills/align-contracts/references/frontend-react-typescript.md`。只有带 `react-typescript` 环境标签的用例才应该注入这份参考。
- 用例清单：`skill-evals/align-contracts-heavy/cases.zh-CN.md`

## 测试核心问题

1. 不使用 `align-contracts` 时，agent 是否容易随手改字段、造假字段、写散落 mapper、忽略语义差异。
2. 明确使用 `align-contracts` 后，agent 是否更稳定地识别 provider contract、consumer contract、source of truth 和 contract gap 类型。
3. 明确使用 `align-contracts` 后，agent 是否更常把转换放在正确边界，而不是在调用点临时凑 shape。
4. 明确使用 `align-contracts` 后，agent 是否更少发明 placeholder/default fields。
5. 明确使用 `align-contracts` 后，agent 是否在语义不清时主动询问，而不是猜。

## 术语说明

| 术语 | 人话解释 |
| --- | --- |
| Provider contract | 数据提供方实际给出的形状。例如 API 返回 JSON、数据库 row、SDK payload、webhook event。 |
| Consumer contract | 数据消费方期望收到的形状。例如 React 组件 props、service 输入、handler 输入、domain model。 |
| Payload | 外部传进来的一包原始数据。 |
| Domain model | 项目内部稳定使用的数据模型。外部系统字段变化时，不应该让内部模型到处跟着乱改。 |
| Boundary adapter / normalizer | 边界翻译层。把外部数据统一翻译成内部格式，避免每个调用点都手写转换。 |
| Ad-hoc mapper | 临时凑字段的映射代码，通常散落在父组件、handler 或 service 里。 |
| Fake default / placeholder field | 为了让类型或编译通过而造出来的假字段，例如 `id: 0`、`avatarUrl: ""`。 |

## 总体测试规模

每个场景跑两种模式：

1. Baseline：普通任务 prompt，不要求使用 `align-contracts`。
2. Skill：同样任务 prompt，但明确要求先使用 `align-contracts`。

默认只跑 smoke 子集，每种模式重复 2 次：

```text
6 个 smoke 场景 × 2 种模式 × 2 次重复 = 24 份 agent 代码快照
```

17 个 core 场景仍保留在用例清单里作为素材库，但默认不全部运行。重复运行的目的不是算分，而是降低单次模型随机性的影响，观察 skill 是否稳定改善真实代码改动。

## Prompt 隔离

heavy runner 会把用例的 `任务场景` 发给 agent，但不会把 `这条在测什么`、`常见错误`、`期待好回答` 放进任务 prompt。这样报告里可以展示人工审查维度，同时避免把答案直接泄漏给 baseline 或 skill 样本。

Skill 模式会额外注入 `skills/align-contracts/SKILL.md`。带 `react-typescript` 标签的用例还会注入 React/TypeScript 参考文件；其他环境不注入这份参考。

## Fixture 与代码快照

每个场景会生成一个最小 fixture，让 baseline 和 skill 两组 agent 在隔离工作区里真实编辑代码。运行后保留这些快照：

| 快照 | 人话解释 |
| --- | --- |
| original | 测试 fixture 的原始代码。 |
| baseline | 不注入 `align-contracts` 时，agent 改出来的代码。 |
| skill | 注入 `align-contracts` 后，agent 改出来的代码。 |

fixture 文件分两类：

| 角色 | 含义 |
| --- | --- |
| `editable` | 源码文件，agent 应该在这里修复契约错位。 |
| `input` | provider、后端、SDK、webhook 或 AI 输出样例。它是输入材料，不是希望 agent 修改的目标文件。 |

`input` 文件在 HTML 报告中默认只展示一次；如果 baseline 或 skill 改动了它，报告会展开三栏并提示检查。

## 人工审查方法

主要看 `.eval-runs/align-contracts-heavy/report.html`：

- baseline/skill 是否真正修复 provider 与 consumer 的契约错位。
- 是否把转换放在合适边界，而不是调用点临时凑 shape。
- 是否造假字段或默认值，例如 `id: 0`、`avatarUrl: ""`。
- 语义不确定时是否避免随手 alias，并保留需要确认的边界。
- 是否只改契约相关代码，避免无关 UI/CSS/业务流程改动。
- `input` 文件是否被改动；如果被改，需要判断 agent 是否把 provider 样例当成了可修代码。

`comparison.json` 是机器可读索引，适合做后续自定义审查工具。多次重复运行时，请优先读取 `cases[].runs[]`；顶层 `cases[].files[]` 只保留第一轮路径，方便快速预览。

也可以运行：

```bash
npm run eval:align-contracts:review
```

该命令读取 `comparison.json` 和代码快照，要求 AI 按语义人工审核每个 case，而不是用正则或关键词命中判分。输出文件：

- `review-summary.md`：按通过、未通过、不确定分组的审核总结。
- `review-summary.json`：结构化审核结果，便于后续分析。

## 执行产物目录

真实采样输出不放进 `tests/`，统一写入被 git ignore 的运行目录：

```text
.eval-runs/align-contracts-heavy/
```

该目录会包含：

- `prompts/`：每个 case、每个模式实际发送给 Codex 的 prompt。
- `outputs/`：Codex 返回的文字说明，按 case、模式和第几次运行保存。
- `comparisons/`：original、baseline、skill 的真实代码快照。
- `comparison.json`：代码快照索引，方便脚本或人工工具读取。
- `summary.json`：样本状态摘要。
- `summary.md`：简短运行总览。
- `report.html`：人工审查用三栏代码对比报告。
- `review-summary.md`：AI 审核后的通过、未通过、不确定总结。
- `review-summary.json`：AI 审核的结构化结果。
- `reviews/`：AI 审核 prompt 和输出。

这样仓库里的 `tests/` 只保留稳定测试代码，模型输出不会污染 git 状态。

## 当前已知限制

- fixture 是手写最小样例，适合看契约判断质量，但不等价于真实业务项目复杂度。
- runner 目前只收集代码快照，没有对 agent 改完的 fixture 做 TypeScript 编译、lint 或单元测试验证。
- `input` 文件现在靠 prompt 和报告提示约束，不是文件系统层面的只读文件；agent 误改输入材料时只能在报告里发现。
- 用例表和 `buildAcXXFixture` 仍然分开维护，新增 case 时可能发生文档和 fixture 漂移。
- `--resume` 只检查输出文件和快照目录是否存在，没有逐个校验每个 fixture 文件是否完整。
- 如果 Codex 运行失败、超时，或 agent 删除了目标 fixture 文件，runner 目前会中断整轮；后续可以把该样本记为失败并继续跑其他样本。
- AI 审核依赖模型判断，结论仍建议抽查；它避免正则/关键词判分，但不能替代最终业务判断。
- 通用 `skill-evals/_shared/skill-eval-runner.mjs` 只负责解析用例、注入 skill 和调用 Codex，不再写入旧版自动评价字段。

## 当前结论

这套系统现在更适合作为“人工审核样本生成器”：它负责稳定生成 original / baseline / skill 代码对比，真正的结论由人工审查给出。后续如果要进一步自动化，建议优先加编译/静态检查和输入文件完整性校验。
