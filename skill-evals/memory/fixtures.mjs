import path from "node:path";

export function buildFixture(testCase) {
  const builders = {
    "MEM-SETUP-01": buildMemSetup01Fixture,
    "MEM-SETUP-03": buildMemSetup03Fixture,
    "MEM-SETUP-04": buildMemSetup04Fixture,
    "MEM-LOAD-02": buildMemLoad02Fixture,
    "MEM-LOAD-03": buildMemLoad03Fixture,
    "MEM-SYNC-01": buildMemSync01Fixture,
    "MEM-SYNC-03": buildMemSync03Fixture,
    "MEM-SYNC-04": buildMemSync04Fixture,
    "MEM-SYNC-05": buildMemSync05Fixture,
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
    ],
  };
}

function buildMemSetup04Fixture() {
  return {
    files: [
      file(".wingman/memory/projectBrief.md", md(`# Project Brief

## 0. Memory Settings
- **Language**: \`zh-CN\`

## 1. Architecture Decisions (ADR - Global Rules)
- 所有 checkout 支付状态字段必须在 domain memory 中显式登记。 [WHY]: 防止 API 字段迁移期间出现无声 fallback。

## 2. Domain Registry
- \`checkout\`: read when work touches checkout payment, order status, fulfillment, or refunds.
`)),
      file(".wingman/memory/activeContext.md", md(`# Active Context

## Pending Tasks
- [ ] Verify checkout payment status rollout after next webhook deployment.

---
## Current Sprint Logs
### [2026-05-07] Checkout payment rollout context
- **目标**: 保留 checkout 支付状态迁移的当前上下文。
- **核心文件明细**:
  - \`src/checkoutWebhook.ts\`: nextStatus - payment webhook 仍在迁移观察期。
- **遗留问题/备注**: 不要重写这条手工维护的当前日志。
`)),
      file(".wingman/memory/domains/README.md", domainReadme()),
      file(".wingman/memory/domains/checkout.md", md(`# Checkout Domain

## Current Truths
- \`payment_status\` 是 checkout 支付状态的 canonical field。 [WHY]: 用户已确认支付状态不能从订单状态推断。
  - **Evidence**: existing memory
  - **Applies When**: checkout payment display and webhook mapping

## Notes
- Preserve this hand-written checkout note during memory setup.
`)),
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

function buildMemSync05Fixture() {
  return {
    files: [
      file(".wingman/memory/projectBrief.md", projectBriefWithDomains(["checkout", "auth", "billing"])),
      file(".wingman/memory/activeContext.md", activeContext("Partial checkout contract conflict is being resolved.")),
      file(".wingman/memory/domains/README.md", domainReadme()),
      file(".wingman/memory/domains/checkout.md", md(`# Checkout Domain

## Current Truths
- Refund status uses \`refund_status\` and must not be inferred from \`payment_status\`. [WHY]: Refund lifecycle can continue after payment succeeds.
  - **Evidence**: existing memory
  - **Applies When**: checkout refund display and refund reconciliation
- Payment UI may fall back from missing \`payment_status\` to \`order_status\` during migration. [WHY]: Historical temporary fallback from the old provider migration.
  - **Evidence**: old migration note
  - **Applies When**: checkout payment display
- Fulfillment starts only after order status is \`paid\`. [WHY]: Shipment must not start before confirmed payment.
  - **Evidence**: existing memory
  - **Applies When**: checkout fulfillment and webhook status transitions
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
      input("src/checkoutWebhook.ts", checkoutWebhookFixed()),
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
