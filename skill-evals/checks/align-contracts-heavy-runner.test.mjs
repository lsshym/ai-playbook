import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  aggregateSummary,
  buildCaseFixture,
  buildPrompt,
  formatAggregateReport,
  formatConsoleSummary,
  formatHtmlReport,
  parseCasesFromReport,
  resolveSkillBundle,
  runHeavySuite,
} from "../align-contracts-heavy/runner.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");

test("align-contracts heavy case catalog exposes the curated core cases", async () => {
  const casesDoc = await readFile(
    path.join(repoRoot, "skill-evals", "align-contracts-heavy", "cases.zh-CN.md"),
    "utf8",
  );
  const cases = parseCasesFromReport(casesDoc);

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
});

test("align-contracts heavy design doc links to the separate case catalog", async () => {
  const report = await readFile(
    path.join(repoRoot, "skill-evals", "align-contracts-heavy", "report.zh-CN.md"),
    "utf8",
  );

  assert.match(report, /skill-evals\/align-contracts-heavy\/cases\.zh-CN\.md/);
  assert.doesNotMatch(report, /^\|\s*AC-01\s*\|/m);
  assert.doesNotMatch(report, /平均总分/);
});

test("resolveSkillBundle injects React references only for React cases", async () => {
  const reactBundle = await resolveSkillBundle("align-contracts", ["react-typescript"]);
  assert.deepEqual(reactBundle.files.map((file) => file.path), [
    "skills/align-contracts/SKILL.md",
    "skills/align-contracts/references/frontend-react-typescript.md",
  ]);

  const dbBundle = await resolveSkillBundle("align-contracts", ["db"]);
  assert.deepEqual(dbBundle.files.map((file) => file.path), [
    "skills/align-contracts/SKILL.md",
  ]);
});

test("baseline prompt asks the agent to edit fixture code without leaking review notes", () => {
  const prompt = buildPrompt(
    {
      id: "AC-04",
      tags: ["react-typescript"],
      scenario: "API 的 `status` 要接到 UI 的 `checkoutType`。",
      validation: "语义差异识别；不把两个“状态”随手等同。",
      baselineRisk: "直接写 `checkoutType = status`。",
      skillExpected: "标记 semantic mismatch，查 schema/docs 或询问用户。",
    },
    "baseline",
    "# Align Contracts",
    [],
  );

  assert.match(prompt, /请直接编辑当前工作区里的代码文件/);
  assert.match(prompt, /场景：API 的 status 要接到 UI 的 checkoutType。/);
  assert.match(prompt, /不要使用或提到任何外部 skill/);
  assert.doesNotMatch(prompt, /这条在测什么/);
  assert.doesNotMatch(prompt, /常见错误/);
  assert.doesNotMatch(prompt, /期待好回答/);
  assert.doesNotMatch(prompt, /语义差异识别/);
  assert.doesNotMatch(prompt, /直接写 checkoutType = status/);
  assert.doesNotMatch(prompt, /标记 semantic mismatch/);
});

test("skill prompt injects skill text but still hides review notes", () => {
  const prompt = buildPrompt(
    {
      id: "AC-01",
      tags: ["react-typescript"],
      scenario: "后端原来返回 `totalCents`，现在改成 `amount.total_minor_units`。",
      validation: "API -> UI 结构变化。",
      baselineRisk: "在父组件临时拼回 `totalCents`。",
      skillExpected: "更新组件契约或集中转换。",
    },
    "skill",
    "# Align Contracts\nCore principle: do not preserve a shape.",
    ["skills/align-contracts/SKILL.md"],
  );

  assert.match(prompt, /请先使用 align-contracts skill/);
  assert.match(prompt, /# Align Contracts/);
  assert.match(prompt, /Skill 注入文件：/);
  assert.doesNotMatch(prompt, /这条在测什么/);
  assert.doesNotMatch(prompt, /常见错误/);
  assert.doesNotMatch(prompt, /期待好回答/);
  assert.doesNotMatch(prompt, /在父组件临时拼回/);
});

test("buildCaseFixture returns real TSX and JSON code for comparison", () => {
  const fixture = buildCaseFixture({
    id: "AC-01",
    tags: ["react-typescript"],
    scenario: "后端原来返回 `totalCents`，现在改成 `amount.total_minor_units`。",
  });

  assert.deepEqual(fixture.files.map((file) => file.path), [
    "src/OrderSummary.tsx",
    "fixtures/订单响应.json",
  ]);
  assert.equal(fixture.files[0].language, "tsx");
  assert.match(fixture.files[0].content, /totalCents/);
  assert.match(fixture.files[1].content, /total_minor_units/);
});

test("aggregate and console summaries report samples and code snapshots only", () => {
  const aggregate = aggregateSummary([
    {
      测试编号: "AC-01",
      模式: "baseline",
      状态: "已完成",
      代码快照: [{ path: "src/OrderSummary.tsx" }],
    },
    {
      测试编号: "AC-01",
      模式: "skill",
      状态: "已完成",
      代码快照: [{ path: "src/OrderSummary.tsx" }],
    },
  ]);

  assert.equal(aggregate.baseline.样本数, 1);
  assert.equal(aggregate.baseline.代码快照数, 1);
  assert.equal(aggregate.skill.样本数, 1);
  assert.equal(aggregate.案例数, 1);
  assert.doesNotMatch(formatConsoleSummary(aggregate), /关键期望/);
  assert.doesNotMatch(formatAggregateReport(aggregate), /风险错误/);
  assert.match(formatAggregateReport(aggregate), /代码快照/);
});

test("formatHtmlReport renders original, baseline, and skill code columns", () => {
  const html = formatHtmlReport({
    aggregate: aggregateSummary([]),
    planned: 2,
    samples: [
      {
        测试编号: "AC-01",
        环境标签: ["react-typescript"],
        场景: "后端 totalCents 改成 amount.total_minor_units。",
        主要验证点: "测 API 返回结构和 React props 契约错位。",
        Baseline风险: "在父组件临时拼回 totalCents。",
        Skill预期: "更新组件契约或在 adapter 边界统一转换。",
        模式: "baseline",
        第几次运行: 1,
        状态: "已完成",
        代码快照: [
          {
            path: "src/OrderSummary.tsx",
            language: "tsx",
            originalPath: "comparisons/AC-01/original/src/OrderSummary.tsx",
            currentPath: "comparisons/AC-01/baseline/src/OrderSummary.tsx",
            original: "<Money totalCents={order.totalCents} />",
            current: "<Money totalCents={order.amount.total_minor_units} />",
          },
        ],
      },
      {
        测试编号: "AC-01",
        环境标签: ["react-typescript"],
        场景: "后端 totalCents 改成 amount.total_minor_units。",
        主要验证点: "测 API 返回结构和 React props 契约错位。",
        Baseline风险: "在父组件临时拼回 totalCents。",
        Skill预期: "更新组件契约或在 adapter 边界统一转换。",
        模式: "skill",
        第几次运行: 1,
        状态: "已完成",
        代码快照: [
          {
            path: "src/OrderSummary.tsx",
            language: "tsx",
            originalPath: "comparisons/AC-01/original/src/OrderSummary.tsx",
            currentPath: "comparisons/AC-01/skill/src/OrderSummary.tsx",
            original: "<Money totalCents={order.totalCents} />",
            current: "<Money totalMinorUnits={order.amount.total_minor_units} />",
          },
        ],
      },
    ],
  });

  assert.match(html, /Original/);
  assert.match(html, /测试目的/);
  assert.match(html, /测 API 返回结构和 React props 契约错位/);
  assert.match(html, /常见错误/);
  assert.match(html, /在父组件临时拼回 totalCents/);
  assert.match(html, /期待好改法/);
  assert.match(html, /adapter 边界统一转换/);
  assert.match(html, /Baseline/);
  assert.match(html, /Skill/);
  assert.match(html, /src\/OrderSummary\.tsx/);
  assert.match(html, /&lt;Money totalCents=\{order\.totalCents\} \/&gt;/);
  assert.match(html, /&lt;Money totalMinorUnits=\{order\.amount\.total_minor_units\} \/&gt;/);
  assert.doesNotMatch(html, /PASS/);
  assert.doesNotMatch(html, /FAIL/);
});

test("formatHtmlReport renders provider fixture input files once", () => {
  const json = [
    "{",
    '  "id": "ord_123",',
    '  "amount": {',
    '    "total_minor_units": 1299',
    "  }",
    "}",
  ].join("\n");
  const html = formatHtmlReport({
    aggregate: aggregateSummary([]),
    planned: 2,
    samples: [
      {
        测试编号: "AC-01",
        环境标签: ["react-typescript"],
        场景: "后端 totalCents 改成 amount.total_minor_units。",
        模式: "baseline",
        第几次运行: 1,
        状态: "已完成",
        代码快照: [
          {
            path: "fixtures/订单响应.json",
            language: "json",
            role: "input",
            original: json,
            current: json,
          },
        ],
      },
      {
        测试编号: "AC-01",
        环境标签: ["react-typescript"],
        场景: "后端 totalCents 改成 amount.total_minor_units。",
        模式: "skill",
        第几次运行: 1,
        状态: "已完成",
        代码快照: [
          {
            path: "fixtures/订单响应.json",
            language: "json",
            role: "input",
            original: json,
            current: json,
          },
        ],
      },
    ],
  });

  assert.match(html, /fixtures\/订单响应\.json/);
  assert.match(html, /输入材料/);
  assert.doesNotMatch(html, /<div class="code-title">Baseline<\/div>/);
  assert.doesNotMatch(html, /<div class="code-title">Skill<\/div>/);
});

test("formatHtmlReport expands input files if an agent edits them", () => {
  const original = "{\n  \"id\": \"ord_123\"\n}";
  const changed = "{\n  \"id\": \"ord_999\"\n}";
  const html = formatHtmlReport({
    aggregate: aggregateSummary([]),
    planned: 2,
    samples: [
      {
        测试编号: "AC-01",
        环境标签: ["react-typescript"],
        场景: "后端 totalCents 改成 amount.total_minor_units。",
        模式: "baseline",
        第几次运行: 1,
        状态: "已完成",
        代码快照: [
          {
            path: "fixtures/订单响应.json",
            language: "json",
            role: "input",
            original,
            current: changed,
          },
        ],
      },
      {
        测试编号: "AC-01",
        环境标签: ["react-typescript"],
        场景: "后端 totalCents 改成 amount.total_minor_units。",
        模式: "skill",
        第几次运行: 1,
        状态: "已完成",
        代码快照: [
          {
            path: "fixtures/订单响应.json",
            language: "json",
            role: "input",
            original,
            current: original,
          },
        ],
      },
    ],
  });

  assert.match(html, /输入材料被修改/);
  assert.match(html, /<div class="code-title">Baseline<\/div>/);
  assert.match(html, /ord_999/);
});

test("dry run writes planned samples without legacy evaluation fields", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "align-contracts-heavy-"));
  await runHeavySuite({
    dryRun: true,
    limit: 1,
    runs: 1,
    output: root,
    log: () => {},
  });

  const summary = JSON.parse(await readFile(path.join(root, "summary.json"), "utf8"));
  assert.equal(summary.计划样本数, 2);
  assert.equal(summary.样本.length, 2);
  assert.equal(summary.样本[0].状态, "已计划");
  assert.equal(summary.样本[0].模式, "baseline");
  assert.equal(summary.样本[1].模式, "skill");
  assert.equal(summary.样本[0].评分, undefined);
  assert.equal(summary.样本[0].代码快照, undefined);
});
