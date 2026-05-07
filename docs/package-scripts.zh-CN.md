# Package Scripts

本文说明 `package.json` 里的 npm scripts 分别做什么，以及平时应该跑哪几个。

## 日常只需要记住

```bash
npm run prepare:codex-local
npm test
```

- `npm run prepare:codex-local`: 修改 Codex 插件内容后，把根目录 payload 同步到 `plugins/wingman/`。
- `npm test`: 跑完整测试和发布前健康检查。

## Scripts 说明

| Script | 作用 |
| --- | --- |
| `test` | npm 标准测试入口。运行 `npm test` 时会执行它。当前它只是转到 `test:all`，方便保留一个统一总入口。 |
| `test:all` | 显式的完整检查入口。依次运行 `test:plugin`、`test:package`、`test:behavior` 和 `check:plugin`。CI 或发布前可以直接跑这个。 |
| `test:plugin` | 检查当前仓库里的插件本体，包括 manifest、skill frontmatter、README/skill 覆盖、alias、hook smoke test，以及 `plugins/wingman` payload 是否和源码同步。 |
| `test:package` | 用临时 package fixtures 模拟完整插件包，确认缺文件、坏 manifest、坏 frontmatter、路径漂移等问题能被检查脚本抓出来。 |
| `test:behavior` | 检查行为测试资产是否完整，包括 prompt、expectation 和人工审核记录。它不启动真实 agent，也不验证模型实时行为。 |
| `check:plugin` | 直接运行 `scripts/check-plugin.mjs`，做一次插件发布健康检查。它也包含在 `test:all` 里。 |
| `eval:align-contracts` | 手动执行 `skills/align-contracts` 的代码对比评估。默认只跑 6 个 smoke 场景，baseline/skill 两组各重复 2 次，输出 original/baseline/skill 代码快照到 `.eval-runs/align-contracts/`。它不包含在 `npm test` 里。 |
| `eval:align-contracts:dry-run` | 只生成评估 prompt、目录说明和 `summary.json`，不调用模型。适合先检查测试用例、隔离方式和输出结构。 |
| `prepare:codex-local` | 运行 `scripts/sync-to-codex-plugin.sh --dest .`，把根目录维护的 Codex 插件内容同步到 `plugins/wingman/`。这样当前 GitHub 仓库就具备 Codex marketplace 需要的目录结构，用户通过 Codex 从这个仓库安装插件时能找到 Wingman。 |

## 手动评估脚本

`eval:align-contracts` 是实验评估入口，不是日常单元测试入口。它会调用公共 code snapshot runner，让 Codex 在最小 fixture 工作区里真实编辑代码。默认运行 6 个 smoke 场景 × 2 个模式 × 2 次重复，也就是 24 份代码快照：

```bash
npm run eval:align-contracts:dry-run
npm run eval:align-contracts -- --case AC-S05 --runs 1
npm run eval:align-contracts -- --limit 1 --runs 1
npm run eval:align-contracts -- --resume
```

默认使用 `gpt-5.5` 和 `low` 推理程度。`--reasoning-effort low|medium|high` 可以覆盖推理程度。

流程说明见 `skill-evals/align-contracts/README.zh-CN.md`，用例清单见 `skill-evals/align-contracts/cases.zh-CN.md`。运行后主要查看 `.eval-runs/align-contracts/report.html` 和 `comparison.json`；需要 AI 审核总结时，可以把 `report.html` 或 `comparison.json` 交给模型人工判断，后续再抽成公共 review 命令。

## 什么时候跑 `prepare:codex-local`

改动这些内容后运行：

- `.codex-plugin/`
- `skills/`
- `assets/`
- `README.md`
- `LICENSE`
- `PRIVACY.md`
- `TERMS.md`

运行后再用下面命令检查同步结果：

```bash
git diff -- plugins/wingman
npm test
```
