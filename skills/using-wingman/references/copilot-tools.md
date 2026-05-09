# Copilot CLI Tool Mapping

Wingman skills are platform-neutral, but some examples or upstream references may use Claude Code tool names. In Copilot CLI, adapt them to Copilot's available tools.

| Skill reference | Copilot CLI equivalent |
|-----------------|------------------------|
| `Skill` tool | `skill` |
| `Read` | `view` |
| `Write` | `create` |
| `Edit` | `edit` |
| `Bash` | `bash` |
| `Grep` | `grep` |
| `Glob` | `glob` |
| `Task` tool for subagents | `task` with the appropriate agent type, only when the workflow and platform support it |
| Task status or output | `read_agent`, `list_agents` |
| `TodoWrite` | Copilot's todo/session tracking mechanism when available |
| `WebFetch` | `web_fetch` |
| `WebSearch` | No direct equivalent; use `web_fetch` with an appropriate search URL if allowed |

## Notes

- Skills are auto-discovered from installed plugins.
- Use Copilot's async shell session tools when a long-running command must stay alive.
- Do not assume every Wingman workflow needs subagents.
