import path from "node:path";

export function buildFixture(testCase) {
  const builders = {
    "MEM-SETUP-01": buildMemSetup01Fixture,
    "MEM-SETUP-02": buildMemSetup02Fixture,
    "MEM-SETUP-03": buildMemSetup03Fixture,
    "MEM-LOAD-01": buildMemLoad01Fixture,
    "MEM-LOAD-02": buildMemLoad02Fixture,
    "MEM-LOAD-03": buildMemLoad03Fixture,
    "MEM-LOAD-04": buildMemLoad04Fixture,
    "MEM-SYNC-01": buildMemSync01Fixture,
    "MEM-SYNC-02": buildMemSync02Fixture,
    "MEM-SYNC-03": buildMemSync03Fixture,
    "MEM-SYNC-04": buildMemSync04Fixture,
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

function buildMemSetup01Fixture() {
  return {
    files: [
      missing(".wingman/memory/projectBrief.md", "markdown"),
      missing(".wingman/memory/activeContext.md", "markdown"),
      missing(".wingman/memory/domains/README.md", "markdown"),
      missing(".wingman/memory/archive/README.md", "markdown"),
      missing("AGENTS.md", "markdown"),
      missing("CLAUDE.md", "markdown"),
      missing(".cursor/rules/wingman-memory.mdc", "markdown"),
    ],
  };
}

function buildMemSetup02Fixture() {
  return {
    files: [
      file("AGENTS.md", md(`# Existing Agent Rules

Keep the custom release checklist.

<!-- Wingman Memory:start -->
# Old Wingman Memory
Use stale root.
<!-- Wingman Memory:end -->

Do not remove this deployment note.
`)),
      file("CLAUDE.md", md(`# Claude Local Rules

Preserve this custom Claude note.

<!-- Wingman Memory:start -->
@OLD_AGENTS.md
<!-- Wingman Memory:end -->
`)),
      file(".cursor/rules/wingman-memory.mdc", md(`---
alwaysApply: true
---

Custom Cursor note must remain.

<!-- Wingman Memory:start -->
Old memory pointer.
<!-- Wingman Memory:end -->
`)),
      missing(".wingman/memory/projectBrief.md", "markdown"),
      missing(".wingman/memory/activeContext.md", "markdown"),
      missing(".wingman/memory/domains/README.md", "markdown"),
      missing(".wingman/memory/archive/README.md", "markdown"),
    ],
  };
}

function buildMemSetup03Fixture() {
  return {
    files: [
      missing(".wingman/memory/projectBrief.md", "markdown"),
      missing(".wingman/memory/activeContext.md", "markdown"),
      missing(".wingman/memory/domains/README.md", "markdown"),
      file("src/checkoutWebhook.ts", ts(`type OrderStatus = "pending_payment" | "paid";

export function nextStatus(event: { type: string }): OrderStatus {
  if (event.type === "payment.succeeded") {
    return "pending_payment";
  }
  return "pending_payment";
}
`)),
    ],
  };
}

function buildMemLoad01Fixture() {
  return {
    files: [
      file(".wingman/memory/projectBrief.md", projectBriefWithDomains(["checkout", "auth", "billing"])),
      file(".wingman/memory/activeContext.md", activeContext("Checkout webhook fix is in progress.")),
      file(".wingman/memory/domains/README.md", domainReadme()),
      file(".wingman/memory/domains/checkout.md", checkoutDomain()),
      input(".wingman/memory/domains/auth.md", md(`# Auth Domain

## Current Truths
- 诱饵: webhook success should never mark checkout paid. [WHY]: Auth lockout wording only.
`)),
      input(".wingman/memory/domains/billing.md", md(`# Billing Domain

## Current Truths
- 诱饵: payment success maps to billing reconciliation only. [WHY]: Billing export note.
`)),
      input(".wingman/memory/archive/2026-04.md", md(`# April Archive

### Old checkout rule
- 过期诱饵: payment.succeeded should keep orders in pending_payment.
`)),
      file("src/checkoutWebhook.ts", checkoutWebhookBug()),
    ],
  };
}

function buildMemLoad02Fixture() {
  return {
    files: [
      file(".wingman/memory/projectBrief.md", projectBriefWithDomains(["checkout"])),
      file(".wingman/memory/activeContext.md", activeContext("Checkout status-flow work is active.")),
      file(".wingman/memory/domains/README.md", domainReadme()),
      file(".wingman/memory/domains/checkout/index.md", md(`# Checkout Domain

## When To Read This Domain
- Checkout webhook
- Payment flow
- Order status transitions

## Current Truths
- Use subfiles for topic-specific rules. [WHY]: Checkout is large enough to split.

## Subfiles
- pricing.md: amount and currency display rules
- status-flow.md: checkout, payment, and order state mapping
- api-contracts.md: request/response fields and backend contracts
`)),
      input(".wingman/memory/domains/checkout/pricing.md", md(`# Checkout Pricing

## Current Truths
- 诱饵: pricing files do not decide order status. [WHY]: Money display is separate.
`)),
      file(".wingman/memory/domains/checkout/status-flow.md", md(`# Checkout Status Flow

## Current Truths
- On \`payment.succeeded\`, set order status to \`paid\`. [WHY]: Fulfillment starts only after confirmed payment.
`)),
      input(".wingman/memory/domains/checkout/api-contracts.md", md(`# Checkout API Contracts

## Current Truths
- 诱饵: API field names do not decide status transitions. [WHY]: This file is only about payload fields.
`)),
      file("src/checkoutWebhook.ts", checkoutWebhookBug()),
    ],
  };
}

function buildMemLoad03Fixture() {
  return {
    files: [
      file(".wingman/memory/projectBrief.md", projectBriefWithDomains(["checkout"])),
      file(".wingman/memory/activeContext.md", activeContext("Current rule: payment.succeeded maps to paid.")),
      file(".wingman/memory/domains/README.md", domainReadme()),
      file(".wingman/memory/domains/checkout.md", checkoutDomain()),
      input(".wingman/memory/archive/2026-04.md", md(`# April Archive

### Old Checkout Notes
- OLD AND WRONG: \`payment.succeeded\` should remain \`pending_payment\`.
`)),
      file("src/checkoutWebhook.ts", checkoutWebhookBug()),
    ],
  };
}

function buildMemLoad04Fixture() {
  return {
    files: [
      missing(".wingman/memory/projectBrief.md", "markdown"),
      file("src/inviteCodes.ts", ts(`export function createInviteCode(seed: string) {
  return seed.slice(0, 6);
}
`)),
    ],
  };
}

function buildMemSync01Fixture() {
  return {
    files: [
      file(".wingman/memory/projectBrief.md", projectBriefWithDomains(["checkout"])),
      file(".wingman/memory/activeContext.md", activeContext("Older checkout notes remain below.")),
      file(".wingman/memory/domains/README.md", domainReadme()),
      file(".wingman/memory/domains/checkout.md", checkoutDomain()),
      file("src/checkoutWebhook.ts", checkoutWebhookFixed()),
    ],
  };
}

function buildMemSync02Fixture() {
  return {
    files: [
      file(".wingman/memory/projectBrief.md", projectBriefWithDomains(["checkout", "auth", "billing"])),
      file(".wingman/memory/activeContext.md", activeContext("API contract confirmed by user.")),
      file(".wingman/memory/domains/README.md", domainReadme()),
      file(".wingman/memory/domains/checkout.md", md(`# Checkout Domain

## Current Truths
- Legacy note: \`order_status\` was once used as a fallback for payment UI. [WHY]: Historical migration note.
`)),
      input(".wingman/memory/domains/auth.md", md(`# Auth Domain

## Current Truths
- Auth tokens expire after 30 minutes. [WHY]: Security policy.
`)),
      input(".wingman/memory/domains/billing.md", md(`# Billing Domain

## Current Truths
- Billing exports use invoice status. [WHY]: Accounting integration contract.
`)),
    ],
  };
}

function buildMemSync03Fixture() {
  return {
    files: [
      file(".wingman/memory/projectBrief.md", projectBriefWithDomains(["checkout"])),
      file(".wingman/memory/activeContext.md", activeContext("Existing meaningful log.")),
      file(".wingman/memory/domains/README.md", domainReadme()),
      file(".wingman/memory/domains/checkout.md", checkoutDomain()),
      file("src/formatOrder.ts", ts(`export function formatOrderId(orderId: string) {
  const normalizedOrderId = orderId.trim();
  return normalizedOrderId;
}
`)),
    ],
  };
}

function buildMemSync04Fixture() {
  return {
    files: [
      file(".wingman/memory/projectBrief.md", projectBriefWithDomains(["checkout"])),
      file(".wingman/memory/activeContext.md", activeContext("Existing log should not change.")),
      file(".wingman/memory/domains/README.md", domainReadme()),
      file(".wingman/memory/domains/checkout.md", checkoutDomain()),
      file("src/checkoutWebhook.ts", checkoutWebhookFixed()),
    ],
  };
}

function buildGenericFixture(testCase) {
  return {
    files: [
      file("README.md", md(`# ${testCase.id}

${testCase.scenario ?? ""}
`)),
    ],
  };
}

function inferEnvironment(testCase) {
  if (testCase.id?.startsWith("MEM-SETUP")) return "Wingman memory 初始化 fixture";
  if (testCase.id?.startsWith("MEM-LOAD")) return "带 Wingman memory 的 TypeScript 项目";
  if (testCase.id?.startsWith("MEM-SYNC")) return "需要同步 Wingman memory 的 TypeScript 项目";
  return "现有项目";
}

function projectBriefWithDomains(domains) {
  const registry = domains
    .map((domain) => `- \`${domain}\`: read when work touches ${domain}.`)
    .join("\n");
  return md(`# Project Brief

## 0. Memory Settings
- **Language**: \`zh-CN\`

## 1. Architecture Decisions (ADR - Global Rules)

## 2. Domain Registry
${registry}
`);
}

function activeContext(note) {
  return md(`# Active Context

## Pending Tasks
- [ ] Continue current eval fixture task.

---
## Current Sprint Logs
### [2026-05-01] Existing log
- **Goal**: Preserve this old log during eval.
- **Core Files**:
  - \`src/existing.ts\`: Existing context that should remain.
- **Notes**: ${note}
`);
}

function domainReadme() {
  return md(`# Domain Memory

Domains store durable business and architecture knowledge, not feature logs.
`);
}

function checkoutDomain() {
  return md(`# Checkout Domain

## Current Truths
- On \`payment.succeeded\`, set order status to \`paid\`. [WHY]: Paid orders can enter fulfillment only after confirmed payment.
  - **Evidence**: existing memory
  - **Applies When**: checkout webhook status transitions
`);
}

function checkoutWebhookBug() {
  return ts(`type OrderStatus = "pending_payment" | "paid";

export function nextStatus(event: { type: string }): OrderStatus {
  if (event.type === "payment.succeeded") {
    return "pending_payment";
  }
  return "pending_payment";
}
`);
}

function checkoutWebhookFixed() {
  return ts(`type OrderStatus = "pending_payment" | "paid";

export function nextStatus(event: { type: string }): OrderStatus {
  if (event.type === "payment.succeeded") {
    return "paid";
  }
  return "pending_payment";
}
`);
}

function file(filePath, content, language) {
  return {
    path: filePath,
    content,
    language,
  };
}

function input(filePath, content, language) {
  return {
    ...file(filePath, content, language),
    role: "input",
  };
}

function missing(filePath, language) {
  return {
    path: filePath,
    content: "",
    language,
    initiallyExists: false,
  };
}

function languageForPath(filePath) {
  const ext = path.extname(filePath).slice(1);
  if (ext === "ts") return "typescript";
  if (ext === "md" || ext === "mdc") return "markdown";
  return ext || "text";
}

function ts(value) {
  return `${value.trim()}\n`;
}

function md(value) {
  return `${value.trim()}\n`;
}
