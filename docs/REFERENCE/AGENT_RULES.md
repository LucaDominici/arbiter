---
title: 'Agent Rules Export Reference'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: []
---

# Agent Rules Export Reference

`arbiter agent-rules` derives governance rules from the provenance graph
and exports them to the native format of each supported AI coding agent.

---

## Commands

### `arbiter agent-rules export`

Export governance rules for one or all AI agent targets.

```
arbiter agent-rules export --target <target>
arbiter agent-rules export --all
```

**Options:**

| Option              | Default  | Description                                                      |
| ------------------- | -------- | ---------------------------------------------------------------- |
| `--target <target>` | `claude` | Target agent: `claude`, `cursor`, `copilot`, `aider`, `windsurf` |
| `--all`             | false    | Emit all targets to their standard paths                         |
| `--dir <dir>`       | `.`      | Project root directory                                           |
| `--json`            | false    | Machine-readable JSON output                                     |

**Target outputs:**

| Target     | File written                      | Format                  |
| ---------- | --------------------------------- | ----------------------- |
| `claude`   | `.claude/AGENT_RULES.md`          | Markdown with INV table |
| `cursor`   | `.cursorrules`                    | Cursor rules format     |
| `copilot`  | `.github/copilot-instructions.md` | Markdown                |
| `aider`    | `CONVENTIONS.md`                  | Markdown                |
| `windsurf` | `.windsurfrules`                  | Text rules              |

### `arbiter agent-rules verify`

Detect drift between the on-disk agent file and a fresh export.

```
arbiter agent-rules verify --target <target>
```

Exits 0 if the file is up-to-date or missing (not yet exported).
Exits 1 if the file is stale (differs from a fresh export).

---

## Intermediate Format

`arbiter agent-rules export` first builds a target-agnostic intermediate JSON
document, then passes it to the target emitter. The schema:

```json
{
  "schemaVersion": "1.0",
  "repo": "my-project",
  "invariants": [
    {
      "id": "INV-04",
      "statement": "No any type in TypeScript",
      "severity": "hard-stop",
      "enforcement": [{ "type": "gate", "ref": "no-explicit-any" }],
      "applies_to": []
    }
  ],
  "workflows": [{ "trigger": "before commit", "action": "run gate: node scripts/check-all.mjs L1" }]
}
```

---

## Severity Mapping

Severity is derived from the INV tier:

| Tier            | Severity  | Label in output |
| --------------- | --------- | --------------- |
| `architectural` | hard-stop | MANDATORY       |
| `security`      | hard-stop | MANDATORY       |
| `governance`    | hard-stop | MANDATORY       |
| `data`          | advisory  | RECOMMENDED     |
| `operational`   | advisory  | RECOMMENDED     |
| (unknown)       | advisory  | RECOMMENDED     |

---

## Fallback Behaviour

When no `.arbiter/graph.json` exists, the command falls back to the global
`INVARIANT_CATALOG` (all catalog entries). The `fallbackUsed: true` flag
is set in JSON output. Run `arbiter graph build` to produce a repo-specific
graph and avoid the fallback.

---

## Drift Detection in CI

Add a CI step to verify that exported agent files stay in sync:

```yaml
- name: Verify agent rules
  run: arbiter agent-rules verify --target claude
```

When the graph changes (e.g., after adding a new INV), re-run
`arbiter agent-rules export --all` to refresh all target files.
