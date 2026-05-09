# Codex Tool Mapping

Wingman skills are platform-neutral, but some examples or upstream references may use Claude Code tool names. In Codex, adapt them to the available Codex tools and the current sandbox rules.

| Skill reference | Codex equivalent |
|-----------------|------------------|
| `Skill` tool | Use Codex's native skill loading behavior. If a skill is already loaded in context, follow it directly. |
| `TodoWrite` | `update_plan` |
| `Task` tool for subagents | `spawn_agent`, only when the user explicitly asks for subagents or parallel agent work |
| Task result | `wait_agent` |
| Finished spawned agent | `close_agent` when no longer needed |
| `Bash` | `exec_command` |
| `Read`, `Write`, `Edit` | Use native file-reading tools and `apply_patch` for manual edits |
| `Grep`, `Glob` | `rg`, `rg --files`, or native search tools |

## Notes

- Do not introduce subagents just because a copied workflow mentions `Task`. In Codex, spawn agents only when explicitly allowed by the current instructions or the user.
- Respect sandbox and escalation requirements for shell commands.
- Prefer `rg` and `rg --files` for local search.
- Use `apply_patch` for manual file edits.
