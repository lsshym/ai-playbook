#!/usr/bin/env node

import {
  execFileWithInput,
  parseArgs as parseSharedArgs,
  parseCasesFromMarkdownTable,
  renderCodexConfig,
  resolveSkillBundle as resolveSkillBundleForEval,
} from "../_shared/skill-eval-runner.mjs";
import {
  access,
  cp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export {
  execFileWithInput,
  renderCodexConfig,
} from "../_shared/skill-eval-runner.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const casesPath = path.join(repoRoot, "skill-evals", "align-contracts-heavy", "cases.zh-CN.md");
const defaultResultsRoot = path.join(repoRoot, ".eval-runs", "align-contracts-heavy");
const cleanCodexHome = path.join(os.tmpdir(), "wingman-align-baseline-codex-home");
const cleanWorkdirRoot = path.join(os.tmpdir(), "wingman-align-clean-workdirs");

const skillReferenceMap = {
  "align-contracts": {
    "react-typescript": ["references/frontend-react-typescript.md"],
  },
};
const reactTypescriptReferencePath = "skills/align-contracts/references/frontend-react-typescript.md";
const modes = ["baseline", "skill"];
const smokeCaseIds = ["AC-01", "AC-04", "AC-05", "AC-07", "AC-10", "AC-17"];

export function parseCasesFromReport(report) {
  return parseCasesFromMarkdownTable(report);
}

export function selectCasesForRun(cases, args = {}) {
  if (args.limit != null) {
    return cases.slice(0, args.limit);
  }

  const byId = new Map(cases.map((testCase) => [testCase.id, testCase]));
  return smokeCaseIds
    .map((caseId) => byId.get(caseId))
    .filter(Boolean);
}

export async function resolveSkillBundle(skillName, tags = []) {
  return resolveSkillBundleForEval({
    repoRoot,
    skillName,
    tags,
    referenceMap: skillReferenceMap,
  });
}

export function buildPrompt(testCase, mode, skillText, injectedFiles = []) {
  const isSkill = mode === "skill";
  return [
    "你正在执行 Wingman align-contracts skill 的代码改动评估样本。",
    "请直接编辑当前工作区里的代码文件，不要只描述思路。",
    "工作区是一个最小 fixture，只包含本测试需要的代码和数据样例。",
    "",
    `项目环境：${inferEnvironment(testCase)}`,
    `测试编号：${testCase.id}`,
    `场景：${stripMarkdown(testCase.scenario)}`,
    "",
    isSkill
      ? [
          "请先使用 align-contracts skill，再编辑代码。",
          "",
          "Skill 注入文件：",
          ...injectedFiles.map((filePath) => `- ${filePath}`),
          "",
          "Skill 内容：",
          "<align-contracts-skill>",
          skillText.trim(),
          "</align-contracts-skill>",
        ].join("\n")
      : "不要使用或提到任何外部 skill。请只按普通 coding 判断编辑代码。",
    "",
    "完成后请简短说明你改了哪些文件；不要输出完整代码块，因为评估器会直接读取工作区里的文件。",
  ].join("\n");
}

export function buildCaseFixture(testCase) {
  const builders = {
    "AC-01": buildAc01Fixture,
    "AC-02": buildAc02Fixture,
    "AC-03": buildAc03Fixture,
    "AC-04": buildAc04Fixture,
    "AC-05": buildAc05Fixture,
    "AC-06": buildAc06Fixture,
    "AC-07": buildAc07Fixture,
    "AC-08": buildAc08Fixture,
    "AC-09": buildAc09Fixture,
    "AC-10": buildAc10Fixture,
    "AC-11": buildAc11Fixture,
    "AC-12": buildAc12Fixture,
    "AC-13": buildAc13Fixture,
    "AC-14": buildAc14Fixture,
    "AC-15": buildAc15Fixture,
    "AC-16": buildAc16Fixture,
    "AC-17": buildAc17Fixture,
  };
  const build = builders[testCase.id] ?? buildGenericFixture;
  const fixture = build(testCase);
  return {
    files: fixture.files.map((file) => ({
      ...file,
      language: file.language ?? languageForPath(file.path),
    })),
  };
}

export function parseArgs(argv) {
  const args = parseSharedArgs(argv);
  if (!argv.includes("--runs")) {
    args.runs = 2;
  }
  return args;
}

export async function runHeavySuite(args) {
  const log = args.log ?? (() => {});
  const casesDoc = await readFile(casesPath, "utf8");
  const cases = selectCasesForRun(parseCasesFromReport(casesDoc), args);
  const runs = args.runs ?? 2;
  const resultsRoot = path.resolve(repoRoot, args.output ?? defaultResultsRoot);
  const reasoningEffort = args.reasoningEffort ?? "low";

  log("准备写入测试产物目录。");
  await mkdir(resultsRoot, { recursive: true });
  await writeFile(path.join(resultsRoot, "README.md"), resultsReadme);

  if (!args.dryRun) {
    await prepareCleanCodexHome(reasoningEffort);
  }

  const summary = [];
  const comparisons = [];
  let planned = 0;

  for (const testCase of cases) {
    const fixture = buildCaseFixture(testCase);
    await writeOriginalComparisonFiles({ resultsRoot, testCase, fixture });

    for (const mode of modes) {
      const skillBundle = mode === "skill"
        ? await resolveSkillBundle("align-contracts", testCase.tags)
        : { text: "", files: [] };
      const injectedFiles = skillBundle.files.map((file) => file.path);
      const prompt = buildPrompt(testCase, mode, skillBundle.text, injectedFiles);
      const promptPath = path.join(resultsRoot, "prompts", testCase.id, `${mode}.txt`);
      await mkdir(path.dirname(promptPath), { recursive: true });
      await writeFile(promptPath, prompt);

      for (let run = 1; run <= runs; run += 1) {
        planned += 1;
        const outputPath = path.join(resultsRoot, "outputs", testCase.id, `${mode}-${run}.md`);
        await mkdir(path.dirname(outputPath), { recursive: true });

        if (args.dryRun) {
          log(`计划：${testCase.id} ${mode} 第 ${run}/${runs} 次。`);
          summary.push(buildSampleSummary({ testCase, mode, run, status: "planned", injectedFiles }));
          continue;
        }

        const workdir = sampleWorkdir(testCase.id, mode, run);
        const snapshotRoot = path.join(resultsRoot, "comparisons", testCase.id, `${mode}-${run}`);
        let status = "completed";
        let output = "";

        if (args.resume && (await exists(outputPath)) && (await exists(snapshotRoot))) {
          log(`复用：${testCase.id} ${mode} 第 ${run}/${runs} 次，输出和代码快照已存在。`);
          output = await readFile(outputPath, "utf8");
          status = "existing";
        } else {
          log(`开始：${testCase.id} ${mode} 第 ${run}/${runs} 次，正在调用 Codex。`);
          await prepareSampleWorkdir(workdir, fixture);
          await runCodex({ prompt, outputPath, workdir, reasoningEffort });
          await copySnapshot({ workdir, snapshotRoot, fixture });
          output = await readFile(outputPath, "utf8");
          log(`完成：${testCase.id} ${mode} 第 ${run}/${runs} 次。`);
        }

        const snapshots = await collectSnapshots({
          resultsRoot,
          testCase,
          mode,
          run,
          fixture,
          snapshotRoot,
        });
        summary.push(buildSampleSummary({
          testCase,
          mode,
          run,
          status,
          output,
          injectedFiles,
          codeSnapshots: snapshots,
        }));
      }
    }

    const caseComparison = buildCaseComparison({ resultsRoot, testCase, fixture, samples: summary });
    comparisons.push(caseComparison);
    await writeCaseComparisonJson(resultsRoot, caseComparison);
  }

  const aggregate = aggregateSummary(summary);
  await writeFile(
    path.join(resultsRoot, "summary.json"),
    `${JSON.stringify({
      评估规模: args.limit == null ? "smoke" : "custom-limit",
      推理强度: reasoningEffort,
      计划样本数: planned,
      汇总: aggregate,
      样本: summary,
    }, null, 2)}\n`,
  );
  await writeFile(
    path.join(resultsRoot, "comparison.json"),
    `${JSON.stringify({ 计划样本数: planned, cases: comparisons }, null, 2)}\n`,
  );
  const aggregateReport = formatAggregateReport(aggregate);
  await writeFile(path.join(resultsRoot, "summary.md"), `${aggregateReport}\n`);
  await writeFile(path.join(resultsRoot, "report.html"), formatHtmlReport({ aggregate, planned, samples: summary }));
  log("写入 summary.json 和 comparison.json 完成。");

  return {
    planned,
    aggregate,
    consoleSummary: formatConsoleSummary(aggregate),
    report: aggregateReport,
    samples: summary,
    resultsRoot,
  };
}

export function aggregateSummary(samples) {
  const aggregate = {
    案例数: new Set(samples.map((sample) => sample.测试编号)).size,
  };
  for (const mode of modes) {
    const modeSamples = samples.filter((sample) => sample.模式 === mode);
    aggregate[mode] = {
      样本数: modeSamples.length,
      已完成: modeSamples.filter((sample) => sample.状态 === "已完成" || sample.状态 === "已存在").length,
      已计划: modeSamples.filter((sample) => sample.状态 === "已计划").length,
      代码快照数: modeSamples.reduce((sum, sample) => sum + (sample.代码快照?.length ?? 0), 0),
    };
  }
  return aggregate;
}

export function formatAggregateReport(aggregate) {
  return [
    "## 总览",
    "",
    "| 模式 | 样本数 | 已完成 | 已计划 | 代码快照 |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...modes.map((mode) => {
      const row = aggregate[mode] ?? { 样本数: 0, 已完成: 0, 已计划: 0, 代码快照数: 0 };
      return `| ${mode} | ${row.样本数} | ${row.已完成} | ${row.已计划} | ${row.代码快照数} |`;
    }),
    "",
    "请用 `comparison.json` 或 `report.html` 人工审查 original / baseline / skill 的真实代码改动。",
  ].join("\n");
}

export function formatConsoleSummary(aggregate) {
  return modes
    .map((mode) => {
      const row = aggregate[mode] ?? { 样本数: 0, 已完成: 0, 代码快照数: 0 };
      return `${mode}：样本 ${row.样本数}，已完成 ${row.已完成}，代码快照 ${row.代码快照数}`;
    })
    .join("\n");
}

export function formatHtmlReport({ aggregate, planned, samples }) {
  const groups = groupSamplesByCase(samples);
  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>align-contracts 代码对比评估报告</title>",
    "<style>",
    "body{margin:0;background:#fafafa;color:#1f2933;font:14px/1.55 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}",
    "main{max-width:1440px;margin:0 auto;padding:32px 24px 56px}",
    "h1{font-size:26px;margin:0 0 6px}h2{font-size:19px;margin:30px 0 10px}h3{font-size:16px;margin:20px 0 8px}h4{margin:14px 0 8px}",
    ".muted{color:#667085}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}",
    "table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d0d5dd;margin:10px 0 18px}",
    "th,td{border-top:1px solid #eaecf0;padding:8px 10px;text-align:left;vertical-align:top}th{background:#f2f4f7;font-weight:700}",
    ".sample{background:#fff;border:1px solid #d0d5dd;border-radius:6px;margin:14px 0 18px;padding:14px}",
    ".sample-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px;border-bottom:1px solid #eaecf0;padding-bottom:8px;margin-bottom:10px}",
    ".grid{display:grid;grid-template-columns:160px minmax(0,1fr);gap:6px 12px;margin:8px 0}.key{color:#667085;font-weight:700}",
    ".code-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.input-grid{grid-template-columns:minmax(0,1fr)}",
    ".code-pane{border:1px solid #d0d5dd;border-radius:6px;min-width:0;background:#fff}",
    ".code-title{padding:8px 10px;border-bottom:1px solid #eaecf0;background:#f9fafb;font-weight:700}",
    "pre{margin:0;padding:10px;white-space:pre;overflow:auto;max-height:520px;background:#fff}",
    "details{margin-top:8px}summary{cursor:pointer;font-weight:700}.path{color:#475467}",
    "</style>",
    "</head>",
    "<body><main>",
    "<h1>align-contracts 代码对比评估报告</h1>",
    `<p class="muted">计划样本数 ${planned}。本报告只展示原始 fixture、baseline 改动结果和 skill 改动结果。</p>`,
    "<h2>结果总览</h2>",
    renderModeSummaryTable(aggregate),
    "<h2>逐 case 代码对比</h2>",
    ...groups.map((group) => renderCaseComparison(group)),
    "</main></body></html>",
  ].join("\n");
}

function renderModeSummaryTable(aggregate) {
  const rows = modes.map((mode) => {
    const row = aggregate[mode] ?? { 样本数: 0, 已完成: 0, 已计划: 0, 代码快照数: 0 };
    return [
      "<tr>",
      `<td>${escapeHtml(mode)}</td>`,
      `<td>${row.样本数}</td>`,
      `<td>${row.已完成}</td>`,
      `<td>${row.已计划}</td>`,
      `<td>${row.代码快照数}</td>`,
      "</tr>",
    ].join("");
  });
  return [
    "<table>",
    "<thead><tr><th>模式</th><th>样本数</th><th>已完成</th><th>已计划</th><th>代码快照</th></tr></thead>",
    `<tbody>${rows.join("")}</tbody>`,
    "</table>",
  ].join("");
}

function renderCaseComparison(group) {
  return [
    `<article class="sample" id="${escapeHtml(anchorId(group.id))}">`,
    '<div class="sample-head">',
    `<h3>${escapeHtml(group.id)} · Run ${escapeHtml(group.run)}</h3>`,
    `<div class="muted">${escapeHtml(group.scenario)}</div>`,
    "</div>",
    '<div class="grid">',
    '<div class="key">环境标签</div>',
    `<div>${escapeHtml(formatTags(group.tags))}</div>`,
    '<div class="key">测试目的</div>',
    `<div>${escapeHtml(group.validation || "未提供测试目的。")}</div>`,
    '<div class="key">常见错误</div>',
    `<div>${escapeHtml(group.baselineRisk || "未提供常见错误。")}</div>`,
    '<div class="key">期待好改法</div>',
    `<div>${escapeHtml(group.skillExpected || "未提供期待好改法。")}</div>`,
    '<div class="key">Skill 注入文件</div>',
    `<div>${escapeHtml(formatInjectedFiles(group.samples.skill))}</div>`,
    "</div>",
    ...renderCodeComparisons(group),
    "</article>",
  ].join("");
}

function renderCodeComparisons(group) {
  const files = new Map();
  for (const sample of Object.values(group.samples)) {
    for (const snapshot of sample.代码快照 ?? []) {
      files.set(snapshot.path, {
        path: snapshot.path,
        language: snapshot.language,
        role: snapshot.role,
        original: snapshot.original,
        baseline: files.get(snapshot.path)?.baseline,
        skill: files.get(snapshot.path)?.skill,
        [sample.模式]: snapshot.current,
      });
    }
  }
  if (!files.size) return ['<p class="muted">这个 case 还没有代码快照。</p>'];
  return [...files.values()].map((file) => [
    `<h4><span class="path mono">${escapeHtml(file.path)}</span></h4>`,
    renderFileCode(file),
  ].join(""));
}

function renderFileCode(file) {
  const hasChanged = file.baseline !== file.original || file.skill !== file.original;
  if (file.role === "input" && !hasChanged) {
    return [
      '<div class="code-grid input-grid">',
      renderCodePane("输入材料", file.original),
      "</div>",
    ].join("");
  }
  if (file.role === "input" && hasChanged) {
    return [
      '<p class="muted">输入材料被修改，请检查 agent 是否改动了 provider 样例。</p>',
      '<div class="code-grid">',
      renderCodePane("Original 输入材料", file.original),
      renderCodePane("Baseline", file.baseline ?? "没有 baseline 快照。"),
      renderCodePane("Skill", file.skill ?? "没有 skill 快照。"),
      "</div>",
    ].join("");
  }
  if (file.baseline === file.original && file.skill === file.original) {
    return [
      '<div class="code-grid input-grid">',
      renderCodePane("未变化文件", file.original),
      "</div>",
    ].join("");
  }
  return [
    '<div class="code-grid">',
    renderCodePane("Original", file.original),
    renderCodePane("Baseline", file.baseline ?? "没有 baseline 快照。"),
    renderCodePane("Skill", file.skill ?? "没有 skill 快照。"),
    "</div>",
  ].join("");
}

function renderCodePane(title, code) {
  return [
    '<section class="code-pane">',
    `<div class="code-title">${escapeHtml(title)}</div>`,
    `<pre><code>${escapeHtml(code)}</code></pre>`,
    "</section>",
  ].join("");
}

function groupSamplesByCase(samples) {
  const groups = new Map();
  for (const sample of samples) {
    const key = `${sample.测试编号}:${sample.第几次运行}`;
    if (!groups.has(key)) {
      groups.set(key, {
        id: sample.测试编号,
        run: sample.第几次运行,
        tags: sample.环境标签 ?? [],
        scenario: sample.场景 ?? "",
        validation: sample.主要验证点 ?? "",
        baselineRisk: sample.Baseline风险 ?? "",
        skillExpected: sample.Skill预期 ?? "",
        samples: {},
      });
    }
    groups.get(key).samples[sample.模式] = sample;
  }
  return [...groups.values()];
}

function buildCaseComparison({ resultsRoot, testCase, fixture, samples }) {
  const caseSamples = samples.filter((sample) => sample.测试编号 === testCase.id);
  const runs = [...new Set(caseSamples.map((sample) => sample.第几次运行))].sort((left, right) => left - right);
  const runComparisons = runs.map((run) => {
    const byMode = Object.fromEntries(
      caseSamples
        .filter((sample) => sample.第几次运行 === run)
        .map((sample) => [sample.模式, sample]),
    );
    return {
      run,
      files: fixture.files.map((file) => {
        const baseline = byMode.baseline?.代码快照?.find((snapshot) => snapshot.path === file.path);
        const skill = byMode.skill?.代码快照?.find((snapshot) => snapshot.path === file.path);
        return {
          path: file.path,
          language: file.language,
          role: file.role ?? "editable",
          originalPath: relativeTo(resultsRoot, originalSnapshotPath(resultsRoot, testCase.id, file.path)),
          baselinePath: baseline?.currentPath,
          skillPath: skill?.currentPath,
        };
      }),
    };
  });
  return {
    caseId: testCase.id,
    tags: testCase.tags ?? [],
    scenario: stripMarkdown(testCase.scenario),
    validation: stripMarkdown(testCase.validation),
    baselineRisk: stripMarkdown(testCase.baselineRisk),
    skillExpected: stripMarkdown(testCase.skillExpected),
    runs: runComparisons,
    files: fixture.files.map((file) => {
      const firstRun = runComparisons[0];
      const firstFile = firstRun?.files.find((runFile) => runFile.path === file.path);
      return {
        path: file.path,
        language: file.language,
        role: file.role ?? "editable",
        originalPath: relativeTo(resultsRoot, originalSnapshotPath(resultsRoot, testCase.id, file.path)),
        baselinePath: firstFile?.baselinePath,
        skillPath: firstFile?.skillPath,
      };
    }),
  };
}

async function writeCaseComparisonJson(resultsRoot, comparison) {
  const filePath = path.join(resultsRoot, "comparisons", comparison.caseId, "comparison.json");
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(comparison, null, 2)}\n`);
}

async function writeOriginalComparisonFiles({ resultsRoot, testCase, fixture }) {
  for (const file of fixture.files) {
    const target = originalSnapshotPath(resultsRoot, testCase.id, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
}

async function prepareSampleWorkdir(workdir, fixture) {
  await rm(workdir, { recursive: true, force: true });
  await mkdir(workdir, { recursive: true });
  await writeFile(
    path.join(workdir, "README.md"),
    [
      "# Temporary align-contracts eval fixture",
      "",
      "Edit the code files in this workspace to satisfy the task prompt.",
      "",
    ].join("\n"),
  );
  await writeFile(path.join(workdir, "package.json"), JSON.stringify({ type: "module" }, null, 2));
  for (const file of fixture.files) {
    const target = path.join(workdir, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
}

async function runCodex({ prompt, outputPath, workdir, reasoningEffort }) {
  const env = { ...process.env, CODEX_HOME: cleanCodexHome };
  await writeFile(
    path.join(cleanCodexHome, "config.toml"),
    renderCodexConfig(workdir, reasoningEffort),
    { mode: 0o600 },
  );
  await execFileWithInput("codex", buildWritableCodexExecArgs(workdir, outputPath), {
    env,
    input: prompt,
    maxBuffer: 1024 * 1024 * 20,
    timeout: 1000 * 60 * 8,
  });
}

function buildWritableCodexExecArgs(workdir, outputPath) {
  return [
    "exec",
    "--cd",
    workdir,
    "--skip-git-repo-check",
    "--sandbox",
    "workspace-write",
    "--ephemeral",
    "-o",
    outputPath,
    "-",
  ];
}

async function prepareCleanCodexHome(reasoningEffort) {
  await mkdir(cleanCodexHome, { recursive: true, mode: 0o700 });
  await cp(path.join(os.homedir(), ".codex", "auth.json"), path.join(cleanCodexHome, "auth.json"));
  await cp(path.join(os.homedir(), ".codex", "installation_id"), path.join(cleanCodexHome, "installation_id"));
  await writeFile(
    path.join(cleanCodexHome, "config.toml"),
    renderCodexConfig(cleanWorkdirRoot, reasoningEffort),
    { mode: 0o600 },
  );
}

async function copySnapshot({ workdir, snapshotRoot, fixture }) {
  await rm(snapshotRoot, { recursive: true, force: true });
  for (const file of fixture.files) {
    const source = path.join(workdir, file.path);
    const target = path.join(snapshotRoot, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target);
  }
}

async function collectSnapshots({ resultsRoot, testCase, mode, run, fixture, snapshotRoot }) {
  const snapshots = [];
  for (const file of fixture.files) {
    const originalPath = originalSnapshotPath(resultsRoot, testCase.id, file.path);
    const currentPath = path.join(snapshotRoot, file.path);
    snapshots.push({
      path: file.path,
      language: file.language,
      role: file.role ?? "editable",
      originalPath: relativeTo(resultsRoot, originalPath),
      currentPath: relativeTo(resultsRoot, currentPath),
      mode,
      run,
      original: await readFile(originalPath, "utf8"),
      current: await readFile(currentPath, "utf8"),
    });
  }
  return snapshots;
}

function buildSampleSummary({ testCase, mode, run, status, output = "", injectedFiles = [], codeSnapshots }) {
  const row = {
    测试编号: testCase.id,
    环境标签: testCase.tags ?? [],
    ReactTS分支: describeReactTsBranch(testCase, mode, injectedFiles),
    场景: stripMarkdown(testCase.scenario),
    主要验证点: stripMarkdown(testCase.validation),
    Baseline风险: stripMarkdown(testCase.baselineRisk),
    Skill预期: stripMarkdown(testCase.skillExpected),
    Skill注入文件: injectedFiles,
    模式: mode,
    第几次运行: run,
    状态: translateStatus(status),
  };
  if (output) {
    row.输出摘录 = summarizeOutput(output);
    row.原始输出 = output;
  }
  if (codeSnapshots?.length) {
    row.代码快照 = codeSnapshots;
  }
  return row;
}

function describeReactTsBranch(testCase, mode, injectedFiles = []) {
  if (mode !== "skill") return "baseline 不注入 skill。";
  const needsReactTs = (testCase.tags ?? []).includes("react-typescript");
  const hasReactTsReference = injectedFiles.includes(reactTypescriptReferencePath);
  if (needsReactTs && hasReactTsReference) return "已命中 React/TS 参考。";
  if (needsReactTs) return "未命中 React/TS 参考。";
  if (hasReactTsReference) return "误注入 React/TS 参考。";
  return "无需命中 React/TS 参考。";
}

function originalSnapshotPath(resultsRoot, caseId, filePath) {
  return path.join(resultsRoot, "comparisons", caseId, "original", filePath);
}

function sampleWorkdir(caseId, mode, run) {
  return path.join(cleanWorkdirRoot, caseId, `${mode}-${run}`);
}

function relativeTo(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function translateStatus(status) {
  return {
    planned: "已计划",
    existing: "已存在",
    completed: "已完成",
  }[status] ?? status;
}

function summarizeOutput(output) {
  return truncateExcerpt(output.replace(/\s+/g, " ").trim(), 420);
}

function truncateExcerpt(value, maxLength = 220) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}...`;
}

function stripMarkdown(value = "") {
  return value.replace(/`/g, "");
}

function formatTags(tags = []) {
  return tags.length ? tags.join(", ") : "generic";
}

function formatInjectedFiles(sample) {
  if (!sample) return "没有 skill 输出。";
  const files = sample.Skill注入文件 ?? [];
  return files.length ? files.join("\n") : "baseline 未注入 skill。";
}

function anchorId(value) {
  return `case-${String(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "-")}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function languageForPath(filePath) {
  const ext = path.extname(filePath).slice(1);
  return ext === "ts" ? "typescript" : ext || "text";
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function inferEnvironment(testCase) {
  const tags = testCase.tags ?? [];
  if (tags.includes("react-typescript")) return "现有 TypeScript/React 项目";
  if (tags.includes("db")) return "带数据库/repository 层的 TypeScript 服务";
  if (tags.includes("webhook")) return "Node.js webhook/event handler 项目";
  if (tags.includes("sdk")) return "集成外部 SDK 的 TypeScript 服务";
  if (tags.includes("ai-schema")) return "TypeScript tool/schema 校验项目";
  if (tags.includes("api")) return "对外或内部 API 契约项目";
  return "现有项目";
}

const resultsReadme = [
  "# align-contracts 代码对比评估输出",
  "",
  "这个目录由 `npm run eval:align-contracts` 或 `skill-evals/align-contracts-heavy/runner.mjs` 生成。",
  "",
  "## 目录说明",
  "",
  "- `prompts/`: 每个 case、每个模式实际发送给 Codex 的 prompt。",
  "- `outputs/`: Codex 返回的文字说明，按 case、模式和第几次运行保存。",
  "- `comparisons/`: original、baseline、skill 的真实代码快照。",
  "- `comparison.json`: 面向机器读取的代码快照索引。",
  "- `report.html`: 面向人工审核的三栏代码对比报告。",
  "- `summary.json`: 样本状态摘要。",
  "",
].join("\n");

function buildAc01Fixture() {
  return {
    files: [
      {
        path: "src/OrderSummary.tsx",
        language: "tsx",
        content: tsx(`type ApiOrder = {
  id: string;
  amount: {
    total_minor_units: number;
  };
};

type MoneyProps = {
  totalCents: number;
};

function Money({ totalCents }: MoneyProps) {
  return <span>{(totalCents / 100).toFixed(2)}</span>;
}

export function OrderSummary({ order }: { order: ApiOrder }) {
  return <Money totalCents={order.totalCents} />;
}
`),
      },
      {
        path: "fixtures/订单响应.json",
        language: "json",
        role: "input",
        content: json({
          id: "ord_123",
          amount: { total_minor_units: 1299 },
        }),
      },
    ],
  };
}

function buildAc02Fixture() {
  return reactFixture("PriceLabel.tsx", `type ApiProduct = {
  price: {
    amount: number;
    currency: string;
  };
};

export function PriceLabel({ product }: { product: ApiProduct }) {
  return <span>{product.price.amount}</span>;
}
`);
}

function buildAc03Fixture() {
  return reactFixture("UserName.tsx", `type ApiUser = {
  user_name: string;
};

export function UserName({ user }: { user: ApiUser }) {
  return <span>{user.userName}</span>;
}
`);
}

function buildAc04Fixture() {
  return reactFixture("CheckoutBadge.tsx", `type ApiCheckout = {
  status: "paid" | "pending" | "failed";
};

type CheckoutType = "guest" | "express" | "standard";

export function toCheckoutType(checkout: ApiCheckout): CheckoutType {
  return checkout.status;
}
`);
}

function buildAc05Fixture() {
  return reactFixture("UserCard.tsx", `type ApiUser = {
  name: string;
};

type UserCardProps = {
  name: string;
  avatarUrl: string;
};

function UserCard({ name, avatarUrl }: UserCardProps) {
  return <img src={avatarUrl} alt={name} />;
}

export function UserCardFromApi({ user }: { user: ApiUser }) {
  return <UserCard name={user.name} avatarUrl={user.avatarUrl} />;
}
`);
}

function buildAc06Fixture() {
  return reactFixture("ItemList.tsx", `type ApiItem = {
  name: string;
};

type Item = {
  id: string;
  name: string;
};

function mapItem(item: ApiItem): Item {
  return {
    id: item.id,
    name: item.name,
  };
}

export function ItemList({ items }: { items: ApiItem[] }) {
  return <ul>{items.map((item) => {
    const mapped = mapItem(item);
    return <li key={mapped.id}>{mapped.name}</li>;
  })}</ul>;
}
`);
}

function buildAc07Fixture() {
  return reactFixture("ProductPrice.tsx", `type ApiProduct = {
  priceInCents: number;
};

export function ProductPrice({ product }: { product: ApiProduct }) {
  return <span>{"$" + product.priceInCents.toFixed(2)}</span>;
}
`);
}

function buildAc08Fixture() {
  return reactFixture("SearchResults.tsx", `type Item = { id: string; label: string };

type ApiResponse = {
  data: Item[];
  pageInfo: {
    page: number;
    hasNextPage: boolean;
  };
};

export function SearchResults({ response }: { response: ApiResponse }) {
  const items = response.items;
  return <ul>{items.map((item) => <li key={item.id}>{item.label}</li>)}</ul>;
}
`);
}

function buildAc09Fixture() {
  return reactFixture("Tags.tsx", `type ApiItem = {
  name: string;
  tags?: string[];
};

export function Tags({ item }: { item: ApiItem }) {
  const tags = item.tags ?? [];
  return <div>{tags.map((tag) => <span key={tag}>{tag}</span>)}</div>;
}
`);
}

function buildAc10Fixture() {
  return reactFixture("ProfileForm.tsx", `type FormState = {
  firstName: string;
  lastName: string;
};

type CreateProfileRequest = {
  full_name: string;
};

export function handleSubmit(form: FormState, submit: (request: CreateProfileRequest) => void) {
  submit({
    firstName: form.firstName,
    lastName: form.lastName,
  });
}
`);
}

function buildAc11Fixture() {
  return reactFixture("SettingsForm.tsx", `type FormState = {
  name: string;
  email: string;
  isDirty: boolean;
};

export function submitSettings(form: FormState, post: (body: Record<string, unknown>) => void) {
  post({ ...form });
}
`);
}

function buildAc12Fixture() {
  return {
    files: [{
      path: "src/userRepository.ts",
      language: "ts",
      content: ts(`type UserRow = {
  user_id: string;
  created_at: string;
  display_name: string;
};

type User = {
  userId: string;
  createdAt: string;
  displayName: string;
};

export function loadUser(row: UserRow): User {
  return row;
}
`),
    }],
  };
}

function buildAc13Fixture() {
  return {
    files: [{
      path: "src/webhook.ts",
      language: "ts",
      content: ts(`type WebhookPayload = {
  type: string;
  data: unknown;
};

export function getEventType(payload: WebhookPayload) {
  return payload.event_type;
}
`),
    }],
  };
}

function buildAc14Fixture() {
  return {
    files: [{
      path: "src/sdkAdapter.ts",
      language: "ts",
      content: ts(`type CheckoutSession = {
  amount_total: number;
};

type Payment = {
  totalCents: number;
};

export function toPayment(session: CheckoutSession): Payment {
  return session;
}
`),
    }],
  };
}

function buildAc15Fixture() {
  return {
    files: [{
      path: "src/toolSchema.ts",
      language: "ts",
      content: ts(`type ToolArgs = {
  id: string;
  action: string;
};

export function bindToolArgs(output: Partial<ToolArgs>): ToolArgs {
  return {
    id: output.id ?? "0",
    action: output.action ?? "unknown",
  };
}
`),
    }],
  };
}

function buildAc16Fixture() {
  return {
    files: [{
      path: "src/publicApi.ts",
      language: "ts",
      content: ts(`type InternalUser = {
  displayName: string;
};

export function serializeUser(user: InternalUser) {
  return {
    name: user.displayName,
  };
}
`),
    }],
  };
}

function buildAc17Fixture() {
  return reactFixture("ProfilePanel.tsx", `import "./ProfilePanel.css";

type ApiProfile = {
  display_name: string;
};

export function ProfilePanel({ profile }: { profile: ApiProfile }) {
  return <section className="profile-panel"><h2>{profile.displayName}</h2></section>;
}
`);
}

function buildGenericFixture(testCase) {
  return {
    files: [{
      path: "src/example.ts",
      language: "ts",
      content: ts(`export const scenario = ${JSON.stringify(stripMarkdown(testCase.scenario))};
`),
    }],
  };
}

function reactFixture(fileName, content) {
  return {
    files: [{
      path: `src/${fileName}`,
      language: "tsx",
      content: tsx(content),
    }],
  };
}

function ts(value) {
  return `${value.trim()}\n`;
}

function tsx(value) {
  return ts(value);
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function main() {
  const result = await runHeavySuite({
    ...parseArgs(process.argv.slice(2)),
    log: (message) => console.log(message),
  });

  console.log(`计划样本数：${result.planned}`);
  console.log(`结果目录：${result.resultsRoot}`);
  console.log(result.consoleSummary);
  console.log(`HTML 报告：${path.join(result.resultsRoot, "report.html")}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
