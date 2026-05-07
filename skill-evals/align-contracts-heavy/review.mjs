#!/usr/bin/env node

import { execFileWithInput, renderCodexConfig } from "../_shared/skill-eval-runner.mjs";
import {
  access,
  cp,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const defaultResultsRoot = path.join(repoRoot, ".eval-runs", "align-contracts-heavy");
const reviewCodexHome = path.join(os.tmpdir(), "wingman-align-review-codex-home");

export function buildCaseReviewPrompt(reviewCase) {
  return [
    "你正在审核 Wingman align-contracts 重型评估结果。",
    "请像人工 reviewer 一样审核代码语义，而不是做机械匹配。",
    "不要用正则，不要用关键词命中，不要因为出现某个字段名就判定通过或失败。",
    "你需要比较 Original、Baseline、Skill 的真实代码改动，判断 Skill 模式是否更好地解决了契约错位。",
    "",
    "判定选项只能是：通过、未通过、不确定。",
    "",
    `测试编号：${reviewCase.caseId}`,
    `场景：${reviewCase.scenario}`,
    `测试目的：${reviewCase.validation || "未提供。"}`,
    `常见错误：${reviewCase.baselineRisk || "未提供。"}`,
    `期待好改法：${reviewCase.skillExpected || "未提供。"}`,
    "",
    "审核标准：",
    "- 是否真正修复 provider contract 与 consumer contract 的错位。",
    "- 是否把转换放在合适边界，而不是在调用点临时凑 shape。",
    "- 是否避免 fake default、placeholder field 或伪造身份字段。",
    "- 语义不确定时是否避免猜测，并保留需要确认的边界。",
    "- 是否只改契约相关代码，避免无关 UI/CSS/业务流程改动。",
    "- input/provider 样例如果被改动，需要视为风险并解释。",
    "",
    "代码快照：",
    ...reviewCase.runs.flatMap((run) => renderReviewRun(run)),
    "",
    "请只输出严格 JSON，不要输出 Markdown，不要包裹代码块。JSON shape 必须是：",
    "{",
    '  "caseId": "AC-01",',
    '  "verdict": "通过|未通过|不确定",',
    '  "reason": "一句话总结判断",',
    '  "passedAreas": ["已经通过的具体点"],',
    '  "failedAreas": ["没有通过的具体点"],',
    '  "uncertainAreas": ["需要人工或业务确认的点"],',
    '  "evidence": ["引用具体代码差异或文件路径作为证据"],',
    '  "baselineAssessment": "baseline 的主要问题或表现",',
    '  "skillAssessment": "skill 的主要问题或表现"',
    "}",
  ].join("\n");
}

export function formatReviewSummary(results) {
  const counts = {
    通过: results.filter((result) => result.verdict === "通过").length,
    未通过: results.filter((result) => result.verdict === "未通过").length,
    不确定: results.filter((result) => result.verdict === "不确定").length,
  };

  return [
    "# align-contracts AI 审核总结",
    "",
    "## 总结",
    "",
    `- 通过：${counts.通过}`,
    `- 未通过：${counts.未通过}`,
    `- 不确定：${counts.不确定}`,
    "",
    renderVerdictSection("未通过", results),
    renderVerdictSection("不确定", results),
    renderVerdictSection("通过", results),
  ].join("\n");
}

export async function reviewEvalResults({
  resultsRoot = defaultResultsRoot,
  dryRun = false,
  reasoningEffort = "low",
  codexBinary = "codex",
  limit,
  log = () => {},
} = {}) {
  const comparisonPath = path.join(resultsRoot, "comparison.json");
  if (!(await exists(comparisonPath))) {
    throw new Error(
      `找不到 ${comparisonPath}。请先运行 npm run eval:align-contracts 生成 comparison.json。`,
    );
  }

  const comparison = JSON.parse(await readFile(comparisonPath, "utf8"));
  const reviewRoot = path.join(resultsRoot, "reviews");
  const cases = limit == null ? comparison.cases : comparison.cases.slice(0, limit);
  const results = [];

  await mkdir(path.join(reviewRoot, "prompts"), { recursive: true });
  await mkdir(path.join(reviewRoot, "outputs"), { recursive: true });

  if (!dryRun) {
    await prepareReviewCodexHome(resultsRoot, reasoningEffort);
  }

  for (const comparisonCase of cases) {
    const reviewCase = await loadReviewCase(resultsRoot, comparisonCase);
    const prompt = buildCaseReviewPrompt(reviewCase);
    const promptPath = path.join(reviewRoot, "prompts", `${comparisonCase.caseId}.txt`);
    const outputPath = path.join(reviewRoot, "outputs", `${comparisonCase.caseId}.json`);
    await writeFile(promptPath, prompt);

    if (dryRun) {
      results.push({
        caseId: comparisonCase.caseId,
        verdict: "不确定",
        reason: "dry-run 只生成审核 prompt，未调用 AI。",
        passedAreas: [],
        failedAreas: [],
        uncertainAreas: ["尚未执行 AI 审核"],
        evidence: [path.relative(resultsRoot, promptPath).split(path.sep).join("/")],
        baselineAssessment: "",
        skillAssessment: "",
      });
      continue;
    }

    log(`审核：${comparisonCase.caseId}`);
    await runCodexReview({ prompt, outputPath, resultsRoot, reasoningEffort, codexBinary });
    const raw = await readFile(outputPath, "utf8");
    results.push(parseReviewOutput(raw, comparisonCase.caseId));
  }

  const summary = {
    source: path.relative(repoRoot, comparisonPath).split(path.sep).join("/"),
    推理强度: reasoningEffort,
    样本数: results.length,
    cases: results,
  };
  await writeFile(
    path.join(resultsRoot, "review-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  await writeFile(
    path.join(resultsRoot, "review-summary.md"),
    `${formatReviewSummary(results)}\n`,
  );

  return {
    resultsRoot,
    reviewRoot,
    results,
    summary,
  };
}

export function parseReviewArgs(argv) {
  const args = { dryRun: false, reasoningEffort: "low" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--output") {
      args.resultsRoot = path.resolve(repoRoot, argv[++index]);
    } else if (arg === "--limit") {
      args.limit = Number(argv[++index]);
    } else if (arg === "--reasoning-effort") {
      args.reasoningEffort = argv[++index];
      if (!["low", "medium", "high"].includes(args.reasoningEffort)) {
        throw new Error("reasoning-effort 只能是 low、medium 或 high");
      }
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return args;
}

async function loadReviewCase(resultsRoot, comparisonCase) {
  return {
    caseId: comparisonCase.caseId,
    tags: comparisonCase.tags ?? [],
    scenario: comparisonCase.scenario ?? "",
    validation: comparisonCase.validation ?? "",
    baselineRisk: comparisonCase.baselineRisk ?? "",
    skillExpected: comparisonCase.skillExpected ?? "",
    runs: await Promise.all(
      (comparisonCase.runs ?? []).map(async (run) => ({
        run: run.run,
        files: await Promise.all(
          (run.files ?? []).map((file) => loadReviewFile(resultsRoot, file)),
        ),
      })),
    ),
  };
}

async function loadReviewFile(resultsRoot, file) {
  return {
    path: file.path,
    role: file.role ?? "editable",
    language: file.language ?? "text",
    original: await readSnapshot(resultsRoot, file.originalPath),
    baseline: await readSnapshot(resultsRoot, file.baselinePath),
    skill: await readSnapshot(resultsRoot, file.skillPath),
  };
}

async function readSnapshot(resultsRoot, relPath) {
  if (!relPath) return "没有快照。";
  return readFile(path.join(resultsRoot, relPath), "utf8");
}

function renderReviewRun(run) {
  return [
    "",
    `## Run ${run.run}`,
    ...run.files.flatMap((file) => [
      "",
      `### ${file.path} (${file.role}, ${file.language})`,
      "",
      "Original:",
      fence(file.language, file.original),
      "",
      "Baseline:",
      fence(file.language, file.baseline),
      "",
      "Skill:",
      fence(file.language, file.skill),
    ]),
  ];
}

function fence(language, content) {
  return ["```" + (language || "text"), content.trimEnd(), "```"].join("\n");
}

async function runCodexReview({ prompt, outputPath, resultsRoot, reasoningEffort, codexBinary }) {
  const env = { ...process.env, CODEX_HOME: reviewCodexHome };
  await writeFile(
    path.join(reviewCodexHome, "config.toml"),
    renderCodexConfig(resultsRoot, reasoningEffort),
    { mode: 0o600 },
  );
  await execFileWithInput(
    codexBinary,
    [
      "exec",
      "--cd",
      resultsRoot,
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--ephemeral",
      "-o",
      outputPath,
      "-",
    ],
    {
      env,
      input: prompt,
      maxBuffer: 1024 * 1024 * 20,
      timeout: 1000 * 60 * 8,
    },
  );
}

async function prepareReviewCodexHome(resultsRoot, reasoningEffort) {
  await mkdir(reviewCodexHome, { recursive: true, mode: 0o700 });
  await cp(path.join(os.homedir(), ".codex", "auth.json"), path.join(reviewCodexHome, "auth.json"));
  await cp(path.join(os.homedir(), ".codex", "installation_id"), path.join(reviewCodexHome, "installation_id"));
  await writeFile(
    path.join(reviewCodexHome, "config.toml"),
    renderCodexConfig(resultsRoot, reasoningEffort),
    { mode: 0o600 },
  );
}

function parseReviewOutput(raw, fallbackCaseId) {
  try {
    return normalizeReviewResult(JSON.parse(raw), fallbackCaseId);
  } catch {
    return {
      caseId: fallbackCaseId,
      verdict: "不确定",
      reason: "AI 审核输出不是严格 JSON，请查看 reviews/outputs 中的原始输出。",
      passedAreas: [],
      failedAreas: [],
      uncertainAreas: ["审核输出格式需要人工确认"],
      evidence: [],
      baselineAssessment: "",
      skillAssessment: "",
    };
  }
}

function normalizeReviewResult(result, fallbackCaseId) {
  const verdicts = new Set(["通过", "未通过", "不确定"]);
  return {
    caseId: String(result.caseId || fallbackCaseId),
    verdict: verdicts.has(result.verdict) ? result.verdict : "不确定",
    reason: String(result.reason || "AI 未提供原因。"),
    passedAreas: toStringArray(result.passedAreas),
    failedAreas: toStringArray(result.failedAreas),
    uncertainAreas: toStringArray(result.uncertainAreas),
    evidence: toStringArray(result.evidence),
    baselineAssessment: String(result.baselineAssessment || ""),
    skillAssessment: String(result.skillAssessment || ""),
  };
}

function toStringArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function renderVerdictSection(verdict, results) {
  const items = results.filter((result) => result.verdict === verdict);
  return [
    `## ${verdict}`,
    "",
    items.length ? items.map(renderReviewItem).join("\n\n") : "暂无。",
    "",
  ].join("\n");
}

function renderReviewItem(result) {
  return [
    `### ${result.caseId}`,
    "",
    result.reason,
    "",
    `- 通过点：${formatList(result.passedAreas)}`,
    `- 未通过点：${formatList(result.failedAreas)}`,
    `- 不确定点：${formatList(result.uncertainAreas)}`,
    `- 证据：${formatList(result.evidence)}`,
  ].join("\n");
}

function formatList(items) {
  return items?.length ? items.join("；") : "无";
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const result = await reviewEvalResults({
    ...parseReviewArgs(process.argv.slice(2)),
    log: (message) => console.log(message),
  });

  console.log(`审核 case 数：${result.results.length}`);
  console.log(`审核总结：${path.join(result.resultsRoot, "review-summary.md")}`);
  console.log(`结构化总结：${path.join(result.resultsRoot, "review-summary.json")}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
