---
generated: true
source: 'docs/REFERENCE/gold-doc-set.md'
source_sha: '27b2dc797d19281c598926b242c1b54543e72ce7'
last_updated: '2026-06-15'
---

# Reference: Gold Doc-Set + Report

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/gold-doc-set.md](../docs/REFERENCE/gold-doc-set.md)

# Reference: Gold Doc-Set + Report

The **gold doc-set** is the canonical documentation every arbiter project must carry — and,
save explicit derogations, _only_ that set. A deterministic audit grades a repo against it and
an updatable **gold report** records the result. **All numbers are computed by code, never by an
AI.**

## Artifacts

| File                         | Role                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `standards/gold-doc-set.yml` | The manifest: every canonical doc, its tier, overlay, and `accept_any` equivalents. |
| `standards/doc-profile`      | Per-repo overlays (`has-api`, `has-plugin-api`, …) + an `allow:` derogation list.   |
| `scripts/check-doc-set.mjs`  | Deterministic presence audit → text or `--json`.                                    |
| `scripts/gold-report.mjs`    | Renders `GOLD-REPORT.md` from the audit.                                            |
| `GOLD-REPORT.md`             | The updatable gold report (regenerated on demand).                                  |

## Tiers and matching

- **mandatory** — required; a gap is a failure under `--strict`.
- **recommended** — advisory; a gap is a warning.
- **conditional** — only applies when its overlay is enabled in `standards/doc-profile`.

A check passes if its `path` exists, or any `accept_any` equivalent exists, or its `glob`
matches ≥1 file. `accept_any` is how equivalents are accepted without false gaps —
`architecture` = `arc42` = `blueprint`, `coding-standards` = `naming-convention` = secure-coding
checklist, `VERSION` = `package.json`, and so on.

## Usage

```bash
node scripts/check-doc-set.mjs              # advisory audit (exit 0)
node scripts/check-doc-set.mjs --json       # machine-readable
node scripts/check-doc-set.mjs --strict     # exit 1 if a mandatory doc is missing
node scripts/check-doc-set.mjs --generate   # scaffold stubs for missing mandatory+recommended .md docs
node scripts/gold-report.mjs                # (re)write GOLD-REPORT.md
node scripts/gold-report.mjs --check        # exit 1 if the committed report is stale
```

npm aliases: `npm run check:doc-set`, `npm run gold:report`.

## Rollout (this increment)

- **generate-missing + advisory**: the audit is advisory today; missing docs can be scaffolded
  with `--generate`. It is promoted to a blocking gate once a repo reaches zero mandatory gaps.
- The code-quality **gold engine** (registry→Y/P/N, effectiveness overlay, E1–E7, false-gap
  meta-gate, no-regress ratchet) is tracked separately in #1373; once landed its score joins the
  report. Downstream `.ejs` propagation of this kit is tracked in #1374.
