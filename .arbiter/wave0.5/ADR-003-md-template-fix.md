# ADR-003 — Markdown template fix: pipe closure + padding preservation

> **Status**: Draft (Claude) · **Date**: 2026-05-26 · **Reviewer**: Luca
> **Maps to**: Wave 0 findings **F2** (broken pipe in `.claude/CLAUDE.md`) + **F3** (table padding regression, GLOBAL_INVARIANTS.md blank-line bloat)
> **Evidence**: [`../wave0/haben-smoke-test.md`](../wave0/haben-smoke-test.md) §F2 §F3 · [`../wave0/evidence/haben-update-1st.txt`](../wave0/evidence/haben-update-1st.txt)

## Problem

Two related defects in arbiter's Markdown templates:

**F2 (severe)**: regenerated `.claude/CLAUDE.md` has table rows that drop the trailing `|`, breaking strict CommonMark renderers. Reproduced lines 32 and 34 of the generated file.

**F3 (medium)**: all regenerated MD files lose column padding, regress `npm test` → `npm run test`, and `GLOBAL_INVARIANTS.md` grows from 555 to 713 lines (+158 blank-line insertions). Cosmetic but compounds with F6 (non-idempotence): every update produces a stage-able diff.

## Code anchors

- `src/templates/claude/CLAUDE.md.ejs` — the broken template
- `src/templates/agents-md/AGENTS.md.ejs` — same family
- `src/templates/codex/...` — codex template (similar defect likely)
- `src/generators/claude.ts` — invokes the template

Grep target: in `src/templates/claude/CLAUDE.md.ejs`, find the hooks-table EJS block and inspect the loop emitting each row.

## Hypothesis (to confirm in chat)

Two likely root causes:

1. **Template loop**: row emit looks like `| ${event} | ${hook} | ${purpose} ${'|'}` or similar, where a trailing whitespace or conditional drops the pipe.
2. **Table padding**: arbiter currently runs Prettier (or a similar formatter) on the generated MD, but with `--prose-wrap=preserve` or without `--md-table-padded` it collapses padding. Or, more likely: arbiter is NOT running a formatter, and the template is hand-written with bare `| col |` syntax instead of padded.

`GLOBAL_INVARIANTS.md` blank-line bloat is probably a `<%# %>` comment block or a stray `<%- '\n\n' %>` between sections inserting one extra blank per loop iteration.

## Options considered

**Option A — Fix the template by hand**
- Open `CLAUDE.md.ejs`, ensure every row ends with `|`, restore padding markup, remove stray newlines.
- Pro: minimal change, ships fastest.
- Con: regresses again the next time someone edits the template by hand. No invariant.

**Option B — Generate then format (RECOMMENDED)**
- After EJS render, pipe the output through Prettier with `--prose-wrap=preserve` and the project's Prettier config.
- Pro: idempotent. Any hand-written MD that's roughly correct gets normalized. Padding is consistent.
- Con: adds Prettier as a runtime dep of the CLI. Already present in arbiter's devDeps; need to verify it's also a runtime dep or shipped.

**Option C — Format-on-template, not at generation time**
- Run Prettier on `*.ejs` templates themselves and trust that the EJS output mirrors the template exactly.
- Pro: zero runtime cost.
- Con: EJS interpolation can change column widths (e.g., `${projectName}` of varying length breaks alignment). Doesn't actually solve the padding problem.

## Recommended: Option B

Pipe rendered output through Prettier. Specifically:
- Add `prettier` to `dependencies` (not just `devDependencies`)
- Wrap the generator call: `const rendered = await ejs.renderFile(...); const formatted = await prettier.format(rendered, { parser: 'markdown', proseWrap: 'preserve' })`
- For the table-pipe bug, this means we also need to fix the EJS to at least produce parseable markdown — Prettier won't add a missing pipe, it'll just refuse to format.

Apply same pattern to JSON (`.claude/settings.json`) and TOML (`.codex/config.toml`):
- JSON → `prettier.format(parser: 'json')` — fixes F3d (deny array inline vs multi-line jitter)
- TOML → Prettier doesn't support TOML; use `@iarna/toml` parse+stringify with a stable key order for idempotence

This also dovetails with ADR-004 (templates pass L1), since one of the four L1 failures is exactly the Prettier format check.

## Test plan

- Unit: `__tests__/generators/markdown-format.test.ts` — render each MD template against a fixture config, snapshot the output, assert: (a) every table row ends with `|`, (b) `prettier --check` returns 0 on the output, (c) re-running the generator with same input produces byte-identical output.
- Integration: regenerate haben-fixture; diff against committed baseline; assert no semantic diff.
- Property: fuzz `projectName` length (3, 8, 30 chars); assert tables still parse as valid MD.

## File impact survey

| File | Change |
|---|---|
| `src/templates/claude/CLAUDE.md.ejs` | Restore trailing pipe; switch to padded markup if template-side fix kept |
| `src/templates/agents-md/AGENTS.md.ejs` | Same; verify `npm test` vs `npm run test` semantics |
| `src/templates/codex/*` | Audit for same defect; fix |
| `src/templates/root/GLOBAL_INVARIANTS.md.ejs` (or wherever the inv-list lives) | Remove stray blank-line emit between sections |
| `src/generators/<each>.ts` | Inject prettier-format step post-render |
| `src/utils/format.ts` (new) | Shared `formatGenerated(content, ext)` utility |
| `package.json` | Move prettier from devDeps → deps (verify size impact) |
| `__tests__/generators/*` | Add snapshot tests |

## Acceptance criteria

- [ ] Regenerated `.claude/CLAUDE.md` passes `markdownlint` and `prettier --check`
- [ ] `wc -l GLOBAL_INVARIANTS.md` post-update ≤ pre-update + 5 lines (no blank-line bloat)
- [ ] Re-running `arbiter update` twice in a row produces zero file changes between runs (idempotence delta = 0)
- [ ] Table rows in generated MD all close with `|` (assertable via regex)
- [ ] `npm test` (idiomatic) preserved over `npm run test`
- [ ] L1 + L2 green (this should also resolve the `format` failure in F10)
- [ ] Reviewed by Claude

## Open questions

1. Is `prettier` already a runtime dep, or only dev? (check `package.json` "dependencies")
2. Does the existing dist ship `node_modules/prettier`? (Prettier is ~7MB; matters for CLI startup.)
3. For TOML: `@iarna/toml` is the closest analog; any objection?
4. Should padding be configurable (`arbiter.json` field `mdStyle: 'padded' | 'compact'`)? Suggest: no, padded is the default and that's the only style.
