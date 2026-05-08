# memory 触发与执行效果测试用例

本文只维护 `memory-setup`、`memory-load`、`memory-sync` 三个 memory skill 的评估用例清单。运行流程和 runner 以后补充到 `README.zh-CN.md`。

runner 应从下表解析用例 ID、目标 skill、环境标签、场景和重点。`场景` 可以进入任务 prompt；`重点` 主要用于报告展示、人工审查和未来自动断言，不应原样泄露到任务 prompt。

## Smoke 用例

首批用例采用统一五列格式：`ID`、`Skill`、`环境标签`、`场景`、`重点`。场景要写清楚 fixture 的初始状态和用户任务；重点要写清楚触发要求、执行要求、常见错误和验收边界。

| ID | Skill | 环境标签 | 场景 | 重点 |
| --- | --- | --- | --- | --- |
| MEM-SETUP-01 | memory-setup | setup, empty-memory, zh-CN | 空仓库中，用户明确说“初始化 Wingman memory”。fixture 初始没有 `.wingman/`。 | 必须触发 `memory-setup`，不能只打印模板。执行后应创建 `.wingman/memory/`、`.wingman/memory/projectBrief.md`、`.wingman/memory/activeContext.md`、`.wingman/memory/domains/README.md`、`.wingman/memory/archive/README.md`。重点检查 memory root 是否完整、seed 内容是否符合 skill 模板、中文请求下 `projectBrief.md` 的 `Language` 是否设置为 `zh-CN`。不能创建或修改 `.wingman/memory` 之外的项目说明文件。 |
| MEM-SETUP-02 | memory-setup | setup, existing-project-docs, memory-only | 仓库已有若干项目说明文件，里面有用户自定义内容。用户明确要求重新初始化 Wingman memory。 | 必须触发 `memory-setup`。执行时只创建或补齐 `.wingman/memory/` 下的 seed 文件；既有项目说明文件必须保持原样。重点检查不能整文件重写、不能追加非 memory 配置、不能改动用户自定义规则。 |
| MEM-SETUP-04 | memory-setup | setup, existing-memory, partial-missing | 仓库已经有 `.wingman/memory/projectBrief.md`、`.wingman/memory/activeContext.md` 和 checkout domain，里面包含用户维护的 ADR、domain registry、当前日志和稳定业务真理；用户说“重新初始化 Wingman memory”，fixture 只缺 `.wingman/memory/archive/README.md`。 | 必须触发 `memory-setup`，但只能补齐缺失的 seed 文件。重点检查不能整文件覆盖已有 `projectBrief.md`、`activeContext.md` 或 `.wingman/memory/domains/checkout.md`，不能删除用户已有 ADR、domain registry、active log 或 domain truth；应只创建 `.wingman/memory/archive/README.md`，最多补齐缺失目录/README，不应把已有 memory 重置成模板。 |
| MEM-SETUP-03 | memory-load | missing-memory, checkout | 仓库没有 `.wingman/memory`，用户只是要求修复 checkout webhook 状态流 bug，没有说初始化记忆系统，也没有手动调用 `/memory-setup`。 | 一般工作不能自动触发 `memory-setup`。这条的主路径是 `memory-load`：先判断是否存在 memory root，发现 `.wingman/memory` 不存在后安静继续。重点检查不会因为缺少 memory root 就擅自创建 `.wingman/`，不会把 setup 当成 load 的 fallback。 |
| MEM-LOAD-01 | memory-load | multi-domain, checkout | memory 里有 `checkout`、`auth`、`billing` 多个 domain，`projectBrief.md` 的 domain registry 能指向这些 domain。用户要修 checkout webhook 状态流 bug，例如支付 webhook 已成功但订单仍停在 `pending_payment`。 | 应触发 `memory-load`，并精准加载 `projectBrief.md`、`activeContext.md`、`domains/README.md` 和 checkout domain。重点检查不加载 auth/billing/archive，不被无关 domain 里的诱饵规则带偏；最终代码应遵守 checkout 当前状态流规则，memory 文件不应被修改。 |
| MEM-LOAD-02 | memory-load | folder-domain, checkout-status | checkout 是 folder domain，包含 `checkout/index.md`、`pricing.md`、`status-flow.md`、`api-contracts.md`。`index.md` 的 `Subfiles` 说明每个文件用途。用户任务只涉及支付成功后的订单状态流。 | 应触发 `memory-load`。重点检查是否先读 `checkout/index.md`，再只读 `status-flow.md` 等必要文件；不应全量读取 checkout 所有 subfiles，不应把 pricing 或 API contract 当状态流规则。报告里应展示 agent 声明依据的 memory 文件列表，用于人工审查读取范围。 |
| MEM-LOAD-03 | memory-load | archive-trap, checkout | `activeContext.md` 和 checkout domain 写着当前状态规则，`archive/2026-04.md` 放了一条过期且冲突的旧规则。用户修 checkout 状态流 bug。 | 应触发 `memory-load`，但 archive 是 cold storage，默认不读。重点检查执行时不能被 archive 旧规则诱导，不能按旧规则改代码，也不能把旧规则重新写回 active/domain。最终代码应使用 active/domain 当前规则，memory 文件保持不变。 |
| MEM-LOAD-04 | memory-load | missing-memory, new-domain | 仓库没有 `.wingman/memory`，用户要实现一个全新的 invite-code 业务能力。这个业务以前没有任何 domain memory。 | 新业务读不到 memory 是正常情况。重点检查 `memory-load` 可以判断 memory root 不存在或没有相关 domain 后继续工作；不警告、不初始化、不编造“之前的规则”；最终说明不能声称读取了不存在的 memory。 |
| MEM-SYNC-01 | memory-sync | active-log, checkout | 已完成 checkout webhook 状态修复，需要记录本次进展。fixture 中 `activeContext.md` 已有当前日志区和若干旧日志，checkout domain 没有足够证据新增稳定规则。 | 应触发 `memory-sync`。重点检查是否 prepend 到 `activeContext.md` 的当前日志区，包含目标、核心文件和备注；不能把日志追加到文件末尾，不能重写旧日志，不能无证据写 domain truth 或 project ADR。 |
| MEM-SYNC-02 | memory-sync | domain-truth, checkout-api | 用户明确确认一个 checkout API contract，例如 `payment_status` 是 canonical field，不能用 `order_status` 兜底。fixture 中已有 checkout domain，另有 auth/billing domain 作为无关文件。 | 应触发 `memory-sync`。重点检查是否写入 checkout domain truth，带 `[WHY]`、Evidence、Applies When；不能写到 `projectBrief.md` 的全局 ADR，不能污染 auth/billing，不能翻译字段名，不能留下与新规则冲突的旧 truth。memory 正文应遵守 `projectBrief.md` 的 `Language: zh-CN`，但字段名、路径和代码符号保持原文。 |
| MEM-SYNC-05 | memory-sync | domain-truth, partial-conflict, checkout-api | 用户明确确认 checkout 支付状态 contract：`payment_status` 是 canonical field，不能用 `order_status` 兜底。fixture 中 checkout domain 已有多条 truth，其中只有一条关于 payment UI fallback 的 truth 与新规则部分冲突，另有退款状态、履约状态等不冲突上下文。 | 应触发 `memory-sync`。重点检查是否只替换或修正与 `payment_status`/`order_status` 冲突的那条 truth，并保留 checkout domain 中不冲突的退款、履约、状态流上下文；不能整文件清空重写，不能删除无关 truth，不能把规则写到全局 ADR，不能污染 auth/billing。新 durable truth 仍需带 `[WHY]`、Evidence、Applies When，并保持字段名原文。 |
| MEM-SYNC-03 | memory-sync | ignore-threshold, rename-only | 本次只是变量改名、格式整理或纯代码移动，没有状态、数据、契约或业务行为变化；用户仍说“同步一下 memory”。 | 应触发 `memory-sync` 后通过 Value Funnel 判断不值得记录。重点检查拒绝写 memory 或说明未达到记录阈值；不能为了响应 sync 请求硬写泛泛日志，不能把 rename-only 伪装成架构决策。 |
| MEM-SYNC-04 | memory-sync | user-override, skip-update | 已完成一个有意义的 checkout bugfix，但用户明确说“这个不用记忆 / skip update / 不更新”。 | 用户覆盖优先。重点检查短路行为：即使改动有价值，也完全不修改 `.wingman/memory`；不能读取 memory，不能写 active log，不能写 domain truth，不能归档旧日志，不能额外修改业务代码。最终说明应简短表达已按用户要求跳过 memory 更新，`Memory files used` 应为 `无`。 |

## Fixture 设计约定

memory eval 的 fixture 应包含两类文件：

| 角色 | 含义 | 报告展示方式 |
| --- | --- | --- |
| `editable` | agent 应该编辑或创建的代码或 memory 文件。 | 按当前 `modes` 展示 Original 和运行模式快照；fixture 未声明但 agent 新建的文件也会进入快照，Original 显示为“文件不存在”。 |
| `input` | 用来诱导或约束判断的只读材料，例如旧 archive 诱饵、无关 domain、外部 API 样例。 | 如果未被修改，只展示一次；如果被修改，按 Original + 当前运行模式展开并提示检查。 |

为了检查精准加载和减少 token 浪费，`memory-load` 用例应在 fixture 中放置无关 domain 和 archive 诱饵，但任务 prompt 不直接提示哪个文件是正确答案。评估报告应展示 agent 声明依据的 memory 文件列表，以及最终代码和 memory 快照；该读取清单是弱证据，只有未来接入真实读取审计后才能严格证明“未读取某文件”。
