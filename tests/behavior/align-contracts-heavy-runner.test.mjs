import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  aggregateSummary,
  buildPrompt,
  buildCodexExecArgs,
  execFileWithInput,
  formatAggregateReport,
  formatConsoleSummary,
  formatHtmlReport,
  parseArgs,
  renderCodexConfig,
  runHeavySuite,
  parseCasesFromReport,
  resolveSkillBundle,
  scoreOutput,
} from "../../scripts/align-contracts-heavy-runner.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");

test("align-contracts heavy report exposes the curated core cases", async () => {
  const report = await readFile(
    path.join(repoRoot, "docs", "align-contracts-heavy-test", "report.zh-CN.md"),
    "utf8",
  );
  const cases = parseCasesFromReport(report);

  assert.equal(cases.length, 17);
  assert.deepEqual(cases[0], {
    id: "AC-01",
    tags: ["react-typescript"],
    scenario: "后端原来返回 `totalCents`，现在改成 `amount.total_minor_units`，前端金额组件还在用旧字段。",
    validation: "测回答能不能看出这是 API 返回结构和 React 组件 props 的契约错位，而不是普通 undefined 小 bug。",
    baselineRisk: "在父组件临时构造 `{ totalCents: amount.total_minor_units }`，让旧组件继续假装 API 没变。",
    skillExpected: "说明 API contract 已变；更新组件 props，或只在 API adapter/mapper 边界统一转成内部字段如 `totalMinorUnits`。",
  });
  assert.deepEqual(cases.map((testCase) => testCase.id), [
    "AC-01",
    "AC-02",
    "AC-03",
    "AC-04",
    "AC-05",
    "AC-06",
    "AC-07",
    "AC-08",
    "AC-09",
    "AC-10",
    "AC-11",
    "AC-12",
    "AC-13",
    "AC-14",
    "AC-15",
    "AC-16",
    "AC-17",
  ]);
  assert.equal(cases[11].scenario, "数据库 row 是 `snake_case`，业务层 entity 是 `camelCase`。");
  assert.deepEqual(cases[11].tags, ["db"]);
});

test("resolveSkillBundle injects references selected by case tags", async () => {
  const bundle = await resolveSkillBundle("align-contracts", ["react-typescript"]);

  assert.deepEqual(bundle.files.map((file) => file.path), [
    "skills/align-contracts/SKILL.md",
    "skills/align-contracts/references/frontend-react-typescript.md",
  ]);
  assert.match(bundle.text, /# Align Contracts/);
  assert.match(bundle.text, /# React \+ TypeScript Frontend Binding/);
  assert.match(bundle.text, /Avoid unrelated changes to:/);
});

test("resolveSkillBundle does not inject React reference for non-React cases", async () => {
  const bundle = await resolveSkillBundle("align-contracts", ["db"]);

  assert.deepEqual(bundle.files.map((file) => file.path), [
    "skills/align-contracts/SKILL.md",
  ]);
  assert.match(bundle.text, /# Align Contracts/);
  assert.doesNotMatch(bundle.text, /# React \+ TypeScript Frontend Binding/);
});

test("baseline prompt does not inject skill text", () => {
  const sampleCase = {
    id: "AC-04",
    scenario: "API 的 `status` 要接到 UI 的 `checkoutType`。",
    validation: "语义差异识别；不把两个“状态”随手等同。",
    baselineRisk: "直接写 `checkoutType = status`。",
    skillExpected: "标记 semantic mismatch，查 schema/docs 或询问用户。",
  };
  const skillText = "# Align Contracts\nCore principle: do not preserve a shape.";

  const prompt = buildPrompt(sampleCase, "baseline", skillText);

  assert.match(prompt, /测试编号：AC-04/);
  assert.match(prompt, /不要使用或提到任何外部 skill/);
  assert.doesNotMatch(prompt, /# Align Contracts/);
});

test("baseline prompt does not leak validation hints or expected failure modes", () => {
  const prompt = buildPrompt(
    {
      id: "AC-04",
      scenario: "API 的 `status` 要接到 UI 的 `checkoutType`。",
      validation: "语义差异识别；不把两个“状态”随手等同。",
      baselineRisk: "直接写 `checkoutType = status`。",
      skillExpected: "标记 semantic mismatch，查 schema/docs 或询问用户。",
    },
    "baseline",
    "# Align Contracts",
  );

  assert.match(prompt, /场景：API 的 status 要接到 UI 的 checkoutType。/);
  assert.doesNotMatch(prompt, /这条在测什么/);
  assert.doesNotMatch(prompt, /常见错误/);
  assert.doesNotMatch(prompt, /语义差异识别/);
  assert.doesNotMatch(prompt, /直接写 checkoutType = status/);
  assert.doesNotMatch(prompt, /期待好回答/);
});

test("skill prompt injects local align-contracts text", () => {
  const sampleCase = {
    id: "AC-04",
    scenario: "API 的 `status` 要接到 UI 的 `checkoutType`。",
    validation: "语义差异识别；不把两个“状态”随手等同。",
    baselineRisk: "直接写 `checkoutType = status`。",
    skillExpected: "标记 semantic mismatch，查 schema/docs 或询问用户。",
  };
  const skillText = "# Align Contracts\nCore principle: do not preserve a shape.";

  const prompt = buildPrompt(sampleCase, "skill", skillText);

  assert.match(prompt, /请先使用 align-contracts skill/);
  assert.match(prompt, /# Align Contracts/);
  assert.match(prompt, /这条在测什么：语义差异识别/);
  assert.match(prompt, /常见错误：直接写 checkoutType = status/);
  assert.match(prompt, /期待好回答/);
  assert.doesNotMatch(prompt, /主要验证点/);
  assert.doesNotMatch(prompt, /已知 baseline 风险/);
  assert.doesNotMatch(prompt, /预期 skill 行为/);
});

test("skill prompt shows injected skill bundle files", () => {
  const sampleCase = {
    id: "AC-01",
    tags: ["react-typescript"],
    scenario: "后端原来返回 `totalCents`，现在改成 `amount.total_minor_units`，前端金额组件还在用旧字段。",
    validation: "测回答能不能看出这是 API 返回结构和 React 组件 props 的契约错位，而不是普通 undefined 小 bug。",
    baselineRisk: "在父组件临时构造 `{ totalCents: amount.total_minor_units }`，让旧组件继续假装 API 没变。",
    skillExpected: "说明 API contract 已变；更新组件 props，或只在 API adapter/mapper 边界统一转成内部字段如 `totalMinorUnits`。",
  };
  const skillText = [
    "## skills/align-contracts/SKILL.md",
    "# Align Contracts",
    "## skills/align-contracts/references/frontend-react-typescript.md",
    "# React + TypeScript Frontend Binding",
  ].join("\n");

  const prompt = buildPrompt(sampleCase, "skill", skillText, [
    "skills/align-contracts/SKILL.md",
    "skills/align-contracts/references/frontend-react-typescript.md",
  ]);

  assert.match(prompt, /Skill 注入文件：/);
  assert.match(prompt, /skills\/align-contracts\/SKILL\.md/);
  assert.match(prompt, /skills\/align-contracts\/references\/frontend-react-typescript\.md/);
  assert.match(prompt, /# React \+ TypeScript Frontend Binding/);
});

test("prompt return format is Chinese", () => {
  const prompt = buildPrompt(
    {
      id: "AC-01",
      scenario: "后端金额字段从 `totalCents` 改成 `amount.total_minor_units`。",
      validation: "API -> UI 结构变化。",
      baselineRisk: "临时拼回旧字段。",
      skillExpected: "集中转换。",
    },
    "baseline",
    "# Align Contracts",
  );

  assert.match(prompt, /请返回：/);
  assert.match(prompt, /提供方契约/);
  assert.match(prompt, /消费方契约/);
  assert.match(prompt, /事实来源/);
  assert.doesNotMatch(prompt, /Provider contract/);
});

test("scoreOutput rewards contract-alignment signals", () => {
  const score = scoreOutput(`
Provider contract: API gives amount.total_minor_units.
Consumer contract: React summary expected totalCents.
Source of truth: backend API owns the display-only shape.
Gap: structural mismatch, not naming only.
Binding location: update schema parser or one adapter.
Avoid ad-hoc parent mapper and fake defaults such as id: 0.
Ask the user if checkoutType and status differ semantically.
Preserve CSS and layout. Verify with typecheck and fixture tests.
`);

  assert.equal(score.total, 10);
  assert.equal(score.基础项总分, 10);
  assert.equal(score.flags.fakeDefaults, false);
  assert.equal(score.flags.adHocMapper, false);
});

test("scoreOutput uses case-specific expectations and risks as primary scoring", () => {
  const testCase = {
    id: "AC-01",
    scenario: "后端金额字段从 `totalCents` 改成 `amount.total_minor_units`。",
    validation: "API -> UI 结构变化；金额字段 ownership；React component contract。",
    baselineRisk: "在父组件临时拼回 `totalCents`，假装 API 没变。",
    skillExpected: "识别 API contract 已变，更新组件契约或集中转换。",
  };

  const score = scoreOutput(
    `
识别 API contract 已变。
建议更新组件契约，或在 adapter 中集中转换。
不要在父组件临时拼回 totalCents。
`,
    testCase,
  );

  assert.equal(score.total, 4);
  assert.equal(score.主分, 4);
  assert.equal(score.场景期望.命中数, 2);
  assert.equal(score.风险错误.避开数, 2);
  assert.deepEqual(score.场景期望.项目.map((item) => item.名称), [
    "识别 API contract 已变",
    "更新组件契约或集中转换",
  ]);
});

test("scoreOutput treats API contract changed wording as evidence", () => {
  const testCase = {
    id: "AC-01",
    scenario: "后端金额字段从 `totalCents` 改成 `amount.total_minor_units`。",
    validation: "API -> UI 结构变化；金额字段 ownership；React component contract。",
    baselineRisk: "在父组件临时拼回 `totalCents`，假装 API 没变。",
    skillExpected: "识别 API contract 已变，更新组件契约或集中转换。",
  };

  const score = scoreOutput(
    "API contract 已经从 totalCents 改为 amount.total_minor_units，所以事实来源是后端 API。",
    testCase,
  );

  assert.equal(score.场景期望.项目[0].命中, true);
  assert.equal(
    score.场景期望.项目[0].证据,
    "API contract 已经从 totalCents 改为 amount.total_minor_units，所以事实来源是后端 API。",
  );
});

test("scoreOutput penalizes case-specific risk language", () => {
  const testCase = {
    id: "AC-01",
    scenario: "后端金额字段从 `totalCents` 改成 `amount.total_minor_units`。",
    validation: "API -> UI 结构变化；金额字段 ownership；React component contract。",
    baselineRisk: "在父组件临时拼回 `totalCents`，假装 API 没变。",
    skillExpected: "识别 API contract 已变，更新组件契约或集中转换。",
  };

  const score = scoreOutput("在父组件临时拼回 totalCents，假装 API 没变。", testCase);

  assert.equal(score.风险错误.避开数, 0);
  assert.equal(score.风险错误.项目[0].出现, true);
  assert.equal(score.风险错误.项目[1].出现, true);
});

test("scoreOutput treats explicit rejection of risk code as avoided risk", () => {
  const testCase = {
    id: "AC-01",
    scenario: "后端金额字段从 `totalCents` 改成 `amount.total_minor_units`。",
    validation: "API -> UI 结构变化；金额字段 ownership；React component contract。",
    baselineRisk: "在父组件临时拼回 `totalCents`，假装 API 没变。",
    skillExpected: "识别 API contract 已变，更新组件契约或集中转换。",
  };

  const score = scoreOutput(
    `
这里不能把新 API 在父组件里临时拼回 totalCents。
不推荐在父组件里写 const item = { ...apiItem, totalCents: apiItem.amount.total_minor_units }。
这会假装 API 没变。
`,
    testCase,
  );

  assert.equal(score.风险错误.避开数, 2);
  assert.equal(score.风险错误.项目[0].出现, false);
  assert.equal(score.风险错误.项目[0].证据, "这里不能把新 API 在父组件里临时拼回 totalCents。");
  assert.equal(score.风险错误.项目[0].判定说明, "回答明确否定或避免该风险。");
  assert.equal(score.风险错误.项目[1].出现, false);
});

test("scoreOutput records evidence and expectations for auxiliary criteria", () => {
  const score = scoreOutput(`
提供方契约：API 返回 amount.total_minor_units。
消费方契约：React 组件还在读取 totalCents。
事实来源：以后端 API schema 为准。
差异分类：这是结构变化，不只是命名变化。
绑定位置：应在 API adapter 中处理。
验证计划：运行 typecheck。
`, {
    id: "AC-01",
    scenario: "后端原来返回 `totalCents`，现在改成 `amount.total_minor_units`，前端金额组件还在用旧字段。",
    validation: "测回答能不能看出这是 API 返回结构和 React 组件 props 的契约错位，而不是普通 undefined 小 bug。",
    baselineRisk: "在父组件临时构造 `{ totalCents: amount.total_minor_units }`，让旧组件继续假装 API 没变。",
    skillExpected: "说明 API contract 已变；更新组件 props，或只在 API adapter/mapper 边界统一转成内部字段如 `totalMinorUnits`。",
  });

  assert.equal(score.检查项.提供方契约.通过, true);
  assert.equal(score.检查项.提供方契约.证据, "提供方契约：API 返回 amount.total_minor_units。");
  assert.equal(score.检查项.避免临时映射.通过, true);
  assert.equal(score.检查项.避免临时映射.适用, true);
  assert.match(score.检查项.避免临时映射.期望看到, /不要出现临时或分散映射/);
  assert.equal(score.检查项.避免临时映射.证据, "");
  assert.equal(score.检查项.避免临时映射.判定说明, "未发现临时或分散映射。");
  assert.equal(score.检查项.保留既有行为.通过, true);
  assert.equal(score.检查项.保留既有行为.判定说明, "未发现无关改动建议。");
  assert.equal(score.检查项.不清楚时主动询问.适用, false);
  assert.equal(score.检查项.不清楚时主动询问.判定说明, "本用例没有语义不确定触发点；这项应由语义不确定类用例覆盖。");
});

test("scoreOutput requires asking only for uncertainty-trigger cases", () => {
  const testCase = {
    id: "AC-04",
    scenario: "API 的 `status` 被拿来填 UI 的 `checkoutType`，但这两个词可能不是同一个业务概念。",
    validation: "测回答会不会警惕两个字段都像状态不代表语义相同。",
    baselineRisk: "直接写 `checkoutType = status`。",
    skillExpected: "标记这是语义不确定的契约错位；先查 schema/docs 或问清楚含义，再决定映射关系。",
  };

  const failed = scoreOutput("直接把 status 映射到 checkoutType。", testCase);
  assert.equal(failed.检查项.不清楚时主动询问.适用, true);
  assert.equal(failed.检查项.不清楚时主动询问.通过, false);
  assert.equal(failed.检查项.不清楚时主动询问.判定说明, "语义不确定，但未找到主动确认证据。");

  const passed = scoreOutput("这两个字段语义不确定，应先查 schema/docs 或问用户确认。", testCase);
  assert.equal(passed.检查项.不清楚时主动询问.适用, true);
  assert.equal(passed.检查项.不清楚时主动询问.通过, true);
  assert.equal(passed.检查项.不清楚时主动询问.判定说明, "找到主动确认证据。");
});

test("scoreOutput includes body text when evidence matches a markdown heading", () => {
  const score = scoreOutput(`
- **提供方契约**
  后端 API 现在提供 amount.total_minor_units。

- **消费方契约**
  React 组件还在读取 totalCents。
`);

  assert.equal(
    score.检查项.提供方契约.证据,
    "**提供方契约** 后端 API 现在提供 amount.total_minor_units。",
  );
  assert.equal(
    score.检查项.消费方契约.证据,
    "**消费方契约** React 组件还在读取 totalCents。",
  );
});

test("execFileWithInput writes prompt text to child stdin", async () => {
  const result = await execFileWithInput(
    process.execPath,
    ["-e", "process.stdin.pipe(process.stdout)"],
    {
      input: "中文 prompt\n",
      maxBuffer: 1024,
      timeout: 1000,
    },
  );

  assert.equal(result.stdout, "中文 prompt\n");
});

test("codex exec runs in isolated non-git workdir by skipping git repo check", () => {
  const args = buildCodexExecArgs("/tmp/clean-workdir", "/tmp/output.md");

  assert.ok(args.includes("--skip-git-repo-check"));
  assert.deepEqual(args.slice(0, 3), ["exec", "--cd", "/tmp/clean-workdir"]);
});

test("codex config defaults to medium reasoning and can be overridden", () => {
  assert.match(renderCodexConfig("/tmp/workdir", "medium"), /model_reasoning_effort = "medium"/);
  assert.match(renderCodexConfig("/tmp/workdir", "low"), /model_reasoning_effort = "low"/);
});

test("parseArgs supports reasoning effort override", () => {
  assert.equal(parseArgs(["--reasoning-effort", "low"]).reasoningEffort, "low");
  assert.throws(
    () => parseArgs(["--reasoning-effort", "xhigh"]),
    /reasoning-effort 只能是 low、medium 或 high/,
  );
});

test("aggregate summary reports Chinese hit details for each scoring criterion", () => {
  const aggregate = aggregateSummary([
    {
      模式: "baseline",
      评分: {
        总分: 2,
        主分满分: 4,
        基础项总分: 2,
        场景期望: { 命中数: 1, 总数: 2 },
        风险错误: { 避开数: 1, 总数: 2 },
        命中项: {
          提供方契约: true,
          消费方契约: false,
          事实来源: true,
          差异分类: false,
          绑定位置: false,
          避免临时映射: false,
          避免假默认值: false,
          不清楚时主动询问: false,
          保留既有行为: false,
          提出验证方式: false,
        },
        风险标记: {
          疑似假默认值: false,
          疑似临时映射: true,
        },
      },
    },
  ]);

  assert.equal(aggregate.baseline.样本数, 1);
  assert.equal(aggregate.baseline.总分, 2);
  assert.equal(aggregate.baseline.主分满分, 4);
  assert.equal(aggregate.baseline.基础项总分, 2);
  assert.equal(aggregate.baseline.场景期望.命中数, 1);
  assert.equal(aggregate.baseline.场景期望.总数, 2);
  assert.equal(aggregate.baseline.风险错误.避开数, 1);
  assert.equal(aggregate.baseline.风险错误.出现次数, 1);
  assert.equal(aggregate.baseline.命中项.提供方契约.命中数, 1);
  assert.equal(aggregate.baseline.命中项.消费方契约.命中数, 0);
  assert.equal(aggregate.baseline.命中项.事实来源.命中率, 1);
  assert.equal(aggregate.baseline.风险标记.疑似临时映射.出现次数, 1);
});

test("formatAggregateReport renders readable markdown tables without main scores", () => {
  const report = formatAggregateReport({
    baseline: {
      样本数: 1,
      总分: 6,
      主分满分: 10,
      基础项总分: 2,
      平均分: 6,
      平均满分: 10,
      场景期望: { 命中数: 3, 总数: 5, 命中率: 0.6 },
      风险错误: { 避开数: 3, 总数: 5, 出现次数: 2, 避开率: 0.6, 出现率: 0.4 },
      风险标记: {
        疑似假默认值: { 出现次数: 0, 出现率: 0 },
        疑似临时映射: { 出现次数: 1, 出现率: 1 },
      },
      命中项: {
        提供方契约: { 命中数: 1, 命中率: 1 },
        消费方契约: { 命中数: 1, 命中率: 1 },
        事实来源: { 命中数: 0, 命中率: 0 },
        差异分类: { 命中数: 0, 命中率: 0 },
        绑定位置: { 命中数: 0, 命中率: 0 },
        避免临时映射: { 命中数: 0, 命中率: 0 },
        避免假默认值: { 命中数: 0, 命中率: 0 },
        不清楚时主动询问: { 命中数: 0, 命中率: 0 },
        保留既有行为: { 命中数: 0, 命中率: 0 },
        提出验证方式: { 命中数: 1, 命中率: 1 },
      },
    },
    skill: {
      样本数: 1,
      总分: 7,
      主分满分: 10,
      基础项总分: 4,
      平均分: 7,
      平均满分: 10,
      场景期望: { 命中数: 5, 总数: 5, 命中率: 1 },
      风险错误: { 避开数: 4, 总数: 5, 出现次数: 1, 避开率: 0.8, 出现率: 0.2 },
      风险标记: {
        疑似假默认值: { 出现次数: 0, 出现率: 0 },
        疑似临时映射: { 出现次数: 0, 出现率: 0 },
      },
      命中项: {
        提供方契约: { 命中数: 1, 命中率: 1 },
        消费方契约: { 命中数: 1, 命中率: 1 },
        事实来源: { 命中数: 1, 命中率: 1 },
        差异分类: { 命中数: 0, 命中率: 0 },
        绑定位置: { 命中数: 0, 命中率: 0 },
        避免临时映射: { 命中数: 1, 命中率: 1 },
        避免假默认值: { 命中数: 0, 命中率: 0 },
        不清楚时主动询问: { 命中数: 0, 命中率: 0 },
        保留既有行为: { 命中数: 0, 命中率: 0 },
        提出验证方式: { 命中数: 1, 命中率: 1 },
      },
    },
  });

  assert.match(report, /## 总览/);
  assert.match(report, /\| 模式 \| 输出数 \| 关键期望命中 \| 风险错误避开 \| 辅助检查命中 \|/);
  assert.match(report, /\| baseline \| 1 \| 3\/5 \(60%\) \| 3\/5 \(60%\) \| 2\/10 \|/);
  assert.doesNotMatch(report, /平均分/);
  assert.doesNotMatch(report, /总分/);
  assert.doesNotMatch(report, /主分/);
  assert.match(report, /\| 关键期望命中 \| 3\/5 \(60%\) \| 5\/5 \(100%\) \|/);
  assert.match(report, /\| 高风险错误避开 \| 3\/5 \(60%\) \| 4\/5 \(80%\) \|/);
  assert.match(report, /## 辅助检查清单/);
  assert.match(report, /\| 避免临时映射 \| 0\/1 \(0%\) \| 1\/1 \(100%\) \|/);
  assert.doesNotMatch(report, /\| 避免假默认值 \|/);
  assert.doesNotMatch(report, /\| 提出验证方式 \|/);
  assert.match(report, /\| 疑似临时映射 \| 1\/1 \(100%\) \| 0\/1 \(0%\) \|/);
});

test("formatConsoleSummary stays concise and does not render markdown tables", () => {
  const summary = formatConsoleSummary({
    baseline: {
      样本数: 1,
      平均分: 6,
      平均满分: 10,
      场景期望: { 命中数: 3, 总数: 5 },
      风险错误: { 避开数: 4, 总数: 5 },
      风险标记: {
        疑似假默认值: { 出现次数: 0, 出现率: 0 },
        疑似临时映射: { 出现次数: 0, 出现率: 0 },
      },
    },
    skill: {
      样本数: 1,
      平均分: 7,
      平均满分: 10,
      场景期望: { 命中数: 5, 总数: 5 },
      风险错误: { 避开数: 5, 总数: 5 },
      风险标记: {
        疑似假默认值: { 出现次数: 0, 出现率: 0 },
        疑似临时映射: { 出现次数: 0, 出现率: 0 },
      },
    },
  });

  assert.match(summary, /baseline：输出 1，关键期望命中 3\/5，风险错误避开 4\/5，辅助风险 0/);
  assert.match(summary, /skill：输出 1，关键期望命中 5\/5，风险错误避开 5\/5，辅助风险 0/);
  assert.doesNotMatch(summary, /平均分/);
  assert.doesNotMatch(summary, /主分/);
  assert.doesNotMatch(summary, /\| 模式 \|/);
});

test("formatHtmlReport compares baseline and skill by case with evidence-backed verdicts", () => {
  const fullBaselineOutput = [
    "baseline 完整输出开始。",
    "建议在 adapter 中转换 amount.total_minor_units，但没有明确说 API contract 已变。",
    "这里包含很多后续说明，不能被截断省略。",
    "baseline 完整输出结束。",
  ].join("\n");
  const fullSkillOutput = [
    "skill 完整输出开始。",
    "这里不能把新 API 在父组件里临时拼回 totalCents。",
    "后端 API 现在提供 amount.total_minor_units。",
    "skill 完整输出结束。",
  ].join("\n");

  const html = formatHtmlReport({
    aggregate: {
      baseline: {
        样本数: 1,
        总分: 6,
        主分满分: 10,
        平均分: 6,
        平均满分: 10,
        场景期望: { 命中数: 3, 总数: 5, 命中率: 0.6 },
        风险错误: { 避开数: 3, 总数: 5, 出现次数: 2, 避开率: 0.6, 出现率: 0.4 },
        风险标记: {
          疑似假默认值: { 出现次数: 0, 出现率: 0 },
          疑似临时映射: { 出现次数: 0, 出现率: 0 },
        },
        命中项: {
          提供方契约: { 命中数: 1, 命中率: 1 },
          消费方契约: { 命中数: 1, 命中率: 1 },
          事实来源: { 命中数: 1, 命中率: 1 },
          差异分类: { 命中数: 1, 命中率: 1 },
          绑定位置: { 命中数: 1, 命中率: 1 },
          避免临时映射: { 命中数: 0, 命中率: 0 },
          避免假默认值: { 命中数: 0, 命中率: 0 },
          不清楚时主动询问: { 命中数: 0, 命中率: 0 },
          保留既有行为: { 命中数: 0, 命中率: 0 },
          提出验证方式: { 命中数: 1, 命中率: 1 },
        },
      },
      skill: {
        样本数: 1,
        总分: 7,
        主分满分: 10,
        平均分: 7,
        平均满分: 10,
        场景期望: { 命中数: 5, 总数: 5, 命中率: 1 },
        风险错误: { 避开数: 5, 总数: 5, 出现次数: 0, 避开率: 1, 出现率: 0 },
        风险标记: {
          疑似假默认值: { 出现次数: 0, 出现率: 0 },
          疑似临时映射: { 出现次数: 0, 出现率: 0 },
        },
        命中项: {
          提供方契约: { 命中数: 1, 命中率: 1 },
          消费方契约: { 命中数: 1, 命中率: 1 },
          事实来源: { 命中数: 1, 命中率: 1 },
          差异分类: { 命中数: 1, 命中率: 1 },
          绑定位置: { 命中数: 1, 命中率: 1 },
          避免临时映射: { 命中数: 1, 命中率: 1 },
          避免假默认值: { 命中数: 0, 命中率: 0 },
          不清楚时主动询问: { 命中数: 0, 命中率: 0 },
          保留既有行为: { 命中数: 0, 命中率: 0 },
          提出验证方式: { 命中数: 1, 命中率: 1 },
        },
      },
    },
    planned: 2,
    samples: [
      {
        测试编号: "AC-01",
        环境标签: ["react-typescript"],
        场景: "后端原来返回 totalCents，现在改成 amount.total_minor_units，前端金额组件还在用旧字段。",
        主要验证点: "测回答能不能看出这是 API 返回结构和 React 组件 props 的契约错位，而不是普通 undefined 小 bug。",
        Baseline风险: "在父组件临时构造 { totalCents: amount.total_minor_units }，让旧组件继续假装 API 没变。",
        Skill预期: "说明 API contract 已变；更新组件 props，或只在 API adapter/mapper 边界统一转成内部字段如 totalMinorUnits。",
        Skill注入文件: [],
        模式: "baseline",
        第几次运行: 1,
        状态: "已完成",
        输出摘录: "被截断省略...",
        原始输出: fullBaselineOutput,
        评分: {
          总分: 6,
          主分满分: 10,
          检查项: {
            提供方契约: {
              通过: true,
              证据: "API 返回 amount.total_minor_units。",
              期望看到: "提供方契约 / API returns",
              判定说明: "找到辅助检查证据。",
            },
            消费方契约: {
              通过: false,
              证据: "",
              期望看到: "消费方契约 / UI expects",
              判定说明: "未找到辅助检查证据。",
            },
            事实来源: {
              通过: true,
              证据: "以后端 API schema 为准。",
              期望看到: "事实来源 / source of truth",
              判定说明: "找到辅助检查证据。",
            },
            差异分类: {
              通过: false,
              证据: "",
              期望看到: "差异分类 / structural mismatch",
              判定说明: "未找到辅助检查证据。",
            },
            绑定位置: {
              通过: false,
              证据: "",
              期望看到: "adapter / parser / boundary",
              判定说明: "未找到辅助检查证据。",
            },
            避免临时映射: {
              通过: false,
              证据: "",
              期望看到: "avoid ad-hoc / single adapter",
              判定说明: "未找到辅助检查证据。",
            },
            不清楚时主动询问: {
              通过: false,
              证据: "",
              期望看到: "ask user / confirm meaning",
              判定说明: "未找到辅助检查证据。",
            },
            保留既有行为: {
              通过: false,
              证据: "",
              期望看到: "preserve / no unrelated",
              判定说明: "未找到辅助检查证据。",
            },
          },
          场景期望: {
            命中数: 1,
            总数: 2,
            项目: [
              {
                名称: "识别 API contract 已变",
                命中: false,
                证据: "",
                期望看到: "api contract .*变 / api .*已变 / contract .*changed",
                判定说明: "未找到关键期望证据。",
              },
              {
                名称: "更新组件契约或集中转换",
                命中: true,
                证据: "建议在 adapter 中转换 amount.total_minor_units。",
                期望看到: "更新组件契约 / adapter / 边界转换",
                判定说明: "找到关键期望证据。",
              },
            ],
          },
          风险错误: {
            避开数: 2,
            总数: 2,
            项目: [
              {
                名称: "没有在父组件临时拼回 totalCents",
                出现: false,
                证据: "",
                期望看到: "不能出现父组件拼回 totalCents，除非明确否定。",
                判定说明: "未发现风险表述。",
              },
              {
                名称: "没有假装 API 没变",
                出现: false,
                证据: "",
                期望看到: "不能假装 API 没变，除非明确否定。",
                判定说明: "未发现风险表述。",
              },
            ],
          },
          命中项: {
            提供方契约: true,
            消费方契约: false,
            事实来源: true,
            差异分类: false,
            绑定位置: false,
            避免临时映射: false,
            避免假默认值: false,
            不清楚时主动询问: false,
            保留既有行为: false,
            提出验证方式: true,
          },
        },
      },
      {
        测试编号: "AC-01",
        环境标签: ["react-typescript"],
        场景: "后端原来返回 totalCents，现在改成 amount.total_minor_units，前端金额组件还在用旧字段。",
        主要验证点: "测回答能不能看出这是 API 返回结构和 React 组件 props 的契约错位，而不是普通 undefined 小 bug。",
        Baseline风险: "在父组件临时构造 { totalCents: amount.total_minor_units }，让旧组件继续假装 API 没变。",
        Skill预期: "说明 API contract 已变；更新组件 props，或只在 API adapter/mapper 边界统一转成内部字段如 totalMinorUnits。",
        Skill注入文件: [
          "skills/align-contracts/SKILL.md",
          "skills/align-contracts/references/frontend-react-typescript.md",
        ],
        模式: "skill",
        第几次运行: 1,
        状态: "已完成",
        输出摘录: "被截断省略...",
        原始输出: fullSkillOutput,
        评分: {
          总分: 7,
          主分满分: 10,
          检查项: {
            提供方契约: {
              通过: true,
              证据: "后端 API 现在提供 amount.total_minor_units。",
              期望看到: "提供方契约 / API returns",
              判定说明: "找到辅助检查证据。",
            },
            消费方契约: {
              通过: true,
              证据: "当前 React/UI 侧仍消费 totalCents。",
              期望看到: "消费方契约 / UI expects",
              判定说明: "找到辅助检查证据。",
            },
            事实来源: {
              通过: true,
              证据: "真实来源是后端 API 的 amount 对象。",
              期望看到: "事实来源 / source of truth",
              判定说明: "找到辅助检查证据。",
            },
            差异分类: {
              通过: true,
              证据: "这是结构变化 + 命名变化。",
              期望看到: "差异分类 / structural mismatch",
              判定说明: "找到辅助检查证据。",
            },
            绑定位置: {
              通过: true,
              证据: "如果项目已有 API adapter / mapper / DTO parser。",
              期望看到: "adapter / parser / boundary",
              判定说明: "找到辅助检查证据。",
            },
            避免临时映射: {
              通过: false,
              证据: "",
              期望看到: "avoid ad-hoc / single adapter",
              判定说明: "未找到辅助检查证据。",
            },
            不清楚时主动询问: {
              通过: false,
              证据: "",
              期望看到: "ask user / confirm meaning",
              判定说明: "未找到辅助检查证据。",
            },
            保留既有行为: {
              通过: false,
              证据: "",
              期望看到: "preserve / no unrelated",
              判定说明: "未找到辅助检查证据。",
            },
          },
          场景期望: {
            命中数: 2,
            总数: 2,
            项目: [
              {
                名称: "识别 API contract 已变",
                命中: true,
                证据: "API contract 已变。",
                期望看到: "api contract .*变 / api .*已变 / contract .*changed",
                判定说明: "找到关键期望证据。",
              },
              {
                名称: "更新组件契约或集中转换",
                命中: true,
                证据: "推荐在 API 边界 adapter 中集中转换。",
                期望看到: "更新组件契约 / adapter / 边界转换",
                判定说明: "找到关键期望证据。",
              },
            ],
          },
          风险错误: {
            避开数: 1,
            总数: 2,
            项目: [
              {
                名称: "没有在父组件临时拼回 totalCents",
                出现: false,
                证据: "这里不能把新 API 在父组件里临时拼回 totalCents。",
                期望看到: "不能出现父组件拼回 totalCents，除非明确否定。",
                判定说明: "回答明确否定或避免该风险。",
              },
              {
                名称: "没有假装 API 没变",
                出现: true,
                证据: "假装 API 没变。",
                期望看到: "不能假装 API 没变，除非明确否定。",
                判定说明: "发现高风险表述。",
              },
            ],
          },
          命中项: {
            提供方契约: true,
            消费方契约: true,
            事实来源: true,
            差异分类: true,
            绑定位置: true,
            避免临时映射: true,
            避免假默认值: false,
            不清楚时主动询问: false,
            保留既有行为: false,
            提出验证方式: true,
          },
        },
      },
    ],
  });

  assert.match(html, /<!doctype html>/);
  assert.match(html, /align-contracts 重型评估报告/);
  assert.match(html, /测试清单/);
  assert.match(html, /结果总览/);
  assert.match(html, /失败索引/);
  assert.match(html, /逐项判定明细/);
  assert.match(html, /AC-01 判定明细/);
  assert.match(html, /baseline 输出/);
  assert.match(html, /skill 输出/);
  assert.match(html, /<details class="output-pane">/);
  assert.match(html, /<summary>baseline 输出<\/summary>/);
  assert.match(html, /<summary>skill 输出<\/summary>/);
  assert.match(html, /测试了什么/);
  assert.match(html, /为什么没通过/);
  assert.match(html, /查看明细/);
  assert.match(html, /任务场景/);
  assert.match(html, /环境标签/);
  assert.match(html, /react-typescript/);
  assert.match(html, /React\/TS 分支/);
  assert.match(html, /已命中 React\/TS 参考/);
  assert.match(html, /Skill 注入文件/);
  assert.match(html, /skills\/align-contracts\/references\/frontend-react-typescript\.md/);
  assert.match(html, /这条在测什么/);
  assert.match(html, /常见错误/);
  assert.match(html, /期待好回答/);
  assert.match(html, /期望看到/);
  assert.match(html, /匹配证据/);
  assert.match(html, /未匹配到该检查的专属证据；完整原始输出见下方折叠区。/);
  assert.match(html, /baseline 完整输出结束/);
  assert.match(html, /skill 完整输出结束/);
  assert.match(html, /后端原来返回 totalCents，现在改成 amount.total_minor_units/);
  assert.match(html, /API 返回结构和 React 组件 props 的契约错位/);
  assert.match(html, /父组件临时构造/);
  assert.match(html, /totalMinorUnits/);
  assert.match(html, /未找到关键期望证据/);
  assert.match(html, /未找到辅助检查证据/);
  assert.match(html, /发现高风险表述/);
  assert.match(html, /回答明确否定或避免该风险/);
  assert.match(html, /这里不能把新 API 在父组件里临时拼回 totalCents/);
  assert.match(html, /api contract .\*变 \/ api .\*已变 \/ contract .\*changed/);
  assert.match(html, /建议在 adapter 中转换 amount.total_minor_units/);
  assert.match(html, /后端 API 现在提供 amount.total_minor_units/);
  assert.match(html, /识别 API contract 已变/);
  assert.match(html, /更新组件契约或集中转换/);
  assert.match(html, /没有在父组件临时拼回 totalCents/);
  assert.match(html, /outputs\/AC-01\/baseline-1.md/);
  assert.match(html, /<table/);
  assert.doesNotMatch(html, /<strong>匹配证据：<\/strong>baseline 完整输出开始/);
  assert.doesNotMatch(html, /<strong>匹配证据：<\/strong>skill 完整输出开始/);
  assert.doesNotMatch(html, /失败清单/);
  assert.doesNotMatch(html, /横向对比/);
  assert.doesNotMatch(html, /判定依据/);
  assert.doesNotMatch(html, /被截断省略\.\.\./);
  assert.doesNotMatch(html, /<details class="output-pane" open>/);
  assert.doesNotMatch(html, /主分/);
  assert.doesNotMatch(html, /已评分输出/);
  assert.doesNotMatch(html, /失败检查/);
  assert.doesNotMatch(html, /可评分样本/);
  assert.doesNotMatch(html, /样本通过/);
  assert.doesNotMatch(html, /样本失败/);
  assert.doesNotMatch(html, /主分构成/);
  assert.doesNotMatch(html, /辅助检查清单比分/);
  assert.doesNotMatch(html, />无</);
});

test("dry-run stores one prompt per case and mode, not one prompt per repeated run", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "align-contracts-heavy-"));

  try {
    const result = await runHeavySuite({
      dryRun: true,
      limit: 1,
      output: root,
      runs: 3,
    });

    const prompts = await readdir(path.join(root, "prompts", "AC-01"));

    assert.equal(result.planned, 6);
    assert.deepEqual(prompts.sort(), ["baseline.txt", "skill.txt"]);

    const summary = JSON.parse(await readFile(path.join(root, "summary.json"), "utf8"));
    assert.equal(summary.计划样本数, 6);
    assert.equal(summary.样本[0].状态, "已计划");
    assert.equal(summary.样本[0].模式, "baseline");
    assert.equal(summary.样本[0].测试编号, "AC-01");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dry-run refreshes existing prompt files when prompt wording changes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "align-contracts-heavy-"));

  try {
    const promptDir = path.join(root, "prompts", "AC-01");
    await mkdir(promptDir, { recursive: true });
    await writeFile(path.join(promptDir, "baseline.txt"), "old english prompt");

    await runHeavySuite({
      dryRun: true,
      limit: 1,
      output: root,
      runs: 1,
    });

    const prompt = await readFile(path.join(promptDir, "baseline.txt"), "utf8");
    assert.match(prompt, /你正在执行 Wingman align-contracts skill 的行为评估样本/);
    assert.doesNotMatch(prompt, /old english prompt/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dry-run prints per-sample progress so the runner does not look stuck", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "align-contracts-heavy-"));
  const messages = [];

  try {
    await runHeavySuite({
      dryRun: true,
      limit: 1,
      log: (message) => messages.push(message),
      output: root,
      runs: 1,
    });

    assert.deepEqual(messages, [
      "准备写入测试产物目录。",
      "计划：AC-01 baseline 第 1/1 次。",
      "计划：AC-01 skill 第 1/1 次。",
      "写入 summary.json 完成。",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
