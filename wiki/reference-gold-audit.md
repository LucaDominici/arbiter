---
generated: true
source: 'docs/REFERENCE/gold-audit.md'
source_sha: '2cf4ee7a471f9a0b07eb5abaca4c459ca949862c'
last_updated: '2026-06-20'
---

# Reference: Gold-Audit Engine

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/gold-audit.md](../docs/REFERENCE/gold-audit.md)

# Reference: Gold-Audit Engine

The **gold-audit engine** grades a repo against a per-stack registry and emits a per-check
verdict with evidence plus an aggregate score. It is the native-node reimplementation of an
upstream reference gold-audit engine — **zero Python dependency** for consumer projects. **The
score is computed by code, never by an AI**: the same repo and registry always produce
byte-identical output.

## Artifacts

| File                                  | Role                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| `standards/gold-registry.yml`         | The default registry: every check, its dimension, type, args, weight, risk.           |
| `standards/gold-registry.<stack>.yml` | Per-stack registry (`java`, `typescript`, …) — selected with `--stack` (#1413).       |
| `standards/thresholds.yml`            | Brownfield-class threshold SSOT: `threshold_ref` → per-class numeric bar (#1413).     |
| `standards/gold-profile`              | Per-repo overlays that switch on `applies_if`-gated checks (optional).                |
| `scripts/gold-audit.mjs`              | The engine CLI (verdicts, score, no-regress gate, ratchet, false-gap gate).           |
| `scripts/lib/gold-audit-lib.mjs`      | The pure deterministic evaluator (shared by the CLI, the report, and tests).          |
| `scripts/check-gold-registries.mjs`   | Per-stack false-gap meta-gate: every per-stack registry parses + is all-SAFE (#1413). |
| `.gold-audit-baseline.json`           | The monotonic ratchet baseline (score + Y-count, never lowered).                      |

## Verdicts

Every check resolves to exactly one verdict, with evidence (file + line) attached:

- **Y** — verified true by code.
- **P** — partial (a `count_matches` check met some, not all, of its target).
- **N** — verified false by code (the path/pattern was absent).
- **NA** — not applicable (`applies_if` overlay disabled).
- **NV** — not verified by code (a `manual` / attestation-required check).

Scoring excludes `NA` and `NV` from the denominator — a repo is never graded on what code
cannot verify.

## Check types

`file_exists`, `file_contains`, `count_matches`, `value`, `manual`. Each non-manual check's
`args.path` is resolved **inside** the repo root; traversal (`..`) and absolute paths are
rejected and scored `N`.

The **CLI path flags** (`--registry`, `--profile`, `--baseline`, `--thresholds`, `--json`), by
contrast, accept both relative (resolved against CWD) and **absolute** paths — so arbiter can audit
a governed project by pointing at an external kit (`cd project && gold-audit --registry /abs/kit.yml`)
without copying the kit in-repo.

### The `value` op reads pre-generated tool reports (#1413)

A `value` check with an `args.format` reads a **pre-generated** tool report deterministically (no
live spawn — that would break determinism, the `engine.ts` ⇆ `gold-audit-lib.mjs` parity, and
fail-closed safety) and compares an extracted metric to a per-brownfield-class bar:

```yaml
- id: JA-COV-03
  type: value
  args:
    path: target/coverage-summary.json # the pre-generated report (inside repo root)
    format: json # json | xml | regex
    select: 'total.lines.pct' # json: dotted path; xml: count:tag / attr:tag@name; regex: group 1
    op: gte # gte | lte | eq
  threshold_ref: coverage.line # resolves to thresholds.<ref>.<class>
  applies_if: has-java # report-check overlay (off ⇒ NA)
```

Verdict rules (the no-false-N contract):

- **report file absent** ⇒ `NA` — the tool did not run / does not apply for this build (never a
  false `N`).
- metric extracted and comparison passes ⇒ `Y` (evidence carries `actual op bar`).
- metric extracted and comparison fails ⇒ `N`.
- report present but the selector finds no numeric metric, or the threshold is unresolvable ⇒ `N`
  (a real authoring/report error, never a silent pass).

For back-compat, a `value` check **without** a `format` keeps the legacy single-line
`args.equals`-contains behavior.

### `threshold_ref` + `standards/thresholds.yml` (per-class bars)

Registries carry **no literal numbers** for value checks — every bar lives in
`standards/thresholds.yml`, keyed by `threshold_ref` and brownfield class. `--class <C>` selects the
column, so the same check is strict on a greenfield `gold` repo and lenient on a `heavy` legacy repo
**without duplicating the check**. Each row is ratchet-monotonic: higher-is-better metrics
(coverage) have `gold ≥ light ≥ medium ≥ heavy`; lower-is-better metrics (violation counts) have
`gold ≤ light ≤ medium ≤ heavy`.

## Dimensions

`D-DOCS`, `D-EFFECTIVENESS` (anti-ceremony: prove tools are wired, not just present),
`D-ENFORCEMENT` (E1–E7), `D-SUPPLY-CHAIN` (keyless signing + SBOM attestation), `D-META-TEST`
(RED-on-bug + GREEN-on-clean per static rule). Per-stack registries add their own families — e.g.
the Java registry uses `D-BUILD`, `D-STYLE`, `D-COVERAGE`, `D-MUTATION`, `D-ARCH`.

## Per-stack registries (`--stack`)

`--stack <s>` selects `standards/gold-registry.<s>.yml` (unless `--registry` is given explicitly).
The shipped per-stack registries are a **justified subset** of each kit, not the full port:

- **`java`** — Checkstyle / PMD / SpotBugs violation ceilings, JaCoCo line/branch coverage floors,
  PIT mutation-score floor, ArchUnit violation ceiling — each a report-reading `value` op gated by
  the `has-java` overlay (so non-Java repos score `NA`, never a false gap).
- **`typescript`** — `tsconfig` strict mode, ESLint config + error ceiling, Vitest/Jest coverage
  floors, gated by `has-ts`.

Every per-stack check is **SAFE** (no app-specific single-proxy grep, no absolute gold-sized count
baked into the registry — the bars live in `thresholds.yml`). The full per-stack ports are tracked
as follow-up work.

## Gates

- **No-regress** (`--check`): recompute and fail if `score` or `yCount` dropped below the
  baseline. A missing baseline bootstraps and passes. `ALLOW_GOLD_REGRESS=1` is the loud,
  session-scoped escape hatch.
- **Ratchet** (`--update-baseline`): per-field `max(current, baseline)` — the baseline can only
  tighten, never loosen.
- **False-gap meta-gate** (`--strict`): if any check is `RISKY`, the gate fails — the engine
  refuses to score on a fragile registry.
- **Per-stack false-gap meta-gate** (`scripts/check-gold-registries.mjs`): validates that every
  `standards/gold-registry.<stack>.yml` parses, carries no `RISKY` check, and references only
  `threshold_ref`s that exist in `thresholds.yml` (#1413).

## Usage

```bash
node scripts/gold-audit.mjs                       # one-line summary (default registry)
node scripts/gold-audit.mjs --json                # machine-readable scored payload
node scripts/gold-audit.mjs --check               # no-regress gate (exit 1 on score/Y drop)
node scripts/gold-audit.mjs --strict              # false-gap meta-gate (exit 1 if any RISKY)
node scripts/gold-audit.mjs --update-baseline     # monotonic ratchet
node scripts/gold-audit.mjs --stack java --class heavy   # per-stack registry, per-class bars (#1413)
node scripts/check-gold-registries.mjs            # per-stack false-gap meta-gate (#1413)
```

npm alias: `npm run gold:audit`. Wired into `scripts/check-all.mjs` (the `gold-audit no-regress`
and `gold-audit false-gap` checks, L1) and mirrored in the local↔CI parity map. The engine's
score and dimension table render into `GOLD-REPORT.md` via `scripts/gold-report.mjs`.

## Level-up skill family (#1420 / #1422)

- **`/gold-audit`** (#1420) — read-only measurement front door. Runs `arbiter gold-audit --json` and
  reports the level band + a prioritized "what's missing" list (N/P checks grouped by family, with
  evidence). It never re-scores (no AI scoring) and never changes code.
- **`/close-gold-gap`** (#1422) + `arbiter close-gold-gap <gapId>` — emits the deterministic remediation
  recipe for

*[content truncated — see source for full text]*
