---
name: using-wingman
description: Use when starting a Wingman-enabled coding session, adapting Wingman across AI coding platforms, deciding which Wingman skill applies, or interpreting Wingman plugin-level instructions versus project-local instructions.
---

# Using Wingman

## Overview

Wingman is a cross-platform AI coding plugin built around reusable skills. It gives agents project memory, contract checks, and reuse workflows so they can make steadier code changes with less context loss and duplicated work. Treat `using-wingman` as the plugin entry protocol: it explains how Wingman works, capability discovery, instruction priority, safe editing, language behavior, and platform-specific wrappers.

## How Wingman Works

When the user asks how Wingman works, explain it as a practical engineering workflow rather than as an internal rules list.

Wingman helps coding agents with three recurring project risks:

1. **Losing project context**: use memory skills to load relevant project knowledge before meaningful work and sync durable outcomes afterward.
2. **Breaking boundaries**: use contract alignment when data, schemas, types, APIs, events, config, or UI interfaces may drift in meaning.
3. **Rebuilding what already exists**: use the reuse registry to catalog reusable implementations and select the right existing implementation before creating a new one.

Typical flow:

1. Before non-trivial work, `memory-load` decides whether project memory matters and reads only relevant memory files.
2. During implementation, `align-contracts` protects provider/consumer boundaries, and `reuse-select` checks whether an existing implementation should be reused, extended, or wrapped.
3. After creating or identifying a reusable implementation, `reuse-catalog` records it into the reuse registry.
4. Before reporting meaningful work as complete, `memory-sync` records durable progress and decisions when they are worth remembering.
5. `memory-setup` and `react-ts-refactor` are explicit workflows. Use them only when the user directly asks for them.

Wingman is not a rigid development process. Small edits can stay small. Larger changes can still use tests, planning, review, or delegation when the task calls for them. Wingman focuses on preserving project context, aligning contracts, and avoiding duplicate implementations.

For a user-facing explanation, prefer this shape:

```markdown
Wingman is a cross-platform AI coding plugin for working safely inside real projects.

It mainly helps with:
- project memory: load context before meaningful work, sync important outcomes afterward
- contract alignment: avoid hiding API/type/schema meaning drift
- reuse decisions: catalog reusable implementations and decide whether to reuse, extend, wrap, or create
- explicit workflows: memory setup and React + TypeScript refactor diagnostics, only when requested

In a normal task, the agent first decides whether memory or reuse context is needed, uses contract checks when boundaries are involved, edits conservatively, then syncs durable knowledge if the work changed something worth remembering.
```

## Instruction Priority

Wingman skills provide plugin defaults, but user control comes first. Follow the highest applicable instruction source:

1. Direct user instructions, including current-chat requests.
2. Project-local instructions from the active coding platform, such as `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, Cursor rules, or equivalent files.
3. Wingman skills.
4. Default model behavior.

If a project-local instruction conflicts with Wingman, follow the project-local instruction. The user is in control.

## How to Access Wingman Skills

Use the current platform's skill mechanism:

- **Claude Code:** use the `Skill` tool. When invoked, follow the loaded skill directly instead of reading skill files manually.
- **Copilot CLI:** use the `skill` tool. Skills are auto-discovered from installed plugins.
- **Gemini CLI:** use `activate_skill`. Gemini loads skill metadata at session start and activates full content on demand.
- **Codex:** use the platform's native skill loading behavior. If a Wingman skill is already loaded in context, follow it directly.
- **Cursor:** use Cursor's plugin skill UI or slash-command surface where available. Hooks may load `using-wingman` automatically, but manual skill invocation should not depend on hooks.
- **Other environments:** use the platform's documented skill or instruction-loading mechanism.

## Platform Adaptation

Wingman skill bodies are platform-neutral. If a Wingman skill or wrapper mentions platform-specific tool names, adapt them to the current platform.

For tool mappings, read only the relevant reference when needed:

- Codex: `references/codex-tools.md`
- Copilot CLI: `references/copilot-tools.md`
- Gemini CLI: `references/gemini-tools.md`

## Using Wingman Skills

Check Wingman skill triggers before meaningful coding work, debugging, refactoring, review, or project explanation. If a situational Wingman trigger clearly matches, use that skill before acting. If the task is trivial, isolated, or no trigger clearly matches, continue normally.

Explicit user requests win: when the user directly asks for a Wingman skill, use that skill before other work unless the request conflicts with higher-priority instructions.

Situational skills:

- `memory-load`: use before non-trivial work where durable project context may matter.
- `memory-sync`: use after meaningful work that should be recorded as durable context.
- `align-contracts`: use when data, schema, type, API, event, config, or UI boundary meanings may drift.
- `reuse-select`: use before rebuilding something that may already exist, or when deciding whether to reuse, extend, wrap, or create an implementation.
- `reuse-catalog`: use after creating or identifying a reusable project implementation that should become part of the selection map.

Explicit workflow skills:

- `memory-setup`: initialize Wingman memory files.
- `react-ts-refactor`: run the React + TypeScript component refactor diagnostic workflow.

Run explicit workflow skills only when the user directly asks for them.

Slash-prefixed forms such as `/reuse-catalog`, `/reuse-select`, `/memory-setup`, or `/react-ts-refactor` are conceptual invocation aliases for skills. Specific platforms may namespace or display them differently, such as `/wingman:memory-setup` in Claude Code.

## Wingman Red Flags

These are signs that a Wingman skill may be needed:

| Thought | Check |
|---------|-------|
| "This is just a field rename." | If it crosses API, schema, type, UI, event, or config boundaries, use `align-contracts`. |
| "I'll create a new component/helper." | If a reusable implementation may already exist, use `reuse-select` first. |
| "No need to read memory for this change." | If the work touches business rules, state transitions, permissions, money, orders, field mappings, debugging, or refactoring, use `memory-load`. |
| "The work is done; I can just report back." | If the result creates durable context, decisions, contract knowledge, or reusable implementation knowledge, use `memory-sync` or `reuse-catalog`. |
| "The memory folder is missing, so I'll initialize it." | Do not run `memory-setup` unless the user directly asks for it. |

## Safe Editing

- Preserve existing code during real file edits.
- Do not write placeholder comments such as `// ... existing code ...` into files to stand in for unchanged code.
- Use abbreviated snippets only in chat explanations, examples, or change summaries.
- Keep edits scoped to the user request and the surrounding project design.

## Language

Wingman's published plugin instructions are English by default. Generated memory and user-facing output may adapt to the project memory language or the user's current language.

## Platform Wrappers

Different platforms use different names for persistent instructions and startup behavior. Keep Wingman's canonical behavior in skills; platform wrappers may add their own hooks or manifests to invoke those capabilities.
