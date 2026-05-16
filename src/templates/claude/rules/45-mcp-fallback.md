# MCP Fallback Determinism

When an MCP tool is unavailable (not found, server unreachable, timeout), do NOT halt or prompt the user — switch immediately to the approved fallback and report the deviation.

## Approved Fallback Equivalents

| MCP Tool            | Approved Fallback                                    |
| ------------------- | ---------------------------------------------------- |
| GitHub MCP          | `gh` CLI (`gh issue view`, `gh pr list`, `gh api …`) |
| File-system MCP     | Built-in Read / Edit / Write tools                   |
| Browser MCP         | `curl` or `wget` for simple HTTP fetches             |
| Search / vector MCP | `grep`, `find`, or `git log --grep`                  |

## Protocol

1. **Switch** to the approved fallback without asking.
2. **Report** the deviation inline:
   ```
   [mcp-fallback] <tool-name> unavailable — using <fallback>
   ```
3. **Never silently downgrade.** If no safe fallback exists, surface an error to the user rather than proceeding without the required capability.

## Rationale

Silent fallback causes non-deterministic session behavior that is hard to reproduce and audit. Explicit fallback + deviation report keeps transcripts auditable and lets the operator decide whether to restore MCP access.
