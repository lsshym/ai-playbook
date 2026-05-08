import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  resolveCodeSnapshotSkillBundle,
} from "../_shared/code-snapshot-eval.mjs";
import { loadEvalDefinition } from "../_shared/standard-skill-eval.mjs";
import { buildFixture } from "../align-contracts/fixtures.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const definition = await loadEvalDefinition(repoRoot, "align-contracts");

test("align-contracts case catalog exposes the curated core cases", async () => {
  const casesDoc = await readFile(
    path.join(repoRoot, "skill-evals", "align-contracts", "cases.zh-CN.md"),
    "utf8",
  );
  const cases = definition.parseCasesFromReport(casesDoc);

  assert.equal(cases.length, 6);
  assert.equal(cases[0].skill, "align-contracts");
  assert.deepEqual(cases[0].tags, ["react-typescript"]);
  assert.equal(cases[0].scenario, "API 返回 `user_name`，页面里临时定义的 `UserViewModel` 只在当前组件内展示用户名。");
  assert.match(cases[0].focus, /局部\/临时 consumer type/);
  assert.deepEqual(cases.map((testCase) => testCase.id), [
    "AC-S01",
    "AC-S02",
    "AC-S03",
    "AC-S04",
    "AC-S05",
    "AC-S06",
  ]);
});

test("align-contracts defaults to a compact smoke case set", async () => {
  const casesDoc = await readFile(
    path.join(repoRoot, "skill-evals", "align-contracts", "cases.zh-CN.md"),
    "utf8",
  );
  const cases = definition.parseCasesFromReport(casesDoc);
  const selected = definition.selectCasesForRun(cases, {});

  assert.deepEqual(selected.map((testCase) => testCase.id), [
    "AC-S01",
    "AC-S02",
    "AC-S03",
    "AC-S04",
    "AC-S05",
    "AC-S06",
  ]);
});

test("align-contracts args default to smoke runs and low reasoning", () => {
  assert.deepEqual(definition.parseArgs([]), {
    caseIds: [],
    dryRun: false,
    reasoningEffort: "low",
    resume: false,
    runs: 2,
  });
});

test("align-contracts eval keeps only a short local README, not a long static report", async () => {
  const readme = await readFile(
    path.join(repoRoot, "skill-evals", "align-contracts", "README.zh-CN.md"),
    "utf8",
  );

  assert.match(readme, /cases\.zh-CN\.md/);
  assert.match(readme, /report\.html/);
  assert.doesNotMatch(readme, /## 当前已知限制/);
  assert.doesNotMatch(readme, /平均总分/);
});

test("align-contracts args can run a named case without changing the case table", () => {
  assert.deepEqual(definition.parseArgs(["--case", "AC-S05", "--runs", "1", "--dry-run"]), {
    caseIds: ["AC-S05"],
    dryRun: true,
    reasoningEffort: "low",
    resume: false,
    runs: 1,
  });
});

test("resolveSkillBundle injects React references only for React cases", async () => {
  const reactBundle = await resolveCodeSnapshotSkillBundle({
    repoRoot,
    skillName: "align-contracts",
    tags: ["react-typescript"],
    referenceMap: definition.config.referenceMap,
  });
  assert.deepEqual(reactBundle.files.map((file) => file.path), [
    "skills/align-contracts/SKILL.md",
    "skills/align-contracts/references/frontend-react-typescript.md",
  ]);

  const dbBundle = await resolveCodeSnapshotSkillBundle({
    repoRoot,
    skillName: "align-contracts",
    tags: ["db"],
    referenceMap: definition.config.referenceMap,
  });
  assert.deepEqual(dbBundle.files.map((file) => file.path), [
    "skills/align-contracts/SKILL.md",
  ]);
});

test("baseline prompt asks the agent to edit fixture code without leaking review notes", () => {
  const prompt = definition.buildPrompt(
    {
      id: "AC-S03",
      skill: "align-contracts",
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

  assert.match(prompt, /请直接编辑当前工作区里的文件/);
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
  const prompt = definition.buildPrompt(
    {
      id: "AC-S05",
      skill: "align-contracts",
      tags: ["react-typescript"],
      scenario: "共享 `Money` 组件直接依赖 `ApiOrder[\"amount\"]`。",
      validation: "通用组件不能耦合 provider-specific payload。",
      baselineRisk: "让 `Money` 继续接收 API amount shape。",
      skillExpected: "改成稳定 props 如 `totalMinorUnits` 和 `currency`。",
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
  assert.doesNotMatch(prompt, /通用组件不能耦合/);
});

test("buildCaseFixture returns local consumer type fixture for AC-S01", () => {
  const fixture = buildFixture({
    id: "AC-S01",
    tags: ["react-typescript"],
    scenario: "API 返回 `user_name`，页面里临时定义的 `UserViewModel` 只在当前组件内展示用户名。",
  });

  assert.deepEqual(fixture.files.map((file) => file.path), [
    "src/UserHeader.tsx",
  ]);
  assert.equal(fixture.files[0].language, "tsx");
  assert.match(fixture.files[0].content, /type UserViewModel/);
  assert.match(fixture.files[0].content, /user\.userName/);
});

test("buildCaseFixture returns shared domain boundary fixture for AC-S02", () => {
  const fixture = buildFixture({
    id: "AC-S02",
    tags: ["api", "domain"],
    scenario: "外部 API 返回 snake_case 用户，但共享 domain `User` 使用 camelCase。",
  });

  assert.deepEqual(fixture.files.map((file) => file.path), [
    "src/domain/user.ts",
    "src/api/users.ts",
  ]);
  assert.match(fixture.files[0].content, /export type User/);
  assert.match(fixture.files[1].content, /return apiUser/);
});

test("buildCaseFixture returns reusable Money component fixture for AC-S05", () => {
  const fixture = buildFixture({
    id: "AC-S05",
    tags: ["react-typescript"],
    scenario: "共享 `Money` 组件直接依赖 `ApiOrder[\"amount\"]`。",
  });

  assert.deepEqual(fixture.files.map((file) => file.path), [
    "src/apiTypes.ts",
    "src/components/Money.tsx",
    "src/pages/OrderSummary.tsx",
    "src/pages/RefundSummary.tsx",
  ]);
  assert.match(fixture.files[1].content, /ApiOrder\["amount"\]/);
  assert.match(fixture.files[3].content, /<Money amount=\{refund\.amount\}/);
});

test("aggregate and console summaries report samples and code snapshots only", () => {
  const aggregate = definition.aggregateSummary([
    {
      测试编号: "AC-S05",
      模式: "baseline",
      状态: "已完成",
      代码快照: [{ path: "src/OrderSummary.tsx" }],
    },
    {
      测试编号: "AC-S05",
      模式: "skill",
      状态: "已完成",
      代码快照: [{ path: "src/OrderSummary.tsx" }],
    },
  ]);

  assert.equal(aggregate.baseline.样本数, 1);
  assert.equal(aggregate.baseline.代码快照数, 1);
  assert.equal(aggregate.skill.样本数, 1);
  assert.equal(aggregate.案例数, 1);
  assert.doesNotMatch(definition.formatConsoleSummary(aggregate), /关键期望/);
  assert.doesNotMatch(definition.formatAggregateReport(aggregate), /风险错误/);
  assert.match(definition.formatAggregateReport(aggregate), /代码快照/);
});

test("formatHtmlReport renders original, baseline, and skill code columns", () => {
  const html = definition.formatHtmlReport({
    aggregate: definition.aggregateSummary([]),
    planned: 2,
    samples: [
      {
        测试编号: "AC-S05",
        环境标签: ["react-typescript"],
        场景: "共享 Money 组件直接依赖 ApiOrder amount。",
        主要验证点: "测通用组件是否避免 provider-specific payload。",
        Baseline风险: "让 Money 继续接收 API amount shape。",
        Skill预期: "改成稳定 props，如 totalMinorUnits 和 currency。",
        模式: "baseline",
        第几次运行: 1,
        状态: "已完成",
        代码快照: [
          {
            path: "src/components/Money.tsx",
            language: "tsx",
            originalPath: "comparisons/AC-S05/original/src/components/Money.tsx",
            currentPath: "comparisons/AC-S05/baseline/src/components/Money.tsx",
            original: 'type MoneyProps = { amount: ApiOrder["amount"] }',
            current: 'type MoneyProps = { amount: ApiOrder["amount"] }',
          },
        ],
      },
      {
        测试编号: "AC-S05",
        环境标签: ["react-typescript"],
        场景: "共享 Money 组件直接依赖 ApiOrder amount。",
        主要验证点: "测通用组件是否避免 provider-specific payload。",
        Baseline风险: "让 Money 继续接收 API amount shape。",
        Skill预期: "改成稳定 props，如 totalMinorUnits 和 currency。",
        模式: "skill",
        第几次运行: 1,
        状态: "已完成",
        代码快照: [
          {
            path: "src/components/Money.tsx",
            language: "tsx",
            originalPath: "comparisons/AC-S05/original/src/components/Money.tsx",
            currentPath: "comparisons/AC-S05/skill/src/components/Money.tsx",
            original: 'type MoneyProps = { amount: ApiOrder["amount"] }',
            current: "type MoneyProps = { totalMinorUnits: number; currency: string }",
          },
        ],
      },
    ],
  });

  assert.match(html, /Original/);
  assert.match(html, /测试目的/);
  assert.match(html, /测通用组件是否避免 provider-specific payload/);
  assert.match(html, /常见错误/);
  assert.match(html, /让 Money 继续接收 API amount shape/);
  assert.match(html, /期待好改法/);
  assert.match(html, /稳定 props/);
  assert.match(html, /Baseline/);
  assert.match(html, /Skill/);
  assert.match(html, /src\/components\/Money\.tsx/);
  assert.match(html, /ApiOrder/);
  assert.match(html, /totalMinorUnits/);
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
  const html = definition.formatHtmlReport({
    aggregate: definition.aggregateSummary([]),
    planned: 2,
    samples: [
      {
        测试编号: "AC-S01",
        环境标签: ["react-typescript"],
        场景: "API 返回 user_name，页面临时 UserViewModel 只在当前组件展示用户名。",
        模式: "baseline",
        第几次运行: 1,
        状态: "已完成",
        代码快照: [
          {
            path: "fixtures/api-user.json",
            language: "json",
            role: "input",
            original: json,
            current: json,
          },
        ],
      },
      {
        测试编号: "AC-S01",
        环境标签: ["react-typescript"],
        场景: "API 返回 user_name，页面临时 UserViewModel 只在当前组件展示用户名。",
        模式: "skill",
        第几次运行: 1,
        状态: "已完成",
        代码快照: [
          {
            path: "fixtures/api-user.json",
            language: "json",
            role: "input",
            original: json,
            current: json,
          },
        ],
      },
    ],
  });

  assert.match(html, /fixtures\/api-user\.json/);
  assert.match(html, /输入材料/);
  assert.doesNotMatch(html, /<div class="code-title">Baseline<\/div>/);
  assert.doesNotMatch(html, /<div class="code-title">Skill<\/div>/);
});

test("formatHtmlReport expands input files if an agent edits them", () => {
  const original = "{\n  \"id\": \"ord_123\"\n}";
  const changed = "{\n  \"id\": \"ord_999\"\n}";
  const html = definition.formatHtmlReport({
    aggregate: definition.aggregateSummary([]),
    planned: 2,
    samples: [
      {
        测试编号: "AC-S01",
        环境标签: ["react-typescript"],
        场景: "API 返回 user_name，页面临时 UserViewModel 只在当前组件展示用户名。",
        模式: "baseline",
        第几次运行: 1,
        状态: "已完成",
        代码快照: [
          {
            path: "fixtures/api-user.json",
            language: "json",
            role: "input",
            original,
            current: changed,
          },
        ],
      },
      {
        测试编号: "AC-S01",
        环境标签: ["react-typescript"],
        场景: "API 返回 user_name，页面临时 UserViewModel 只在当前组件展示用户名。",
        模式: "skill",
        第几次运行: 1,
        状态: "已完成",
        代码快照: [
          {
            path: "fixtures/api-user.json",
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
  const root = await mkdtemp(path.join(tmpdir(), "align-contracts-"));
  await definition.run({
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

test("default dry run plans the compact smoke matrix", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "align-contracts-smoke-"));
  await definition.run({
    dryRun: true,
    output: root,
    log: () => {},
  });

  const summary = JSON.parse(await readFile(path.join(root, "summary.json"), "utf8"));
  assert.equal(summary.评估规模, "smoke");
  assert.equal(summary.计划样本数, 24);
  assert.equal(summary.样本.length, 24);
  assert.deepEqual([...new Set(summary.样本.map((sample) => sample.测试编号))], [
    "AC-S01",
    "AC-S02",
    "AC-S03",
    "AC-S04",
    "AC-S05",
    "AC-S06",
  ]);
});
