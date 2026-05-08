#!/usr/bin/env node

import { parseEvalReviewArgs, runEvalReview } from "./_shared/eval-review.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const [evalName, ...argv] = process.argv.slice(2);
  if (!evalName) {
    throw new Error("用法：node skill-evals/review.mjs <eval-name> [--dry-run] [--case ID] [--output DIR]");
  }

  const result = await runEvalReview({
    repoRoot,
    evalName,
    ...parseEvalReviewArgs(argv),
    log: (message) => console.log(message),
  });

  console.log(`状态：${result.status}`);
  console.log(`Prompt：${result.promptPath}`);
  console.log(`AI 分析报告：${result.outputPath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
