# align-contracts 重型测试用例

本文只维护 `align-contracts` 重型评估的用例清单。测试流程、产物和人工审查方法见 `skill-evals/align-contracts-heavy/report.zh-CN.md`。

runner 会从下表解析用例 ID、环境标签和场景描述。`这条在测什么`、`常见错误`、`期待好回答` 只用于报告展示和人工审查，不会放进 baseline/skill 的任务 prompt。

## Core 用例

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

## Fixture 说明

fixture 代码目前由 `skill-evals/align-contracts-heavy/runner.mjs` 里的 `buildAcXXFixture` 函数生成。每个 case 至少包含一个可编辑源码文件；有些 case 还包含 provider 或外部系统输入样例。

文件角色：

| 角色 | 含义 | 报告展示方式 |
| --- | --- | --- |
| `editable` | agent 应该编辑的源码文件。 | 展示 Original / Baseline / Skill 三栏。 |
| `input` | provider、后端、SDK、webhook 或 AI 输出样例，作为输入材料给 agent 理解契约。 | baseline 和 skill 都没改时只展示一次；如果被改动，则展开三栏并提示检查。 |

用例清单和 fixture 代码需要一起维护。新增或改动 AC case 时，除了更新本表，也要补对应 fixture 和行为测试。
