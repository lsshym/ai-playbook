# Wingman

> A cross-platform AI coding workflow plugin for steadier work in real projects.

Wingman is a cross-platform AI coding workflow plugin that gives agents project memory, contract checks, and reuse decisions so they can make steadier code changes with less context loss and duplicated work.

## How It Works

Wingman packages reusable coding-agent skills for working safely inside real projects across Codex, Cursor, Claude Code, and other AI coding platforms. It focuses on three problems agents often run into:

- **Project memory**: load relevant context before meaningful work and sync durable outcomes afterward.
- **Contract alignment**: keep API, type, schema, event, config, and UI boundaries honest when shapes or meanings drift.
- **Reuse decisions**: catalog reusable implementations and decide whether to reuse, extend, wrap, or create something new.

A typical Wingman-assisted task looks like this:

1. Before non-trivial work, `memory-load` decides whether project memory matters and reads only relevant memory files.
2. During implementation, `align-contracts` protects provider/consumer boundaries, and `reuse-select` checks whether existing implementations should be reused.
3. After creating or identifying something reusable, `reuse-catalog` records it in the reuse registry.
4. Before reporting meaningful work as complete, `memory-sync` records durable progress and decisions when they are worth remembering.
5. `memory-setup` and `react-ts-refactor` are explicit workflows. They run only when the user directly asks for them.

Wingman is not a rigid development process. Small edits can stay small. Larger changes can still use tests, planning, review, or delegation when the task calls for them. Wingman focuses on making agents steadier in existing projects by preserving context, aligning contracts, and avoiding duplicate implementations.

## Principles

- One shared content core
- Platform differences isolated to lightweight metadata shells
- YAML frontmatter enables discovery where platforms support it
- Shared prompt bodies stay centralized and duplication-free

## Directory Layout

```text
.
├── .agents/
├── .codex-plugin/
├── .cursor-plugin/
├── .claude-plugin/
├── assets/
├── skills/
├── PRIVACY.md
├── TERMS.md
├── package.json
└── README.md
```

## Capability Types

Wingman ships all capabilities as skills. Some skills are situational and may be used when their trigger conditions apply. Explicit workflow skills must only run when the user asks for them directly.

Explicit workflow skills:

- `memory-setup`
- `react-ts-refactor`

Slash-prefixed forms such as `/reuse-catalog`, `/reuse-select`, `/memory-setup`, or `/react-ts-refactor` are conceptual invocation aliases for skills. Specific platforms may namespace or display them differently, such as `/wingman:memory-setup` in Claude Code.

## Core Engineering

- `using-wingman`
- `align-contracts`

### `using-wingman`

Use as Wingman's plugin entry protocol when a platform supports startup or explicit skill invocation.

It defines:

- instruction priority between users, project-local instructions, Wingman, and default model behavior
- cross-platform skill access and tool adaptation guidance
- safe editing rules for real file changes versus abbreviated chat snippets
- capability discovery across Wingman skills
- language behavior and platform wrapper expectations

### `align-contracts`

Use when connecting one boundary to another and field shapes or meanings may drift.

Good fit:

- API response -> UI, service, or domain model
- database row -> domain entity
- webhook/event payload -> handler input
- SDK response -> internal model
- config/env/CLI input -> runtime options
- legacy type -> new type
- form state -> request DTO
- AI structured output -> tool or schema input

What it does:

- identifies the provider contract and consumer contract
- decides which side owns the meaning, or when a boundary adapter is appropriate
- separates naming-only changes from semantic mismatches
- prevents ad-hoc call-site mapping, proxy fields, and fake placeholder data
- preserves existing behavior unless the contract requires an explicit change

React and TypeScript frontend binding is kept as a specialization in `skills/align-contracts/references/frontend-react-typescript.md`. Agents should read that reference only when the task involves React, JSX, TypeScript props, frontend components, or backend-response-to-UI binding.

Example prompts:

```text
Use align-contracts to connect this webhook payload to our internal payment event.
Use align-contracts to bind this API response into the existing React component.
Use align-contracts to migrate this legacy DTO to the new domain model.
```

## Explicit Diagnostics

- `react-ts-refactor`

### `react-ts-refactor`

Use for an explicit React + TypeScript component refactor diagnostic workflow. It combines component logic and type cleanup into one plan-first table, then waits for approval before code changes.

Good fit:

- React component prop explosion
- inline props, state, callback, or display types in TSX files
- duplicated or partially reusable component-local type shapes
- parent/child component contract cleanup
- messy deep access, disorganized component logic, or nested render branches

It is not a generic refactor workflow. Do not use it for backend-only code, non-React TypeScript, pure CSS, ordinary TypeScript fixes, or direct edits without an explicit request. If the diagnostic reveals API, schema, domain, or provider/consumer semantic drift, use `align-contracts` before changing meaning.

Example prompt:

```text
/react-ts-refactor
Use /react-ts-refactor to analyze this React + TypeScript component and wait for approval before edits.
```

## Advanced Context

- `memory-load`
- `memory-sync`
- `memory-setup`

Best for repositories with longer timelines, collaborative work, or codebases where durable context matters.

Wingman stores project memory in `.wingman/memory/` inside the target repository. The memory skills read and write that directory directly; they do not create project instruction files.

### `memory-setup`

Use once in a target repository to initialize Wingman memory files.

It creates:

- `.wingman/memory/projectBrief.md`
- `.wingman/memory/activeContext.md`
- `.wingman/memory/domains/README.md`
- `.wingman/memory/archive/README.md`

The generated memory files use English templates by default, with adaptive language controlled by `projectBrief.md` -> `Memory Settings` -> `Language`.

Example prompt:

```text
/memory-setup
```

### `memory-load`

Use before non-trivial work when existing project context may affect the task.

It first decides whether memory is needed. It skips trivial isolated tasks such as small copy edits, formatting, simple style tweaks, or throwaway experiments. It loads memory when work touches existing behavior, business logic, API integration, state flow, permissions, money, orders, field mappings, reusable implementations, review, debugging, or refactoring. If uncertain, it loads memory.

What it reads:

- `projectBrief.md` for global rules and domain registry
- `activeContext.md` for hot current work
- relevant domain `index.md` and topic files
- archive files only when history is explicitly needed

It builds an internal checklist and only surfaces it when there is a conflict, missing context, or the user asks.

Example prompts:

```text
Use memory-load before changing this checkout flow.
Load Wingman memory and review the relevant domain before this refactor.
```

### `memory-sync`

Use after meaningful work to record progress and distill durable knowledge.

It records changes when they affect business rules, API contracts, state transitions, field mappings, money calculations, rule checkboxes, debugging conclusions, or durable decisions. It skips low-value noise such as pure formatting, variable renames, or behavior-preserving movement.

It updates:

- `activeContext.md` for short-term progress
- `domains/` for stable business or architecture truths
- `archive/YYYY-MM.md` when active context grows too large

It should not rewrite memory wholesale. It moves complete old log blocks to archive and only deletes logs proven obsolete or replaced.

Example prompts:

```text
Use memory-sync to record the API contract decision from this change.
Sync memory for the checkout bug fix, but do not archive unrelated history.
```

## Language Policy

Wingman's published plugin instructions are written in English. Generated memory content is adaptive: it follows `.wingman/memory/projectBrief.md` -> `Memory Settings` -> `Language` when configured, otherwise it follows the existing memory language, the user's current language, then English as fallback.

## Reuse Registry

- `reuse-catalog`
- `reuse-select`

### `reuse-catalog`

Use to catalog one reusable project implementation into `.wingman/registry/`.

Good fit:

- after creating a reusable UI component
- after extracting a shared hook or utility
- after identifying a business component worth reusing
- after formalizing a reusable module, pattern, contract, or workflow

It reads the actual source evidence, creates or updates one registry card, and keeps `.wingman/registry/index.md` as a short discovery index. Registry cards focus on selection decisions: when to use an implementation, when not to use it, similar implementations, and whether future agents should reuse, extend, wrap, or create something new.

### `reuse-select`

Use before building something new when an existing reusable implementation may already exist.

Good fit:

- finding similar components
- locating existing utilities
- checking previous reusable implementations
- deciding whether to reuse, extend, wrap, or create an implementation

It reads `.wingman/registry/index.md` first, opens only the most relevant implementation cards, compares use cases and boundaries, then returns the best reuse decision.

## Packaging Model

Wingman keeps one shared content core at the repository root:

- `skills/`

Platform wrappers stay thin:

- `.cursor-plugin/plugin.json`
- `.codex-plugin/plugin.json`
- `.agents/plugins/marketplace.json`
- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`

Cross-platform means shared content and aligned public capability names, not guaranteed identical runtime behavior on every platform. The Codex manifest points at `skills/`; the Cursor manifest points at `skills/`; the Claude plugin manifest provides conservative metadata and relies on default `skills/` discovery, while `.claude-plugin/marketplace.json` is kept as a Claude Code marketplace shell. Platform-specific startup hooks should invoke `using-wingman` instead of duplicating the plugin-level protocol.

## Local Testing

Run release checks before publishing or installing from a marketplace source:

```bash
npm test
```

Useful test entry points:

```bash
npm run test:plugin    # Current repo plugin contracts, skills, aliases, docs, hooks
npm run test:package   # Full package fixtures and negative package scenarios
npm run test:behavior  # Superpowers-style prompt/expectation/manual-review assets
npm run check:plugin   # Release health check for this plugin package
npm run test:all       # Everything above
```

`npm test` is an alias for `npm run test:all`.

These checks validate plugin manifests, marketplace metadata, referenced assets and hooks, skill frontmatter, explicit workflow gating, `using-wingman` capability coverage, package fixtures, and behavior-test assets.

For Codex, Wingman is not currently listed in the official Codex plugin directory. Install it from this GitHub repository marketplace:

```bash
curl -fsSLO https://raw.githubusercontent.com/lsshym/wingman.ai/main/scripts/install-codex-wingman.sh
bash install-codex-wingman.sh --self-delete
```

The `raw.githubusercontent.com` URL downloads the plain script file from GitHub. The script adds `lsshym/wingman.ai` as a Codex marketplace, installs a cache fallback if Codex does not create one automatically, enables `wingman@wingman-marketplace`, asks you to restart Codex, and `--self-delete` removes the downloaded installer after a successful run. After restart, Wingman should be available even if it does not appear in the official `/plugins` directory.

For Cursor, use `.cursor-plugin/plugin.json`; Cursor discovers the shared `skills/` directory through the plugin manifest.

For Claude Code, `.claude-plugin/marketplace.json` is kept as a compatibility shell. Skill invocation may be namespaced by the plugin name, for example `/wingman:memory-setup`.

## License

MIT
