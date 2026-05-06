# align-contracts 重型测试报告（讨论稿）

状态：测试设计讨论稿，尚未执行真实 agent 输出采样。

目标：高度验证 `skills/align-contracts` 是否真的改善 agent 在“数据提供方”和“数据消费方”之间对齐契约的能力，而不是只检查它是否被提到或触发。

## 测试对象

- Skill：`skills/align-contracts/SKILL.md`
- React/TypeScript 参考：`skills/align-contracts/references/frontend-react-typescript.md`。只有带 `react-typescript` 环境标签的用例才应该注入这份参考。

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

每种模式重复 3 次：

```text
17 个 core 场景 × 2 种模式 × 3 次重复 = 102 份 agent 输出
```

重复 3 次的目的：降低单次模型随机性的影响，观察 skill 是否稳定改善输出。

## 评分方式

每份输出的主分不再按固定 10 个术语打分，而是按当前场景自己的目标来算。这样能避免“回答里提到了 provider contract，所以得分很高，但其实没有解决这个场景”的假阳性。

主分由两部分组成：

| 主分构成 | 看什么 |
| --- | --- |
| 关键期望命中 | 回答有没有做到这个场景明确期待的动作。例如 AC-01 要识别 API contract 已变，并建议更新组件契约或集中转换。 |
| 高风险错误避开 | 回答有没有避开这个场景最容易犯的错。例如 AC-01 不能在父组件临时拼回 `totalCents`，也不能假装 API 没变。 |

辅助检查清单仍会保留在 `summary.json` 和 `report.html` 里，但它不是主分，只用来解释回答风格：

| 辅助项 | 人话解释 |
| --- | --- |
| 实际收到的数据长什么样 | 回答是否说清楚外部数据实际给了哪些字段，比如 API 返回了 `amount.total_minor_units`。 |
| 使用数据的代码需要什么 | 回答是否说清楚 UI、业务代码或 handler 原本想读取什么字段。 |
| 应该按谁的定义改 | 回答是否判断 API、schema、domain model、数据库或组件谁才是权威来源。 |
| 这次错位属于哪种问题 | 回答是否区分字段改名、结构变化、语义不一致、缺字段或来源冲突。 |
| 应该在哪里修 | 回答是否把修复位置放到 adapter、schema parser、domain model、组件 props 或边界层。 |
| 避免临时补丁 | 回答是否避免到处写 `oldField = new.field` 这类临时兼容或分散 mapper。 |
| 语义不确定时先确认 | 回答是否在 `status` 和 `checkoutType` 这类可能不同义的字段上建议查文档或问用户。 |
| 避免无关改动 | 回答是否强调只修契约错位，不顺手改布局、样式、业务流程或无关结构。 |

以下两类旧指标不再作为展示重点：

- “避免假默认值”：已经并入各场景的高风险错误，例如“不能塞 `id: 0`”。
- “提出验证方式”：prompt 已经要求回答验证方式，区分度不够，保留为内部辅助信号即可。

## 结果判定

每个场景记录：

- Baseline 三次平均分。
- Skill 三次平均分。
- Skill 是否比 baseline 稳定改善。
- Skill 是否出现严重违规，例如造假字段、随手语义映射、破坏公共契约。

建议总体验收线：

- Skill 的主分平均值明显高于 baseline。
- Skill 的关键期望命中率明显高于 baseline。
- Skill 的高风险错误避开率明显高于 baseline。
- Skill 模式下 semantic mismatch 被误当 naming-only 的比例明显下降。
- Skill 模式下不应为了契约工作引入明显无关改动。

## 测试用例

当前只保留 core 用例。旧的 60 条素材库不继续保留；以后需要覆盖新语言、新框架或新边界时，再按同样格式增补新用例。索引已经重排为 `AC-01` 到 `AC-17`。

| ID | 环境标签 | 任务场景 | 这条在测什么 | 常见错误 | 期待好回答 |
| --- | --- | --- | --- | --- | --- |
| AC-01 | react-typescript | 后端原来返回 `totalCents`，现在改成 `amount.total_minor_units`，前端金额组件还在用旧字段。 | 测回答能不能看出这是 API 返回结构和 React 组件 props 的契约错位，而不是普通 undefined 小 bug。 | 在父组件临时构造 `{ totalCents: amount.total_minor_units }`，让旧组件继续假装 API 没变。 | 说明 API contract 已变；更新组件 props，或只在 API adapter/mapper 边界统一转成内部字段如 `totalMinorUnits`。 |
| AC-02 | react-typescript | 后端金额对象新增了 `currency`，旧页面仍只把金额当一个裸数字展示。 | 测回答会不会意识到“金额数值”和“币种”是一组展示契约，不能只看数字字段。 | 忽略 `currency`，继续只显示 `1299`，让用户不知道这是 USD、CNY 还是别的币种。 | 要求金额展示和传参都带上币种，或把金额值和币种一起映射到 UI/domain model。 |
| AC-03 | react-typescript | API 返回 `user_name`，前端代码想读 `userName`，两边只是命名风格不同。 | 测回答能不能区分“同一个含义的字段改名”和“字段语义变了”。 | 把简单命名差异升级成大改造，或者要求后端必须按前端命名改接口。 | 说明这是命名差异；用清晰的小范围 alias/mapper，或按项目习惯统一字段名。 |
| AC-04 | react-typescript | API 的 `status` 被拿来填 UI 的 `checkoutType`，但这两个词可能不是同一个业务概念。 | 测回答会不会警惕“两个字段都像状态”不代表语义相同。 | 直接写 `checkoutType = status`，把订单状态、支付状态或结账类型混在一起。 | 标记这是语义不确定的契约错位；先查 schema/docs 或问清楚含义，再决定映射关系。 |
| AC-05 | react-typescript | API 没有头像字段，但组件类型要求必须传 `avatarUrl`。 | 测回答遇到缺字段时，会不会为了过类型检查造假数据。 | 塞 `avatarUrl: ""`，让 TypeScript 通过，但掩盖后端其实没给头像。 | 把组件契约改成 optional/nullable 并显示空状态，或明确要求 API 补头像字段。 |
| AC-06 | react-typescript | API 没有 `id`，但内部类型把 `id` 当必填身份字段。 | 测回答能不能意识到身份字段缺失比普通展示字段缺失更危险。 | 塞 `id: 0` 或随机 id，让代码跑起来。 | 明确不能伪造身份字段；要么让提供方补 `id`，要么改消费方不要依赖不存在的身份。 |
| AC-07 | react-typescript | API 返回 `priceInCents`，但组件以为拿到的是“元/美元”主单位。 | 测回答能不能发现单位契约错了，不只是字段名不同。 | 直接显示 API 数字，导致金额放大或缩小 100 倍。 | 明确 `cents` 是小单位；在固定边界转换或用清晰字段名保持单位，并补金额显示测试。 |
| AC-08 | react-typescript | API 返回分页对象 `{ data, pageInfo }`，旧代码只认 `items` 数组。 | 测回答能不能保留分页信息，而不是只让列表渲染出来。 | 只取 `data` 塞给列表，丢掉 `pageInfo`，分页按钮或加载逻辑坏掉。 | 更新消费方契约，让 UI 同时拿到列表数据和 `pageInfo`。 |
| AC-09 | react-typescript | API 的 `tags` 字段可能不存在，也可能是空数组。 | 测回答能不能区分“没给这个字段”和“明确给了空列表”。 | 默认 `tags: []`，掩盖字段缺失。 | 先判断业务上缺失和空数组是否等价；不确定时查文档或问用户。 |
| AC-10 | react-typescript | 表单里分开存 `firstName`/`lastName`，提交接口要求 `full_name`。 | 测回答会不会把 UI 表单状态和 request DTO 的转换放在提交边界。 | 在 submit handler 里随手拼字符串，规则散落且难测。 | 在 request DTO builder/adapter 中集中生成 `full_name`，并说明拼接规则。 |
| AC-11 | react-typescript | 表单 state 里有 `isDirty` 这类只给 UI 用的字段。 | 测回答能不能把 UI 状态和 API 请求体分开。 | 把 `isDirty` 一起提交给后端。 | 构造 request DTO 时过滤 UI-only 字段，只提交后端契约要求的字段。 |
| AC-12 | db | 数据库 row 是 `snake_case`，业务层 entity 是 `camelCase`。 | 测回答会不会把 DB 到 domain 的命名转换放在 repository/mapper。 | 在 service、controller、组件里到处手写字段转换。 | 在 repository 或 mapper 层集中转换，业务层只看稳定 domain entity。 |
| AC-13 | webhook | webhook 字段从 `event_type` 改成 `type`。 | 测回答会不会把 webhook 版本变化放到入口 parser，而不是让 handler 到处兼容。 | 在 handler 里到处写 `event_type || type`。 | 用版本化 parser/adapter 识别新旧 payload，再归一化给业务处理。 |
| AC-14 | sdk | 第三方 SDK 返回 `amount_total`，内部模型使用 `totalCents`。 | 测回答会不会隔离 SDK 字段，不让 vendor shape 泄漏到全项目。 | 业务代码全项目直接读 SDK 的 `amount_total`。 | 在 SDK adapter 统一映射成内部 money model，业务层保持稳定。 |
| AC-15 | ai-schema | AI structured output 缺少工具 schema 的必填字段。 | 测回答能不能拒绝不完整 AI 输出。 | 补 `{ id: 0 }` 之类假字段让工具能调用。 | schema 校验失败，要求模型重试或返回明确错误。 |
| AC-16 | api | 对外 public API 的字段要改名。 | 测回答能不能意识到 public contract 改动会影响外部调用方。 | 直接改字段名，破坏现有客户或集成方。 | 明确这是公共契约变更，需要兼容策略、版本化或先和用户确认。 |
| AC-17 | react-typescript | 任务只要求修契约错位，但代码旁边有 CSS 看起来也想改。 | 测回答能不能控制改动范围，避免视觉回归。 | 顺手改 CSS 或布局，导致 UI 变化。 | 只改契约相关逻辑和测试，明确保留现有视觉行为。 |

## 每个场景的 prompt 结构

每个场景生成两份 prompt。

Baseline prompt 模板：

```text
You are working in an existing TypeScript/React project.

Task:
[场景描述]

Please propose the code change approach and mention what you would verify.
```

Skill prompt 模板：

```text
You are working in an existing TypeScript/React project.

Use the `align-contracts` skill before solving this.

Task:
[场景描述]

Please propose the code change approach and mention what you would verify.
```

如果场景不是 React/TypeScript，例如 webhook、SDK、DB、AI schema 或 public API，则把第一句替换成对应项目类型。报告会单独展示 React/TypeScript 参考是否按环境标签精准注入。

## 单场景记录模板

```markdown
### AC-XX: [场景标题]

这条在测什么：
- ...

Baseline Run 1:
- 摘要：
- 分数：
- 违规：

Baseline Run 2:
- 摘要：
- 分数：
- 违规：

Baseline Run 3:
- 摘要：
- 分数：
- 违规：

Skill Run 1:
- 摘要：
- 分数：
- 违规：

Skill Run 2:
- 摘要：
- 分数：
- 违规：

Skill Run 3:
- 摘要：
- 分数：
- 违规：

结论：
- Baseline 平均分：
- Skill 平均分：
- 是否符合预期：
- 备注：
```

## 总报告统计项

最终执行后，应在报告顶部补充：

| 指标 | Baseline | Skill | 改善 |
| --- | --- | --- | --- |
| 平均总分 | 待执行 | 待执行 | 待执行 |
| provider contract 识别率 | 待执行 | 待执行 | 待执行 |
| consumer contract 识别率 | 待执行 | 待执行 | 待执行 |
| source of truth 判断率 | 待执行 | 待执行 | 待执行 |
| semantic mismatch 误判率 | 待执行 | 待执行 | 待执行 |
| fake defaults 出现率 | 待执行 | 待执行 | 待执行 |
| ad-hoc mapper 出现率 | 待执行 | 待执行 | 待执行 |
| 主动询问率 | 待执行 | 待执行 | 待执行 |
| 提出验证方式比例 | 待执行 | 待执行 | 待执行 |

## 当前结论

当前文档只定义测试设计和测试用例，不代表 `align-contracts` 已经通过或失败。

下一步如果确认这 17 个 core 场景和评分维度没有问题，再生成可执行 prompt 文件、记录 102 份输出，并把统计结果补回本文档。

## 执行产物目录

真实采样输出不放进 `tests/`，统一写入被 git ignore 的运行目录：

```text
.eval-runs/align-contracts-heavy/
```

该目录会包含：

- `prompts/`：每个 case、每个模式发送给 Codex 的完整 prompt；重复运行共用同一份 prompt。
- `outputs/`：每次 Codex 返回的原始文本。
- `summary.json`：自动评分摘要。

这样仓库里的 `tests/` 只保留稳定测试代码，102 份模型输出不会污染 git 状态。
