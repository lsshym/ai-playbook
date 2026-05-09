# Gemini CLI Tool Mapping

Wingman skills are platform-neutral, but some examples or upstream references may use Claude Code tool names. In Gemini CLI, adapt them to Gemini's available tools.

| Skill reference | Gemini CLI equivalent |
|-----------------|-----------------------|
| `Skill` tool | `activate_skill` |
| `Read` | `read_file` |
| `Write` | `write_file` |
| `Edit` | `replace` |
| `Bash` | `run_shell_command` |
| `Grep` | `grep_search` |
| `Glob` | `glob` |
| `TodoWrite` | `write_todos` |
| `WebSearch` | `google_web_search` |
| `WebFetch` | `web_fetch` |
| `Task` tool for subagents | Gemini subagent syntax when available, such as `@generalist` |

## Notes

- Gemini loads skill metadata at session start and activates full content on demand.
- When a workflow references a prompt template, fill all placeholders before sending it to a Gemini subagent.
- Do not assume every Wingman workflow needs subagents.
