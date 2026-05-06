import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildSkillEvalPrompt,
  parseCasesFromMarkdownTable,
  resolveSkillBundle,
  runSkillEval,
} from "../../scripts/skill-eval-runner.mjs";

test("generic skill eval runner parses the shared case table shape", () => {
  const cases = parseCasesFromMarkdownTable(`
| ID | 环境标签 | 任务场景 | 这条在测什么 | 常见错误 | 期待好回答 |
| --- | --- | --- | --- | --- | --- |
| TS-01 | react-typescript, api | API shape changed. | Contract drift. | Patch caller. | Align boundary. |
`);

  assert.deepEqual(cases, [
    {
      id: "TS-01",
      tags: ["react-typescript", "api"],
      scenario: "API shape changed.",
      validation: "Contract drift.",
      baselineRisk: "Patch caller.",
      skillExpected: "Align boundary.",
    },
  ]);
});

test("generic skill eval runner builds baseline and skill prompts for any skill", () => {
  const testCase = {
    id: "GO-01",
    scenario: "Go handler reads legacy JSON field.",
    validation: "Provider and consumer JSON contract.",
    baselineRisk: "Hide the drift in one handler.",
    skillExpected: "Use parser or adapter boundary.",
  };

  const baseline = buildSkillEvalPrompt({
    evalName: "Wingman demo skill",
    skillName: "demo-skill",
    testCase,
    mode: "baseline",
    skillText: "# Demo Skill",
    environment: "Go 项目",
    returnSections: ["契约", "验证"],
  });
  const skill = buildSkillEvalPrompt({
    evalName: "Wingman demo skill",
    skillName: "demo-skill",
    testCase,
    mode: "skill",
    skillText: "# Demo Skill",
    injectedFiles: ["skills/demo-skill/SKILL.md"],
    environment: "Go 项目",
    returnSections: ["契约", "验证"],
  });

  assert.match(baseline, /你正在执行 Wingman demo skill 的行为评估样本/);
  assert.match(baseline, /项目环境：Go 项目/);
  assert.match(baseline, /不要使用或提到任何外部 skill/);
  assert.doesNotMatch(baseline, /Provider and consumer JSON contract/);
  assert.doesNotMatch(baseline, /# Demo Skill/);
  assert.match(skill, /请先使用 demo-skill skill/);
  assert.match(skill, /Skill 注入文件：\n- skills\/demo-skill\/SKILL\.md/);
  assert.match(skill, /<demo-skill-skill>\n# Demo Skill\n<\/demo-skill-skill>/);
  assert.match(skill, /请返回：\n- 契约\n- 验证/);
});

test("generic skill eval runner resolves references from a skill-specific tag map", async () => {
  const fixtureRoot = await makeFixtureRepo();

  try {
    const bundle = await resolveSkillBundle({
      repoRoot: fixtureRoot,
      skillName: "demo-skill",
      tags: ["go"],
      referenceMap: {
        "demo-skill": {
          go: ["references/go.md"],
        },
      },
    });

    assert.deepEqual(bundle.files.map((file) => file.path), [
      "skills/demo-skill/SKILL.md",
      "skills/demo-skill/references/go.md",
    ]);
    assert.match(bundle.text, /# Demo Skill/);
    assert.match(bundle.text, /# Go Reference/);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("generic skill eval runner dry-runs baseline and skill samples without Codex", async () => {
  const fixtureRoot = await makeFixtureRepo();
  const resultsRoot = path.join(fixtureRoot, ".eval-runs", "demo");

  try {
    await mkdir(path.join(fixtureRoot, "docs"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, "docs", "cases.md"),
      [
        "| ID | 环境标签 | 任务场景 | 这条在测什么 | 常见错误 | 期待好回答 |",
        "| --- | --- | --- | --- | --- | --- |",
        "| GO-01 | go | Go handler reads legacy JSON field. | Contract drift. | Patch caller. | Align boundary. |",
        "",
      ].join("\n"),
    );

    const result = await runSkillEval(
      {
        repoRoot: fixtureRoot,
        reportPath: path.join(fixtureRoot, "docs", "cases.md"),
        defaultResultsRoot: resultsRoot,
        cleanCodexHome: path.join(fixtureRoot, "tmp", "codex-home"),
        cleanWorkdir: path.join(fixtureRoot, "tmp", "workdir"),
        evalName: "demo-eval",
        skillName: "demo-skill",
        referenceMap: {
          "demo-skill": {
            go: ["references/go.md"],
          },
        },
        buildPrompt: (testCase, mode, skillText, injectedFiles) =>
          buildSkillEvalPrompt({
            evalName: "Wingman demo skill",
            skillName: "demo-skill",
            testCase,
            mode,
            skillText,
            injectedFiles,
            environment: "Go 项目",
            returnSections: ["契约"],
          }),
        buildSampleSummary: ({ testCase, mode, run, status, injectedFiles }) => ({
          id: testCase.id,
          mode,
          run,
          status,
          injectedFiles,
        }),
        scoreOutput: () => ({ total: 0 }),
        aggregateSummary: (samples) => ({ count: samples.length }),
        formatAggregateReport: (aggregate) => `count ${aggregate.count}`,
        formatConsoleSummary: (aggregate) => `count ${aggregate.count}`,
        formatHtmlReport: ({ planned, samples }) => `<html>${planned}:${samples.length}</html>`,
        resultsReadme: "# Demo Eval\n",
      },
      { dryRun: true, runs: 2, log: () => {} },
    );

    assert.equal(result.planned, 4);
    assert.equal(result.consoleSummary, "count 4");
    assert.equal(result.report, "count 4");
    assert.equal(result.samples.length, 4);
    assert.deepEqual(result.samples.map((sample) => `${sample.id}:${sample.mode}#${sample.run}`), [
      "GO-01:baseline#1",
      "GO-01:baseline#2",
      "GO-01:skill#1",
      "GO-01:skill#2",
    ]);

    const skillPrompt = await readFile(
      path.join(resultsRoot, "prompts", "GO-01", "skill.txt"),
      "utf8",
    );
    const summaryJson = JSON.parse(await readFile(path.join(resultsRoot, "summary.json"), "utf8"));
    assert.match(skillPrompt, /# Go Reference/);
    assert.equal(summaryJson.计划样本数, 4);
    assert.equal(summaryJson.样本.length, 4);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

async function makeFixtureRepo() {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "skill-eval-runner-"));
  await mkdir(path.join(fixtureRoot, "skills", "demo-skill", "references"), { recursive: true });
  await writeFile(path.join(fixtureRoot, "skills", "demo-skill", "SKILL.md"), "# Demo Skill\n");
  await writeFile(
    path.join(fixtureRoot, "skills", "demo-skill", "references", "go.md"),
    "# Go Reference\n",
  );
  return fixtureRoot;
}
