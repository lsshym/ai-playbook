import {
  buildCodexExecArgs,
  execFileWithInput,
  renderCodexConfig,
} from "./skill-eval-runner.mjs";
import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const defaultModes = ["baseline", "skill"];
const labeledModes = {
  baseline: "Baseline",
  skill: "Skill",
};

export function parseEvalReviewArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--output") {
      args.output = argv[++index];
    } else if (arg === "--case") {
      args.caseIds = [...(args.caseIds ?? []), argv[++index]];
    } else if (arg === "--cases") {
      args.caseIds = [
        ...(args.caseIds ?? []),
        ...argv[++index].split(",").map((id) => id.trim()).filter(Boolean),
      ];
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

export async function runEvalReview({
  repoRoot,
  evalName,
  output,
  dryRun = false,
  reasoningEffort = "low",
  caseIds = [],
  log = () => {},
  codexBinary = "codex",
  maxFileChars = 5000,
  maxOutputChars = 2500,
  timeout = 1000 * 60 * 8,
  maxBuffer = 1024 * 1024 * 20,
}) {
  const resultsRoot = path.resolve(repoRoot, output ?? path.join(".eval-runs", evalName));
  const promptPath = path.join(resultsRoot, "ai-review-prompt.md");
  const outputPath = path.join(resultsRoot, "ai-review.md");
  const reviewInput = await loadEvalReviewInput({
    resultsRoot,
    caseIds,
    maxFileChars,
    maxOutputChars,
  });
  const prompt = buildEvalReviewPrompt({ evalName, ...reviewInput });

  await mkdir(resultsRoot, { recursive: true });
  await writeFile(promptPath, prompt);
  log(`写入 AI review prompt：${promptPath}`);

  if (dryRun) {
    return { status: "planned", resultsRoot, promptPath, outputPath };
  }

  const codexHome = path.join(os.tmpdir(), `wingman-${evalName}-review-codex-home`);
  await prepareReviewCodexHome(codexHome, repoRoot, reasoningEffort);
  log(`开始生成 AI 分析报告：${outputPath}`);
  await execFileWithInput(codexBinary, buildCodexExecArgs(repoRoot, outputPath), {
    env: { ...process.env, CODEX_HOME: codexHome },
    input: prompt,
    maxBuffer,
    timeout,
  });
  log("AI 分析报告生成完成。");

  return { status: "completed", resultsRoot, promptPath, outputPath };
}

export function buildEvalReviewPrompt({ evalName, summary, cases, modes = inferModesFromSummary(summary) }) {
  return [
    `请生成一份中文 AI 评估分析报告，评估对象是 Wingman skill eval：${evalName}。`,
    "",
    `本次结果模式：${modes.join(", ")}`,
    "",
    "评估方式：",
    "- 逐 case 使用“重点/validation”作为判分标准，不要只评价代码风格。",
    modes.includes("baseline") && modes.includes("skill")
      ? "- 对比 baseline 与 skill 的输出和文件快照，判断 skill 是否比 baseline 更符合预期。"
      : "- 按实际运行模式检查输出和文件快照是否符合该 case 的重点。",
    "- 每个 case 给出结论：通过 / 部分通过 / 失败 / 无法判断，并写出证据。",
    "- 如果样本只是 dry-run、缺少输出或缺少快照，必须标为无法判断。",
    "- 重点指出 skill 协议问题、fixture 问题、测试标准问题，以及下一步应修的最高优先级事项。",
    "",
    "请按这个结构输出：",
    "1. 总览结论",
    "2. 逐 Case 结果表",
    "3. 关键失败与风险",
    "4. 建议调整",
    "",
    "## 汇总数据",
    fencedJson(summary),
    "",
    "## Case 数据",
    ...cases.map((testCase) => renderReviewCase(testCase, modes)),
  ].join("\n");
}

async function loadEvalReviewInput({ resultsRoot, caseIds = [], maxFileChars, maxOutputChars }) {
  const summary = summarizeEvalSummary(await readJson(path.join(resultsRoot, "summary.json")));
  const comparison = await readJson(path.join(resultsRoot, "comparison.json"));
  const modes = comparison.modes ?? inferModesFromSummary(summary);
  const selected = selectCases(comparison.cases ?? [], caseIds);
  const cases = [];

  for (const testCase of selected) {
    cases.push({
      caseId: testCase.caseId,
      tags: testCase.tags ?? [],
      scenario: testCase.scenario ?? "",
      validation: testCase.validation ?? "",
      runs: await Promise.all((testCase.runs ?? []).map(async (run) => ({
        run: run.run,
        modes,
        outputs: await readRunOutputs(resultsRoot, testCase.caseId, run.run, modes, maxOutputChars),
        files: await Promise.all((run.files ?? []).map((file) => readReviewFile(resultsRoot, file, modes, maxFileChars))),
      }))),
    });
  }

  return { summary, cases, modes };
}

async function readRunOutputs(resultsRoot, caseId, run, modes, maxOutputChars) {
  const entries = {};
  for (const mode of modes) {
    const outputPath = path.join(resultsRoot, "outputs", caseId, `${mode}-${run}.md`);
    entries[mode] = await readMaybe(outputPath, "", maxOutputChars);
  }
  return entries;
}

async function readReviewFile(resultsRoot, file, modes, maxFileChars) {
  return {
    path: file.path,
    language: file.language,
    role: file.role ?? "editable",
    original: await readRelativeSnapshot(resultsRoot, file.originalPath, maxFileChars),
    snapshots: await readModeSnapshots(resultsRoot, file, modes, maxFileChars),
  };
}

async function readModeSnapshots(resultsRoot, file, modes, maxFileChars) {
  const snapshots = {};
  for (const mode of modes) {
    const legacyPath = mode === "baseline" ? file.baselinePath : mode === "skill" ? file.skillPath : undefined;
    snapshots[mode] = await readRelativeSnapshot(
      resultsRoot,
      file.modePaths?.[mode] ?? legacyPath,
      maxFileChars,
    );
  }
  return snapshots;
}

async function readRelativeSnapshot(resultsRoot, relativePath, maxChars) {
  if (!relativePath) return "[[snapshot missing]]\n";
  return readMaybe(path.join(resultsRoot, relativePath), `[[snapshot missing: ${relativePath}]]\n`, maxChars);
}

async function readMaybe(filePath, fallback, maxChars) {
  if (!(await exists(filePath))) return fallback;
  return truncate(await readFile(filePath, "utf8"), maxChars);
}

function selectCases(cases, caseIds) {
  if (!caseIds?.length) return cases;
  const byId = new Map(cases.map((testCase) => [testCase.caseId, testCase]));
  return caseIds.map((caseId) => {
    const testCase = byId.get(caseId);
    if (!testCase) {
      throw new Error(`未知 case：${caseId}`);
    }
    return testCase;
  });
}

function renderReviewCase(testCase, modes) {
  return [
    `### ${testCase.caseId}`,
    "",
    `标签：${testCase.tags.length ? testCase.tags.join(", ") : "generic"}`,
    `场景：${testCase.scenario}`,
    `重点：${testCase.validation || "未提供"}`,
    "",
    ...testCase.runs.map((run) => renderReviewRun(run, modes)),
  ].join("\n");
}

function renderReviewRun(run, fallbackModes) {
  const modes = run.modes ?? fallbackModes;
  return [
    `#### Run ${run.run}`,
    "",
    ...modes.flatMap((mode) => [
      `${modeLabel(mode)} 输出：`,
      fenced("markdown", run.outputs[mode] || "[[output missing]]\n"),
      "",
    ]),
    "",
    ...run.files.map((file) => renderReviewFile(file, modes)),
  ].join("\n");
}

function renderReviewFile(file, modes) {
  return [
    `文件：${file.path} (${file.role}, ${file.language ?? "text"})`,
    "",
    "Original:",
    fenced(file.language, file.original),
    "",
    ...modes.flatMap((mode) => [
      `${modeLabel(mode)}:`,
      fenced(file.language, file.snapshots?.[mode] ?? file[mode] ?? "[[snapshot missing]]\n"),
      "",
    ]),
  ].join("\n");
}

function summarizeEvalSummary(summary) {
  const compact = {};
  for (const key of ["评估规模", "推理强度", "计划样本数", "汇总"]) {
    if (summary[key] !== undefined) {
      compact[key] = summary[key];
    }
  }
  return compact;
}

function inferModesFromSummary(summary) {
  const aggregate = summary?.汇总 ?? {};
  const modes = Object.keys(aggregate).filter((key) => key !== "案例数");
  return modes.length ? modes : defaultModes;
}

function modeLabel(mode) {
  return labeledModes[mode] ?? mode;
}

function fencedJson(value) {
  return fenced("json", `${JSON.stringify(value, null, 2)}\n`);
}

function fenced(language, value) {
  return [`\`\`\`${language ?? ""}`, value.trimEnd(), "```"].join("\n");
}

function truncate(value, maxChars) {
  if (!Number.isFinite(maxChars) || value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n[[truncated ${value.length - maxChars} chars]]\n`;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function prepareReviewCodexHome(codexHome, workdir, reasoningEffort) {
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  await cp(path.join(os.homedir(), ".codex", "auth.json"), path.join(codexHome, "auth.json"));
  await cp(path.join(os.homedir(), ".codex", "installation_id"), path.join(codexHome, "installation_id"));
  await writeFile(
    path.join(codexHome, "config.toml"),
    renderCodexConfig(workdir, reasoningEffort),
    { mode: 0o600 },
  );
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
