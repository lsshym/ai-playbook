# memory 触发与执行效果评估

这个目录只放 `memory-setup`、`memory-load`、`memory-sync` 的评估用例和未来 fixture 约定。测试脚本暂未实现；当前先维护 case 标准，后续 runner 应参考 `skill-evals/align-contracts` 的输出结构。

## 评估目标

memory eval 同时覆盖两件事：

- **触发判断**：该使用哪个 memory skill，以及哪些 skill 绝不能被误触发。
- **执行效果**：skill 触发后是否读取或更新正确 memory 文件，是否避免全量读取、串 domain、污染 archive、错误升格规则或重写无关历史。

## 未来运行方式

未来脚本建议沿用 `align-contracts` 的命令风格：

```bash
npm run eval:memory:dry-run
npm run eval:memory -- --case MEM-L02 --runs 1
npm run eval:memory -- --resume
```

默认 smoke 集合应覆盖 `cases.zh-CN.md` 中全部首批用例，输出到 `.eval-runs/memory/`。

## 输出建议

未来 runner 建议生成：

- `report.html`: 人工审查用的 Original / Baseline / Skill 三栏快照，外加触发判断摘要。
- `comparison.json`: 机器可读的文件快照索引。
- `summary.json`: 样本状态摘要。
- `prompts/`: 每个 case、每个模式实际发送给 Codex 的 prompt。
- `outputs/`: Codex 的文字说明。

`memory-load` 执行类用例还应在报告中展示 agent 声明依据的 memory 文件列表，便于人工检查是否做到精准读取。

## 模式建议

memory eval 可以比 `align-contracts` 多一个触发判断维度：

| 模式 | 用途 |
| --- | --- |
| `trigger` | 不注入完整 skill 内容，只测试模型是否应选择期望 skill、避免禁止 skill。 |
| `baseline` | 明确不使用外部 skill，观察普通 agent 会怎样处理。 |
| `skill` | 注入目标 skill 文本，测试执行效果是否符合协议。 |

触发类用例主要看 `trigger` 输出；执行类用例主要看 `baseline` / `skill` 文件快照对比。

## Prompt 约定

`任务场景` 可以进入 prompt。以下列只能用于报告展示和人工审查，不应进入 baseline/skill 任务 prompt：

- `期望触发`
- `禁止触发`
- `这条在测什么`
- `常见错误`
- `期待效果`

执行类用例可以要求 agent 在最终说明中列出“本次依据的 memory 文件”，这是为了评估精准加载；但 prompt 不应泄露哪个 domain 或 subfile 是正确答案。

## 怎么加 case

1. 在 `cases.zh-CN.md` 追加一行 case。
2. 在未来 `runner.mjs` 中添加对应 fixture builder。
3. 给 fixture 补行为测试，确认文件列表、诱饵规则和关键 memory 结构。
4. 确认 prompt 不泄露报告列里的审查答案。
