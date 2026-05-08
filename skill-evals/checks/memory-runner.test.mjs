import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { loadEvalDefinition } from "../_shared/standard-skill-eval.mjs";
import { buildFixture } from "../memory/fixtures.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const definition = await loadEvalDefinition(repoRoot, "memory");

test("memory case catalog exposes detailed smoke cases in the standard shape", async () => {
  const casesDoc = await readFile(
    path.join(repoRoot, "skill-evals", "memory", "cases.zh-CN.md"),
    "utf8",
  );
  const cases = definition.parseCasesFromReport(casesDoc);

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
  assert.deepEqual(cases[0].tags, ["setup", "empty-memory", "zh-CN"]);
  assert.equal(
    cases[0].scenario,
    "空仓库中，用户明确说“初始化 Wingman memory”。fixture 初始没有 `.wingman/`、`AGENTS.md`、`CLAUDE.md` 或 `.cursor/rules/wingman-memory.mdc`。",
  );
  assert.equal(
    cases[0].focus,
    "必须触发 `memory-setup`，不能只打印模板。执行后应创建 `.wingman/memory/`、`.wingman/memory/projectBrief.md`、`.wingman/memory/activeContext.md`、`.wingman/memory/domains/README.md`、`.wingman/memory/archive/README.md`，并创建平台入口文件。重点检查 memory root 是否完整、seed 内容是否符合 skill 模板、中文请求下 `projectBrief.md` 的 `Language` 是否设置为 `zh-CN`。",
  );
  assert.match(cases.find((testCase) => testCase.id === "MEM-SETUP-02").focus, /允许按平台模板补充 Cursor frontmatter/);
  assert.match(cases.find((testCase) => testCase.id === "MEM-SYNC-02").focus, /遵守 `projectBrief\.md` 的 `Language: zh-CN`/);
  assert.match(cases.find((testCase) => testCase.id === "MEM-SYNC-04").focus, /短路/);
  assert.match(cases.find((testCase) => testCase.id === "MEM-SYNC-04").focus, /不能读取 memory/);
  assert.match(cases.find((testCase) => testCase.id === "MEM-SYNC-04").focus, /不能额外修改业务代码/);
});

test("memory defaults to all curated smoke cases", async () => {
  const casesDoc = await readFile(
    path.join(repoRoot, "skill-evals", "memory", "cases.zh-CN.md"),
    "utf8",
  );
  const cases = definition.parseCasesFromReport(casesDoc);
  const selected = definition.selectCasesForRun(cases, {});

  assert.deepEqual(selected.map((testCase) => testCase.id), cases.map((testCase) => testCase.id));
});

test("memory args default to one dry-run capable smoke matrix", () => {
  assert.deepEqual(definition.config.modes, ["skill"]);
  assert.deepEqual(definition.parseArgs([]), {
    caseIds: [],
    dryRun: false,
    reasoningEffort: "low",
    resume: false,
    runs: 1,
  });
});

test("memory prompt injects only the row scenario and hides focus details", () => {
  const prompt = definition.buildPrompt(
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
  assert.match(prompt, /Memory files used:/);
  assert.match(prompt, /没有真实读取审计日志时/);
  assert.doesNotMatch(prompt, /先读 checkout\/index\.md/);
  assert.doesNotMatch(prompt, /status-flow\.md；不全量读取/);
});

test("memory sync prompt treats completed work as memory-only sync", () => {
  const prompt = definition.buildPrompt(
    {
      id: "MEM-SYNC-04",
      skill: "memory-sync",
      tags: ["user-override", "skip-update"],
      scenario: "已完成一个有意义的 checkout bugfix，但用户明确说“这个不用记忆 / skip update / 不更新”。",
      focus: "短路；不能读取 memory；不能额外修改业务代码。",
    },
    "skill",
    "# Wingman Memory Sync",
    ["skills/memory-sync/SKILL.md"],
  );

  assert.match(prompt, /memory-sync 用例中，场景描述的工作视为已经完成/);
  assert.match(prompt, /不要为了满足 eval 再修改业务代码/);
  assert.match(prompt, /不要读取、创建或修改 `\.wingman\/memory`/);
  assert.match(prompt, /Memory files used:/);
  assert.doesNotMatch(prompt, /短路；不能读取 memory/);
});

test("memory setup fixture tracks created memory and platform entry files", () => {
  const fixture = buildFixture({ id: "MEM-SETUP-01" });

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
  const fixture = buildFixture({ id: "MEM-LOAD-02" });
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
  const fixture = buildFixture({ id: "MEM-SYNC-02" });
  const paths = fixture.files.map((file) => file.path);

  assert.ok(paths.includes(".wingman/memory/domains/checkout.md"));
  assert.ok(paths.includes(".wingman/memory/domains/auth.md"));
  assert.ok(paths.includes(".wingman/memory/domains/billing.md"));
  assert.match(fixture.files.find((file) => file.path.endsWith("checkout.md")).content, /order_status/);
});

test("memory sync skip fixture treats completed code as input context", () => {
  const fixture = buildFixture({ id: "MEM-SYNC-04" });
  const codeFile = fixture.files.find((file) => file.path === "src/checkoutWebhook.ts");

  assert.equal(codeFile.role, "input");
  assert.match(codeFile.content, /payment\.succeeded/);
});

test("memory dry run writes prompts, summary, and comparison index", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "memory-eval-"));
  await definition.run({
    dryRun: true,
    limit: 1,
    runs: 1,
    output: root,
    log: () => {},
  });

  const summary = JSON.parse(await readFile(path.join(root, "summary.json"), "utf8"));
  const comparison = JSON.parse(await readFile(path.join(root, "comparison.json"), "utf8"));
  const prompt = await readFile(path.join(root, "prompts", "MEM-SETUP-01", "skill.txt"), "utf8");

  assert.equal(summary.计划样本数, 1);
  assert.equal(summary.样本.length, 1);
  assert.deepEqual(summary.样本.map((sample) => sample.模式), ["skill"]);
  assert.deepEqual(Object.keys(summary.汇总).sort(), ["skill", "案例数"].sort());
  assert.equal(comparison.cases[0].caseId, "MEM-SETUP-01");
  assert.equal(comparison.cases[0].runs[0].files[0].baselinePath, undefined);
  assert.equal(comparison.cases[0].runs[0].files[0].skillPath, undefined);
  assert.deepEqual(comparison.cases[0].runs[0].files[0].modePaths, {});
  assert.match(comparison.cases[0].files[0].originalPath, /comparisons\/MEM-SETUP-01\/original\/\.wingman\/memory\/projectBrief\.md/);
  assert.match(prompt, /# Memory Setup/);
});
