# memory 触发与执行效果评估

这个目录只放 `memory-setup`、`memory-load`、`memory-sync` 的评估用例、配置和 fixture。运行、快照、HTML 报告由统一入口 `skill-evals/run.mjs` 调用公共 runner 生成。

## 评估目标

memory eval 同时覆盖两件事：

- **触发判断**：用户明确调用时该使用哪个 memory skill，一般任务默认不自动触发 memory setup/sync。
- **执行效果**：skill 触发后是否读取或更新正确 memory 文件，是否避免全量读取、串 domain、污染 archive、错误升格规则或重写无关历史。

## 怎么跑

命令沿用 `align-contracts` 的风格：

```bash
npm run eval -- memory --dry-run
npm run eval -- memory --case MEM-LOAD-02 --runs 1
npm run eval -- memory --resume
npm run eval:review -- memory
```

默认 smoke 集合覆盖 `cases.zh-CN.md` 中全部首批用例，输出到 `.eval-runs/memory/`。

## 输出建议

runner 生成：

- `report.html`: 人工审查用的 Original / Baseline / Skill 三栏快照，外加触发判断摘要。
- `comparison.json`: 机器可读的文件快照索引。
- `summary.json`: 样本状态摘要。
- `prompts/`: 每个 case、每个模式实际发送给 Codex 的 prompt。
- `outputs/`: Codex 的文字说明。
- `ai-review.md`: 运行 `npm run eval:review -- memory` 后生成的 AI 分析报告。

`memory-load` 执行类用例还应在报告中展示 agent 声明依据的 memory 文件列表，便于人工检查是否做到精准读取。

## 模式建议

memory eval 仍以 `align-contracts` 的 `baseline` / `skill` 对比为主体：

| 模式 | 用途 |
| --- | --- |
| `baseline` | 明确不使用外部 skill，观察普通 agent 会怎样处理。 |
| `skill` | 注入目标 skill 文本，测试触发判断和执行效果是否符合协议。 |

触发要求不单独拆成浅层 case，而是写进每条用例的 `重点`：例如 `MEM-SETUP-03` 同时检查“普通工作不能自动 setup”和“缺少 memory root 时 load 应正常继续”。runner 可以从 `重点` 派生人工审查项，也可以在报告里展示模型最终说明以辅助判断。

## Prompt 约定

`场景` 可以进入 prompt。`重点` 只能用于报告展示、人工审查和未来自动断言，不应原样进入 baseline/skill 任务 prompt。

执行类用例可以要求 agent 在最终说明中列出“本次依据的 memory 文件”，这是为了评估精准加载；但 prompt 不应泄露哪个 domain 或 subfile 是正确答案。

## 怎么加 case

1. 在 `cases.zh-CN.md` 追加一行 case。
2. 在 `fixtures.mjs` 中添加对应 fixture builder。
3. 给 fixture 补行为测试，确认文件列表、诱饵规则和关键 memory 结构。
4. 确认 prompt 不泄露报告列里的审查答案。
