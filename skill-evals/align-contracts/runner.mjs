#!/usr/bin/env node

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
} from "../_shared/code-snapshot-eval.mjs";
import { parseCasesFromMarkdownTable } from "../_shared/skill-eval-runner.mjs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const casesPath = path.join(repoRoot, "skill-evals", "align-contracts", "cases.zh-CN.md");
const defaultResultsRoot = path.join(repoRoot, ".eval-runs", "align-contracts");
const cleanCodexHome = path.join(os.tmpdir(), "wingman-align-contracts-codex-home");
const cleanWorkdirRoot = path.join(os.tmpdir(), "wingman-align-contracts-workdirs");

const skillName = "align-contracts";
const evalName = "align-contracts";
const modes = ["baseline", "skill"];
const smokeCaseIds = ["AC-S01", "AC-S02", "AC-S03", "AC-S04", "AC-S05", "AC-S06"];
const reactTypescriptReferencePath = "skills/align-contracts/references/frontend-react-typescript.md";
const skillReferenceMap = {
  [skillName]: {
    "react-typescript": ["references/frontend-react-typescript.md"],
  },
};

const evalConfig = {
  repoRoot,
  casesPath,
  defaultResultsRoot,
  cleanCodexHome,
  cleanWorkdirRoot,
  evalName,
  skillName,
  modes,
  defaultRuns: 2,
  smokeCaseIds,
  referenceMap: skillReferenceMap,
  buildFixture: buildCaseFixture,
  buildPrompt: (options) => buildPrompt(
    options.testCase,
    options.mode,
    options.skillText,
    options.injectedFiles,
  ),
  inferEnvironment,
  buildSampleExtras: ({ testCase, mode, injectedFiles }) => ({
    ReactTS分支: describeReactTsBranch(testCase, mode, injectedFiles),
  }),
  resultsReadme: [
    "# align-contracts 代码对比评估输出",
    "",
    "这个目录由 `npm run eval:align-contracts` 生成。",
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
  ].join("\n"),
};

export function parseCasesFromReport(report) {
  return parseCasesFromMarkdownTable(report);
}

export function selectCasesForRun(cases, args = {}) {
  return selectCodeSnapshotCases(cases, args, smokeCaseIds);
}

export async function resolveSkillBundle(name, tags = []) {
  return resolveCodeSnapshotSkillBundle({
    repoRoot,
    skillName: name,
    tags,
    referenceMap: skillReferenceMap,
  });
}

export function buildPrompt(testCase, mode, skillText, injectedFiles = []) {
  return buildCodeSnapshotEvalPrompt({
    evalName: "Wingman align-contracts skill",
    skillName,
    testCase,
    mode,
    skillText,
    injectedFiles,
    environment: inferEnvironment(testCase),
  });
}

export function parseArgs(argv) {
  return parseCodeSnapshotArgs(argv, { defaultRuns: 2 });
}

export function aggregateSummary(samples) {
  return aggregateCodeSnapshotSummary(samples, modes);
}

export function formatAggregateReport(aggregate) {
  return formatCodeSnapshotAggregateReport(aggregate, modes);
}

export function formatConsoleSummary(aggregate) {
  return formatCodeSnapshotConsoleSummary(aggregate, modes);
}

export function formatHtmlReport({ aggregate, planned, samples }) {
  return formatCodeSnapshotHtmlReport({
    title: "align-contracts 代码对比评估报告",
    aggregate,
    planned,
    samples,
    modes,
  });
}

export async function runAlignContractsEval(args) {
  return runCodeSnapshotEval(evalConfig, args);
}

export function buildCaseFixture(testCase) {
  const builders = {
    "AC-S01": buildAcS01Fixture,
    "AC-S02": buildAcS02Fixture,
    "AC-S03": buildAcS03Fixture,
    "AC-S04": buildAcS04Fixture,
    "AC-S05": buildAcS05Fixture,
    "AC-S06": buildAcS06Fixture,
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

function buildAcS01Fixture() {
  return {
    files: [
      {
        path: "src/UserHeader.tsx",
        language: "tsx",
        content: tsx(`type ApiUser = {
  user_name: string;
};

type UserViewModel = {
  userName: string;
};

export function UserHeader({ user }: { user: ApiUser }) {
  const view: UserViewModel = {
    userName: user.userName,
  };

  return <h1>{view.userName}</h1>;
}
`),
      },
    ],
  };
}

function buildAcS02Fixture() {
  return {
    files: [
      {
        path: "src/domain/user.ts",
        language: "ts",
        content: ts(`export type User = {
  userId: string;
  displayName: string;
};
`),
      },
      {
        path: "src/api/users.ts",
        language: "ts",
        content: ts(`import type { User } from "../domain/user";

type ApiUser = {
  user_id: string;
  display_name: string;
};

export function loadUser(apiUser: ApiUser): User {
  return apiUser;
}
`),
      },
    ],
  };
}

function buildAcS03Fixture() {
  return reactFixture("CheckoutBadge.tsx", `type ApiCheckout = {
  status: "paid" | "pending" | "failed";
};

type CheckoutType = "guest" | "express" | "standard";

export function toCheckoutType(checkout: ApiCheckout): CheckoutType {
  return checkout.status;
}
`);
}

function buildAcS04Fixture() {
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

function buildAcS05Fixture() {
  return {
    files: [
      {
        path: "src/apiTypes.ts",
        language: "ts",
        content: ts(`export type ApiOrder = {
  id: string;
  amount: {
    total_minor_units: number;
    currency: string;
  };
};

export type ApiRefund = {
  id: string;
  amount: {
    total_minor_units: number;
    currency: string;
  };
};
`),
      },
      {
        path: "src/components/Money.tsx",
        language: "tsx",
        content: tsx(`import type { ApiOrder } from "../apiTypes";

type MoneyProps = {
  amount: ApiOrder["amount"];
};

export function Money({ amount }: MoneyProps) {
  return <span>{amount.currency} {(amount.total_minor_units / 100).toFixed(2)}</span>;
}
`),
      },
      {
        path: "src/pages/OrderSummary.tsx",
        language: "tsx",
        content: tsx(`import type { ApiOrder } from "../apiTypes";
import { Money } from "../components/Money";

export function OrderSummary({ order }: { order: ApiOrder }) {
  return <Money amount={order.amount} />;
}
`),
      },
      {
        path: "src/pages/RefundSummary.tsx",
        language: "tsx",
        content: tsx(`import type { ApiRefund } from "../apiTypes";
import { Money } from "../components/Money";

export function RefundSummary({ refund }: { refund: ApiRefund }) {
  return <Money amount={refund.amount} />;
}
`),
      },
    ],
  };
}

function buildAcS06Fixture() {
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

function describeReactTsBranch(testCase, mode, injectedFiles = []) {
  if (mode !== "skill") return "baseline 不注入 skill。";
  const needsReactTs = (testCase.tags ?? []).includes("react-typescript");
  const hasReactTsReference = injectedFiles.includes(reactTypescriptReferencePath);
  if (needsReactTs && hasReactTsReference) return "已命中 React/TS 参考。";
  if (needsReactTs) return "未命中 React/TS 参考。";
  if (hasReactTsReference) return "误注入 React/TS 参考。";
  return "无需命中 React/TS 参考。";
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

function languageForPath(filePath) {
  const ext = path.extname(filePath).slice(1);
  return ext === "ts" ? "typescript" : ext || "text";
}

function stripMarkdown(value = "") {
  return value.replace(/`/g, "");
}

function ts(value) {
  return `${value.trim()}\n`;
}

function tsx(value) {
  return ts(value);
}

async function main() {
  const result = await runAlignContractsEval({
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
