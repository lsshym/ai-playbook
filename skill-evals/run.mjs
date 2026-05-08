#!/usr/bin/env node

import { loadEvalDefinition } from "./_shared/standard-skill-eval.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const [evalName, ...argv] = process.argv.slice(2);
  if (!evalName) {
    throw new Error("用法：node skill-evals/run.mjs <eval-name> [--dry-run] [--case ID] [--runs N]");
  }

  const definition = await loadEvalDefinition(repoRoot, evalName);
  const result = await definition.run({
    ...definition.parseArgs(argv),
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
