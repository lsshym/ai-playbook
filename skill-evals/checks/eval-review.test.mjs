import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildEvalReviewPrompt,
  parseEvalReviewArgs,
  runEvalReview,
} from "../_shared/eval-review.mjs";

test("eval review prompt focuses on cases, criteria, outputs, and snapshots", () => {
  const prompt = buildEvalReviewPrompt({
    evalName: "memory",
    summary: {
      计划样本数: 2,
      汇总: {
        baseline: { 样本数: 1, 已完成: 1 },
        skill: { 样本数: 1, 已完成: 1 },
      },
    },
    cases: [{
      caseId: "MEM-LOAD-02",
      scenario: "checkout folder domain status flow.",
      validation: "Read index then status-flow only.",
      tags: ["folder-domain"],
      runs: [{
        run: 1,
        files: [{
          path: "src/checkout.ts",
          original: "return 'pending_payment';\n",
          baseline: "return 'pending_payment';\n",
          skill: "return 'paid';\n",
        }],
        outputs: {
          baseline: "I changed checkout.",
          skill: "依据 memory: projectBrief.md, status-flow.md",
        },
      }],
    }],
  });

  assert.match(prompt, /请生成一份中文 AI 评估分析报告/);
  assert.match(prompt, /MEM-LOAD-02/);
  assert.match(prompt, /Read index then status-flow only/);
  assert.match(prompt, /依据 memory/);
  assert.match(prompt, /Original/);
  assert.match(prompt, /Skill/);
});

test("eval review dry-run writes the review prompt without calling Codex", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "eval-review-"));
  const resultsRoot = path.join(repoRoot, ".eval-runs", "demo");

  try {
    await writeDemoResults(resultsRoot);
    const result = await runEvalReview({
      repoRoot,
      evalName: "demo",
      dryRun: true,
      log: () => {},
    });

    assert.equal(result.outputPath, path.join(resultsRoot, "ai-review.md"));
    assert.equal(result.promptPath, path.join(resultsRoot, "ai-review-prompt.md"));
    assert.equal(result.status, "planned");
  const prompt = await readFile(result.promptPath, "utf8");
  assert.match(prompt, /DM-01/);
  assert.match(prompt, /Skill output/);
  assert.doesNotMatch(prompt, /summary duplicate scenario should be omitted/);
  await assert.rejects(
    readFile(result.outputPath, "utf8"),
    /ENOENT/,
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("eval review args support output, dry-run, and reasoning effort", () => {
  assert.deepEqual(
    parseEvalReviewArgs(["--output", "tmp/results", "--dry-run", "--reasoning-effort", "medium"]),
    {
      output: "tmp/results",
      dryRun: true,
      reasoningEffort: "medium",
    },
  );
});

test("eval review supports skill-only results without baseline sections", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "eval-review-skill-only-"));
  const resultsRoot = path.join(repoRoot, ".eval-runs", "memory");

  try {
    await writeSkillOnlyResults(resultsRoot);
    const result = await runEvalReview({
      repoRoot,
      evalName: "memory",
      dryRun: true,
      log: () => {},
    });
    const prompt = await readFile(result.promptPath, "utf8");

    assert.match(prompt, /本次结果模式：skill/);
    assert.match(prompt, /Skill 输出：/);
    assert.match(prompt, /memory evidence/);
    assert.doesNotMatch(prompt, /Baseline 输出：/);
    assert.doesNotMatch(prompt, /比 baseline 更符合预期/);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

async function writeDemoResults(resultsRoot) {
  await mkdir(path.join(resultsRoot, "outputs", "DM-01"), { recursive: true });
  await mkdir(path.join(resultsRoot, "comparisons", "DM-01", "original", "src"), { recursive: true });
  await mkdir(path.join(resultsRoot, "comparisons", "DM-01", "baseline-1", "src"), { recursive: true });
  await mkdir(path.join(resultsRoot, "comparisons", "DM-01", "skill-1", "src"), { recursive: true });
  await writeFile(path.join(resultsRoot, "outputs", "DM-01", "baseline-1.md"), "Baseline output\n");
  await writeFile(path.join(resultsRoot, "outputs", "DM-01", "skill-1.md"), "Skill output\n");
  await writeFile(path.join(resultsRoot, "comparisons", "DM-01", "original", "src", "demo.ts"), "export const value = 'old';\n");
  await writeFile(path.join(resultsRoot, "comparisons", "DM-01", "baseline-1", "src", "demo.ts"), "export const value = 'old';\n");
  await writeFile(path.join(resultsRoot, "comparisons", "DM-01", "skill-1", "src", "demo.ts"), "export const value = 'new';\n");
  await writeFile(path.join(resultsRoot, "summary.json"), `${JSON.stringify({
    计划样本数: 2,
    汇总: {
      baseline: { 样本数: 1, 已完成: 1 },
      skill: { 样本数: 1, 已完成: 1 },
    },
    样本: [{
      测试编号: "DM-01",
      场景: "summary duplicate scenario should be omitted",
    }],
  }, null, 2)}\n`);
  await writeFile(path.join(resultsRoot, "comparison.json"), `${JSON.stringify({
    计划样本数: 2,
    cases: [{
      caseId: "DM-01",
      tags: ["demo"],
      scenario: "Demo scenario.",
      validation: "Skill should update demo value.",
      runs: [{
        run: 1,
        files: [{
          path: "src/demo.ts",
          language: "ts",
          role: "editable",
          originalPath: "comparisons/DM-01/original/src/demo.ts",
          baselinePath: "comparisons/DM-01/baseline-1/src/demo.ts",
          skillPath: "comparisons/DM-01/skill-1/src/demo.ts",
        }],
      }],
    }],
  }, null, 2)}\n`);
}

async function writeSkillOnlyResults(resultsRoot) {
  await mkdir(path.join(resultsRoot, "outputs", "MEM-LOAD-02"), { recursive: true });
  await mkdir(path.join(resultsRoot, "comparisons", "MEM-LOAD-02", "original", "src"), { recursive: true });
  await mkdir(path.join(resultsRoot, "comparisons", "MEM-LOAD-02", "skill-1", "src"), { recursive: true });
  await writeFile(path.join(resultsRoot, "outputs", "MEM-LOAD-02", "skill-1.md"), "memory evidence\n");
  await writeFile(path.join(resultsRoot, "comparisons", "MEM-LOAD-02", "original", "src", "checkout.ts"), "export const status = 'pending_payment';\n");
  await writeFile(path.join(resultsRoot, "comparisons", "MEM-LOAD-02", "skill-1", "src", "checkout.ts"), "export const status = 'paid';\n");
  await writeFile(path.join(resultsRoot, "summary.json"), `${JSON.stringify({
    计划样本数: 1,
    汇总: {
      skill: { 样本数: 1, 已完成: 1 },
    },
  }, null, 2)}\n`);
  await writeFile(path.join(resultsRoot, "comparison.json"), `${JSON.stringify({
    计划样本数: 1,
    modes: ["skill"],
    cases: [{
      caseId: "MEM-LOAD-02",
      tags: ["folder-domain"],
      scenario: "Load checkout memory.",
      validation: "Read only relevant memory files.",
      runs: [{
        run: 1,
        files: [{
          path: "src/checkout.ts",
          language: "ts",
          role: "editable",
          originalPath: "comparisons/MEM-LOAD-02/original/src/checkout.ts",
          skillPath: "comparisons/MEM-LOAD-02/skill-1/src/checkout.ts",
        }],
      }],
    }],
  }, null, 2)}\n`);
}
