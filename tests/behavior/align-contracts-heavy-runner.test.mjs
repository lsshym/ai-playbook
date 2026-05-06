import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildPrompt,
  runHeavySuite,
  parseCasesFromReport,
  scoreOutput,
} from "../../scripts/align-contracts-heavy-runner.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");

test("align-contracts heavy report exposes 60 executable cases", async () => {
  const report = await readFile(
    path.join(repoRoot, "docs", "align-contracts-heavy-test", "report.zh-CN.md"),
    "utf8",
  );
  const cases = parseCasesFromReport(report);

  assert.equal(cases.length, 60);
  assert.deepEqual(cases[0], {
    id: "AC-01",
    scenario: "后端金额字段从 `totalCents` 改成 `amount.total_minor_units`。",
    validation: "API -> UI 结构变化；金额字段 ownership；React component contract。",
    baselineRisk: "在父组件临时拼回 `totalCents`，假装 API 没变。",
    skillExpected: "识别 API contract 已变，更新组件契约或集中转换。",
  });
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
  assert.match(prompt, /预期 skill 行为/);
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
  assert.equal(score.flags.fakeDefaults, false);
  assert.equal(score.flags.adHocMapper, false);
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
