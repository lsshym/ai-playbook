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
| `eval:align-contracts` | 手动执行 `skills/align-contracts` 的重型模型评估 runner。默认会按报告里的 60 个场景，baseline/skill 两组各重复 3 次，输出到 `.eval-runs/align-contracts-heavy/`。它不包含在 `npm test` 里。 |
| `eval:align-contracts:dry-run` | 只生成重型评估的 prompt、目录说明和 `summary.json`，不调用模型。适合先检查测试用例、隔离方式和输出结构。 |
| `prepare:codex-local` | 运行 `scripts/sync-to-codex-plugin.sh --dest .`，把根目录维护的 Codex 插件内容同步到 `plugins/wingman/`。这样当前 GitHub 仓库就具备 Codex marketplace 需要的目录结构，用户通过 Codex 从这个仓库安装插件时能找到 Wingman。 |

## 手动评估脚本

`eval:align-contracts` 是实验评估入口，不是日常单元测试入口。它会调用 Codex 生成真实回答，完整运行是 60 个场景 × 2 个模式 × 3 次重复，也就是 360 份模型输出，所以需要手动触发：

```bash
npm run eval:align-contracts:dry-run
npm run eval:align-contracts -- --limit 1 --runs 1
npm run eval:align-contracts -- --resume
```

评估设计见 `docs/align-contracts-heavy-test/report.zh-CN.md`，运行产物见 `.eval-runs/README.md`。

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
