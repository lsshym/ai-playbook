# align-contracts 代码对比评估

这个目录只放 `align-contracts` 自己的用例、配置和 fixture。运行、快照、HTML 报告由统一入口 `skill-evals/run.mjs` 调用公共 runner 生成。

## 怎么跑

```bash
npm run eval -- align-contracts --dry-run
npm run eval -- align-contracts --case AC-S05 --runs 1
npm run eval -- align-contracts --resume
npm run eval:review -- align-contracts
```

默认运行 6 个 smoke case，baseline/skill 两种模式各 2 次，输出到 `.eval-runs/align-contracts/`。

## 输出看哪里

- `report.html`: 人工审查用的 original / baseline / skill 三栏代码对比。
- `comparison.json`: 机器可读的快照索引。
- `summary.json`: 样本状态摘要。
- `prompts/`: 每个 case 实际发给 Codex 的 prompt。
- `outputs/`: Codex 的文字说明。
- `ai-review.md`: 运行 `npm run eval:review -- align-contracts` 后生成的 AI 分析报告。

## 怎么加 case

1. 在 `cases.zh-CN.md` 追加一行 case。
2. 在 `fixtures.mjs` 添加对应 fixture builder。
3. 给 fixture 补一条行为测试，确认文件列表和关键错位代码。
