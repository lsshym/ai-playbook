# Skill Eval 使用与标准

这个目录维护 Wingman skill 的可重复评估。`package.json` 只保留两个通用入口；具体跑哪个 skill eval，用参数指定。

## 常用命令

```bash
npm run eval -- memory --dry-run
npm run eval -- memory --case MEM-LOAD-02 --runs 1
npm run eval -- align-contracts --case AC-S05 --runs 1
npm run eval:review -- memory --dry-run
npm run eval:review -- memory
```

说明：

- `npm run eval -- <eval-name>`: 按该 suite 的 `modes` 配置运行评估，输出到 `.eval-runs/<eval-name>/`。
- `--dry-run`: 只生成 prompt、summary 和 comparison，不调用模型。
- `--case ID`: 只跑一个 case。
- `--cases A,B`: 跑多个指定 case。
- `--runs N`: 覆盖重复次数。
- `--resume`: 复用已有输出和快照。
- `--output DIR`: 改写输出目录。
- `--reasoning-effort low|medium|high`: 覆盖 Codex 推理强度。
- `npm run eval:review -- <eval-name>`: 读取 eval 输出，生成 AI 分析报告。

## 输出目录

每次运行会写入 `.eval-runs/<eval-name>/`：

- `prompts/`: 每个 case、每个模式实际发送给 Codex 的 prompt。
- `outputs/`: Codex 的文字输出。
- `comparisons/`: original 和各运行模式的文件快照。
- `comparison.json`: 机器可读的逐 case 快照索引。
- `summary.json`: 样本状态摘要。
- `summary.md`: 简短汇总。
- `report.html`: 人工审查用的 Original + 当前运行模式对比报告。
- `ai-review-prompt.md`: AI 分析报告 prompt，运行 review 后生成。
- `ai-review.md`: AI 分析报告，运行非 dry-run review 后生成。

## 新增 Eval Suite

每个 eval suite 放在 `skill-evals/<eval-name>/`，只维护这些文件：

```text
skill-evals/<eval-name>/
  README.zh-CN.md
  cases.zh-CN.md
  eval.config.mjs
  fixtures.mjs
```

不要创建 suite 本地 `runner.mjs`。统一入口固定是：

```text
skill-evals/run.mjs
skill-evals/review.mjs
```

## Case 表格式

所有 `cases.zh-CN.md` 必须使用同一个表头：

```markdown
| ID | Skill | 环境标签 | 场景 | 重点 |
| --- | --- | --- | --- | --- |
```

字段含义：

| 字段 | 含义 |
| --- | --- |
| `ID` | 用例编号，必须唯一，例如 `AC-S01`、`MEM-LOAD-02`。 |
| `Skill` | 目标 skill 名，必须对应 `skills/<skill>/SKILL.md`。 |
| `环境标签` | 用逗号分隔的标签，用于环境描述、reference 注入和 fixture 分支。 |
| `场景` | 模型任务描述；这是唯一可以进入 prompt 的用例正文。 |
| `重点` | 测试目的、常见错误、期待效果和验收边界；只能进报告和人工审查，不应原样进入 prompt。 |

## Config 标准

`eval.config.mjs` 必须 default export 一个对象：

```js
export default {
  evalName: "memory",
  defaultRuns: 1,
  fixtureModule: "./fixtures.mjs",
  referenceMap: {
    "align-contracts": {
      "react-typescript": ["references/frontend-react-typescript.md"]
    }
  },
  promptInstructions: [
    "请在最终说明中列出本次依据的 memory 文件；如果没有读取到 memory，请明确说明。"
  ],
  modes: ["skill"]
};
```

允许字段只有：

- `evalName`
- `defaultRuns`
- `fixtureModule`
- `referenceMap`
- `promptInstructions`
- `modes`

`evalName` 必须等于目录名，`fixtureModule` 必须是 `./fixtures.mjs`。

`modes` 可选，默认是 `["baseline", "skill"]`。如果 suite 不需要对照组，可以设置为 `["skill"]`。目前只允许 `baseline` 和 `skill`，并且必须包含 `skill`。

## Fixture 标准

`fixtures.mjs` 必须导出：

```js
export function buildFixture(testCase) {
  return {
    files: [
      {
        path: "src/example.ts",
        content: "...",
        role: "editable",
        language: "typescript",
        initiallyExists: true
      }
    ]
  };
}
```

文件对象只允许这些字段：

- `path`
- `content`
- `role`
- `language`
- `initiallyExists`
- `missingContent`

`role` 只能是：

- `editable`: agent 应该编辑或创建的文件。
- `input`: 只读输入材料、诱饵或外部样例。若被修改，报告会按 Original + 当前运行模式展开并提示检查。

`path` 必须是相对路径，不能使用绝对路径或 `..` 跳出 fixture 工作区。

## Prompt 防泄题

统一 runner 只把 `场景` 放进任务 prompt。`重点` 用于报告展示和人工审查，不应原样进入任务 prompt。

如果某个 eval 需要额外说明，例如 memory eval 要求模型列出读取过的 memory 文件，把这类通用说明放在 `eval.config.mjs` 的 `promptInstructions`。

## AI 分析报告

真实 eval 跑完后，用统一 review 入口生成 AI 分析报告：

```bash
npm run eval:review -- memory
npm run eval:review -- align-contracts
```

review 入口读取 `.eval-runs/<eval-name>/summary.json`、`comparison.json`、`outputs/` 和 `comparisons/` 下的快照。它不会读取 HTML 报告，避免浪费 token。

可以用 `--dry-run` 只生成 `ai-review-prompt.md`，不调用模型；可以用 `--case CASE_ID` 或 `--cases A,B` 限制分析范围。

## 机器校验

标准由 `skill-evals/checks/eval-standard.test.mjs` 强制执行。它会检查：

- 必需文件是否存在。
- 是否存在禁止的本地 `runner.mjs`。
- case 表头是否完全一致。
- `Skill` 是否指向真实 skill。
- `eval.config.mjs` 是否只使用白名单字段。
- fixture shape 是否合法。
- `package.json` 是否只暴露通用 `eval` 和 `eval:review` 入口。

运行：

```bash
npm run test:behavior
```
