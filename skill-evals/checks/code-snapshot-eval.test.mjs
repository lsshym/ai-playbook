import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildCodeSnapshotEvalPrompt,
  formatCodeSnapshotConsoleSummary,
  formatCodeSnapshotHtmlReport,
  runCodeSnapshotEval,
} from "../_shared/code-snapshot-eval.mjs";

test("code snapshot prompt asks agents to edit fixture files and hides review notes", () => {
  const prompt = buildCodeSnapshotEvalPrompt({
    evalName: "demo-contracts",
    skillName: "demo-skill",
    testCase: {
      id: "DM-01",
      tags: ["typescript"],
      scenario: "API field changed.",
      validation: "Review-only validation.",
      baselineRisk: "Leaked answer.",
      skillExpected: "Leaked expected behavior.",
    },
    mode: "skill",
    skillText: "# Demo Skill",
    injectedFiles: ["skills/demo-skill/SKILL.md"],
    environment: "TypeScript fixture",
  });

  assert.match(prompt, /请直接编辑当前工作区里的代码文件/);
  assert.match(prompt, /请先使用 demo-skill skill/);
  assert.match(prompt, /# Demo Skill/);
  assert.match(prompt, /场景：API field changed\./);
  assert.doesNotMatch(prompt, /Review-only validation/);
  assert.doesNotMatch(prompt, /Leaked answer/);
  assert.doesNotMatch(prompt, /Leaked expected behavior/);
});

test("code snapshot eval dry-run writes prompts, summary, comparison index, and html report", async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "code-snapshot-eval-"));
  const resultsRoot = path.join(fixtureRoot, ".eval-runs", "demo");

  try {
    await writeFile(path.join(fixtureRoot, "cases.md"), [
      "| ID | 环境标签 | 任务场景 | 这条在测什么 | 常见错误 | 期待好回答 |",
      "| --- | --- | --- | --- | --- | --- |",
      "| DM-01 | typescript | API field changed. | Review-only validation. | Patch caller. | Align boundary. |",
      "",
    ].join("\n"));

    const result = await runCodeSnapshotEval({
      repoRoot: fixtureRoot,
      casesPath: path.join(fixtureRoot, "cases.md"),
      defaultResultsRoot: resultsRoot,
      cleanCodexHome: path.join(fixtureRoot, "tmp", "codex-home"),
      cleanWorkdirRoot: path.join(fixtureRoot, "tmp", "workdirs"),
      evalName: "demo-contracts",
      skillName: "demo-skill",
      defaultRuns: 1,
      smokeCaseIds: ["DM-01"],
      referenceMap: {},
      buildFixture: () => ({
        files: [
          {
            path: "src/example.ts",
            language: "ts",
            content: "export const value = input.oldName;\n",
          },
        ],
      }),
      resolveSkillBundle: async () => ({
        text: "# Demo Skill\n",
        files: [{ path: "skills/demo-skill/SKILL.md", content: "# Demo Skill\n" }],
      }),
    }, {
      dryRun: true,
      log: () => {},
    });

    assert.equal(result.planned, 2);
    assert.match(result.consoleSummary, /baseline：样本 1/);

    const baselinePrompt = await readFile(path.join(resultsRoot, "prompts", "DM-01", "baseline.txt"), "utf8");
    const summary = JSON.parse(await readFile(path.join(resultsRoot, "summary.json"), "utf8"));
    const comparison = JSON.parse(await readFile(path.join(resultsRoot, "comparison.json"), "utf8"));
    const html = await readFile(path.join(resultsRoot, "report.html"), "utf8");

    assert.match(baselinePrompt, /不要使用或提到任何外部 skill/);
    assert.equal(summary.计划样本数, 2);
    assert.equal(summary.样本.length, 2);
    assert.equal(summary.样本[0].代码快照, undefined);
    assert.equal(comparison.cases[0].caseId, "DM-01");
    assert.match(comparison.cases[0].files[0].originalPath, /comparisons\/DM-01\/original\/src\/example\.ts/);
    assert.match(html, /demo-contracts 代码对比评估报告/);
    assert.match(html, /这个 case 还没有代码快照/);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("code snapshot html report renders input files once unless they change", () => {
  const html = formatCodeSnapshotHtmlReport({
    title: "demo report",
    modes: ["baseline", "skill"],
    aggregate: {
      案例数: 1,
      baseline: { 样本数: 1, 已完成: 1, 已计划: 0, 代码快照数: 1 },
      skill: { 样本数: 1, 已完成: 1, 已计划: 0, 代码快照数: 1 },
    },
    planned: 2,
    samples: [
      {
        测试编号: "DM-01",
        环境标签: ["typescript"],
        场景: "Provider sample.",
        模式: "baseline",
        第几次运行: 1,
        状态: "已完成",
        代码快照: [{
          path: "fixtures/provider.json",
          role: "input",
          language: "json",
          original: "{\n  \"name\": \"Ada\"\n}",
          current: "{\n  \"name\": \"Ada\"\n}",
        }],
      },
      {
        测试编号: "DM-01",
        环境标签: ["typescript"],
        场景: "Provider sample.",
        模式: "skill",
        第几次运行: 1,
        状态: "已完成",
        代码快照: [{
          path: "fixtures/provider.json",
          role: "input",
          language: "json",
          original: "{\n  \"name\": \"Ada\"\n}",
          current: "{\n  \"name\": \"Ada\"\n}",
        }],
      },
    ],
  });

  assert.match(html, /demo report/);
  assert.match(html, /输入材料/);
  assert.doesNotMatch(html, /<div class="code-title">Baseline<\/div>/);
  assert.doesNotMatch(html, /<div class="code-title">Skill<\/div>/);
});

test("code snapshot console summary is generic across skills", () => {
  assert.equal(
    formatCodeSnapshotConsoleSummary({
      baseline: { 样本数: 1, 已完成: 1, 代码快照数: 2 },
      skill: { 样本数: 1, 已完成: 0, 代码快照数: 0 },
    }, ["baseline", "skill"]),
    "baseline：样本 1，已完成 1，代码快照 2\nskill：样本 1，已完成 0，代码快照 0",
  );
});
