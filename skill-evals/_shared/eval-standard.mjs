import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";

const standardHeader = ["ID", "Skill", "环境标签", "场景", "重点"];
const allowedConfigKeys = new Set([
  "evalName",
  "defaultRuns",
  "referenceMap",
  "fixtureModule",
  "promptInstructions",
]);
const allowedFileKeys = new Set([
  "path",
  "content",
  "role",
  "language",
  "initiallyExists",
  "missingContent",
]);
const allowedRoles = new Set(["editable", "input"]);

export async function collectEvalSuites(repoRoot) {
  const evalRoot = path.join(repoRoot, "skill-evals");
  const entries = await readdir(evalRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .filter((entry) => !entry.name.startsWith("_"))
    .filter((entry) => entry.name !== "checks")
    .map((entry) => ({
      name: entry.name,
      dir: path.join(evalRoot, entry.name),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function parseStandardCases(report) {
  return report
    .split("\n")
    .filter((line) => /^\|\s*[A-Z]+(?:-[A-Z0-9]+)*\s*\|/.test(line))
    .filter((line) => !line.trim().startsWith("| ID |"))
    .map((line) => {
      const cells = splitMarkdownRow(line);
      return {
        id: cells[0],
        skill: cells[1],
        tags: parseTags(cells[2]),
        scenario: cells[3],
        focus: cells[4],
        validation: cells[4],
        baselineRisk: "",
        skillExpected: cells[4],
      };
    });
}

export async function validateEvalStandard(repoRoot) {
  const issues = [];
  const suites = await collectEvalSuites(repoRoot);
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));

  validatePackageScripts(packageJson, suites, issues);

  for (const suite of suites) {
    await validateRequiredFiles(suite, issues);
    await validateNoLocalRunner(suite, issues);
    await validateCases(repoRoot, suite, issues);
    await validateConfig(suite, issues);
    await validateFixtures(suite, issues);
  }

  return issues;
}

export function validateFixtureShape(fixture, context = "fixture") {
  const issues = [];
  if (!fixture || !Array.isArray(fixture.files)) {
    return [`${context}: fixture must export { files: [...] }`];
  }
  for (const [index, file] of fixture.files.entries()) {
    const fileContext = `${context}.files[${index}]`;
    for (const key of Object.keys(file)) {
      if (!allowedFileKeys.has(key)) {
        issues.push(`${fileContext}: unsupported field ${key}`);
      }
    }
    if (!file.path) {
      issues.push(`${fileContext}: path is required`);
    } else if (file.path.includes("..") || path.isAbsolute(file.path)) {
      issues.push(`${fileContext}: path must stay inside fixture workspace`);
    }
    if (file.role && !allowedRoles.has(file.role)) {
      issues.push(`${fileContext}: role must be editable or input`);
    }
    if (file.initiallyExists !== false && typeof file.content !== "string") {
      issues.push(`${fileContext}: content is required unless initiallyExists is false`);
    }
  }
  return issues;
}

async function validateRequiredFiles(suite, issues) {
  for (const fileName of ["cases.zh-CN.md", "eval.config.mjs", "fixtures.mjs", "README.zh-CN.md"]) {
    if (!(await exists(path.join(suite.dir, fileName)))) {
      issues.push(`${suite.name}: missing ${fileName}`);
    }
  }
}

async function validateNoLocalRunner(suite, issues) {
  if (await exists(path.join(suite.dir, "runner.mjs"))) {
    issues.push(`${suite.name}: local runner.mjs is not allowed; use skill-evals/run.mjs`);
  }
}

async function validateCases(repoRoot, suite, issues) {
  const casesPath = path.join(suite.dir, "cases.zh-CN.md");
  if (!(await exists(casesPath))) return;

  const content = await readFile(casesPath, "utf8");
  const headerLine = content.split("\n").find((line) => line.trim().startsWith("| ID |"));
  if (!headerLine) {
    issues.push(`${suite.name}: cases table header is missing`);
    return;
  }
  const header = splitMarkdownRow(headerLine);
  if (JSON.stringify(header) !== JSON.stringify(standardHeader)) {
    issues.push(`${suite.name}: cases table header must be "| ID | Skill | 环境标签 | 场景 | 重点 |"`);
  }

  const cases = parseStandardCases(content);
  const seenIds = new Set();
  for (const testCase of cases) {
    if (seenIds.has(testCase.id)) {
      issues.push(`${suite.name}: duplicate case id ${testCase.id}`);
    }
    seenIds.add(testCase.id);
    if (!(await exists(path.join(repoRoot, "skills", testCase.skill, "SKILL.md")))) {
      issues.push(`${suite.name}: ${testCase.id} references unknown skill ${testCase.skill}`);
    }
  }
}

async function validateConfig(suite, issues) {
  const configPath = path.join(suite.dir, "eval.config.mjs");
  if (!(await exists(configPath))) return;
  const config = await importFresh(configPath);
  const value = config.default;
  if (!value || typeof value !== "object") {
    issues.push(`${suite.name}: eval.config.mjs must default-export an object`);
    return;
  }
  for (const key of Object.keys(value)) {
    if (!allowedConfigKeys.has(key)) {
      issues.push(`${suite.name}: eval.config.mjs unsupported field ${key}`);
    }
  }
  if (value.evalName !== suite.name) {
    issues.push(`${suite.name}: evalName must equal directory name`);
  }
  if (!Number.isInteger(value.defaultRuns) || value.defaultRuns < 1) {
    issues.push(`${suite.name}: defaultRuns must be a positive integer`);
  }
  if (value.fixtureModule !== "./fixtures.mjs") {
    issues.push(`${suite.name}: fixtureModule must be "./fixtures.mjs"`);
  }
}

async function validateFixtures(suite, issues) {
  const fixturesPath = path.join(suite.dir, "fixtures.mjs");
  const casesPath = path.join(suite.dir, "cases.zh-CN.md");
  if (!(await exists(fixturesPath)) || !(await exists(casesPath))) return;

  const fixtures = await importFresh(fixturesPath);
  if (typeof fixtures.buildFixture !== "function") {
    issues.push(`${suite.name}: fixtures.mjs must export buildFixture(testCase)`);
    return;
  }
  const cases = parseStandardCases(await readFile(casesPath, "utf8"));
  for (const testCase of cases) {
    const fixture = fixtures.buildFixture(testCase);
    issues.push(...validateFixtureShape(fixture, `${suite.name}:${testCase.id}`));
  }
}

function validatePackageScripts(packageJson, suites, issues) {
  if (packageJson.scripts?.eval !== "node skill-evals/run.mjs") {
    issues.push('package script eval must be "node skill-evals/run.mjs"');
  }
  if (packageJson.scripts?.["eval:review"] !== "node skill-evals/review.mjs") {
    issues.push('package script eval:review must be "node skill-evals/review.mjs"');
  }
  for (const suite of suites) {
    for (const suffix of ["", ":dry-run", ":review"]) {
      const scriptName = `eval:${suite.name}${suffix}`;
      if (packageJson.scripts?.[scriptName] !== undefined) {
        issues.push(`${suite.name}: package script ${scriptName} is not allowed; use generic eval scripts`);
      }
    }
  }
}

function splitMarkdownRow(line) {
  return line
    .trim()
    .slice(1, -1)
    .split(" | ")
    .map((cell) => cell.trim());
}

function parseTags(value = "") {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function importFresh(filePath) {
  return import(`${pathToFileUrl(filePath)}?t=${Date.now()}-${Math.random()}`);
}

function pathToFileUrl(filePath) {
  return `file://${filePath.split(path.sep).map(encodeURIComponent).join("/")}`;
}
