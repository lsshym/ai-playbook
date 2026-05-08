import {
  aggregateCodeSnapshotSummary,
  buildCodeSnapshotEvalPrompt,
  formatCodeSnapshotAggregateReport,
  formatCodeSnapshotConsoleSummary,
  formatCodeSnapshotHtmlReport,
  parseCodeSnapshotArgs,
  resolveCodeSnapshotSkillBundle,
  runCodeSnapshotEval,
  selectCodeSnapshotCases,
} from "./code-snapshot-eval.mjs";
import { parseStandardCases } from "./eval-standard.mjs";
import os from "node:os";
import path from "node:path";

const defaultModes = ["baseline", "skill"];

export async function loadEvalDefinition(repoRoot, evalName) {
  const evalDir = path.join(repoRoot, "skill-evals", evalName);
  const configModule = await import(pathToFileUrl(path.join(evalDir, "eval.config.mjs")));
  const fixturesModule = await import(pathToFileUrl(path.join(evalDir, configModule.default.fixtureModule)));
  return buildEvalDefinition({
    repoRoot,
    evalDir,
    config: configModule.default,
    fixtures: fixturesModule,
  });
}

export function buildEvalDefinition({ repoRoot, evalDir, config, fixtures }) {
  const evalName = config.evalName;
  const smokeCaseIds = config.smokeCaseIds ?? [];
  const defaultRuns = config.defaultRuns ?? 1;
  const referenceMap = config.referenceMap ?? {};
  const modes = config.modes ?? defaultModes;

  const evalConfig = {
    repoRoot,
    casesPath: path.join(evalDir, "cases.zh-CN.md"),
    defaultResultsRoot: path.join(repoRoot, ".eval-runs", evalName),
    cleanCodexHome: path.join(os.tmpdir(), `wingman-${evalName}-codex-home`),
    cleanWorkdirRoot: path.join(os.tmpdir(), `wingman-${evalName}-workdirs`),
    evalName,
    skillName: evalName,
    modes,
    defaultRuns,
    smokeCaseIds,
    referenceMap,
    parseCases: parseCasesFromReport,
    selectCases: (cases, args) => selectCasesForRun(cases, args, smokeCaseIds),
    buildFixture: fixtures.buildFixture,
    buildPrompt: (options) => buildPrompt({
      evalName,
      testCase: options.testCase,
      mode: options.mode,
      skillText: options.skillText,
      injectedFiles: options.injectedFiles,
      environment: inferEnvironment(options.testCase),
      promptInstructions: resolvePromptInstructions(config, options.testCase),
    }),
    resolveSkillBundle: (name, tags, testCase) => resolveSkillBundle({
      repoRoot,
      testCase,
      tags,
      referenceMap,
    }),
    buildSampleExtras: ({ testCase }) => ({
      目标Skill: testCase.skill,
    }),
    resultsReadme: buildResultsReadme(evalName),
  };

  return {
    evalName,
    parseCasesFromReport,
    selectCasesForRun: (cases, args = {}) => selectCasesForRun(cases, args, smokeCaseIds),
    buildPrompt: (testCase, mode, skillText = "", injectedFiles = []) => buildPrompt({
      evalName,
      testCase,
      mode,
      skillText,
      injectedFiles,
      environment: inferEnvironment(testCase),
      promptInstructions: resolvePromptInstructions(config, testCase),
    }),
    parseArgs: (argv) => parseCodeSnapshotArgs(argv, { defaultRuns }),
    aggregateSummary: (samples) => aggregateCodeSnapshotSummary(samples, modes),
    formatAggregateReport: (aggregate) => formatCodeSnapshotAggregateReport(aggregate, modes),
    formatConsoleSummary: (aggregate) => formatCodeSnapshotConsoleSummary(aggregate, modes),
    formatHtmlReport: ({ aggregate, planned, samples }) => formatCodeSnapshotHtmlReport({
      title: `${evalName} 代码对比评估报告`,
      aggregate,
      planned,
      samples,
      modes,
    }),
    run: (args) => runCodeSnapshotEval(evalConfig, args),
    config: evalConfig,
  };
}

function resolvePromptInstructions(config, testCase) {
  if (typeof config.promptInstructions === "function") {
    return config.promptInstructions(testCase);
  }
  return config.promptInstructions ?? [];
}

export function parseCasesFromReport(report) {
  return parseStandardCases(report);
}

export function selectCasesForRun(cases, args = {}, smokeCaseIds = []) {
  if (smokeCaseIds.length) {
    return selectCodeSnapshotCases(cases, args, smokeCaseIds);
  }
  return selectCodeSnapshotCases(cases, args, cases.map((testCase) => testCase.id));
}

export async function resolveSkillBundle({ repoRoot, testCase, tags = [], referenceMap = {} }) {
  return resolveCodeSnapshotSkillBundle({
    repoRoot,
    skillName: testCase.skill,
    tags,
    referenceMap,
  });
}

export function buildPrompt({
  evalName,
  testCase,
  mode,
  skillText = "",
  injectedFiles = [],
  environment = "现有项目",
  promptInstructions = [],
}) {
  const prompt = buildCodeSnapshotEvalPrompt({
    evalName: `Wingman ${evalName} skill`,
    skillName: testCase.skill,
    testCase,
    mode,
    skillText,
    injectedFiles,
    environment,
  }).replace("请直接编辑当前工作区里的代码文件", "请直接编辑当前工作区里的文件");

  if (!promptInstructions.length) return prompt;
  return [
    prompt,
    "",
    ...promptInstructions,
  ].join("\n");
}

function inferEnvironment(testCase) {
  const tags = testCase.tags ?? [];
  if (testCase.skill?.startsWith("memory-")) return "Wingman memory eval fixture";
  if (tags.includes("react-typescript")) return "现有 TypeScript/React 项目";
  if (tags.includes("api")) return "API 契约项目";
  if (tags.includes("domain")) return "带 domain model 的项目";
  return "现有项目";
}

function buildResultsReadme(evalName) {
  return [
    `# ${evalName} 评估输出`,
    "",
    `这个目录由 \`npm run eval -- ${evalName}\` 生成。`,
    "",
    "## 目录说明",
    "",
    "- `prompts/`: 每个 case、每个模式实际发送给 Codex 的 prompt。",
    "- `outputs/`: Codex 返回的文字说明，按 case、模式和第几次运行保存。",
    "- `comparisons/`: original 和各运行模式的真实文件快照。",
    "- `comparison.json`: 面向机器读取的文件快照索引。",
    "- `report.html`: 面向人工审核的 Original + 当前运行模式文件对比报告。",
    "- `summary.json`: 样本状态摘要。",
    "",
  ].join("\n");
}

function pathToFileUrl(filePath) {
  return `file://${filePath.split(path.sep).map(encodeURIComponent).join("/")}`;
}
