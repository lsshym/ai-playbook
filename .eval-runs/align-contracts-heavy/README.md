# align-contracts 代码对比评估输出

这个目录由 `npm run eval:align-contracts` 或 `skill-evals/align-contracts-heavy/runner.mjs` 生成。

## 目录说明

- `prompts/`: 每个 case、每个模式实际发送给 Codex 的 prompt。
- `outputs/`: Codex 返回的文字说明，按 case、模式和第几次运行保存。
- `comparisons/`: original、baseline、skill 的真实代码快照。
- `comparison.json`: 面向机器读取的代码快照索引。
- `report.html`: 面向人工审核的三栏代码对比报告。
- `summary.json`: 样本状态摘要。
