---
title: Kit Opt-In Checks (A9/A10)
type: reference
status: active
date: 2026-07-06
doc_version: '1.0.0'
last_review: '2026-07-06'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: []
---

# Kit Opt-In Checks (A9/A10)

Standalone, opt-in checks living under `src/kit/checks/`. They are not part of `kit install`'s
mandatory 6-phase lifecycle (DETECT → MEASURE → SCAFFOLD → ASSESS → PLAN → VERIFY) and are not new
dimensions in the fixed N01-N78 catalog. A target project runs them on demand, from its own CI or
locally, once it has adopted the arbiter kit.

All three ship as `arbiter kit` subcommands, gated the same way as the rest of the `kit` group:
behind `--experimental.kit` plus `enforceKitGate()`. None of them are invoked automatically by
`kit install`; a project wires them into its own pipeline when it wants them.

---

## A9 — Java kit: Flyway migration validator

```
arbiter --experimental.kit kit check-flyway --dir <migrationDir> [--secondary-dir <dir>]
```

Validates SQL migration files against four rules (`src/kit/checks/flyway-validator.ts`):

| Rule              | What it checks                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `naming`          | Filenames match Flyway convention: `V<version>__<desc>.sql`, `R__<desc>.sql`, `U<version>__<desc>.sql`                                                             |
| `destructive-ddl` | Flags `DROP`/`TRUNCATE`/destructive `ALTER` statements unless the file contains an escape-hatch marker (`-- arbiter:allow-destructive`)                            |
| `idempotency`     | Repeatable migrations (`R__`) should use idempotent DDL (`IF EXISTS`/`IF NOT EXISTS`)                                                                              |
| `dual-set-parity` | When `--secondary-dir` points at a second dialect's migration set (e.g. a PostgreSQL + SQLite pair), every version present in one set must be present in the other |

Exit code `0` on a clean set, `1` with one line per violation on failure.

## A9 — Java kit: test taxonomy count gate

```
arbiter --experimental.kit kit check-test-taxonomy --dir <testSrcDir> [--required-tags unit,integration]
```

Scans `*Test.java` / `*IT.java` / `*Spec.java` files and requires each one to carry at least one
JUnit5 `@Tag("...")` annotation matching the required-tags list (default: `unit`, `integration`).
Zero untagged test files is the gate; any untagged file fails with exit code `1` and is named in
the output (`src/kit/checks/java-test-taxonomy.ts`).

## A10 — Frontend kit: token hygiene

```
arbiter --experimental.kit kit check-token-hygiene --dirs <dir1,dir2,...> \
  [--extensions .vue,.ts] [--allowed-color-names brand,accent] \
  [--forbid-style-blocks] [--baseline-path <baseline.json>]
```

Enforces semantic-token-only styling (`src/kit/checks/token-hygiene.ts`):

- **raw-palette** — flags Tailwind-style raw palette utility classes (`bg-red-500`, `text-slate-700`,
  etc.). `--allowed-color-names` exempts project-defined semantic color names that happen to carry
  a numeric shade suffix.
- **style-block** — with `--forbid-style-blocks`, flags any `<style>` block in a scanned file, for
  projects that require all styling to flow through the token layer instead of component-local CSS.

### Baseline + ratchet

`--baseline-path` points at a JSON file of grandfathered violations:

```json
{
  "grandfathered": [{ "file": "src/components/Legacy.vue", "line": 12, "pattern": "bg-red-500" }]
}
```

A violation matching an entry (same file, same line, snippet contains the pattern) is tolerated and
does not fail the gate. Anything not in the baseline is a new violation and fails. The baseline is a
ratchet: `findStaleBaselineEntries` identifies entries with no matching current violation, so a
project can prune fixed debt over time — the file is meant to shrink, not grow.

This algorithm generalizes the approach used by viafera's own `verify-primitives-tokens.mjs` gate
(five checks, baseline + literal-exception file); the arbiter implementation here is a from-scratch,
project-agnostic rewrite with no external palette or token names baked in.

---

## Activation summary

| Check              | Command                   | Flag(s) required     |
| ------------------ | ------------------------- | -------------------- |
| Flyway validator   | `kit check-flyway`        | `--experimental.kit` |
| Test taxonomy gate | `kit check-test-taxonomy` | `--experimental.kit` |
| Token hygiene      | `kit check-token-hygiene` | `--experimental.kit` |

All three exit `0` on pass and `1` on the first category of failure found, so they compose directly
into a CI job as separate steps or as a single `&&`-chained invocation.
