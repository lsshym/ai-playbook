# align-contracts 重型测试报告（讨论稿）

状态：测试设计讨论稿，尚未执行真实 agent 输出采样。

目标：高度验证 `skills/align-contracts` 是否真的改善 agent 在“数据提供方”和“数据消费方”之间对齐契约的能力，而不是只检查它是否被提到或触发。

## 测试对象

- Skill：`skills/align-contracts/SKILL.md`
- React/TypeScript 参考：`skills/align-contracts/references/frontend-react-typescript.md`

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
60 个场景 × 2 种模式 × 3 次重复 = 360 份 agent 输出
```

重复 3 次的目的：降低单次模型随机性的影响，观察 skill 是否稳定改善输出。

## 评分维度

每份输出按 10 分评分。

| 维度 | 分数 | 说明 |
| --- | --- | --- |
| 识别 provider contract | 0/1 | 是否说清楚数据实际来自哪里、长什么样。 |
| 识别 consumer contract | 0/1 | 是否说清楚接收方期望什么字段/结构。 |
| 判断 source of truth | 0/1 | 是否判断谁拥有业务含义，例如 API、schema、domain model、memory、docs。 |
| 正确分类 gap | 0/1 | 是否区分命名差异、语义差异、缺字段、结构差异、source-of-truth 冲突。 |
| 选择合理 binding location | 0/1 | 是否把转换放到 schema/parser、adapter、domain model、consumer interface 等合理位置。 |
| 避免 ad-hoc call-site mapping | 0/1 | 是否避免在父组件/handler/service 调用点随手凑字段。 |
| 避免 fake defaults | 0/1 | 是否避免 `id: 0`、`field: ""`、随手 placeholder。 |
| 不确定时主动询问 | 0/1 | 语义或 ownership 不清时是否问用户，而不是猜。 |
| 保持无关行为稳定 | 0/1 | 是否避免顺手改 CSS、布局、无关重构、公共 API。 |
| 给出验证方式 | 0/1 | 是否提出测试、typecheck、schema parse、sample payload、fixture 等验证方式。 |

## 结果判定

每个场景记录：

- Baseline 三次平均分。
- Skill 三次平均分。
- Skill 是否比 baseline 稳定改善。
- Skill 是否出现严重违规，例如造假字段、随手语义映射、破坏公共契约。

建议总体验收线：

- Skill 平均分比 baseline 至少高 2 分。
- Skill 模式下 fake defaults 出现率明显下降。
- Skill 模式下 semantic mismatch 被误当 naming-only 的比例明显下降。
- Skill 模式下不确定时主动询问的比例明显上升。
- Skill 模式下不应为了契约工作引入明显无关改动。

## 测试用例

| ID | 场景 | 主要验证点 | Baseline 容易出现的坏结果 | 使用 `align-contracts` 的预期结果 |
| --- | --- | --- | --- | --- |
| AC-01 | 后端金额字段从 `totalCents` 改成 `amount.total_minor_units`。 | API -> UI 结构变化；金额字段 ownership；React component contract。 | 在父组件临时拼回 `totalCents`，假装 API 没变。 | 识别 API contract 已变，更新组件契约或集中转换。 |
| AC-02 | 后端金额响应新增 `currency`，旧 UI 只显示数字。 | 金额和币种是否被当成同一个展示契约。 | 忽略 `currency`，继续只显示 `1299`。 | 明确金额必须携带币种展示或传递。 |
| AC-03 | API 是 `user_name`，前端代码想用 `userName`。 | 命名差异 vs 语义差异。 | 过度设计 adapter 或错误要求改后端。 | 判断只是命名差异，小范围 alias 或清晰 mapper。 |
| AC-04 | API 的 `status` 要接到 UI 的 `checkoutType`。 | 语义差异识别；不把两个“状态”随手等同。 | 直接写 `checkoutType = status`。 | 标记 semantic mismatch，查 schema/docs 或询问用户。 |
| AC-05 | API 没有头像字段，组件类型要求 `avatarUrl`。 | 缺字段处理；fake default 防护。 | 塞 `avatarUrl: ""` 让 TypeScript 通过。 | 改成 optional/empty state，或明确要求 API 补字段。 |
| AC-06 | API 没有 `id`，内部类型要求 `id`。 | 必填身份字段缺失；不能造身份。 | 塞 `id: 0`。 | 明确缺少身份字段，不能假装有 id。 |
| AC-07 | API 返回 `priceInCents`，组件以为是元。 | 单位差异；金额安全。 | 直接显示，金额放大/缩小 100 倍。 | 识别单位契约，在边界转换并测试显示。 |
| AC-08 | API 返回美元小数，内部模型要求整数分。 | 精度和单位转换位置。 | 到处乘 100。 | 在固定边界转换，内部保持整数分模型。 |
| AC-09 | 商品字段 `image`，组件字段叫 `img`。 | 同义字段改名；React props contract。 | 父组件到处改名。 | 如果语义相同，局部 alias 或更新组件 props，不散落。 |
| AC-10 | 商品字段 `points` 和 `price` 被混用。 | 积分 vs 价格的语义差异。 | 把积分当价格显示。 | 判断语义不同，不随手映射。 |
| AC-11 | API 返回 `{ data, pageInfo }`，旧代码只认 `items`。 | 分页结构是否保留。 | 只取 `data`，丢掉分页信息。 | 更新 consumer contract，保留 `pageInfo`。 |
| AC-12 | API 从数组变成分页对象。 | 数组 -> 对象结构变化。 | 让组件继续假装收到数组。 | 明确结构变化，更新类型和渲染逻辑。 |
| AC-13 | API 日期字段从 timestamp 改成 ISO string。 | 日期解析契约；转换位置。 | 组件里到处 `new Date()`。 | 在边界或展示层明确解析规则。 |
| AC-14 | 日期字段从本地时间变 UTC。 | 时区语义。 | 直接显示导致时间偏差。 | 识别时区 contract，明确转换位置。 |
| AC-15 | API 返回 `null`，组件只接受字符串。 | nullable contract。 | 用 `|| ""` 静默兜底。 | 类型改为 nullable/optional，并做明确空状态。 |
| AC-16 | API 返回可选数组 `tags?: string[]`。 | 缺字段 vs 空数组是否同义。 | 默认 `tags: []` 掩盖缺失。 | 判断业务上缺失和空数组是否等价，不确定则问。 |
| AC-17 | 表单字段 `firstName/lastName` 要提交为 `full_name`。 | Form state -> request DTO。 | 在 submit 里乱拼。 | 在 request DTO 边界清楚转换。 |
| AC-18 | 表单 state 有 UI-only 字段 `isDirty`。 | UI state 和 API DTO 分离。 | 把 `isDirty` 一起提交给后端。 | 过滤 UI-only 字段，只提交 API contract。 |
| AC-19 | 后端要求 `phone_country_code`，UI 只有完整手机号。 | 缺少结构化字段；不能猜解析规则。 | 直接截字符串。 | 要求明确解析规则或补表单字段。 |
| AC-20 | 后端要求枚举 `ACTIVE/INACTIVE`，UI 用 boolean。 | boolean -> enum 映射。 | 随手 `true -> ACTIVE`，漏掉未知态。 | 明确枚举映射并覆盖所有分支。 |
| AC-21 | 数据库是 `snake_case`，业务层是 `camelCase`。 | DB row -> domain entity。 | service 层到处手写映射。 | repository/mapper 层集中转换。 |
| AC-22 | DB 字段 `deleted_at` 表示软删除。 | 字段业务含义。 | 当普通时间字段展示。 | 保留软删除语义，消费方不误用。 |
| AC-23 | DB 金额字段单位是分。 | DB 单位契约。 | domain 以为是元。 | 在 DB 边界转换或保持清晰命名。 |
| AC-24 | DB `status` 是订单状态，UI `status` 是支付状态。 | 同名不同义。 | 同名就直接传。 | 识别同名也可能不同义，拆分概念。 |
| AC-25 | webhook 从 `event_type` 改成 `type`。 | webhook version drift。 | handler 里到处 `event_type || type`。 | 用版本化 parser/adapter。 |
| AC-26 | webhook payload 多包一层 `data.object`。 | 嵌套结构变化。 | handler 深层硬改。 | 在 webhook 边界处理结构。 |
| AC-27 | webhook 新旧版本同时存在。 | 多版本兼容边界。 | 一个 handler 写满兼容逻辑。 | 版本分流，边界归一化。 |
| AC-28 | webhook 缺签名字段。 | 安全/可信输入 contract。 | 假设可信继续处理。 | 校验失败，明确拒绝或报错。 |
| AC-29 | SDK 返回 `amount_total`，内部用 `totalCents`。 | SDK payload -> internal domain model。 | 全项目直接读 SDK 字段。 | SDK adapter 统一转换，内部模型稳定。 |
| AC-30 | SDK 返回 vendor-specific status。 | 外部状态枚举不能泄漏。 | 内部状态枚举跟着 vendor 走。 | 映射到内部稳定枚举。 |
| AC-31 | 换支付 SDK，字段完全不同。 | adapter 是否隔离外部变化。 | 改业务代码适配新 SDK。 | 只改 SDK 边界 adapter。 |
| AC-32 | SDK 返回 BigInt/string 金额。 | 金额精度。 | 直接 `Number()` 可能丢精度。 | 明确精度和转换规则。 |
| AC-33 | CLI 参数 `--dry-run false`。 | string -> boolean 解析。 | 字符串非空，被当 true。 | CLI parser 明确转 boolean。 |
| AC-34 | env `FEATURE_ENABLED=false`。 | env string truthiness。 | JS 把 `"false"` 当 truthy。 | 明确解析 env boolean。 |
| AC-35 | env 缺少必填 API key。 | 必填 config 缺失。 | 用空字符串继续跑。 | 启动时报错或显式失败。 |
| AC-36 | config 超时时间是秒，代码当毫秒。 | 配置单位。 | 超时行为错误。 | 明确单位转换。 |
| AC-37 | AI 输出 JSON 缺少必填字段。 | AI structured output -> tool schema。 | 补 `{ id: 0 }`。 | schema 校验失败，要求重试/报错。 |
| AC-38 | AI 输出多了未知字段。 | unknown fields policy。 | 直接传给工具。 | schema parse 时剔除或拒绝。 |
| AC-39 | AI 输出 enum 拼错。 | enum validation。 | 自动猜一个最接近的。 | 校验失败并要求修正。 |
| AC-40 | AI 输出数组，工具要对象。 | structural mismatch。 | 包一层假对象。 | 明确 schema mismatch。 |
| AC-41 | parent 传 `image`，child 要 `img`。 | parent/child component contract。 | 父组件到处重命名。 | 判断是否只是名字不同，选择局部处理或更新 props。 |
| AC-42 | child 需要 `author.avatarUrl`，API 只有 `author.image`。 | nested field 语义判断。 | 硬塞字段。 | 判断语义是否相同，不确定则问。 |
| AC-43 | display-only 巨大嵌套数据。 | 是否允许 direct source usage。 | 写一个超大 mapper 只为改名字。 | 允许直接读源数据，避免无意义转换。 |
| AC-44 | UI 组件类型过时，API 才是产品真实字段。 | API owns meaning。 | 父组件造旧 shape。 | 更新组件 props 契约。 |
| AC-45 | UI 公共类型稳定，只有单个 API 不同。 | internal UI model owns meaning。 | 为一个 API 改掉公共组件类型。 | 在该 API 边界 adapter。 |
| AC-46 | public API 字段要改名。 | public contract 变更。 | 直接改，破坏调用方。 | 识别公共契约变化，询问或做兼容策略。 |
| AC-47 | internal API 字段要改名。 | 内部可控契约迁移。 | 保留新旧字段导致混乱。 | 如果内部可控，统一改契约和消费者。 |
| AC-48 | migration 改 DB 字段含义。 | migration/source truth。 | 只改类型名不改逻辑。 | 查 migration，按真实含义更新。 |
| AC-49 | OpenAPI spec 和代码类型冲突。 | source of truth 冲突。 | 随手相信代码。 | 判断哪个拥有权威，不清楚则问。 |
| AC-50 | README 文档和实际 API 冲突。 | docs vs runtime contract。 | 随手相信 README。 | 查真实 schema/source，标记冲突。 |
| AC-51 | 两边字段名一样但单位不同。 | same name, different meaning。 | 因为同名就直接用。 | 识别同名也可能不同义。 |
| AC-52 | 两边字段名不同但含义相同。 | different name, same meaning。 | 以为是新业务字段。 | 识别只是命名不同。 |
| AC-53 | 新字段没有时要兼容旧字段。 | fallback 边界。 | 到处 `new || old`。 | 只在版本兼容边界 fallback，并说明原因。 |
| AC-54 | 缺字段时产品要求显示 `Unknown`。 | display fallback vs data truth。 | 到处硬编码 `Unknown`。 | localized fallback，明确这是展示策略。 |
| AC-55 | 项目已有 schema parser。 | 复用现有边界实现。 | 新写一套 mapper。 | 复用现有 parser/adapter。 |
| AC-56 | 多个 call site 重复转换同一个 API。 | duplication of boundary mapping。 | 每处各写一遍。 | 抽到共同边界。 |
| AC-57 | 修改契约时顺手改 CSS。 | visual preservation。 | 视觉回归。 | 只改契约相关逻辑，保留视觉。 |
| AC-58 | 修改类型时顺手重构组件层级。 | scope control。 | 扩大影响面。 | 行为稳定，改动最小。 |
| AC-59 | 不确定 `status` 是订单状态还是支付状态。 | ask-user trigger。 | 自己猜。 | 主动问用户。 |
| AC-60 | 不确定 adapter 应放哪层。 | architecture uncertainty。 | 随便建 `utils`。 | 查项目模式，不清楚则问。 |

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

如果场景不是 React/TypeScript，例如 webhook、CLI、SDK、DB，则把第一句替换成对应项目类型。

## 单场景记录模板

```markdown
### AC-XX: [场景标题]

主要验证点：
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

下一步如果确认这 60 个场景和评分维度没有问题，再生成可执行 prompt 文件、记录 360 份输出，并把统计结果补回本文档。

## 执行产物目录

真实采样输出不放进 `tests/`，统一写入被 git ignore 的运行目录：

```text
.eval-runs/align-contracts-heavy/
```

该目录会包含：

- `prompts/`：每个 case、每个模式发送给 Codex 的完整 prompt；重复运行共用同一份 prompt。
- `outputs/`：每次 Codex 返回的原始文本。
- `summary.json`：自动评分摘要。

这样仓库里的 `tests/` 只保留稳定测试代码，360 份模型输出不会污染 git 状态。
