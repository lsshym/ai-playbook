import { spawn } from "node:child_process";
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

export function parseCasesFromMarkdownTable(report) {
  return report
    .split("\n")
    .filter((line) => /^\|\s*[A-Z]+-\d{2,}\s*\|/.test(line))
    .map((line) => {
      const cells = line
        .slice(1, -1)
        .split(" | ")
        .map((cell) => cell.trim());
      return {
        id: cells[0],
        tags: parseCaseTags(cells[1]),
        scenario: cells[2],
        validation: cells[3],
        baselineRisk: cells[4],
        skillExpected: cells[5],
      };
    });
}

export async function resolveSkillBundle({ repoRoot, skillName, tags = [], referenceMap = {} }) {
  const files = [{ path: `skills/${skillName}/SKILL.md` }];
  const references = referenceMap[skillName] ?? {};
  for (const tag of tags) {
    for (const referencePath of references[tag] ?? []) {
      const filePath = `skills/${skillName}/${referencePath}`;
      if (!files.some((file) => file.path === filePath)) {
        files.push({ path: filePath });
      }
    }
  }

  const loadedFiles = await Promise.all(
    files.map(async (file) => ({
      ...file,
      content: await readFile(path.join(repoRoot, file.path), "utf8"),
    })),
  );
  return {
    files: loadedFiles,
    text: loadedFiles
      .map((file) => [`## ${file.path}`, "", file.content.trim()].join("\n"))
      .join("\n\n"),
  };
}

export function buildSkillEvalPrompt({
  evalName,
  skillName,
  testCase,
  mode,
  skillText = "",
  injectedFiles = [],
  environment = "现有项目",
  returnSections = [],
}) {
  const isSkill = mode === "skill";

  return [
    `你正在执行 ${evalName} 的行为评估样本。`,
    "不要编辑文件。只根据下面的任务描述回答。",
    "请提出代码改动思路和验证方式。",
    "",
    `项目环境：${environment}`,
    `测试编号：${testCase.id}`,
    `场景：${stripMarkdown(testCase.scenario)}`,
    "",
    isSkill
      ? [
          `请先使用 ${skillName} skill，再回答这个任务。`,
          "Skill 注入文件：",
          ...injectedFiles.map((filePath) => `- ${filePath}`),
          "",
          "Skill 内容：",
          `<${skillName}-skill>`,
          skillText.trim(),
          `</${skillName}-skill>`,
        ].join("\n")
      : "不要使用或提到任何外部 skill。请只按普通 coding 判断回答。",
    "",
    "请返回：",
    ...returnSections.map((section) => `- ${section}`),
  ].join("\n");
}

export async function runSkillEval(config, args) {
  const log = args.log ?? (() => {});
  const report = await readFile(config.reportPath, "utf8");
  const cases = (config.parseCases ?? parseCasesFromMarkdownTable)(report);
  const selectedCases = cases.slice(0, args.limit ?? cases.length);
  const resultsRoot = path.resolve(config.repoRoot, args.output ?? config.defaultResultsRoot);
  const modes = config.modes ?? ["baseline", "skill"];
  const runs = args.runs ?? config.defaultRuns ?? 1;

  log("准备写入测试产物目录。");
  await mkdir(resultsRoot, { recursive: true });
  await writeFile(path.join(resultsRoot, "README.md"), config.resultsReadme ?? defaultResultsReadme(config));

  if (!args.dryRun) {
    await prepareCleanCodexHome(config, args.reasoningEffort ?? "low");
    await prepareCleanWorkdir(config);
  }

  const summary = [];
  let planned = 0;

  for (const testCase of selectedCases) {
    for (const mode of modes) {
      const skillBundle = mode === "skill"
        ? await resolveSkillBundle({
            repoRoot: config.repoRoot,
            skillName: config.skillName,
            tags: testCase.tags,
            referenceMap: config.referenceMap ?? {},
          })
        : { text: "", files: [] };
      const injectedFiles = skillBundle.files.map((file) => file.path);
      const prompt = config.buildPrompt(testCase, mode, skillBundle.text, injectedFiles);
      const promptPath = path.join(resultsRoot, "prompts", testCase.id, `${mode}.txt`);
      await mkdir(path.dirname(promptPath), { recursive: true });
      await writeFile(promptPath, prompt);

      for (let run = 1; run <= runs; run += 1) {
        planned += 1;
        const outputPath = path.join(resultsRoot, "outputs", testCase.id, `${mode}-${run}.md`);
        await mkdir(path.dirname(outputPath), { recursive: true });

        if (args.dryRun) {
          log(`计划：${testCase.id} ${mode} 第 ${run}/${runs} 次。`);
          summary.push(
            config.buildSampleSummary({
              testCase,
              mode,
              run,
              status: "planned",
              injectedFiles,
            }),
          );
          continue;
        }

        if (args.resume && (await exists(outputPath))) {
          log(`复用：${testCase.id} ${mode} 第 ${run}/${runs} 次，输出已存在。`);
          const existing = await readFile(outputPath, "utf8");
          summary.push(
            config.buildSampleSummary({
              testCase,
              mode,
              run,
              status: "existing",
              output: existing,
              injectedFiles,
            }),
          );
          continue;
        }

        log(`开始：${testCase.id} ${mode} 第 ${run}/${runs} 次，正在调用 Codex。`);
        await runCodex(config, prompt, outputPath);
        log(`完成：${testCase.id} ${mode} 第 ${run}/${runs} 次。`);
        const output = await readFile(outputPath, "utf8");
        summary.push(
          config.buildSampleSummary({
            testCase,
            mode,
            run,
            status: "completed",
            output,
            injectedFiles,
          }),
        );
      }
    }
  }

  const aggregate = config.aggregateSummary(summary);
  await writeFile(
    path.join(resultsRoot, "summary.json"),
    `${JSON.stringify({ 计划样本数: planned, 汇总: aggregate, 样本: summary }, null, 2)}\n`,
  );
  const aggregateReport = config.formatAggregateReport(aggregate);
  await writeFile(path.join(resultsRoot, "summary.md"), `${aggregateReport}\n`);
  const htmlReport = config.formatHtmlReport({ aggregate, planned, samples: summary });
  await writeFile(path.join(resultsRoot, "report.html"), htmlReport);
  log("写入 summary.json 完成。");

  return {
    planned,
    aggregate,
    consoleSummary: config.formatConsoleSummary(aggregate),
    report: aggregateReport,
    samples: summary,
    resultsRoot,
  };
}

export function buildCodexExecArgs(cwd, outputPath) {
  return [
    "exec",
    "--cd",
    cwd,
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--ephemeral",
    "-o",
    outputPath,
    "-",
  ];
}

export function execFileWithInput(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const maxBuffer = options.maxBuffer ?? 1024 * 1024;

    const timeout = options.timeout
      ? setTimeout(() => {
          if (settled) return;
          settled = true;
          child.kill("SIGTERM");
          reject(new Error(`命令超时：${file}`));
        }, options.timeout)
      : null;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length + stderr.length > maxBuffer && !settled) {
        settled = true;
        child.kill("SIGTERM");
        reject(new Error(`命令输出超过缓冲区限制：${file}`));
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stdout.length + stderr.length > maxBuffer && !settled) {
        settled = true;
        child.kill("SIGTERM");
        reject(new Error(`命令输出超过缓冲区限制：${file}`));
      }
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const detail = stderr.trim() ? `\n${stderr.trim()}` : "";
      const error = new Error(`命令失败：${file}，退出码 ${code ?? signal}${detail}`);
      error.code = code;
      error.signal = signal;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });

    child.stdin.end(options.input ?? "");
  });
}

export function renderCodexConfig(workdir, reasoningEffort = "low") {
  return [
    'openai_base_url = "http://ai.wykj.cc:8080"',
    'model = "gpt-5.5"',
    `model_reasoning_effort = "${reasoningEffort}"`,
    "",
    `[projects."${workdir}"]`,
    'trust_level = "trusted"',
    "",
  ].join("\n");
}

export function parseArgs(argv) {
  const args = { runs: 3, dryRun: false, resume: false, reasoningEffort: "low" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--resume") {
      args.resume = true;
    } else if (arg === "--limit") {
      args.limit = Number(argv[++index]);
    } else if (arg === "--runs") {
      args.runs = Number(argv[++index]);
    } else if (arg === "--output") {
      args.output = argv[++index];
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

async function runCodex(config, prompt, outputPath) {
  const env = { ...process.env };
  const cwd = config.cleanWorkdir;

  // Both modes run outside this repo so local `skills/` files cannot be
  // discovered accidentally. The skill mode gets the skill only via prompt text.
  env.CODEX_HOME = config.cleanCodexHome;

  await execFileWithInput(
    config.codexBinary ?? "codex",
    buildCodexExecArgs(cwd, outputPath),
    {
      env,
      input: prompt,
      maxBuffer: config.maxBuffer ?? 1024 * 1024 * 20,
      timeout: config.timeout ?? 1000 * 60 * 8,
    },
  );
}

async function prepareCleanCodexHome(config, reasoningEffort) {
  await mkdir(config.cleanCodexHome, { recursive: true, mode: 0o700 });
  await cp(path.join(os.homedir(), ".codex", "auth.json"), path.join(config.cleanCodexHome, "auth.json"));
  await cp(path.join(os.homedir(), ".codex", "installation_id"), path.join(config.cleanCodexHome, "installation_id"));
  await writeFile(
    path.join(config.cleanCodexHome, "config.toml"),
    renderCodexConfig(config.cleanWorkdir, reasoningEffort),
    { mode: 0o600 },
  );
}

async function prepareCleanWorkdir(config) {
  await rm(config.cleanWorkdir, { recursive: true, force: true });
  await mkdir(config.cleanWorkdir, { recursive: true });
  await writeFile(
    path.join(config.cleanWorkdir, "README.md"),
    [
      "# Temporary Skill Eval Workspace",
      "",
      "This workspace intentionally contains no Wingman skills.",
      "It is used for baseline and explicit-skill prompt sampling.",
      "",
    ].join("\n"),
  );
}

function parseCaseTags(value = "") {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function defaultResultsReadme(config) {
  return [
    `# ${config.evalName ?? config.skillName ?? "skill"} 测试输出`,
    "",
    "这个目录由通用 skill eval runner 生成。",
    "",
  ].join("\n");
}

function stripMarkdown(value = "") {
  return value.replace(/`/g, "");
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
