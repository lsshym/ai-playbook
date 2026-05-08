import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildCaseFixture,
  buildPrompt,
  parseArgs,
  parseCasesFromReport,
  runMemoryEval,
  selectCasesForRun,
} from "../memory/runner.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");

test("memory case catalog exposes detailed smoke cases in the four-column shape", async () => {
  const casesDoc = await readFile(
    path.join(repoRoot, "skill-evals", "memory", "cases.zh-CN.md"),
    "utf8",
  );
  const cases = parseCasesFromReport(casesDoc);

  assert.equal(cases.length, 11);
  assert.deepEqual(cases.map((testCase) => testCase.id), [
    "MEM-SETUP-01",
    "MEM-SETUP-02",
    "MEM-SETUP-03",
    "MEM-LOAD-01",
    "MEM-LOAD-02",
    "MEM-LOAD-03",
    "MEM-LOAD-04",
    "MEM-SYNC-01",
    "MEM-SYNC-02",
    "MEM-SYNC-03",
    "MEM-SYNC-04",
  ]);
  assert.equal(cases[0].id, "MEM-SETUP-01");
  assert.equal(cases[0].skill, "memory-setup");
  assert.equal(
    cases[0].scenario,
    "空仓库中，用户明确说“初始化 Wingman memory”。fixture 初始没有 `.wingman/`、`AGENTS.md`、`CLAUDE.md` 或 `.cursor/rules/wingman-memory.mdc`。",
  );
  assert.equal(
    cases[0].focus,
    "必须触发 `memory-setup`，不能只打印模板。执行后应创建 `.wingman/memory/`、`.wingman/memory/projectBrief.md`、`.wingman/memory/activeContext.md`、`.wingman/memory/domains/README.md`、`.wingman/memory/archive/README.md`，并创建平台入口文件。重点检查 memory root 是否完整、seed 内容是否符合 skill 模板、中文请求下 `projectBrief.md` 的 `Language` 是否设置为 `zh-CN`。",
  );
});

test("memory defaults to all curated smoke cases", async () => {
  const casesDoc = await readFile(
    path.join(repoRoot, "skill-evals", "memory", "cases.zh-CN.md"),
    "utf8",
  );
  const cases = parseCasesFromReport(casesDoc);
  const selected = selectCasesForRun(cases, {});

  assert.deepEqual(selected.map((testCase) => testCase.id), cases.map((testCase) => testCase.id));
});

test("memory args default to one dry-run capable smoke matrix", () => {
  assert.deepEqual(parseArgs([]), {
    caseIds: [],
    dryRun: false,
    reasoningEffort: "low",
    resume: false,
    runs: 1,
  });
});

test("memory prompt injects only the row scenario and hides focus details", () => {
  const prompt = buildPrompt(
    {
      id: "MEM-LOAD-02",
      skill: "memory-load",
      scenario: "checkout 是 folder domain，用户任务只涉及支付成功后的订单状态流。",
      focus: "先读 checkout/index.md，再只读 status-flow.md；不全量读取 checkout 所有 subfiles。",
    },
    "skill",
    "# Wingman Memory Load",
    ["skills/memory-load/SKILL.md"],
  );

  assert.match(prompt, /请直接编辑当前工作区里的文件/);
  assert.match(prompt, /请先使用 memory-load skill/);
  assert.match(prompt, /场景：checkout 是 folder domain/);
  assert.match(prompt, /请在最终说明中列出本次依据的 memory 文件/);
  assert.doesNotMatch(prompt, /先读 checkout\/index\.md/);
  assert.doesNotMatch(prompt, /status-flow\.md；不全量读取/);
});

test("memory setup fixture tracks created memory and platform entry files", () => {
  const fixture = buildCaseFixture({ id: "MEM-SETUP-01" });

  assert.deepEqual(fixture.files.map((file) => file.path), [
    ".wingman/memory/projectBrief.md",
    ".wingman/memory/activeContext.md",
    ".wingman/memory/domains/README.md",
    ".wingman/memory/archive/README.md",
    "AGENTS.md",
    "CLAUDE.md",
    ".cursor/rules/wingman-memory.mdc",
  ]);
  assert.equal(fixture.files[0].initiallyExists, false);
});

test("memory load folder-domain fixture includes relevant and irrelevant domain files", () => {
  const fixture = buildCaseFixture({ id: "MEM-LOAD-02" });
  const paths = fixture.files.map((file) => file.path);

  assert.deepEqual(paths, [
    ".wingman/memory/projectBrief.md",
    ".wingman/memory/activeContext.md",
    ".wingman/memory/domains/README.md",
    ".wingman/memory/domains/checkout/index.md",
    ".wingman/memory/domains/checkout/pricing.md",
    ".wingman/memory/domains/checkout/status-flow.md",
    ".wingman/memory/domains/checkout/api-contracts.md",
    "src/checkoutWebhook.ts",
  ]);
  assert.match(fixture.files.find((file) => file.path.endsWith("index.md")).content, /status-flow\.md/);
  assert.match(fixture.files.find((file) => file.path.endsWith("pricing.md")).content, /诱饵/);
});

test("memory sync domain-truth fixture includes unrelated domains to catch pollution", () => {
  const fixture = buildCaseFixture({ id: "MEM-SYNC-02" });
  const paths = fixture.files.map((file) => file.path);

  assert.ok(paths.includes(".wingman/memory/domains/checkout.md"));
  assert.ok(paths.includes(".wingman/memory/domains/auth.md"));
  assert.ok(paths.includes(".wingman/memory/domains/billing.md"));
  assert.match(fixture.files.find((file) => file.path.endsWith("checkout.md")).content, /order_status/);
});

test("memory dry run writes prompts, summary, and comparison index", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "memory-eval-"));
  await runMemoryEval({
    dryRun: true,
    limit: 1,
    runs: 1,
    output: root,
    log: () => {},
  });

  const summary = JSON.parse(await readFile(path.join(root, "summary.json"), "utf8"));
  const comparison = JSON.parse(await readFile(path.join(root, "comparison.json"), "utf8"));
  const prompt = await readFile(path.join(root, "prompts", "MEM-SETUP-01", "skill.txt"), "utf8");

  assert.equal(summary.计划样本数, 2);
  assert.equal(summary.样本.length, 2);
  assert.deepEqual(summary.样本.map((sample) => sample.模式), ["baseline", "skill"]);
  assert.equal(comparison.cases[0].caseId, "MEM-SETUP-01");
  assert.match(comparison.cases[0].files[0].originalPath, /comparisons\/MEM-SETUP-01\/original\/\.wingman\/memory\/projectBrief\.md/);
  assert.match(prompt, /# Memory Setup/);
});
