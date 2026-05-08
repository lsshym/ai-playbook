import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  collectEvalSuites,
  parseStandardCases,
  validateEvalStandard,
} from "../_shared/eval-standard.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");

test("all skill eval suites follow the shared standard", async () => {
  const issues = await validateEvalStandard(repoRoot);

  assert.deepEqual(issues, []);
});

test("standard parser reads the shared five-column case table", () => {
  const cases = parseStandardCases(`
| ID | Skill | 环境标签 | 场景 | 重点 |
| --- | --- | --- | --- | --- |
| DM-01 | memory-load | checkout, api | Fix checkout. | Read only checkout memory. |
`);

  assert.deepEqual(cases, [
    {
      id: "DM-01",
      skill: "memory-load",
      tags: ["checkout", "api"],
      scenario: "Fix checkout.",
      focus: "Read only checkout memory.",
      validation: "Read only checkout memory.",
      baselineRisk: "",
      skillExpected: "Read only checkout memory.",
    },
  ]);
});

test("eval package scripts expose only the shared CLI entrypoints", async () => {
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  const suites = await collectEvalSuites(repoRoot);

  assert.equal(packageJson.scripts.eval, "node skill-evals/run.mjs");
  assert.equal(packageJson.scripts["eval:review"], "node skill-evals/review.mjs");

  for (const suite of suites) {
    assert.equal(packageJson.scripts[`eval:${suite.name}`], undefined);
    assert.equal(packageJson.scripts[`eval:${suite.name}:dry-run`], undefined);
    assert.equal(packageJson.scripts[`eval:${suite.name}:review`], undefined);
  }
});

test("eval suites do not define directory-local runner files", async () => {
  const suites = await collectEvalSuites(repoRoot);

  for (const suite of suites) {
    await assert.rejects(
      access(path.join(suite.dir, "runner.mjs")),
      /ENOENT/,
      `${suite.name} should use skill-evals/run.mjs instead of a local runner`,
    );
  }
});

test("eval suite list excludes shared and check directories", async () => {
  const suites = await collectEvalSuites(repoRoot);
  const entries = await readdir(path.join(repoRoot, "skill-evals"), { withFileTypes: true });

  assert.deepEqual(suites.map((suite) => suite.name).sort(), ["align-contracts", "memory"]);
  assert.ok(entries.some((entry) => entry.name === "_shared"));
  assert.ok(entries.some((entry) => entry.name === "checks"));
});
