# memory 触发与执行效果测试用例

本文只维护 `memory-setup`、`memory-load`、`memory-sync` 三个 memory skill 的评估用例清单。运行流程和 runner 以后补充到 `README.zh-CN.md`。

runner 应从下表解析用例 ID、测试类型、目标 skill、环境标签和任务场景。`期望触发`、`禁止触发`、`这条在测什么`、`常见错误`、`期待效果` 只用于报告展示和人工审查，不应放进 baseline/skill 的任务 prompt。

## Smoke 用例

首批用例覆盖两类问题：

- **触发判断**：agent 是否在该用 skill 时使用 memory skill，不该用时保持克制。
- **执行效果**：skill 触发后，是否按 memory 协议读取或更新正确文件，避免全量读取、串 domain、污染 archive 或写错层级。

索引使用 `MEM-TXX` 表示触发测试，`MEM-LXX` 表示 `memory-load` 执行效果测试，`MEM-SXX` 表示 `memory-sync` 执行效果测试，`MEM-SETUP-XX` 表示 `memory-setup` 执行效果测试。

| ID | 测试类型 | 目标 skill | 环境标签 | 任务场景 | 期望触发 | 禁止触发 | 这条在测什么 | 常见错误 | 期待效果 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MEM-T01 | trigger | memory-setup | explicit-workflow, empty-memory | 用户明确输入 `/memory-setup`，要求在当前仓库初始化 Wingman memory。 | memory-setup | memory-load, memory-sync | 测 `memory-setup` 是否只在用户明确手动调用或明确要求初始化时触发。 | 把显式 setup 当普通说明忽略；或者先执行其他无关操作才进入 setup。 | 先使用 `memory-setup`，准备创建 `.wingman/memory` 和平台入口规则。 |
| MEM-T02 | trigger | memory-setup | nontrivial-work, missing-memory | 仓库没有 `.wingman/memory`，用户要求修复 checkout webhook 状态流 bug，但没有要求初始化记忆系统。 | memory-load | memory-setup | 测普通工作即使仓库没有 memory，也不能自动触发 `memory-setup`；非平凡业务 bug 可以先走 `memory-load` 判断。 | 看到没有 `.wingman/memory` 就擅自创建 memory 骨架；把 setup 当成 memory-load 的 fallback。 | 不触发 `memory-setup`；`memory-load` 发现 memory root 不存在后正常继续任务。 |
| MEM-T03 | trigger | memory-load | existing-memory, checkout | 仓库已有 Wingman memory，用户要求修复 checkout 支付 webhook 成功后订单仍停在 `pending_payment` 的问题。 | memory-load | memory-setup | 测非平凡调试、状态流和现有业务行为是否会触发 `memory-load`。 | 直接改代码不读 memory；或者误触发 `memory-setup` 重建记忆系统。 | 先使用 `memory-load`，再根据相关记忆和代码定位状态流问题。 |
| MEM-T04 | trigger | memory-sync | explicit-sync, api-contract | 用户明确说“用 memory-sync 记录这次 checkout API 契约决定：`payment_status` 是 canonical field”。 | memory-sync | memory-setup | 测显式记录记忆时是否触发 `memory-sync`，且不进入 setup。 | 只口头总结不使用 sync；或者把记录请求误解成初始化 memory。 | 先使用 `memory-sync`，准备把有证据的 API 契约写入合适 memory 位置。 |
| MEM-SETUP-01 | execution | memory-setup | empty-memory, zh-CN | 空仓库中，用户用中文明确要求初始化 Wingman memory。 | memory-setup | memory-load, memory-sync | 测 setup 是否创建完整 memory 根目录、种子文件和平台入口规则。 | 只打印模板不落盘；漏建 `domains/README.md` 或 `archive/README.md`；语言设置仍写成不合适的默认值。 | 创建 `.wingman/memory/projectBrief.md`、`activeContext.md`、`domains/README.md`、`archive/README.md`，并创建或更新 `AGENTS.md`、`CLAUDE.md`、`.cursor/rules/wingman-memory.mdc`；中文请求下 `Language` 应为 `zh-CN` 或合理说明为何保持 `auto`。 |
| MEM-SETUP-02 | execution | memory-setup | existing-entry-files, managed-block | 仓库已有 `AGENTS.md`、`CLAUDE.md` 和 `.cursor/rules/wingman-memory.mdc`，其中既有用户自定义内容，也有旧的 `<!-- Wingman Memory:start -->...<!-- Wingman Memory:end -->` 区块；用户要求重新初始化 Wingman memory。 | memory-setup | memory-load, memory-sync | 测 setup 是否只替换 Wingman 管理区块，并保留平台入口文件里的非 Wingman 内容。 | 整文件重写导致用户规则丢失；重复追加多个 Wingman block；改动无关说明。 | 只替换或追加 Wingman managed block；所有非 Wingman 内容逐字保留；memory 种子文件存在且结构正确。 |
| MEM-L01 | execution | memory-load | missing-memory, new-domain | 仓库没有 `.wingman/memory`，用户要实现一个全新的 invite-code 小功能。 | memory-load | memory-setup, memory-sync | 测新业务或新仓库读不到 memory 是否能正常继续，而不是警告、初始化或编造记忆。 | 把缺失 memory 当错误阻塞；擅自运行 setup；虚构“之前的规则”。 | `memory-load` 判断 memory root 不存在后安静继续；不创建 `.wingman/`；不声称读到了任何 memory。 |
| MEM-L02 | execution | memory-load | multi-domain, checkout | memory 中有 `checkout`、`auth`、`billing`、`reporting` 多个 domain；用户只要求修 checkout webhook 状态流。 | memory-load | memory-setup, memory-sync | 测复杂 memory tree 下能否按 domain registry 精准定位 checkout，而不是全量读取。 | 一次性读取所有 domain；被 auth/billing/reporting 的诱饵规则带偏；默认读取 archive。 | 读取 `projectBrief.md`、`activeContext.md`、`domains/README.md` 和 checkout 相关 domain；不依赖无关 domain；代码遵守 checkout 当前规则。 |
| MEM-L03 | execution | memory-load | folder-domain, checkout-status | `checkout` 是 folder domain，`index.md` 列出 `pricing.md`、`status-flow.md`、`api-contracts.md`；用户只修支付成功后的订单状态流。 | memory-load | memory-setup, memory-sync | 测 folder domain 是否先读 index，再按 subfiles 只读最相关 topic。 | 读完整个 checkout 文件夹；漏读 `index.md` 直接猜文件；把 pricing 或 API contract 当状态流规则。 | 先依据 `checkout/index.md` 判断，再只依赖 `status-flow.md` 等必要文件；不全量读取无关 subfiles。 |
| MEM-L04 | execution | memory-load | archive-trap, checkout | `activeContext.md` 和 checkout domain 写着当前规则，`archive/2026-04.md` 放了一条过期且冲突的旧状态映射；用户修 checkout 状态流。 | memory-load | memory-setup, memory-sync | 测 archive 是否保持 cold storage，默认不读取也不采用旧规则。 | 默认读取 archive；按 archive 的旧规则改代码；把旧规则重新写回 active/domain。 | 不读取或不采用 archive 诱饵；最终代码遵守 active/domain 当前规则；memory 文件不被修改。 |
| MEM-S01 | execution | memory-sync | active-log, checkout | 已完成 checkout webhook 状态流修复，用户要求同步本次进展到 memory。 | memory-sync | memory-setup | 测 sync 是否把有意义进展写入 `activeContext.md` 的当前日志区，并保护旧日志。 | 把日志追加到文件末尾；重写或压缩旧日志；写到 domain truth 但没有证据。 | 在当前日志区顶部 prepend 新日志，包含目标、核心文件和备注；不改无关历史；无稳定规则证据时不写 domain truth。 |
| MEM-S02 | execution | memory-sync | domain-truth, checkout-api | 用户明确确认 checkout API 中 `payment_status` 是 canonical field，不能用 `order_status` 兜底；要求记录这个契约。 | memory-sync | memory-setup | 测 sync 是否把有证据的稳定业务/API 契约写到正确 domain，而不是写成全局 ADR。 | 写进 `projectBrief.md` 的全局规则；遗漏 `[WHY]` 或 Evidence；把字段名翻译掉；同时污染无关 domain。 | 更新 checkout domain 的当前业务真理，包含 `[WHY]`、Evidence、Applies When；不修改 auth/billing/reporting；不把 domain truth 升格成 project ADR。 |
| MEM-S03 | execution | memory-sync | ignore-threshold, rename-only | 本次只是变量改名和格式整理，没有状态、数据、契约或业务行为变化；用户仍说“同步一下 memory”。 | memory-sync | memory-setup | 测 Value Funnel 是否能判断低价值改动不该写 memory。 | 为了响应 sync 请求硬写一条泛泛日志；把 rename-only 伪装成架构决策。 | 说明该改动未达到 memory 记录阈值；不修改 `activeContext.md`、domain 或 archive。 |
| MEM-S04 | execution | memory-sync | user-override, skip-update | 已完成一个有意义的 checkout bugfix，但用户明确说“这个不用记忆 / skip update”。 | memory-sync | memory-setup | 测用户覆盖规则是否优先于 Value Funnel 和默认完成前同步。 | 无视用户要求仍写 active log；写 domain truth；归档旧日志。 | 完全不修改 `.wingman/memory`；简短说明已按用户要求跳过 memory 更新。 |

## Fixture 设计约定

memory eval 的 fixture 应包含两类文件：

| 角色 | 含义 | 报告展示方式 |
| --- | --- | --- |
| `editable` | agent 应该编辑或创建的代码、memory 或平台入口文件。 | 展示 Original / Baseline / Skill 三栏；新建文件的 Original 可显示为空或“文件不存在”。 |
| `input` | 用来诱导或约束判断的只读材料，例如旧 archive 诱饵、无关 domain、外部 API 样例。 | 如果未被修改，只展示一次；如果被修改，展开三栏并提示检查。 |

为了检查精准加载和减少 token 浪费，执行类 `memory-load` 用例应在 fixture 中放置无关 domain 和 archive 诱饵，但任务 prompt 不直接提示哪个文件是正确答案。评估报告应展示 agent 声明依据的 memory 文件列表，以及最终代码和 memory 快照。
