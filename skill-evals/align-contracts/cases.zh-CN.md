# align-contracts 代码对比测试用例

本文只维护 `align-contracts` 代码快照评估的用例清单。运行流程见 `README.zh-CN.md`。

runner 应从下表解析用例 ID、目标 skill、环境标签、场景和重点。`场景` 可以进入任务 prompt；`重点` 只用于报告展示和人工审查，不应放进 baseline/skill 的任务 prompt。

## Core 用例

当前只保留严格贴合 `align-contracts` skill 的 smoke/core 用例。以后需要覆盖新语言、新框架或新边界时，再按同样格式增补新用例。索引使用 `AC-S01` 到 `AC-S06`。

| ID | Skill | 环境标签 | 场景 | 重点 |
| --- | --- | --- | --- | --- |
| AC-S01 | align-contracts | react-typescript | API 返回 `user_name`，页面里临时定义的 `UserViewModel` 只在当前组件内展示用户名。 | 测局部/临时 consumer type 可以改，不需要为了一个展示字段新增 adapter。常见错误是为了保留 `UserViewModel.userName` 新增 `toUserViewModel()`，把局部字段变成不必要架构。期待判断 consumer type 是本地页面展示契约；直接改成本地 alias 或读 `user_name`，不新增 adapter，也不要求后端改字段。 |
| AC-S02 | align-contracts | api, domain | 外部 API 返回 snake_case 用户，但共享 domain `User` 已导出并使用 camelCase。 | 测能否保护稳定/shared domain model，并把外部 API shape 转换在边界。常见错误是把共享 `User` 改成 `user_id`/`display_name`，让 vendor/API shape 泄漏进内部模型。期待保留 `User { userId, displayName }`，在 `loadUser`/API boundary 显式映射 `user_id -> userId`、`display_name -> displayName`。 |
| AC-S03 | align-contracts | react-typescript | API 的 `status` 被拿来填 UI 的 `checkoutType`，但这两个词可能不是同一个业务概念。 | 测是否警惕“两个字段都像状态”不代表语义相同。常见错误是直接写 `checkoutType = status`，或者把 `toCheckoutType` 偷偷改成 `toCheckoutStatus` 来绕开 consumer 契约。期待标记这是语义不确定的契约错位；不要猜映射，查 schema/docs 或问用户，并在代码中保留明确边界。 |
| AC-S04 | align-contracts | react-typescript | API 没有头像字段，但组件类型要求必须传 `avatarUrl`。 | 测遇到缺字段时是否为了过类型检查造假数据。常见错误是塞 `avatarUrl: ""` 或默认头像 URL，让 TypeScript 通过，但掩盖 provider 没给头像。期待把组件契约改成 optional/nullable 并显示空状态，或明确要求 API 补头像字段；不造 fake default。 |
| AC-S05 | align-contracts | react-typescript | 共享 `Money` 组件直接依赖 `ApiOrder["amount"]`，且被订单页和退款页复用。 | 测能否区分局部页面组件和共享通用组件，避免通用组件耦合 provider-specific payload。常见错误是让 `Money` 继续接收 `ApiOrder["amount"]`，或为了一个页面的 API shape 污染共享组件 props。期待给共享 `Money` 使用稳定 props，如 `totalMinorUnits` 和 `currency`；页面负责把各自 provider amount 传成稳定 props。 |
| AC-S06 | align-contracts | react-typescript | 任务只要求修 `display_name` / `displayName` 契约错位，但组件旁边有 CSS 和布局结构。 | 测能否控制改动范围，避免视觉回归。常见错误是顺手改 CSS、className、颜色、布局或组件层级，导致视觉行为变化。期待只改字段引用或局部 alias，保留 CSS import、className、DOM 层级和视觉结构。 |

## Fixture 说明

fixture 代码由 `fixtures.mjs` 里的 `buildFixture` 函数生成。每个 case 至少包含一个可编辑源码文件；有些 case 可包含 provider 或外部系统输入样例。

文件角色：

| 角色 | 含义 | 报告展示方式 |
| --- | --- | --- |
| `editable` | agent 应该编辑的源码文件。 | 展示 Original / Baseline / Skill 三栏。 |
| `input` | provider、后端、SDK、webhook 或 AI 输出样例，作为输入材料给 agent 理解契约。 | baseline 和 skill 都没改时只展示一次；如果被改动，则展开三栏并提示检查。 |
