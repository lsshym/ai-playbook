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
| `prepare:codex-local` | 运行 `scripts/sync-to-codex-plugin.sh --dest .`，把当前仓库的 Codex payload 同步到 `plugins/wingman/`，供 GitHub marketplace 安装使用。 |

## 为什么同时有 `test` 和 `test:all`

这两个看起来重复，但用途略有区别：

- `test` 是 npm 约定入口，所以 `npm test`、编辑器和很多工具默认会找它。
- `test:all` 是项目自己的显式总入口，名字更清楚，也方便在 CI、文档或发布流程中直接引用。

因此 `test` 保持很薄，只代理到 `test:all`。

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
