import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildCaseReviewPrompt,
  formatReviewSummary,
  reviewEvalResults,
} from "../align-contracts-heavy/review.mjs";

test("align-contracts review prompt asks AI to judge manually without regex scoring", () => {
  const prompt = buildCaseReviewPrompt({
    caseId: "AC-01",
    scenario: "后端 totalCents 改成 amount.total_minor_units。",
    validation: "API 返回结构和 React props 契约错位。",
    baselineRisk: "父组件临时拼回 totalCents。",
    skillExpected: "更新组件契约或在 adapter 边界统一转换。",
    runs: [
      {
        run: 1,
        files: [
          {
            path: "src/OrderSummary.tsx",
            role: "editable",
            language: "tsx",
            original: "<Money totalCents={order.totalCents} />",
            baseline: "<Money totalCents={order.amount.total_minor_units} />",
            skill: "<Money totalMinorUnits={order.amount.total_minor_units} />",
          },
        ],
      },
    ],
  });

  assert.match(prompt, /像人工 reviewer 一样审核/);
  assert.match(prompt, /不要用正则/);
  assert.match(prompt, /不要用关键词命中/);
  assert.match(prompt, /通过|未通过|不确定/);
  assert.match(prompt, /<Money totalMinorUnits=\{order\.amount\.total_minor_units\} \/>/);
  assert.match(prompt, /请只输出严格 JSON/);
});

test("align-contracts review summary groups AI verdicts", () => {
  const markdown = formatReviewSummary([
    {
      caseId: "AC-01",
      verdict: "通过",
      reason: "Skill 更新了消费方契约。",
      passedAreas: ["字段结构变化"],
      failedAreas: [],
      uncertainAreas: [],
      evidence: ["Skill 使用 totalMinorUnits。"],
    },
    {
      caseId: "AC-05",
      verdict: "未通过",
      reason: "Skill 仍然造了 avatarUrl 空字符串。",
      passedAreas: [],
      failedAreas: ["假字段"],
      uncertainAreas: [],
      evidence: ["avatarUrl: \"\""],
    },
    {
      caseId: "AC-04",
      verdict: "不确定",
      reason: "语义需要产品确认。",
      passedAreas: [],
      failedAreas: [],
      uncertainAreas: ["checkoutType 与 status 的语义"],
      evidence: ["缺少 schema。"],
    },
  ]);

  assert.match(markdown, /## 总结/);
  assert.match(markdown, /通过：1/);
  assert.match(markdown, /未通过：1/);
  assert.match(markdown, /不确定：1/);
  assert.match(markdown, /## 未通过/);
  assert.match(markdown, /AC-05/);
});

test("align-contracts review tells users to run eval before review", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "align-contracts-review-empty-"));

  await assert.rejects(
    () => reviewEvalResults({ resultsRoot: root, dryRun: true, log: () => {} }),
    /请先运行 npm run eval:align-contracts/,
  );
});
