# 评估运行目录

这个目录用于保存手动评估产生的运行产物。除了这个 README，目录下的输出文件默认不进 git。

## align-contracts 重型评估

`align-contracts` 的重型评估配置在 [docs/align-contracts-heavy-test/report.zh-CN.md](../docs/align-contracts-heavy-test/report.zh-CN.md)。

常用命令：

```bash
npm run eval:align-contracts:dry-run
npm run eval:align-contracts -- --limit 1 --runs 1
npm run eval:align-contracts -- --limit 1 --runs 1 --reasoning-effort low
npm run eval:align-contracts -- --resume
```

- `dry-run` 只生成 prompt 和 `summary.json`，不调用模型，适合先检查 17 个 core 场景和输出目录结构。
- `--limit 1 --runs 1` 只真实跑 1 个场景、baseline/skill 各 1 次，适合确认 Codex 环境可用。
- 默认推理程度是 `medium`。可以用 `--reasoning-effort low|medium|high` 覆盖；建议先用 `medium`，再用 `low` 做压力测试。
- `--resume` 用于继续完整运行；已有输出会复用，避免重复花费。

默认输出位置是 `.eval-runs/align-contracts-heavy/`：

- `README.md`: 本次运行目录说明。
- `prompts/`: 每个 case、每个模式的实际 prompt。
- `outputs/`: 每次 Codex 调用返回的原始回答。
- `summary.json`: 自动评分摘要。
- `report.html`: 更适合人工查看的可视化报告。

这个评估故意没有放进 `npm test`。它会调用模型、耗时和成本都明显高于单元测试，所以通过 `npm run eval:align-contracts*` 手动触发。
