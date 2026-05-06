#!/usr/bin/env node

import { execFile } from "node:child_process";
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
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = path.join(repoRoot, "docs", "align-contracts-heavy-test", "report.zh-CN.md");
const defaultResultsRoot = path.join(repoRoot, ".eval-runs", "align-contracts-heavy");
const cleanCodexHome = path.join(os.tmpdir(), "wingman-align-baseline-codex-home");
const cleanWorkdir = path.join(os.tmpdir(), "wingman-align-clean-workdir");

export function parseCasesFromReport(report) {
  return report
    .split("\n")
    .filter((line) => /^\| AC-\d{2} \|/.test(line))
    .map((line) => {
      const cells = line
        .slice(1, -1)
        .split(" | ")
        .map((cell) => cell.trim());
      return {
        id: cells[0],
        scenario: cells[1],
        validation: cells[2],
        baselineRisk: cells[3],
        skillExpected: cells[4],
      };
    });
}

export function buildPrompt(testCase, mode, skillText) {
  const isSkill = mode === "skill";
  const environment = inferEnvironment(testCase);

  return [
    "你正在执行 Wingman align-contracts skill 的行为评估样本。",
    "不要编辑文件。只根据下面的任务描述回答。",
    "请提出代码改动思路和验证方式。",
    "",
    `项目环境：${environment}`,
    `测试编号：${testCase.id}`,
    `场景：${stripMarkdown(testCase.scenario)}`,
    `主要验证点：${stripMarkdown(testCase.validation)}`,
    `已知 baseline 风险：${stripMarkdown(testCase.baselineRisk)}`,
    "",
    isSkill
      ? [
          "请先使用 align-contracts skill，再回答这个任务。",
          "Skill 内容：",
          "<align-contracts-skill>",
          skillText.trim(),
          "</align-contracts-skill>",
          "",
          `预期 skill 行为：${stripMarkdown(testCase.skillExpected)}`,
        ].join("\n")
      : "不要使用或提到任何外部 skill。请只按普通 coding 判断回答。",
    "",
    "请返回：",
    "- 提供方契约",
    "- 消费方契约",
    "- 事实来源",
    "- 差异分类",
    "- 绑定位置",
    "- 建议实现方式",
    "- 验证计划",
  ].join("\n");
}

export function scoreOutput(output) {
  const text = output.toLowerCase();
  const has = (patterns) => patterns.some((pattern) => pattern.test(text));

  const criteria = {
    providerContract: has([/provider contract/, /提供方契约/, /api (returns|gives|provides)/, /backend .*shape/, /provided by/]),
    consumerContract: has([/consumer contract/, /消费方契约/, /component .*expects/, /ui .*expects/, /handler .*expects/, /internal .*expects/]),
    sourceOfTruth: has([/source of truth/, /事实来源/, /owns? (the )?(meaning|shape|contract)/, /backend .*owns/, /domain .*wins/, /schema .*wins/]),
    gapClassification: has([/gap/, /差异分类/, /structural mismatch/, /semantic mismatch/, /naming only/, /missing field/, /source-of-truth conflict/]),
    bindingLocation: has([/adapter/, /mapper/, /parser/, /schema/, /boundary/, /component prop/, /domain model/, /绑定位置/]),
    avoidsAdHocMapping: has([/avoid .*ad[- ]hoc/, /do not .*parent mapper/, /not .*scatter/, /single (adapter|boundary|mapper)/]),
    avoidsFakeDefaults: has([/do not .*fake/, /avoid .*fake/, /no .*placeholder/, /do not invent/, /explicit .*missing/]),
    asksWhenUnclear: has([/ask (the )?user/, /if .*unclear/, /if .*uncertain/, /confirm .*meaning/]),
    preservesBehavior: has([/preserve/, /no unrelated/, /keep .*layout/, /do not .*css/, /minimal change/]),
    verification: has([/verify/, /typecheck/, /test/, /fixture/, /schema parse/, /sample payload/, /integration/]),
  };

  const flags = {
    fakeDefaults:
      has([/id:\s*0/, /avatarurl:\s*""/, /field:\s*""/, /placeholder/]) &&
      !criteria.avoidsFakeDefaults,
    adHocMapper: has([/parent mapper/, /ad[- ]hoc/, /scatter/]) && !criteria.avoidsAdHocMapping,
  };

  return {
    total: Object.values(criteria).filter(Boolean).length,
    criteria,
    flags,
  };
}

async function main() {
  const result = await runHeavySuite(parseArgs(process.argv.slice(2)));

  console.log(`计划样本数：${result.planned}`);
  console.log(`结果目录：${result.resultsRoot}`);
  console.log(JSON.stringify(result.aggregate, null, 2));
}

export async function runHeavySuite(args) {
  const report = await readFile(reportPath, "utf8");
  const cases = parseCasesFromReport(report);
  const selectedCases = cases.slice(0, args.limit ?? cases.length);
  const skillText = await readFile(
    path.join(repoRoot, "skills", "align-contracts", "SKILL.md"),
    "utf8",
  );
  const resultsRoot = path.resolve(repoRoot, args.output ?? defaultResultsRoot);

  await mkdir(resultsRoot, { recursive: true });
  await writeFile(
    path.join(resultsRoot, "README.md"),
    [
      "# align-contracts 重型测试输出",
      "",
      "这个目录由 `npm run eval:align-contracts` 或 `scripts/align-contracts-heavy-runner.mjs` 生成。",
      "",
      "## 隔离方式",
      "",
      "- baseline 和 skill 两组样本都会在临时干净工作目录里运行，避免当前仓库的 `skills/` 被模型自动发现。",
      "- 两组样本都会使用临时 `CODEX_HOME`，避免本机已安装的 Wingman 插件或其他 skill 泄漏进测试。",
      "- skill 组只通过 prompt 显式注入当前仓库的 `skills/align-contracts/SKILL.md` 内容，所以不要求本机安装 Wingman。",
      "- 这个目录被 git 忽略，因为完整运行会生成几百个模型输出文件。",
      "",
      "## 目录说明",
      "",
      "- `prompts/`: 每个 case、每个模式实际发送给 Codex 的 prompt；重复运行共用同一份 prompt。",
      "- `outputs/`: Codex 返回的原始回答，按 case、模式和第几次运行保存。",
      "- `summary.json`: 自动评分摘要和每个样本的粗粒度命中情况。",
      "",
      "## 常用命令",
      "",
      "- `npm run eval:align-contracts:dry-run`: 只生成 prompt 和计划摘要，不调用模型。",
      "- `npm run eval:align-contracts -- --limit 1 --runs 1`: 先跑一个最小真实样本，检查环境和输出格式。",
      "- `npm run eval:align-contracts -- --resume`: 继续完整评估，已存在的输出不会重复调用。",
      "",
    ].join("\n"),
  );

  if (!args.dryRun) {
    await prepareCleanCodexHome();
    await prepareCleanWorkdir();
  }

  const summary = [];
  let planned = 0;

  for (const testCase of selectedCases) {
    for (const mode of ["baseline", "skill"]) {
      for (let run = 1; run <= args.runs; run += 1) {
        planned += 1;
        const prompt = buildPrompt(testCase, mode, skillText);
        const promptPath = path.join(resultsRoot, "prompts", testCase.id, `${mode}.txt`);
        const outputPath = path.join(resultsRoot, "outputs", testCase.id, `${mode}-${run}.md`);
        await mkdir(path.dirname(promptPath), { recursive: true });
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(promptPath, prompt);

        if (args.dryRun) {
          summary.push(buildSampleSummary({ testCase, mode, run, status: "planned" }));
          continue;
        }

        if (args.resume && (await exists(outputPath))) {
          const existing = await readFile(outputPath, "utf8");
          summary.push(buildSampleSummary({ testCase, mode, run, status: "existing", score: scoreOutput(existing) }));
          continue;
        }

        await runCodex(prompt, outputPath, mode);
        const output = await readFile(outputPath, "utf8");
        summary.push(buildSampleSummary({ testCase, mode, run, status: "completed", score: scoreOutput(output) }));
      }
    }
  }

  const aggregate = aggregateSummary(summary);
  await writeFile(
    path.join(resultsRoot, "summary.json"),
    `${JSON.stringify({ 计划样本数: planned, 汇总: aggregate, 样本: summary }, null, 2)}\n`,
  );

  return { planned, aggregate, samples: summary, resultsRoot };
}

async function runCodex(prompt, outputPath, mode) {
  const env = { ...process.env };
  const cwd = cleanWorkdir;

  // Both modes run outside this repo so local `skills/` files cannot be
  // discovered accidentally. The skill mode gets the skill only via prompt text.
  env.CODEX_HOME = cleanCodexHome;

  await execFileAsync(
    "codex",
    [
      "exec",
      "--cd",
      cwd,
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

async function prepareCleanCodexHome() {
  await mkdir(cleanCodexHome, { recursive: true, mode: 0o700 });
  await cp(path.join(os.homedir(), ".codex", "auth.json"), path.join(cleanCodexHome, "auth.json"));
  await cp(path.join(os.homedir(), ".codex", "installation_id"), path.join(cleanCodexHome, "installation_id"));
  await writeFile(
    path.join(cleanCodexHome, "config.toml"),
    [
      'openai_base_url = "http://ai.wykj.cc:8080"',
      'model = "gpt-5.5"',
      'model_reasoning_effort = "high"',
      "",
      `[projects."${cleanWorkdir}"]`,
      'trust_level = "trusted"',
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
}

async function prepareCleanWorkdir() {
  await rm(cleanWorkdir, { recursive: true, force: true });
  await mkdir(cleanWorkdir, { recursive: true });
  await writeFile(
    path.join(cleanWorkdir, "README.md"),
    [
      "# Temporary Contract Test Workspace",
      "",
      "This workspace intentionally contains no Wingman skills.",
      "It is used for baseline and explicit-skill prompt sampling.",
      "",
    ].join("\n"),
  );
}

function aggregateSummary(summary) {
  const byMode = {};
  for (const sample of summary) {
    if (!sample.评分) continue;
    byMode[sample.模式] ??= {
      样本数: 0,
      总分: 0,
      假默认值次数: 0,
      临时映射次数: 0,
    };
    byMode[sample.模式].样本数 += 1;
    byMode[sample.模式].总分 += sample.评分.总分;
    byMode[sample.模式].假默认值次数 += sample.评分.风险标记.疑似假默认值 ? 1 : 0;
    byMode[sample.模式].临时映射次数 += sample.评分.风险标记.疑似临时映射 ? 1 : 0;
  }

  for (const mode of Object.keys(byMode)) {
    const row = byMode[mode];
    row.平均分 = row.样本数 === 0 ? 0 : row.总分 / row.样本数;
    row.假默认值比例 = row.样本数 === 0 ? 0 : row.假默认值次数 / row.样本数;
    row.临时映射比例 = row.样本数 === 0 ? 0 : row.临时映射次数 / row.样本数;
  }

  return byMode;
}

function buildSampleSummary({ testCase, mode, run, status, score }) {
  const row = {
    测试编号: testCase.id,
    模式: mode,
    第几次运行: run,
    状态: translateStatus(status),
  };

  if (score) {
    row.评分 = translateScore(score);
  }

  return row;
}

function translateScore(score) {
  return {
    总分: score.total,
    命中项: {
      提供方契约: score.criteria.providerContract,
      消费方契约: score.criteria.consumerContract,
      事实来源: score.criteria.sourceOfTruth,
      差异分类: score.criteria.gapClassification,
      绑定位置: score.criteria.bindingLocation,
      避免临时映射: score.criteria.avoidsAdHocMapping,
      避免假默认值: score.criteria.avoidsFakeDefaults,
      不清楚时主动询问: score.criteria.asksWhenUnclear,
      保留既有行为: score.criteria.preservesBehavior,
      提出验证方式: score.criteria.verification,
    },
    风险标记: {
      疑似假默认值: score.flags.fakeDefaults,
      疑似临时映射: score.flags.adHocMapper,
    },
  };
}

function translateStatus(status) {
  return {
    planned: "已计划",
    existing: "已存在",
    completed: "已完成",
  }[status] ?? status;
}

function inferEnvironment(testCase) {
  const text = `${testCase.scenario} ${testCase.validation}`.toLowerCase();
  if (/webhook/.test(text)) return "Node.js webhook/event handler 项目";
  if (/cli|env|config/.test(text)) return "Node.js CLI/config 解析项目";
  if (/db|database|数据库|migration/.test(text)) return "带数据库/repository 层的 TypeScript 服务";
  if (/sdk/.test(text)) return "集成外部 SDK 的 TypeScript 服务";
  if (/ai structured output|tool schema|ai 输出/.test(text)) return "TypeScript tool/schema 校验项目";
  return "现有 TypeScript/React 项目";
}

function stripMarkdown(value) {
  return value.replace(/`/g, "");
}

function parseArgs(argv) {
  const args = { runs: 3, dryRun: false, resume: false };
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
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return args;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
