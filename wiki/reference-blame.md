---
generated: true
source: 'docs/REFERENCE/BLAME.md'
source_sha: '9053344928ea2f657dd8d58a62e371c16c6891a9'
last_updated: '2026-06-08'
---

# arbiter blame — Time-Travel Governance

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/BLAME.md](../docs/REFERENCE/BLAME.md)

# arbiter blame — Time-Travel Governance

`arbiter blame <node>` extends the Provenance Graph with a temporal dimension,
reconstructing the governance history of any node from git commit messages and
optional Notary footer records.

## Synopsis

```
arbiter blame --from <NODE_ID> [--format text|json|mermaid|markdown-audit]
              [--dir <dir>] [--git-dir <path>] [--since <duration>]
```

## Node ID formats

| Format        | Example                    | Description                  |
| ------------- | -------------------------- | ---------------------------- |
| `INV-NN`      | `INV-05`                   | Invariant catalog entry      |
| `ADR-NNN`     | `ADR-042`                  | Architecture decision record |
| `CANON-NN`    | `CANON-16`                 | Canon rule                   |
| `FILE:<path>` | `FILE:src/auth/service.ts` | Source file                  |

## Options

| Option               | Default      | Description                                                |
| -------------------- | ------------ | ---------------------------------------------------------- |
| `--from <id>`        | _(required)_ | Node id to blame                                           |
| `--format <fmt>`     | `text`       | Output format: `text`, `json`, `mermaid`, `markdown-audit` |
| `--dir <dir>`        | `.`          | Project directory containing `.arbiter/graph.json`         |
| `--input <path>`     | auto         | Override graph snapshot path                               |
| `--git-dir <path>`   | `--dir`      | Git repository directory for log harvesting                |
| `--since <duration>` | _(none)_     | Informational time filter (e.g. `90d`)                     |

## Output formats

### text (default)

Human-readable CLI output:

```
INV-01 — "No circular dependencies between modules"

Timeline:
  2024-11-03  CREATED     feat: add INV-01 invariant (commit abc1234)
  2024-11-15  ENFORCED    enforce circular-dep detection [per INV-01] (commit def5678)

Current:
  Status: ENFORCED
```

### json

Machine-readable structured output. Schema:

```json
{
  "nodeId": "INV-01",
  "nodeTitle": "No circular dependencies between modules",
  "entries": [
    {
      "ts": "2024-11-03",
      "event": "CREATED",
      "detail": "feat: add INV-01 invariant (commit abc1234)",
      "sha": "abc1234"
    }
  ],
  "currentStatus": "ENFORCED",
  "complianceMappings": []
}
```

### mermaid

Mermaid `timeline` diagram grouped by year.

### markdown-audit

Full audit report in Markdown with a timeline table and optional compliance
mapping table. Suitable for export to issue trackers or compliance portals.

## How history is harvested

1. Runs `git log --format=... --date=iso-strict --reverse` in `--git-dir`
2. Filters commits by whether the node id appears in the commit subject or
   `Notary: - Intent:` footer
3. For `FILE:` nodes, scopes the log to the file's path (`git log -- <path>`)
4. Parses Notary footer sections to extract `Intent` and `Delta` metadata

## Compliance mapping

Create `.arbiter/compliance.yaml` to map node IDs to compliance control IDs:

```yaml
INV-01:
  - standard: SOC2
    controlId: CC6.1
  - standard: ISO27001
    controlId: A.14.2.1
INV-04:
  - standard: SOC2
    controlId: CC7.2
```

When present, compliance mappings appear in the `text`, `json`, and
`markdown-audit` formats.

## Prerequisites

- `arbiter graph build` must have been run in `--dir` to produce
  `.arbiter/graph.json`
- The `--git-dir` (default: `--dir`) must be a valid git repository

## Timeline event kinds

| Kind        | Meaning                                              |
| ----------- | ---------------------------------------------------- |
| `CREATED`   | First commit referencing this node                   |
| `ENFORCED`  | Commit adds enforcement (gate, check, lint, hook)    |
| `MODIFIED`  | Commit updates or fixes the node                     |
| `MENTIONED` | Commit references the node without structural change |
| `UNKNOWN`   | No keyword match                                     |

## Performance

Blame on a single INV node completes in < 2s on a standard laptop with
a repository of typical size (< 5000 commits). The git log is scoped to
commits referencing the node id, not all commits.

## Implementation

- `src/graph/history.ts` — git log harvester, NDJSON store
- `src/graph/blame.ts` — timeline builder, formatters
- `src/commands/blame.ts` — CLI entry point
- `src/compliance/loader.ts` — optional compliance.yaml loader
- `src/graph/model.ts` — extended with optional `created_at` and `commit_ref`
  fields on `GraphNode` (backwards-compatible)
