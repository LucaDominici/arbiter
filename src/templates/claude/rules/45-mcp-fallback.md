# MCP Tool Fallback Rule

When an MCP tool is unavailable (server offline, auth expired, quota exhausted):

1. **Do not silently skip** — report the deviation to the user before continuing.
2. **Use an approved fallback equivalent:**
   - GitHub operations → `gh` CLI (same data, GitHub-capable path)
   - Structured inspection → `Read` + `Grep` tools (local, deterministic)
   - Web fetch → `WebFetch` tool or `curl` via Bash (document which was used)
3. **Document the substitution** in your response: "MCP `<tool>` unavailable — used `<fallback>` instead."
4. **Do not block on the MCP failure** if a fallback exists and produces equivalent results.

## Non-negotiable

- Never silently produce partial results because an MCP tool was unavailable.
- Never invent data to fill in for a missing MCP response.
- If no approved fallback exists, stop and ask the user how to proceed.
