---
context:
  issue: '#2182'
  type: docs
  pipeline: 'plan → codex-authored docs → L1 gate → commit (no PR, Fable merges)'
  branch_convention: 'task/#2182-adjudication-method'
  base_branch: main
  key_constraints:
    - 'Implementation via Codex (iron rule) even for docs prose'
    - 'docs/internal/ is SKIPPED by check-doc-style.mjs — frontmatter is unenforced here but 8/9 siblings have it; include it so docs/INDEX.md renders a real row'
    - 'No behavioral change to the refutation skill — one-line pointer only'
    - 'Do NOT merge/push/PR/close'
  estimate: 'XS'
---

# #2182 — METHOD doc: adjudication with audit

## Scope

Codify the adjudication protocol validated by the epic #2176 study (/ship v2): when a
mechanical matcher adjudicates LLM-generated text against a ground-truth manifest, it
needs a pre-registered sampled audit gate with an LLM-judge fallback.

## Existing Code Survey

- `grep -rl "adjudicat" docs/ .claude/ scripts/ src/` → `.claude/skills/refutation/SKILL.md`,
  `scripts/check-refutation-verdicts.mjs`, `scripts/check-audit-dry-pass.mjs`,
  `docs/design/anti-context-rot-enforcers.md`. None documents a *method* for adjudicating
  LLM text against a ground-truth manifest — refutation covers verdict aggregation
  (majority rule), not matcher precision. No existing doc to extend → new file justified.
- Placement: `docs/internal/METHOD/` is canonical (CANONICAL_PATHS.md maps
  `docs/METHOD/*` → `docs/internal/METHOD/*`).

## Manifest

| file | change |
| --- | --- |
| `docs/internal/METHOD/ADJUDICATION.md` | NEW — the protocol |
| `.claude/skills/refutation/SKILL.md` | one-line pointer in §Gate |
| `docs/INDEX.md` | regenerated (`node scripts/gen-doc-index.mjs`) |
| `wiki/*.md` | regenerated (`node scripts/gen-wiki.mjs --changed`, second commit) |
| `.claude/plans/2182-adjudication-method.md` | this plan |

## Track B (dual-track) — assessed, deliberately out of scope

`src/templates/root/docs/METHOD/` templates a curated 8-doc subset; four self METHOD docs
(PROCESS, TESTING, EVIDENCE_RETENTION, REUSE_REGISTRY) have no template counterpart, so
there is no 1:1 requirement. The refutation skill has no `SKILL.md.ejs` template at all
(only `scripts/check-refutation-verdicts.mjs.ejs`), so the cross-link is self-only by
construction. Flagged in the final report for Fable, not widened here.

## Verification

`node scripts/check-all.mjs L1` in the worktree after both commits.
