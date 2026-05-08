import {
  execFileWithInput,
  parseArgs as parseSharedArgs,
  parseCasesFromMarkdownTable,
  renderCodexConfig,
  resolveSkillBundle as resolveSkillBundleForEval,
} from "./skill-eval-runner.mjs";
import {
  access,
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export {
  execFileWithInput,
  renderCodexConfig,
} from "./skill-eval-runner.mjs";

const defaultModes = ["baseline", "skill"];
const labeledModes = {
  baseline: "Baseline",
  skill: "Skill",
};

export function parseCodeSnapshotArgs(argv, { defaultRuns = 2 } = {}) {
  const sharedArgv = [];
  const caseIds = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--case") {
      caseIds.push(argv[index + 1]);
      index += 1;
    } else if (arg === "--cases") {
      caseIds.push(...argv[index + 1].split(",").map((id) => id.trim()).filter(Boolean));
      index += 1;
    } else {
      sharedArgv.push(arg);
    }
  }

  const args = parseSharedArgs(sharedArgv);
  args.caseIds = caseIds;

  if (!argv.includes("--runs")) {
    args.runs = defaultRuns;
  }
  return args;
}

export function selectCodeSnapshotCases(cases, args = {}, smokeCaseIds = []) {
  if (args.caseIds?.length) {
    const byId = new Map(cases.map((testCase) => [testCase.id, testCase]));
    return args.caseIds.map((caseId) => {
      const testCase = byId.get(caseId);
      if (!testCase) {
        throw new Error(`未知 case：${caseId}`);
      }
      return testCase;
    });
  }

  if (args.limit != null) {
    return cases.slice(0, args.limit);
  }

  if (!smokeCaseIds.length) {
    return cases;
  }

  const byId = new Map(cases.map((testCase) => [testCase.id, testCase]));
  return smokeCaseIds.map((caseId) => byId.get(caseId)).filter(Boolean);
}

export function resolveCodeSnapshotSkillBundle({
  repoRoot,
  skillName,
  tags = [],
  referenceMap = {},
}) {
  return resolveSkillBundleForEval({
    repoRoot,
    skillName,
    tags,
    referenceMap,
  });
}

export function buildCodeSnapshotEvalPrompt({
  evalName,
  skillName,
  testCase,
  mode,
  skillText = "",
  injectedFiles = [],
  environment = "现有项目",
}) {
  const isSkill = mode === "skill";
  return [
    `你正在执行 ${evalName} 的代码改动评估样本。`,
    "请直接编辑当前工作区里的代码文件，不要只描述思路。",
    "工作区是一个最小 fixture，只包含本测试需要的代码和数据样例。",
    "",
    `项目环境：${environment}`,
    `测试编号：${testCase.id}`,
    `场景：${stripMarkdown(testCase.scenario)}`,
    "",
    isSkill
      ? [
          `请先使用 ${skillName} skill，再编辑代码。`,
          "",
          "Skill 注入文件：",
          ...injectedFiles.map((filePath) => `- ${filePath}`),
          "",
          "Skill 内容：",
          `<${skillName}-skill>`,
          skillText.trim(),
          `</${skillName}-skill>`,
        ].join("\n")
      : "不要使用或提到任何外部 skill。请只按普通 coding 判断编辑代码。",
    "",
    "完成后请简短说明你改了哪些文件；不要输出完整代码块，因为评估器会直接读取工作区里的文件。",
  ].join("\n");
}

export async function runCodeSnapshotEval(config, args) {
  const modes = config.modes ?? defaultModes;
  const log = args.log ?? (() => {});
  const casesDoc = await readFile(config.casesPath, "utf8");
  const parsedCases = (config.parseCases ?? parseCasesFromMarkdownTable)(casesDoc);
  const cases = (config.selectCases ?? selectCodeSnapshotCases)(
    parsedCases,
    args,
    config.smokeCaseIds ?? [],
  );
  const runs = args.runs ?? config.defaultRuns ?? 2;
  const resultsRoot = path.resolve(config.repoRoot, args.output ?? config.defaultResultsRoot);
  const reasoningEffort = args.reasoningEffort ?? "low";

  log("准备写入测试产物目录。");
  await mkdir(resultsRoot, { recursive: true });
  await writeFile(path.join(resultsRoot, "README.md"), config.resultsReadme ?? buildResultsReadme(config));

  if (!args.dryRun) {
    await prepareCodeSnapshotCodexHome(config, reasoningEffort);
  }

  const summary = [];
  const comparisons = [];
  let planned = 0;

  for (const testCase of cases) {
    const fixture = normalizeFixture(config.buildFixture(testCase));
    await writeOriginalComparisonFiles({ resultsRoot, testCase, fixture });

    for (const mode of modes) {
      const skillBundle = mode === "skill"
        ? await loadSkillBundle(config, testCase)
        : { text: "", files: [] };
      const injectedFiles = skillBundle.files.map((file) => file.path);
      const prompt = (config.buildPrompt ?? buildCodeSnapshotEvalPrompt)({
        evalName: config.evalName,
        skillName: config.skillName,
        testCase,
        mode,
        skillText: skillBundle.text,
        injectedFiles,
        environment: config.inferEnvironment?.(testCase) ?? "现有项目",
      });
      const promptPath = path.join(resultsRoot, "prompts", testCase.id, `${mode}.txt`);
      await mkdir(path.dirname(promptPath), { recursive: true });
      await writeFile(promptPath, prompt);

      for (let run = 1; run <= runs; run += 1) {
        planned += 1;
        const outputPath = path.join(resultsRoot, "outputs", testCase.id, `${mode}-${run}.md`);
        await mkdir(path.dirname(outputPath), { recursive: true });

        if (args.dryRun) {
          log(`计划：${testCase.id} ${mode} 第 ${run}/${runs} 次。`);
          summary.push(buildCodeSnapshotSampleSummary({ testCase, mode, run, status: "planned", injectedFiles }));
          continue;
        }

        const workdir = sampleWorkdir(config, testCase.id, mode, run);
        const snapshotRoot = path.join(resultsRoot, "comparisons", testCase.id, `${mode}-${run}`);
        let status = "completed";
        let output = "";

        if (args.resume && (await exists(outputPath)) && (await exists(snapshotRoot))) {
          log(`复用：${testCase.id} ${mode} 第 ${run}/${runs} 次，输出和代码快照已存在。`);
          output = await readFile(outputPath, "utf8");
          status = "existing";
        } else {
          log(`开始：${testCase.id} ${mode} 第 ${run}/${runs} 次，正在调用 Codex。`);
          await prepareSampleWorkdir(workdir, fixture, config);
          await runWritableCodex({ config, prompt, outputPath, workdir, reasoningEffort });
          output = await readFile(outputPath, "utf8");
          log(`完成：${testCase.id} ${mode} 第 ${run}/${runs} 次。`);
        }

        const snapshots = await captureCodeSnapshots({
          workdir,
          resultsRoot,
          testCase,
          mode,
          run,
          fixture,
          snapshotRoot,
          reuseExisting: status === "existing",
        });
        summary.push(buildCodeSnapshotSampleSummary({
          testCase,
          mode,
          run,
          status,
          output,
          injectedFiles,
          codeSnapshots: snapshots,
          sampleExtras: config.buildSampleExtras?.({ testCase, mode, injectedFiles }) ?? {},
        }));
      }
    }

    const caseComparison = buildCaseComparison({
      resultsRoot,
      testCase,
      fixture,
      samples: summary,
      modes,
    });
    comparisons.push(caseComparison);
    await writeCaseComparisonJson(resultsRoot, caseComparison);
  }

  const aggregate = aggregateCodeSnapshotSummary(summary, modes);
  await writeFile(
    path.join(resultsRoot, "summary.json"),
    `${JSON.stringify({
      评估规模: args.limit == null && !args.caseIds?.length ? "smoke" : "custom",
      推理强度: reasoningEffort,
      计划样本数: planned,
      汇总: aggregate,
      样本: summary,
    }, null, 2)}\n`,
  );
  await writeFile(
    path.join(resultsRoot, "comparison.json"),
    `${JSON.stringify({ 计划样本数: planned, modes, cases: comparisons }, null, 2)}\n`,
  );
  const aggregateReport = formatCodeSnapshotAggregateReport(aggregate, modes);
  await writeFile(path.join(resultsRoot, "summary.md"), `${aggregateReport}\n`);
  await writeFile(
    path.join(resultsRoot, "report.html"),
    formatCodeSnapshotHtmlReport({
      title: `${config.evalName} 代码对比评估报告`,
      aggregate,
      planned,
      samples: summary,
      modes,
    }),
  );
  log("写入 summary.json 和 comparison.json 完成。");

  return {
    planned,
    aggregate,
    consoleSummary: formatCodeSnapshotConsoleSummary(aggregate, modes),
    report: aggregateReport,
    samples: summary,
    resultsRoot,
  };
}

export function aggregateCodeSnapshotSummary(samples, modes = defaultModes) {
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

export function formatCodeSnapshotAggregateReport(aggregate, modes = defaultModes) {
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
    `请用 \`comparison.json\` 或 \`report.html\` 人工审查 original / ${modes.join(" / ")} 的真实文件改动。`,
  ].join("\n");
}

export function formatCodeSnapshotConsoleSummary(aggregate, modes = defaultModes) {
  return modes
    .map((mode) => {
      const row = aggregate[mode] ?? { 样本数: 0, 已完成: 0, 代码快照数: 0 };
      return `${mode}：样本 ${row.样本数}，已完成 ${row.已完成}，代码快照 ${row.代码快照数}`;
    })
    .join("\n");
}

export function formatCodeSnapshotHtmlReport({
  title = "代码对比评估报告",
  aggregate,
  planned,
  samples,
  modes = defaultModes,
}) {
  const groups = groupSamplesByCase(samples);
  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
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
    ".code-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.two-pane-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.input-grid{grid-template-columns:minmax(0,1fr)}",
    ".code-pane{border:1px solid #d0d5dd;border-radius:6px;min-width:0;background:#fff}",
    ".code-title{padding:8px 10px;border-bottom:1px solid #eaecf0;background:#f9fafb;font-weight:700}",
    "pre{margin:0;padding:10px;white-space:pre;overflow:auto;max-height:520px;background:#fff}",
    "details{margin-top:8px}summary{cursor:pointer;font-weight:700}.path{color:#475467}",
    "</style>",
    "</head>",
    "<body><main>",
    `<h1>${escapeHtml(title)}</h1>`,
    `<p class="muted">计划样本数 ${planned}。本报告展示原始 fixture 和 ${escapeHtml(modes.join(" / "))} 改动结果。</p>`,
    "<h2>结果总览</h2>",
    renderModeSummaryTable(aggregate, modes),
    "<h2>逐 case 代码对比</h2>",
    ...groups.map((group) => renderCaseComparison(group, modes)),
    "</main></body></html>",
  ].join("\n");
}

function renderModeSummaryTable(aggregate, modes) {
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

function renderCaseComparison(group, modes) {
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
    ...renderCodeComparisons(group, modes),
    "</article>",
  ].join("");
}

function renderCodeComparisons(group, modes) {
  const files = new Map();
  for (const sample of Object.values(group.samples)) {
    for (const snapshot of sample.代码快照 ?? []) {
      const existing = files.get(snapshot.path) ?? {};
      files.set(snapshot.path, {
        ...existing,
        path: snapshot.path,
        language: snapshot.language,
        role: snapshot.role,
        original: snapshot.original,
        [sample.模式]: snapshot.current,
      });
    }
  }
  if (!files.size) return ['<p class="muted">这个 case 还没有代码快照。</p>'];
  return [...files.values()].map((file) => [
    `<h4><span class="path mono">${escapeHtml(file.path)}</span></h4>`,
    renderFileCode(file, modes),
  ].join(""));
}

function renderFileCode(file, modes) {
  const hasChanged = modes.some((mode) => file[mode] !== undefined && file[mode] !== file.original);
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
      `<div class="${escapeHtml(codeGridClass(modes))}">`,
      renderCodePane("Original 输入材料", file.original),
      ...modes.map((mode) => renderModePane(mode, file)),
      "</div>",
    ].join("");
  }
  if (!hasChanged) {
    return [
      '<div class="code-grid input-grid">',
      renderCodePane("未变化文件", file.original),
      "</div>",
    ].join("");
  }
  return [
    `<div class="${escapeHtml(codeGridClass(modes))}">`,
    renderCodePane("Original", file.original),
    ...modes.map((mode) => renderModePane(mode, file)),
    "</div>",
  ].join("");
}

function renderModePane(mode, file) {
  return renderCodePane(modeLabel(mode), file[mode] ?? `没有 ${mode} 快照。`);
}

function codeGridClass(modes) {
  return modes.length === 1 ? "code-grid two-pane-grid" : "code-grid";
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

export function buildCaseComparison({ resultsRoot, testCase, fixture, samples, modes = defaultModes }) {
  const caseSamples = samples.filter((sample) => sample.测试编号 === testCase.id);
  const runs = [...new Set(caseSamples.map((sample) => sample.第几次运行))].sort((left, right) => left - right);
  const files = comparisonFiles({ resultsRoot, testCase, fixture, caseSamples });
  const runComparisons = runs.map((run) => {
    const byMode = Object.fromEntries(
      caseSamples
        .filter((sample) => sample.第几次运行 === run)
        .map((sample) => [sample.模式, sample]),
    );
    return {
      run,
      files: files.map((file) => ({
        path: file.path,
        language: file.language,
        role: file.role ?? "editable",
        originalPath: relativeTo(resultsRoot, originalSnapshotPath(resultsRoot, testCase.id, file.path)),
        modePaths: buildModePaths(byMode, file.path),
        ...legacyModePaths(byMode, file.path),
      })),
    };
  });

  return {
    caseId: testCase.id,
    modes,
    tags: testCase.tags ?? [],
    scenario: stripMarkdown(testCase.scenario),
    validation: stripMarkdown(testCase.validation),
    baselineRisk: stripMarkdown(testCase.baselineRisk),
    skillExpected: stripMarkdown(testCase.skillExpected),
    runs: runComparisons,
    files: files.map((file) => {
      const firstFile = runComparisons[0]?.files.find((runFile) => runFile.path === file.path);
      return {
        path: file.path,
        language: file.language,
        role: file.role ?? "editable",
        originalPath: relativeTo(resultsRoot, originalSnapshotPath(resultsRoot, testCase.id, file.path)),
        modePaths: firstFile?.modePaths ?? {},
        ...pickLegacyFilePaths(firstFile),
      };
    }),
  };
}

function comparisonFiles({ resultsRoot, testCase, fixture, caseSamples }) {
  const byPath = new Map(fixture.files.map((file) => [file.path, file]));
  for (const sample of caseSamples) {
    for (const snapshot of sample.代码快照 ?? []) {
      if (!byPath.has(snapshot.path)) {
        byPath.set(snapshot.path, {
          path: snapshot.path,
          language: snapshot.language ?? languageForPath(snapshot.path),
          role: snapshot.role ?? "editable",
        });
      }
    }
  }
  return [...byPath.values()].map((file) => ({
    ...file,
    originalPath: relativeTo(resultsRoot, originalSnapshotPath(resultsRoot, testCase.id, file.path)),
  }));
}

function buildModePaths(byMode, filePath) {
  return Object.fromEntries(
    Object.entries(byMode)
      .map(([mode, sample]) => [
        mode,
        sample.代码快照?.find((snapshot) => snapshot.path === filePath)?.currentPath,
      ])
      .filter(([, currentPath]) => currentPath),
  );
}

function legacyModePaths(byMode, filePath) {
  return {
    baselinePath: byMode.baseline?.代码快照?.find((snapshot) => snapshot.path === filePath)?.currentPath,
    skillPath: byMode.skill?.代码快照?.find((snapshot) => snapshot.path === filePath)?.currentPath,
  };
}

function pickLegacyFilePaths(file) {
  return {
    baselinePath: file?.baselinePath,
    skillPath: file?.skillPath,
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
    await writeFile(target, originalContentForFile(file));
  }
}

async function prepareSampleWorkdir(workdir, fixture, config) {
  await rm(workdir, { recursive: true, force: true });
  await mkdir(workdir, { recursive: true });
  await writeFile(
    path.join(workdir, "README.md"),
    [
      `# Temporary ${config.evalName ?? "skill"} eval fixture`,
      "",
      "Edit the code files in this workspace to satisfy the task prompt.",
      "",
    ].join("\n"),
  );
  await writeFile(path.join(workdir, "package.json"), JSON.stringify({ type: "module" }, null, 2));
  for (const file of fixture.files) {
    if (file.initiallyExists === false) continue;
    const target = path.join(workdir, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content ?? "");
  }
}

async function runWritableCodex({ config, prompt, outputPath, workdir, reasoningEffort }) {
  const env = { ...process.env, CODEX_HOME: config.cleanCodexHome };
  await writeFile(
    path.join(config.cleanCodexHome, "config.toml"),
    renderCodexConfig(workdir, reasoningEffort),
    { mode: 0o600 },
  );
  await execFileWithInput(config.codexBinary ?? "codex", buildWritableCodexExecArgs(workdir, outputPath), {
    env,
    input: prompt,
    maxBuffer: config.maxBuffer ?? 1024 * 1024 * 20,
    timeout: config.timeout ?? 1000 * 60 * 8,
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

async function prepareCodeSnapshotCodexHome(config, reasoningEffort) {
  await mkdir(config.cleanCodexHome, { recursive: true, mode: 0o700 });
  await cp(path.join(os.homedir(), ".codex", "auth.json"), path.join(config.cleanCodexHome, "auth.json"));
  await cp(path.join(os.homedir(), ".codex", "installation_id"), path.join(config.cleanCodexHome, "installation_id"));
  await writeFile(
    path.join(config.cleanCodexHome, "config.toml"),
    renderCodexConfig(config.cleanWorkdirRoot, reasoningEffort),
    { mode: 0o600 },
  );
}

export async function captureCodeSnapshots({
  workdir,
  resultsRoot,
  testCase,
  mode,
  run,
  fixture,
  snapshotRoot,
  reuseExisting = false,
}) {
  if (!reuseExisting) {
    await rm(snapshotRoot, { recursive: true, force: true });
  }
  const files = reuseExisting
    ? await snapshotFilesFromExistingSnapshot(snapshotRoot, fixture)
    : await snapshotFiles(workdir, fixture);
  const snapshots = [];

  for (const file of files) {
    const originalPath = originalSnapshotPath(resultsRoot, testCase.id, file.path);
    const source = path.join(workdir, file.path);
    const target = path.join(snapshotRoot, file.path);

    if (!(await exists(originalPath))) {
      await mkdir(path.dirname(originalPath), { recursive: true });
      await writeFile(originalPath, originalContentForFile(file));
    }

    if (!reuseExisting) {
      await mkdir(path.dirname(target), { recursive: true });
      if (await exists(source)) {
        await cp(source, target);
      } else {
        await writeFile(target, missingFileSnapshotContent(file));
      }
    }

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

async function snapshotFilesFromExistingSnapshot(snapshotRoot, fixture) {
  const byPath = new Map(fixture.files.map((file) => [file.path, file]));
  for (const filePath of await listWorkspaceFiles(snapshotRoot)) {
    if (byPath.has(filePath)) continue;
    byPath.set(filePath, {
      path: filePath,
      language: languageForPath(filePath),
      role: "editable",
      initiallyExists: false,
    });
  }
  return [...byPath.values()];
}

async function snapshotFiles(workdir, fixture) {
  const byPath = new Map(fixture.files.map((file) => [file.path, file]));
  for (const filePath of await listWorkspaceFiles(workdir)) {
    if (byPath.has(filePath) || isHarnessFile(filePath)) continue;
    byPath.set(filePath, {
      path: filePath,
      language: languageForPath(filePath),
      role: "editable",
      initiallyExists: false,
    });
  }
  return [...byPath.values()];
}

async function listWorkspaceFiles(root, current = "") {
  const dir = path.join(root, current);
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const relativePath = current ? path.join(current, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (isIgnoredDirectory(entry.name)) continue;
      files.push(...await listWorkspaceFiles(root, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath.split(path.sep).join("/"));
    }
  }
  return files.sort();
}

function isHarnessFile(filePath) {
  return filePath === "README.md" || filePath === "package.json";
}

function isIgnoredDirectory(name) {
  return name === ".git" || name === "node_modules";
}

function originalContentForFile(file) {
  if (file.initiallyExists === false) {
    return file.originalContent ?? missingFileSnapshotContent(file);
  }
  return file.content ?? "";
}

function missingFileSnapshotContent(file) {
  return file.missingContent ?? "[[file does not exist]]\n";
}

function buildCodeSnapshotSampleSummary({
  testCase,
  mode,
  run,
  status,
  output = "",
  injectedFiles = [],
  codeSnapshots,
  sampleExtras = {},
}) {
  const row = {
    测试编号: testCase.id,
    环境标签: testCase.tags ?? [],
    ...sampleExtras,
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

function normalizeFixture(fixture) {
  return {
    files: fixture.files.map((file) => ({
      ...file,
      role: file.role ?? "editable",
      language: file.language ?? languageForPath(file.path),
    })),
  };
}

function loadSkillBundle(config, testCase) {
  const tags = testCase.tags ?? [];
  if (config.resolveSkillBundle) {
    return config.resolveSkillBundle(config.skillName, tags, testCase);
  }
  return resolveCodeSnapshotSkillBundle({
    repoRoot: config.repoRoot,
    skillName: config.skillName,
    tags,
    referenceMap: config.referenceMap ?? {},
  });
}

function originalSnapshotPath(resultsRoot, caseId, filePath) {
  return path.join(resultsRoot, "comparisons", caseId, "original", filePath);
}

function sampleWorkdir(config, caseId, mode, run) {
  return path.join(config.cleanWorkdirRoot, caseId, `${mode}-${run}`);
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
  return files.length ? files.join("\n") : "skill 模式未注入额外文件。";
}

function modeLabel(mode) {
  return labeledModes[mode] ?? mode;
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

function buildResultsReadme(config) {
  return [
    `# ${config.evalName ?? config.skillName} 代码对比评估输出`,
    "",
    "这个目录由通用 code snapshot eval runner 生成。",
    "",
    "## 目录说明",
    "",
    "- `prompts/`: 每个 case、每个模式实际发送给 Codex 的 prompt。",
    "- `outputs/`: Codex 返回的文字说明，按 case、模式和第几次运行保存。",
    "- `comparisons/`: original 和各运行模式的真实代码快照。",
    "- `comparison.json`: 面向机器读取的代码快照索引。",
    "- `report.html`: 面向人工审核的 Original + 当前运行模式代码对比报告。",
    "- `summary.json`: 样本状态摘要。",
    "",
  ].join("\n");
}
