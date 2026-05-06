#!/usr/bin/env node

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
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = path.join(repoRoot, "docs", "align-contracts-heavy-test", "report.zh-CN.md");
const defaultResultsRoot = path.join(repoRoot, ".eval-runs", "align-contracts-heavy");
const cleanCodexHome = path.join(os.tmpdir(), "wingman-align-baseline-codex-home");
const cleanWorkdir = path.join(os.tmpdir(), "wingman-align-clean-workdir");

const skillReferenceMap = {
  "align-contracts": {
    "react-typescript": ["references/frontend-react-typescript.md"],
  },
};
const reactTypescriptReferencePath = "skills/align-contracts/references/frontend-react-typescript.md";

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
        tags: parseCaseTags(cells[1]),
        scenario: cells[2],
        validation: cells[3],
        baselineRisk: cells[4],
        skillExpected: cells[5],
      };
    });
}

function parseCaseTags(value = "") {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export async function resolveSkillBundle(skillName, tags = []) {
  const files = [{ path: `skills/${skillName}/SKILL.md` }];
  const references = skillReferenceMap[skillName] ?? {};
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

export function buildPrompt(testCase, mode, skillText, injectedFiles = []) {
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
    "",
    isSkill
      ? [
          "请先使用 align-contracts skill，再回答这个任务。",
          `这条在测什么：${stripMarkdown(testCase.validation)}`,
          `常见错误：${stripMarkdown(testCase.baselineRisk)}`,
          "",
          "Skill 注入文件：",
          ...injectedFiles.map((filePath) => `- ${filePath}`),
          "",
          "Skill 内容：",
          "<align-contracts-skill>",
          skillText.trim(),
          "</align-contracts-skill>",
          "",
          `期待好回答：${stripMarkdown(testCase.skillExpected)}`,
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

export function scoreOutput(output, testCase = null) {
  const text = output.toLowerCase();
  const has = (patterns) => patterns.some((pattern) => pattern.test(text));

  const checkDetails = scoreAuxiliaryChecks(output, testCase);
  const criteria = Object.fromEntries(
    Object.entries(auxiliaryCriterionKeys).map(([key, name]) => [key, checkDetails[name].通过]),
  );

  const flags = {
    fakeDefaults:
      has([/id:\s*0/, /avatarurl:\s*""/, /field:\s*""/, /placeholder/]) &&
      !criteria.avoidsFakeDefaults,
    adHocMapper: has([/parent mapper/, /ad[- ]hoc/, /scatter/]) && !criteria.avoidsAdHocMapping,
  };

  const basicTotal = Object.values(criteria).filter(Boolean).length;
  const caseExpectations = testCase ? scoreCaseExpectations(output, testCase) : null;
  const caseRisks = testCase ? scoreCaseRisks(output, testCase) : null;
  const primaryScore = testCase ? caseExpectations.命中数 + caseRisks.避开数 : basicTotal;
  const primaryMax = testCase ? caseExpectations.总数 + caseRisks.总数 : Object.keys(criteria).length;

  return {
    total: primaryScore,
    主分: primaryScore,
    主分满分: primaryMax,
    基础项总分: basicTotal,
    criteria,
    检查项: checkDetails,
    flags,
    ...(caseExpectations ? { 场景期望: caseExpectations } : {}),
    ...(caseRisks ? { 风险错误: caseRisks } : {}),
  };
}

const auxiliaryCriterionDefinitions = {
  提供方契约: {
    key: "providerContract",
    expectation: "提供方契约 / provider contract / API returns|gives|provides / backend shape / provided by",
    patterns: [/provider contract/, /提供方契约/, /api (returns|gives|provides)/, /backend .*shape/, /provided by/],
  },
  消费方契约: {
    key: "consumerContract",
    expectation: "消费方契约 / consumer contract / component expects / UI expects / handler expects / internal expects",
    patterns: [/consumer contract/, /消费方契约/, /component .*expects/, /ui .*expects/, /handler .*expects/, /internal .*expects/],
  },
  事实来源: {
    key: "sourceOfTruth",
    expectation: "事实来源 / source of truth / owns meaning|shape|contract / backend owns / domain wins / schema wins",
    patterns: [/source of truth/, /事实来源/, /owns? (the )?(meaning|shape|contract)/, /backend .*owns/, /domain .*wins/, /schema .*wins/],
  },
  差异分类: {
    key: "gapClassification",
    expectation: "差异分类 / gap / structural mismatch / semantic mismatch / naming only / missing field / source-of-truth conflict",
    patterns: [/gap/, /差异分类/, /structural mismatch/, /semantic mismatch/, /naming only/, /missing field/, /source-of-truth conflict/],
  },
  绑定位置: {
    key: "bindingLocation",
    expectation: "adapter / mapper / parser / schema / boundary / component prop / domain model / 绑定位置",
    patterns: [/adapter/, /mapper/, /parser/, /schema/, /boundary/, /component prop/, /domain model/, /绑定位置/],
  },
  避免临时映射: {
    key: "avoidsAdHocMapping",
    expectation: "avoid .*ad[- ]hoc / do not .*parent mapper / not .*scatter / single (adapter|boundary|mapper)",
    patterns: [/avoid .*ad[- ]hoc/, /do not .*parent mapper/, /not .*scatter/, /single (adapter|boundary|mapper)/],
  },
  避免假默认值: {
    key: "avoidsFakeDefaults",
    expectation: "do not fake / avoid fake / no placeholder / do not invent / explicit missing",
    patterns: [/do not .*fake/, /avoid .*fake/, /no .*placeholder/, /do not invent/, /explicit .*missing/],
  },
  不清楚时主动询问: {
    key: "asksWhenUnclear",
    expectation: "ask user / if unclear / if uncertain / confirm meaning",
    patterns: [/ask (the )?user/, /if .*unclear/, /if .*uncertain/, /confirm .*meaning/],
  },
  保留既有行为: {
    key: "preservesBehavior",
    expectation: "preserve / no unrelated / keep layout / do not CSS / minimal change",
    patterns: [/preserve/, /no unrelated/, /keep .*layout/, /do not .*css/, /minimal change/],
  },
  提出验证方式: {
    key: "verification",
    expectation: "verify / typecheck / test / fixture / schema parse / sample payload / integration",
    patterns: [/verify/, /typecheck/, /test/, /fixture/, /schema parse/, /sample payload/, /integration/],
  },
};

const auxiliaryCriterionKeys = Object.fromEntries(
  Object.entries(auxiliaryCriterionDefinitions).map(([name, definition]) => [definition.key, name]),
);

function scoreAuxiliaryChecks(output, testCase = null) {
  return Object.fromEntries(
    Object.entries(auxiliaryCriterionDefinitions).map(([name, definition]) => {
      const riskStyle = scoreRiskStyleAuxiliaryCheck(name, output, testCase);
      if (riskStyle) return [name, riskStyle];

      const evidence = findMatchingExcerpt(output, definition.patterns);
      return [
        name,
        {
          适用: true,
          通过: Boolean(evidence),
          期望看到: definition.expectation,
          证据: evidence,
          判定说明: evidence ? "找到辅助检查证据。" : "未找到辅助检查证据。",
        },
      ];
    }),
  );
}

function scoreRiskStyleAuxiliaryCheck(name, output, testCase) {
  if (name === "避免临时映射") {
    return scoreAbsenceCheck({
      output,
      expectation: "不要出现临时或分散映射，例如父组件临时拼旧字段、到处写 newField || oldField。",
      riskPatterns: [
        /ad[- ]hoc/,
        /scatter/,
        /parent mapper/,
        /父组件.*(拼|构造|补).*旧字段/,
        /父组件.*totalcents/,
        /到处.*(映射|转换|兼容)/,
        /\|\|.*旧字段/,
        /newfield\s*\|\|\s*oldfield/,
      ],
      avoidPatterns: [
        /avoid .*ad[- ]hoc/,
        /do not .*parent mapper/,
        /not .*scatter/,
        /不(?:要|能|应|推荐)?.*父组件.*(拼|构造|补)/,
        /避免.*(临时|分散|到处).*(映射|转换|兼容)/,
        /不要.*(临时|分散|到处).*(映射|转换|兼容)/,
        /不建议.*(临时|分散|到处).*(映射|转换|兼容)/,
        /single (adapter|boundary|mapper)/,
      ],
      passReason: "未发现临时或分散映射。",
      avoidReason: "回答明确避免临时或分散映射。",
      failReason: "发现临时或分散映射建议。",
    });
  }

  if (name === "保留既有行为") {
    return scoreAbsenceCheck({
      output,
      expectation: "不要出现无关改动建议，例如顺手改布局、样式、CSS、业务流程或组件层级。",
      riskPatterns: [
        /改.*css/,
        /css.*改/,
        /改.*布局/,
        /布局.*改/,
        /重构.*组件层级/,
        /顺手.*(样式|布局|css|重构|业务流程)/,
        /unrelated/,
      ],
      avoidPatterns: [
        /preserve/,
        /no unrelated/,
        /keep .*layout/,
        /do not .*css/,
        /minimal change/,
        /不(?:要|应|能).*改.*(css|样式|布局|业务流程|组件层级)/,
        /避免.*无关改动/,
        /只改.*契约/,
        /保留.*(视觉|布局|样式|既有行为)/,
      ],
      passReason: "未发现无关改动建议。",
      avoidReason: "回答明确保留既有行为或避免无关改动。",
      failReason: "发现无关改动建议。",
    });
  }

  if (name === "不清楚时主动询问") {
    const applicable = shouldAskWhenUnclear(testCase);
    if (!applicable) {
      return {
        适用: false,
        通过: true,
        期望看到: "仅语义不确定类用例要求触发：ask user / if unclear / if uncertain / confirm meaning / 查文档 / 确认含义。",
        证据: "",
        判定说明: "本用例没有语义不确定触发点；这项应由语义不确定类用例覆盖。",
      };
    }

    const evidence = findMatchingExcerpt(output, [
      /ask (the )?user/,
      /if .*unclear/,
      /if .*uncertain/,
      /confirm .*meaning/,
      /问用户/,
      /询问用户/,
      /确认.*含义/,
      /查.*(schema|docs|文档)/,
      /先.*确认/,
    ]);
    return {
      适用: true,
      通过: Boolean(evidence),
      期望看到: "语义不确定时应主动确认：ask user / if unclear / if uncertain / confirm meaning / 查文档 / 确认含义。",
      证据: evidence,
      判定说明: evidence ? "找到主动确认证据。" : "语义不确定，但未找到主动确认证据。",
    };
  }

  return null;
}

function scoreAbsenceCheck({ output, expectation, riskPatterns, avoidPatterns, passReason, avoidReason, failReason }) {
  const riskEvidence = findMatchingExcerpt(output, riskPatterns);
  const avoidEvidence = findMatchingExcerpt(output, avoidPatterns);
  const failed = Boolean(riskEvidence) && !avoidEvidence;
  return {
    适用: true,
    通过: !failed,
    期望看到: expectation,
    证据: avoidEvidence || riskEvidence,
    判定说明: failed ? failReason : avoidEvidence ? avoidReason : passReason,
  };
}

function shouldAskWhenUnclear(testCase) {
  if (!testCase) return true;
  const text = stripMarkdown([
    testCase.id,
    testCase.scenario,
    testCase.validation,
    testCase.baselineRisk,
    testCase.skillExpected,
  ].filter(Boolean).join(" ")).toLowerCase();
  return /不确定|不清楚|可能不是|可能不同义|语义不确定|问|询问|确认|查.*(schema|docs|文档)|status|checkouttype/.test(text);
}

function scoreCaseExpectations(output, testCase) {
  const items = buildCaseExpectationChecks(testCase).map((item) => {
    const evidence = findMatchingExcerpt(output, item.patterns);
    return {
      名称: item.name,
      命中: Boolean(evidence),
      期望看到: item.expectation ?? formatPatternList(item.patterns),
      证据: evidence,
      判定说明: evidence ? "找到关键期望证据。" : "未找到关键期望证据。",
    };
  });
  return {
    命中数: items.filter((item) => item.命中).length,
    总数: items.length,
    项目: items,
  };
}

function scoreCaseRisks(output, testCase) {
  const items = buildCaseRiskChecks(testCase).map((item) => {
    const riskEvidence = findMatchingExcerpt(output, item.patterns);
    const avoidEvidence = findMatchingExcerpt(output, item.avoidPatterns ?? []);
    const riskAppears = Boolean(riskEvidence) && !avoidEvidence;
    return {
      名称: item.name,
      出现: riskAppears,
      期望看到: item.expectation ?? formatRiskExpectation(item),
      证据: avoidEvidence || riskEvidence,
      判定说明: riskAppears
        ? "发现高风险表述。"
        : avoidEvidence
          ? "回答明确否定或避免该风险。"
          : "未发现风险表述。",
    };
  });
  return {
    避开数: items.filter((item) => !item.出现).length,
    总数: items.length,
    项目: items,
  };
}

function buildCaseExpectationChecks(testCase) {
  if (testCase.id === "AC-01") {
    return [
      {
        name: "识别 API contract 已变",
        expectation:
          "api contract .*变 / api contract .*改 / api .*已变 / api .*改为 / api .*changed / contract .*changed",
        patterns: [
          /api contract .*变/,
          /api contract .*改/,
          /api .*已变/,
          /api .*改为/,
          /api .*changed/,
          /contract .*changed/,
        ],
      },
      {
        name: "更新组件契约或集中转换",
        expectation: "更新组件契约 / 组件契约 / 集中转换 / adapter / 边界.*转换",
        patterns: [/更新组件契约/, /组件契约/, /集中转换/, /adapter/, /边界.*转换/],
      },
    ];
  }

  return splitExpectationText(testCase.skillExpected).map((phrase) => ({
    name: phrase,
    patterns: [phraseToPattern(phrase)],
  }));
}

function buildCaseRiskChecks(testCase) {
  if (testCase.id === "AC-01") {
    return [
      {
        name: "没有在父组件临时拼回 totalCents",
        expectation: "不能出现父组件拼回 totalCents，除非明确否定。",
        patterns: [/在父组件.*拼回\s*totalcents/, /父组件.*拼.*totalcents/],
        avoidPatterns: [
          /不(?:要|能|应|推荐)?(?:把新\s*api)?在父组件.*拼回\s*totalcents/,
          /不推荐在父组件.*totalcents/,
          /避免.*父组件.*拼.*totalcents/,
          /不要.*父组件.*拼.*totalcents/,
          /不能.*父组件.*拼.*totalcents/,
        ],
      },
      {
        name: "没有假装 API 没变",
        expectation: "不能假装 API 没变，除非明确否定。",
        patterns: [/假装\s*api\s*没变/, /pretend.*api.*(unchanged|not changed)/],
        avoidPatterns: [
          /不(?:要|能|应)?假装\s*api\s*没变/,
          /不能.*假装\s*api\s*没变/,
          /避免.*假装\s*api\s*没变/,
          /会.*假装\s*api\s*没变/,
          /掩盖\s*api contract\s*已变/,
        ],
      },
    ];
  }

  return splitExpectationText(testCase.baselineRisk).map((phrase) => ({
    name: phrase,
    patterns: [phraseToPattern(phrase)],
  }));
}

function splitExpectationText(value) {
  return stripMarkdown(value)
    .split(/[，。；;,.]|或/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function phraseToPattern(value) {
  const escaped = value
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s*");
  return new RegExp(escaped);
}

function formatPatternList(patterns) {
  return patterns.map((pattern) => pattern.source).join(" / ");
}

function formatRiskExpectation(item) {
  const risk = formatPatternList(item.patterns);
  const avoid = item.avoidPatterns?.length ? `；除非匹配否定：${formatPatternList(item.avoidPatterns)}` : "";
  return `不能匹配风险：${risk}${avoid}`;
}

function findMatchingExcerpt(output, patterns) {
  if (!patterns.length) return "";
  const chunks = output
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[。！？.!?])\s+/))
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const normalized = chunk.toLowerCase();
    if (patterns.some((pattern) => pattern.test(normalized))) {
      return expandHeadingExcerpt(chunks, index);
    }
  }

  const normalizedOutput = output.toLowerCase();
  if (!patterns.some((pattern) => pattern.test(normalizedOutput))) return "";
  return output.replace(/\s+/g, " ").trim();
}

function expandHeadingExcerpt(chunks, index) {
  const chunk = chunks[index];
  const next = chunks[index + 1];
  if (!next) return chunk;
  const headingOnly = /^#{1,6}\s+\S/.test(chunk) || /^\*\*[^*]+\*\*$/.test(chunk);
  return headingOnly ? `${chunk} ${next}` : chunk;
}

function truncateExcerpt(value, maxLength = 220) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}...`;
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

export async function runHeavySuite(args) {
  const log = args.log ?? (() => {});
  const report = await readFile(reportPath, "utf8");
  const cases = parseCasesFromReport(report);
  const selectedCases = cases.slice(0, args.limit ?? cases.length);
  const resultsRoot = path.resolve(repoRoot, args.output ?? defaultResultsRoot);

  log("准备写入测试产物目录。");
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
      "- skill 组只通过 prompt 显式注入当前仓库的 skill bundle，所以不要求本机安装 Wingman。",
      "- skill bundle 会按用例的环境标签选择 `SKILL.md` 和对应 `references/` 文件。",
      "- 这个目录被 git 忽略，因为完整运行会生成 102 个模型输出文件。",
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
    await prepareCleanCodexHome(args.reasoningEffort ?? "medium");
    await prepareCleanWorkdir();
  }

  const summary = [];
  let planned = 0;

  for (const testCase of selectedCases) {
    for (const mode of ["baseline", "skill"]) {
      for (let run = 1; run <= args.runs; run += 1) {
        planned += 1;
        const skillBundle = mode === "skill"
          ? await resolveSkillBundle("align-contracts", testCase.tags)
          : { text: "", files: [] };
        const prompt = buildPrompt(
          testCase,
          mode,
          skillBundle.text,
          skillBundle.files.map((file) => file.path),
        );
        const promptPath = path.join(resultsRoot, "prompts", testCase.id, `${mode}.txt`);
        const outputPath = path.join(resultsRoot, "outputs", testCase.id, `${mode}-${run}.md`);
        await mkdir(path.dirname(promptPath), { recursive: true });
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(promptPath, prompt);

        if (args.dryRun) {
          log(`计划：${testCase.id} ${mode} 第 ${run}/${args.runs} 次。`);
          summary.push(
            buildSampleSummary({
              testCase,
              mode,
              run,
              status: "planned",
              injectedFiles: skillBundle.files.map((file) => file.path),
            }),
          );
          continue;
        }

        if (args.resume && (await exists(outputPath))) {
          log(`复用：${testCase.id} ${mode} 第 ${run}/${args.runs} 次，输出已存在。`);
          const existing = await readFile(outputPath, "utf8");
          summary.push(
            buildSampleSummary({
              testCase,
              mode,
              run,
              status: "existing",
              score: scoreOutput(existing, testCase),
              output: existing,
              injectedFiles: skillBundle.files.map((file) => file.path),
            }),
          );
          continue;
        }

        log(`开始：${testCase.id} ${mode} 第 ${run}/${args.runs} 次，正在调用 Codex。`);
        await runCodex(prompt, outputPath, mode);
        log(`完成：${testCase.id} ${mode} 第 ${run}/${args.runs} 次。`);
        const output = await readFile(outputPath, "utf8");
        summary.push(
          buildSampleSummary({
            testCase,
            mode,
            run,
            status: "completed",
            score: scoreOutput(output, testCase),
            output,
            injectedFiles: skillBundle.files.map((file) => file.path),
          }),
        );
      }
    }
  }

  const aggregate = aggregateSummary(summary);
  await writeFile(
    path.join(resultsRoot, "summary.json"),
    `${JSON.stringify({ 计划样本数: planned, 汇总: aggregate, 样本: summary }, null, 2)}\n`,
  );
  const aggregateReport = formatAggregateReport(aggregate);
  await writeFile(path.join(resultsRoot, "summary.md"), `${aggregateReport}\n`);
  const htmlReport = formatHtmlReport({ aggregate, planned, samples: summary });
  await writeFile(path.join(resultsRoot, "report.html"), htmlReport);
  log("写入 summary.json 完成。");

  return {
    planned,
    aggregate,
    consoleSummary: formatConsoleSummary(aggregate),
    report: aggregateReport,
    samples: summary,
    resultsRoot,
  };
}

async function runCodex(prompt, outputPath, mode) {
  const env = { ...process.env };
  const cwd = cleanWorkdir;

  // Both modes run outside this repo so local `skills/` files cannot be
  // discovered accidentally. The skill mode gets the skill only via prompt text.
  env.CODEX_HOME = cleanCodexHome;

  await execFileWithInput(
    "codex",
    buildCodexExecArgs(cwd, outputPath),
    {
      env,
      input: prompt,
      maxBuffer: 1024 * 1024 * 20,
      timeout: 1000 * 60 * 8,
    },
  );
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

async function prepareCleanCodexHome(reasoningEffort) {
  await mkdir(cleanCodexHome, { recursive: true, mode: 0o700 });
  await cp(path.join(os.homedir(), ".codex", "auth.json"), path.join(cleanCodexHome, "auth.json"));
  await cp(path.join(os.homedir(), ".codex", "installation_id"), path.join(cleanCodexHome, "installation_id"));
  await writeFile(
    path.join(cleanCodexHome, "config.toml"),
    renderCodexConfig(cleanWorkdir, reasoningEffort),
    { mode: 0o600 },
  );
}

export function renderCodexConfig(workdir, reasoningEffort = "medium") {
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

const scoringCriterionNames = [
  "提供方契约",
  "消费方契约",
  "事实来源",
  "差异分类",
  "绑定位置",
  "避免临时映射",
  "避免假默认值",
  "不清楚时主动询问",
  "保留既有行为",
  "提出验证方式",
];

const riskFlagNames = [
  "疑似假默认值",
  "疑似临时映射",
];

const visibleCriterionNames = scoringCriterionNames.filter(
  (name) => !["避免假默认值", "提出验证方式"].includes(name),
);

const metricCopy = {
  提供方契约: {
    title: "实际收到的数据长什么样",
    description: "看回答是否说清楚外部数据实际给了哪些字段，比如 API 返回了 amount.total_minor_units。",
  },
  消费方契约: {
    title: "使用数据的代码需要什么",
    description: "看回答是否说清楚 UI、业务代码或 handler 原本想读取什么字段。",
  },
  事实来源: {
    title: "应该按谁的定义改",
    description: "看回答是否判断 API、schema、domain model、数据库或组件谁才是权威来源。",
  },
  差异分类: {
    title: "这次错位属于哪种问题",
    description: "看回答是否区分字段改名、结构变化、语义不一致、缺字段或来源冲突。",
  },
  绑定位置: {
    title: "应该在哪里修",
    description: "看回答是否把修复位置放到 adapter、schema parser、domain model、组件 props 或边界层。",
  },
  避免临时映射: {
    title: "避免临时补丁",
    description: "看回答是否避免到处写 oldField = new.field 这类临时兼容或分散 mapper。",
  },
  避免假默认值: {
    title: "避免造假字段",
    description: "看回答是否避免用 id: 0、name: \"\"、placeholder 等假数据骗过类型或测试。",
  },
  不清楚时主动询问: {
    title: "语义不确定时先确认",
    description: "看回答是否在 status 和 checkoutType 这类可能不同义的字段上建议查文档或问用户。",
  },
  保留既有行为: {
    title: "避免无关改动",
    description: "看回答是否强调只修契约错位，不顺手改布局、样式、业务流程或无关结构。",
  },
  提出验证方式: {
    title: "验证办法",
    description: "看回答是否给出 typecheck、fixture、schema parse、组件测试或集成测试等证明方式。",
  },
};

export function aggregateSummary(summary) {
  const byMode = {};
  for (const sample of summary) {
    if (!sample.评分) continue;
    byMode[sample.模式] ??= {
      样本数: 0,
      总分: 0,
      主分满分: 0,
      基础项总分: 0,
      假默认值次数: 0,
      临时映射次数: 0,
      场景期望: createCaseExpectationAggregate(),
      风险错误: createCaseRiskAggregate(),
      命中项: createCriterionAggregate(),
      风险标记: createRiskAggregate(),
    };
    byMode[sample.模式].样本数 += 1;
    byMode[sample.模式].总分 += sample.评分.总分;
    byMode[sample.模式].主分满分 += sample.评分.主分满分 ?? 10;
    byMode[sample.模式].基础项总分 += sample.评分.基础项总分 ?? 0;
    byMode[sample.模式].假默认值次数 += sample.评分.风险标记.疑似假默认值 ? 1 : 0;
    byMode[sample.模式].临时映射次数 += sample.评分.风险标记.疑似临时映射 ? 1 : 0;
    if (sample.评分.场景期望) {
      byMode[sample.模式].场景期望.命中数 += sample.评分.场景期望.命中数;
      byMode[sample.模式].场景期望.总数 += sample.评分.场景期望.总数;
    }
    if (sample.评分.风险错误) {
      byMode[sample.模式].风险错误.避开数 += sample.评分.风险错误.避开数;
      byMode[sample.模式].风险错误.总数 += sample.评分.风险错误.总数;
      byMode[sample.模式].风险错误.出现次数 +=
        sample.评分.风险错误.总数 - sample.评分.风险错误.避开数;
    }
    for (const name of scoringCriterionNames) {
      byMode[sample.模式].命中项[name].命中数 += sample.评分.命中项[name] ? 1 : 0;
    }
    for (const name of riskFlagNames) {
      byMode[sample.模式].风险标记[name].出现次数 += sample.评分.风险标记[name] ? 1 : 0;
    }
  }

  for (const mode of Object.keys(byMode)) {
    const row = byMode[mode];
    row.平均分 = row.样本数 === 0 ? 0 : row.总分 / row.样本数;
    row.平均满分 = row.样本数 === 0 ? 0 : row.主分满分 / row.样本数;
    row.平均基础项分 = row.样本数 === 0 ? 0 : row.基础项总分 / row.样本数;
    row.假默认值比例 = row.样本数 === 0 ? 0 : row.假默认值次数 / row.样本数;
    row.临时映射比例 = row.样本数 === 0 ? 0 : row.临时映射次数 / row.样本数;
    row.场景期望.命中率 =
      row.场景期望.总数 === 0 ? 0 : row.场景期望.命中数 / row.场景期望.总数;
    row.风险错误.避开率 =
      row.风险错误.总数 === 0 ? 0 : row.风险错误.避开数 / row.风险错误.总数;
    row.风险错误.出现率 =
      row.风险错误.总数 === 0 ? 0 : row.风险错误.出现次数 / row.风险错误.总数;
    for (const name of scoringCriterionNames) {
      row.命中项[name].命中率 = row.样本数 === 0 ? 0 : row.命中项[name].命中数 / row.样本数;
    }
    for (const name of riskFlagNames) {
      row.风险标记[name].出现率 = row.样本数 === 0 ? 0 : row.风险标记[name].出现次数 / row.样本数;
    }
  }

  return byMode;
}

export function formatAggregateReport(aggregate) {
  const modes = ["baseline", "skill"].filter((mode) => aggregate[mode]);
  if (modes.length === 0) {
    return [
      "## 总览",
      "",
      "本次运行还没有可评分样本。",
    ].join("\n");
  }

  return [
    "## 总览",
    "",
    "| 模式 | 输出数 | 关键期望命中 | 风险错误避开 | 辅助检查命中 |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...modes.map((mode) => {
      const row = aggregate[mode];
      return `| ${mode} | ${row.样本数} | ${formatCountRate(row.场景期望.命中数, row.场景期望.总数, row.场景期望.命中率)} | ${formatCountRate(row.风险错误.避开数, row.风险错误.总数, row.风险错误.避开率)} | ${formatScore(row.基础项总分 ?? 0, row.样本数 * scoringCriterionNames.length)} |`;
    }),
    "",
    "## 核心检查",
    "",
    `| 项 | ${modes.join(" | ")} |`,
    `| --- | ${modes.map(() => "---:").join(" | ")} |`,
    `| 关键期望命中 | ${modes.map((mode) => formatCountRate(aggregate[mode].场景期望.命中数, aggregate[mode].场景期望.总数, aggregate[mode].场景期望.命中率)).join(" | ")} |`,
    `| 高风险错误避开 | ${modes.map((mode) => formatCountRate(aggregate[mode].风险错误.避开数, aggregate[mode].风险错误.总数, aggregate[mode].风险错误.避开率)).join(" | ")} |`,
    "",
    "## 辅助检查清单",
    "",
    `| 项 | ${modes.join(" | ")} |`,
    `| --- | ${modes.map(() => "---:").join(" | ")} |`,
    ...visibleCriterionNames.map((name) => {
      const cells = modes.map((mode) => formatHit(aggregate[mode].命中项[name], aggregate[mode].样本数));
      return `| ${name} | ${cells.join(" | ")} |`;
    }),
    "",
    "## 风险标记",
    "",
    `| 风险 | ${modes.join(" | ")} |`,
    `| --- | ${modes.map(() => "---:").join(" | ")} |`,
    ...riskFlagNames.map((name) => {
      const cells = modes.map((mode) => formatRisk(aggregate[mode].风险标记[name], aggregate[mode].样本数));
      return `| ${name} | ${cells.join(" | ")} |`;
    }),
  ].join("\n");
}

export function formatConsoleSummary(aggregate) {
  const modes = ["baseline", "skill"].filter((mode) => aggregate[mode]);
  if (modes.length === 0) return "本次运行还没有可评分样本。";

  return modes
    .map((mode) => {
      const row = aggregate[mode];
      const fakeDefaults = row.风险标记?.疑似假默认值?.出现次数 ?? 0;
      const adHocMapping = row.风险标记?.疑似临时映射?.出现次数 ?? 0;
      const expectation = row.场景期望?.总数
        ? `，关键期望命中 ${row.场景期望.命中数}/${row.场景期望.总数}`
        : "";
      const caseRisk = row.风险错误?.总数
        ? `，风险错误避开 ${row.风险错误.避开数}/${row.风险错误.总数}`
        : "";
      return `${mode}：输出 ${row.样本数}${expectation}${caseRisk}，辅助风险 ${fakeDefaults + adHocMapping}`;
    })
    .join("\n");
}

export function formatHtmlReport({ aggregate, planned, samples }) {
  const modes = ["baseline", "skill"].filter((mode) => aggregate[mode]);
  const cases = collectTestCases(samples);
  const failures = collectFailures(samples);
  const sampleGroups = groupSamplesByCase(samples);

  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>align-contracts 重型评估报告</title>",
    "<style>",
    "body{margin:0;background:#fafafa;color:#1f2933;font:14px/1.55 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}",
    "main{max-width:1180px;margin:0 auto;padding:32px 24px 56px}",
    "h1{font-size:26px;margin:0 0 6px}h2{font-size:19px;margin:30px 0 10px}h3{font-size:16px;margin:20px 0 8px}",
    ".muted{color:#667085}",
    "a{color:#175cd3;text-decoration:none}a:hover{text-decoration:underline}",
    "table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d0d5dd;margin:10px 0 18px}",
    "th,td{border-top:1px solid #eaecf0;padding:8px 10px;text-align:left;vertical-align:top}th{background:#f2f4f7;font-weight:700}",
    "tbody tr:first-child td{border-top:1px solid #d0d5dd}.nowrap{white-space:nowrap}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}",
    ".pass{color:#067647;font-weight:700}.fail{color:#b42318;font-weight:700}.warn{color:#b54708;font-weight:700}.na{color:#667085;font-weight:700}",
    ".sample{background:#fff;border:1px solid #d0d5dd;border-radius:6px;margin:14px 0 18px;padding:14px}",
    ".sample-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px;border-bottom:1px solid #eaecf0;padding-bottom:8px;margin-bottom:10px}",
    ".grid{display:grid;grid-template-columns:170px minmax(0,1fr);gap:6px 12px;margin:8px 0}.key{color:#667085;font-weight:700}",
    ".compare{display:grid;grid-template-columns:1fr 1fr;gap:12px}.pane,.output-pane{border:1px solid #d0d5dd;border-radius:6px;padding:10px;background:#fff}",
    ".verdict{display:block;margin-bottom:4px}.expect{color:#475467}.evidence{margin-top:4px}",
    "pre{background:#f6f8fa;border:1px solid #d0d5dd;border-radius:6px;margin:8px 0 0;padding:10px;white-space:pre-wrap;overflow:auto}",
    "details{margin-top:8px}summary{cursor:pointer;font-weight:700}",
    "</style>",
    "</head>",
    "<body><main>",
    "<h1>align-contracts 重型评估报告</h1>",
    `<p class="muted">计划样本数 ${planned}。这份报告用于回答：测试了哪些东西，哪些没通过，为什么没通过。</p>`,
    "<h2>结果总览</h2>",
    renderModeSummaryTable(modes, aggregate),
    "<h2>测试清单</h2>",
    renderCaseTable(cases),
    "<h2>失败索引</h2>",
    renderFailureIndex(failures),
    "<h2>逐项判定明细</h2>",
    ...sampleGroups.slice(0, 200).map((group) => renderCaseComparison(group)),
    "</main></body></html>",
  ].join("\n");
}

function renderModeSummaryTable(modes, aggregate) {
  if (!modes.length) return '<p class="muted">本次运行还没有可评分样本。</p>';
  const rows = modes.map((mode) => {
    const row = aggregate[mode];
    return [
      "<tr>",
      `<td class="nowrap">${escapeHtml(mode)}</td>`,
      `<td>${row.样本数}</td>`,
      `<td>${row.场景期望.命中数}/${row.场景期望.总数}</td>`,
      `<td>${row.风险错误.避开数}/${row.风险错误.总数}</td>`,
      `<td>${formatScore(row.基础项总分 ?? 0, row.样本数 * scoringCriterionNames.length)}</td>`,
      "</tr>",
    ].join("");
  });
  return [
    "<table>",
    "<thead><tr><th>模式</th><th>输出数</th><th>关键期望命中</th><th>风险错误避开</th><th>辅助检查命中</th></tr></thead>",
    `<tbody>${rows.join("")}</tbody>`,
    "</table>",
  ].join("");
}

function collectTestCases(samples) {
  const cases = new Map();
  for (const sample of samples) {
    if (!cases.has(sample.测试编号)) {
      cases.set(sample.测试编号, {
        id: sample.测试编号,
        tags: sample.环境标签 ?? [],
        scenario: sample.场景 ?? "",
        validation: sample.主要验证点 ?? "",
        baselineRisk: sample.Baseline风险 ?? "",
        skillExpected: sample.Skill预期 ?? "",
      });
    }
  }
  return [...cases.values()];
}

function renderCaseTable(cases) {
  if (!cases.length) return '<p class="muted">本次运行还没有测试清单。</p>';
  const rows = cases.map((testCase) => [
    "<tr>",
    `<td class="nowrap mono">${escapeHtml(testCase.id)}</td>`,
    `<td>${escapeHtml(formatTags(testCase.tags))}</td>`,
    `<td>${escapeHtml(testCase.scenario)}</td>`,
    `<td>${escapeHtml(testCase.validation)}</td>`,
    `<td><strong>常见错误：</strong>${escapeHtml(testCase.baselineRisk)}<br><strong>期待好回答：</strong>${escapeHtml(testCase.skillExpected)}</td>`,
    "</tr>",
  ].join(""));
  return [
    "<table>",
    "<thead><tr><th>编号</th><th>环境标签</th><th>任务场景</th><th>这条在测什么</th><th>判定重点</th></tr></thead>",
    `<tbody>${rows.join("")}</tbody>`,
    "</table>",
  ].join("");
}

function collectFailures(samples) {
  const failures = [];
  for (const sample of samples) {
    if (!sample.评分) continue;
    for (const item of sample.评分.场景期望?.项目 ?? []) {
      if (!item.命中) {
        failures.push({
          sample,
          group: "关键期望",
          name: item.名称,
          reason: item.判定说明 ?? "未找到匹配证据。",
          evidence: item.证据 ?? "",
          expectation: item.期望看到 ?? "",
        });
      }
    }
    for (const item of sample.评分.风险错误?.项目 ?? []) {
      if (item.出现) {
        failures.push({
          sample,
          group: "高风险错误",
          name: item.名称,
          reason: item.判定说明 ?? "发现高风险表述。",
          evidence: item.证据 ?? "",
          expectation: item.期望看到 ?? "",
        });
      }
    }
    for (const [name, hit] of Object.entries(sample.评分.命中项 ?? {})) {
      if (!hit && visibleCriterionNames.includes(name)) {
        const detail = sample.评分.检查项?.[name];
        if (detail?.适用 === false) continue;
        failures.push({
          sample,
          group: "辅助检查",
          name,
          reason: detail?.判定说明 ?? "未找到辅助检查证据。",
          evidence: detail?.证据 ?? "",
          expectation: detail?.期望看到 ?? "",
        });
      }
    }
  }
  return failures;
}

function renderFailureIndex(failures) {
  if (!failures.length) return '<p class="muted">没有失败项。</p>';
  const rows = failures.map((failure) => {
    const outputPath = sampleOutputPath(failure.sample);
    const targetId = comparisonAnchorId(failure.sample.测试编号);
    return [
      "<tr>",
      `<td class="nowrap mono">${escapeHtml(failure.sample.测试编号)} ${escapeHtml(failure.sample.模式)} #${failure.sample.第几次运行}</td>`,
      `<td class="nowrap">${escapeHtml(failure.group)}</td>`,
      `<td>${escapeHtml(failure.name)}</td>`,
      `<td>${escapeHtml(failure.reason)}</td>`,
      `<td class="mono">${escapeHtml(outputPath)}</td>`,
      `<td><a href="#${escapeHtml(targetId)}">查看明细</a></td>`,
      "</tr>",
    ].join("");
  });
  return [
    "<table>",
    "<thead><tr><th>样本</th><th>类型</th><th>没通过哪条</th><th>为什么没通过</th><th>原始输出</th><th>定位</th></tr></thead>",
    `<tbody>${rows.join("")}</tbody>`,
    "</table>",
  ].join("");
}

function groupSamplesByCase(samples) {
  const groups = new Map();
  for (const sample of samples) {
    if (!groups.has(sample.测试编号)) {
      groups.set(sample.测试编号, {
        id: sample.测试编号,
        tags: sample.环境标签 ?? [],
        scenario: sample.场景 ?? "",
        validation: sample.主要验证点 ?? "",
        baselineRisk: sample.Baseline风险 ?? "",
        skillExpected: sample.Skill预期 ?? "",
        samples: {},
      });
    }
    groups.get(sample.测试编号).samples[sample.模式] = sample;
  }
  return [...groups.values()];
}

function renderCaseComparison(group) {
  return [
    `<article class="sample" id="${escapeHtml(comparisonAnchorId(group.id))}">`,
    '<div class="sample-head">',
    `<h3>${escapeHtml(group.id)} 判定明细</h3>`,
    `<div class="muted">${escapeHtml(group.scenario)}</div>`,
    "</div>",
    "<h4>测试了什么</h4>",
    '<div class="grid">',
    '<div class="key">环境标签</div>',
    `<div>${escapeHtml(formatTags(group.tags))}</div>`,
    '<div class="key">React/TS 分支</div>',
    `<div>${escapeHtml(formatReactTsBranch(group.samples.skill, group.tags))}</div>`,
    '<div class="key">任务场景</div>',
    `<div>${escapeHtml(group.scenario)}</div>`,
    '<div class="key">这条在测什么</div>',
    `<div>${escapeHtml(group.validation)}</div>`,
    '<div class="key">常见错误</div>',
    `<div>${escapeHtml(group.baselineRisk)}</div>`,
    '<div class="key">期待好回答</div>',
    `<div>${escapeHtml(group.skillExpected)}</div>`,
    '<div class="key">Skill 注入文件</div>',
    `<div>${escapeHtml(formatInjectedFiles(group.samples.skill))}</div>`,
    "</div>",
    renderComparisonTable(group.samples),
    '<div class="compare">',
    renderOutputPane("baseline 输出", group.samples.baseline),
    renderOutputPane("skill 输出", group.samples.skill),
    "</div>",
    "</article>",
  ].join("");
}

function renderOutputPane(title, sample) {
  if (!sample) {
    return `<details class="output-pane"><summary>${escapeHtml(title)}</summary><p class="muted">没有这个模式的输出。</p></details>`;
  }
  return [
    '<details class="output-pane">',
    `<summary>${escapeHtml(title)}</summary>`,
    `<div class="mono">${escapeHtml(sampleOutputPath(sample))}</div>`,
    `<pre>${escapeHtml(fullSampleOutput(sample))}</pre>`,
    "</details>",
  ].join("");
}

function renderComparisonTable(samplesByMode) {
  const rows = [];
  for (const check of collectComparableChecks(samplesByMode)) {
    rows.push([
      "<tr>",
      `<td class="nowrap">${escapeHtml(check.group)}</td>`,
      `<td>${escapeHtml(check.name)}</td>`,
      `<td>${renderVerdictCell(check.baseline, samplesByMode.baseline)}</td>`,
      `<td>${renderVerdictCell(check.skill, samplesByMode.skill)}</td>`,
      "</tr>",
    ].join(""));
  }

  return [
    "<table>",
    "<thead><tr><th>类型</th><th>检查项</th><th>baseline</th><th>skill</th></tr></thead>",
    `<tbody>${rows.join("")}</tbody>`,
    "</table>",
  ].join("");
}

function collectComparableChecks(samplesByMode) {
  const checks = new Map();
  for (const [mode, sample] of Object.entries(samplesByMode)) {
    for (const item of sample.评分?.场景期望?.项目 ?? []) {
      addComparableCheck(checks, "关键期望", item.名称, mode, {
        passed: item.命中,
        reason: item.判定说明,
        expectation: item.期望看到,
        evidence: item.证据,
      });
    }
    for (const item of sample.评分?.风险错误?.项目 ?? []) {
      addComparableCheck(checks, "高风险错误", item.名称, mode, {
        passed: !item.出现,
        reason: item.判定说明,
        expectation: item.期望看到,
        evidence: item.证据,
      });
    }
    for (const name of visibleCriterionNames) {
      const detail = sample.评分?.检查项?.[name];
      addComparableCheck(checks, "辅助检查", name, mode, {
        applicable: detail?.适用 ?? true,
        passed: Boolean(detail?.通过 ?? sample.评分?.命中项?.[name]),
        reason: detail?.判定说明 ?? (sample.评分?.命中项?.[name] ? "找到辅助检查证据。" : "未找到辅助检查证据。"),
        expectation: detail?.期望看到 ?? "",
        evidence: detail?.证据 ?? "",
      });
    }
  }
  return [...checks.values()];
}

function addComparableCheck(checks, group, name, mode, result) {
  const key = `${group}:${name}`;
  if (!checks.has(key)) {
    checks.set(key, { group, name, baseline: null, skill: null });
  }
  checks.get(key)[mode] = result;
}

function renderVerdictCell(result, sample) {
  if (!sample || !result) return '<span class="muted">没有输出</span>';
  if (result.applicable === false) {
    return [
      '<span class="verdict na">N/A</span>',
      `<div>${escapeHtml(result.reason ?? "本用例不适用。")}</div>`,
      `<div class="expect"><strong>期望看到：</strong>${escapeHtml(result.expectation || "该检查只在触发条件存在时判定")}</div>`,
    ].join("");
  }
  const evidence = result.evidence || "未匹配到该检查的专属证据；完整原始输出见下方折叠区。";
  return [
    `<span class="verdict ${result.passed ? "pass" : "fail"}">${result.passed ? "PASS" : "FAIL"}</span>`,
    `<div>${escapeHtml(result.reason ?? "")}</div>`,
    `<div class="expect"><strong>期望看到：</strong>${escapeHtml(result.expectation || "该检查对应的匹配条件")}</div>`,
    `<div class="evidence"><strong>匹配证据：</strong>${escapeHtml(evidence)}</div>`,
  ].join("");
}

function comparisonAnchorId(caseId) {
  return `case-${String(caseId).toLowerCase().replace(/[^a-z0-9_-]+/g, "-")}`;
}

function fullSampleOutput(sample) {
  return sample.原始输出 ?? sample.输出摘录 ?? "本样本没有原始输出。";
}

function renderSampleCheckTable(sample) {
  if (!sample.评分) return '<p class="muted">本样本还没有评分。</p>';
  const rows = [];

  for (const item of sample.评分.场景期望?.项目 ?? []) {
    rows.push(renderCheckRow({
      group: "关键期望",
      name: item.名称,
      passed: item.命中,
      reason: item.判定说明,
      expectation: item.期望看到,
      evidence: item.证据 || sample.输出摘录,
    }));
  }

  for (const item of sample.评分.风险错误?.项目 ?? []) {
    rows.push(renderCheckRow({
      group: "高风险错误",
      name: item.名称,
      passed: !item.出现,
      reason: item.判定说明,
      expectation: item.期望看到,
      evidence: item.证据 || sample.输出摘录,
    }));
  }

  for (const name of visibleCriterionNames) {
    const detail = sample.评分.检查项?.[name];
    rows.push(renderCheckRow({
      group: "辅助检查",
      name,
      passed: Boolean(detail?.通过 ?? sample.评分.命中项?.[name]),
      reason: detail?.判定说明 ?? (sample.评分.命中项?.[name] ? "找到辅助检查证据。" : "未找到辅助检查证据。"),
      expectation: detail?.期望看到,
      evidence: detail?.证据 || sample.输出摘录,
    }));
  }

  return [
    "<table>",
    "<thead><tr><th>类型</th><th>检查项</th><th>结果</th><th>判定说明</th><th>期望看到</th><th>实际输出摘录</th></tr></thead>",
    `<tbody>${rows.join("")}</tbody>`,
    "</table>",
  ].join("");
}

function renderCheckRow({ group, name, passed, reason, expectation, evidence }) {
  return [
    "<tr>",
    `<td class="nowrap">${escapeHtml(group)}</td>`,
    `<td>${escapeHtml(name)}</td>`,
    `<td class="${passed ? "pass" : "fail"}">${passed ? "PASS" : "FAIL"}</td>`,
    `<td>${escapeHtml(reason ?? "")}</td>`,
    `<td>${escapeHtml(expectation || "该检查对应的匹配条件")}</td>`,
    `<td>${escapeHtml(evidence || "本样本没有原始输出摘录。")}</td>`,
    "</tr>",
  ].join("");
}

function sampleOutputPath(sample) {
  return `outputs/${sample.测试编号}/${sample.模式}-${sample.第几次运行}.md`;
}

function renderModeCard(mode, row) {
  const risks = (row.风险标记?.疑似假默认值?.出现次数 ?? 0) + (row.风险标记?.疑似临时映射?.出现次数 ?? 0);
  return [
    '<article class="card">',
    `<div class="label">${escapeHtml(mode)}</div>`,
    `<strong>${formatScore(row.平均分, row.平均满分)}</strong>`,
    `<div class="muted">样本 ${row.样本数} · 主分 ${formatScore(row.总分, row.主分满分)} · 辅助风险 ${risks}</div>`,
    "</article>",
  ].join("");
}

function renderAggregateMetricCard(title, description, modes, aggregate, group, countKey, totalKey, rateKey) {
  const rows = modes.map((mode) => {
    const item = aggregate[mode][group];
    const count = item[countKey] ?? 0;
    const total = item[totalKey] ?? 0;
    const rate = item[rateKey] ?? 0;
    return [
      '<div class="barrow">',
      `<span>${escapeHtml(mode)}</span>`,
      `<div class="bar"><div class="fill ${mode}" style="width:${Math.round(rate * 100)}%"></div></div>`,
      `<strong>${count}/${total}</strong>`,
      "</div>",
    ].join("");
  });
  return `<article class="metric"><h3>${escapeHtml(title)}</h3><p class="metric-desc">${escapeHtml(description)}</p>${rows.join("")}</article>`;
}

function renderMetricCard(name, modes, aggregate, group, isRisk = false) {
  const copy = metricCopy[name] ?? { title: name, description: "" };
  const rows = modes.map((mode) => {
    const item = aggregate[mode][group][name];
    const count = isRisk ? item.出现次数 : item.命中数;
    const rate = isRisk ? item.出现率 : item.命中率;
    const fillClass = isRisk ? "fill risk" : `fill ${mode}`;
    return [
      '<div class="barrow">',
      `<span>${escapeHtml(mode)}</span>`,
      `<div class="bar"><div class="${fillClass}" style="width:${Math.round(rate * 100)}%"></div></div>`,
      `<strong>${count}/${aggregate[mode].样本数}</strong>`,
      "</div>",
    ].join("");
  });
  const description = isRisk
    ? ""
    : `<p class="metric-desc">${escapeHtml(copy.description)}</p>`;
  const scoreLine = isRisk
    ? ""
    : `<p class="raw-metric">辅助检查清单比分：${modes.map((mode) => {
        const item = aggregate[mode][group][name];
        return `${escapeHtml(mode)} ${item.命中数}/${aggregate[mode].样本数}`;
      }).join(" · ")}</p>`;
  return `<article class="metric${isRisk ? " risk" : ""}"><h3>${escapeHtml(copy.title)}</h3>${scoreLine}${description}${rows.join("")}</article>`;
}

function collectCaseItemDetails(samples, modes, group, countKind) {
  const rows = new Map();
  for (const sample of samples) {
    const items = sample.评分?.[group]?.项目 ?? [];
    for (const item of items) {
      if (!rows.has(item.名称)) {
        rows.set(item.名称, Object.fromEntries(modes.map((mode) => [mode, { count: 0, total: 0 }])));
      }
      const modeRow = rows.get(item.名称)[sample.模式];
      if (!modeRow) continue;
      modeRow.total += 1;
      if (countKind === "命中" && item.命中) modeRow.count += 1;
      if (countKind === "避开" && !item.出现) modeRow.count += 1;
    }
  }
  return [...rows.entries()].map(([name, counts]) => ({ name, counts }));
}

function renderDetailCard(title, description, rows, modes) {
  const body = rows.length
    ? rows.map((row) => renderDetailRow(row, modes)).join("")
    : '<p class="muted">本次运行还没有可展示的逐项明细。</p>';
  return `<article class="detail"><h3>${escapeHtml(title)}</h3><p class="metric-desc">${escapeHtml(description)}</p>${body}</article>`;
}

function renderDetailRow(row, modes) {
  const chips = modes
    .map((mode) => {
      const item = row.counts[mode] ?? { count: 0, total: 0 };
      return `<span class="chip">${escapeHtml(mode)} ${item.count}/${item.total}</span>`;
    })
    .join("");
  return `<div class="detail-row"><div class="detail-name">${escapeHtml(row.name)}</div><div class="chips">${chips}</div></div>`;
}

function formatHit(hit, sampleCount) {
  return `${hit.命中数}/${sampleCount} (${formatPercent(hit.命中率)})`;
}

function formatRisk(risk, sampleCount) {
  return `${risk.出现次数}/${sampleCount} (${formatPercent(risk.出现率)})`;
}

function formatCountRate(count, total, rate) {
  return `${count}/${total} (${formatPercent(rate)})`;
}

function formatScore(score, maxScore) {
  if (!maxScore) return formatNumber(score);
  return `${formatNumber(score)}/${formatNumber(maxScore)}`;
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function createCriterionAggregate() {
  return Object.fromEntries(
    scoringCriterionNames.map((name) => [name, { 命中数: 0, 命中率: 0 }]),
  );
}

function createRiskAggregate() {
  return Object.fromEntries(
    riskFlagNames.map((name) => [name, { 出现次数: 0, 出现率: 0 }]),
  );
}

function createCaseExpectationAggregate() {
  return { 命中数: 0, 总数: 0, 命中率: 0 };
}

function createCaseRiskAggregate() {
  return { 避开数: 0, 总数: 0, 出现次数: 0, 避开率: 0, 出现率: 0 };
}

function renderSampleScore(sample) {
  if (!sample.评分) return "";
  const parts = [`主分 ${formatScore(sample.评分.总分, sample.评分.主分满分)}`];
  if (sample.评分.场景期望) {
    parts.push(`关键期望 ${sample.评分.场景期望.命中数}/${sample.评分.场景期望.总数}`);
  }
  if (sample.评分.风险错误) {
    parts.push(`风险错误避开 ${sample.评分.风险错误.避开数}/${sample.评分.风险错误.总数}`);
  }
  return ` · ${parts.join(" · ")}`;
}

function buildSampleSummary({ testCase, mode, run, status, score, output = "", injectedFiles = [] }) {
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

  if (score) {
    row.评分 = translateScore(score);
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

function translateScore(score) {
  return {
    总分: score.total,
    主分: score.主分,
    主分满分: score.主分满分,
    基础项总分: score.基础项总分,
    ...(score.场景期望 ? { 场景期望: score.场景期望 } : {}),
    ...(score.风险错误 ? { 风险错误: score.风险错误 } : {}),
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
    检查项: score.检查项,
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

function summarizeOutput(output) {
  const text = output
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*`_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return truncateExcerpt(text, 420);
}

function formatTags(tags = []) {
  return tags.length ? tags.join(", ") : "generic";
}

function formatInjectedFiles(sample) {
  if (!sample) return "没有 skill 输出。";
  const files = sample.Skill注入文件 ?? [];
  return files.length ? files.join("\n") : "baseline 未注入 skill。";
}

function formatReactTsBranch(skillSample, tags = []) {
  if (skillSample?.ReactTS分支) return skillSample.ReactTS分支;
  const needsReactTs = tags.includes("react-typescript");
  if (!skillSample) {
    return needsReactTs ? "没有 skill 输出，无法判断 React/TS 参考是否命中。" : "无需命中 React/TS 参考。";
  }
  return describeReactTsBranch({ tags }, "skill", skillSample.Skill注入文件 ?? []);
}

function inferEnvironment(testCase) {
  const tags = testCase.tags ?? [];
  if (tags.includes("go")) return "Go 项目";
  if (tags.includes("react-typescript")) return "现有 TypeScript/React 项目";
  if (tags.includes("db")) return "带数据库/repository 层的 TypeScript 服务";
  if (tags.includes("webhook")) return "Node.js webhook/event handler 项目";
  if (tags.includes("sdk")) return "集成外部 SDK 的 TypeScript 服务";
  if (tags.includes("ai-schema")) return "TypeScript tool/schema 校验项目";
  if (tags.includes("api")) return "对外或内部 API 契约项目";
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

export function parseArgs(argv) {
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
