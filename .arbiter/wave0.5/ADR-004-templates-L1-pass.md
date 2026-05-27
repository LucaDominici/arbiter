# ADR-004 — Generated templates must pass L1 gate

> **Status**: Draft (Claude) · **Date**: 2026-05-26 · **Reviewer**: Luca
> **Maps to**: Wave 0 finding **F10** (4 L1 checks fail on arbiter-generated files) + binding for **INV-32** (matrix fixture policy)
> **Evidence**: [`../wave0/haben-smoke-test.md`](../wave0/haben-smoke-test.md) §F10 · [`../wave0/evidence/haben-l1-gate.txt`](../wave0/evidence/haben-l1-gate.txt)

## Problem

Post `arbiter update`, `node scripts/check-all.mjs L1` fails **4 of 20 checks**, all on files arbiter itself just generated:

| Failed check | Cause | Affected generated files |
|---|---|---|
| `format` (Prettier) | 57 files non-compliant | `GLOBAL_INVARIANTS.md`, `docs/METHOD/SSOT_CORE_SET.md`, `docs/METHOD/ENGINEERING_DEFAULTS.md`, `scripts/check-*.mjs` |
| `workflow runners` | Missing `${{ vars.CI_BUILD_RUNNER_LABEL \|\| 'docker-ci-build' }}` | 1 workflow |
| `action pins (INV-75)` | 9 non-SHA action refs | `.github/workflows/05-release.yml`, `06-nightly.yml`, `07-weekly.yml` |
| `workflow perms (INV-76)` | Missing top-level `permissions:` | `.github/workflows/_sigstore-retry-sign.yml` |

A fresh `arbiter init`'d project is L1-RED before the user types a single line of code. This breaks the demo, the gold-target narrative, and per CANON-02/03 prevents promoting any archetype to `proven`.

## Code anchors

- `src/templates/github/workflows/*.ejs` — the 12+ workflow templates
- `src/templates/github/actions/sign-and-attest/action.yml` — composite action template
- `src/templates/scripts/check-action-pins.mjs.ejs` — the check itself (irony)
- `src/templates/scripts/check-workflow-perms.mjs.ejs` — same
- Look in `scripts/` of arbiter for the same checks operating self-dogfood

Cross-cutting: ADR-003's Prettier-on-render fix should resolve the `format` failure on the MD/JSON side. This ADR handles workflow + scripts.

## Scope

4 distinct sub-fixes, each potentially its own PR if they grow:

### Sub-1: SHA-pin all generated workflow actions (INV-75)

Replace `@v3`, `@v2.1.0`, etc. with `@<full-sha> # v3` style pins. For each non-SHA reference in templates, look up the current upstream SHA via:
```
gh api /repos/<owner>/<action>/git/refs/tags/<tag> --jq .object.sha
```

Affected templates (from Wave 0 evidence):
- `slsa-framework/slsa-github-generator@v2.1.0`
- `docker/setup-buildx-action@v3`
- `docker/login-action@v3`
- `docker/metadata-action@v5`
- `docker/build-push-action@v6`
- `zaproxy/action-full-scan@v0.10.0`
- `shopify/toxiproxy-github-action@v1`
- `gitleaks/gitleaks-action@v2`
- `grafana/k6-action@v0.3.1`

Add CI invariant: PR that introduces a non-SHA pin under `src/templates/github/workflows/*.ejs` MUST fail (so this can't regress).

### Sub-2: Add `permissions:` to every workflow template (INV-76)

`_sigstore-retry-sign.yml` is missing it; audit all templates. Minimum stanza: `permissions: contents: read` at top level; per-job overrides where needed.

Same enforcement: arbiter's own L1 check should flag this on templates as well as on user repos.

### Sub-3: Use `${{ vars.CI_BUILD_RUNNER_LABEL || 'docker-ci-build' }}` in `runs-on:`

INV-13 binding (per AGENTS.md). One workflow missing it; audit all 12+ for compliance. Likely a simple template-wide replace.

### Sub-4: Make generated MD/JSON/scripts pass Prettier

Mostly resolved by ADR-003 (Prettier-on-render). For scripts (`check-*.mjs` etc.), ensure templates themselves are Prettier-clean.

### Sub-5: INV-32 regression fixture

Add `__tests__/fixtures/real-projects/<archetype>/` with:
- A minimal greenfield project (TypeScript + Express, L3, the haben archetype)
- A test that runs `arbiter init` against it then asserts `node scripts/check-all.mjs L1` exits 0

Without this fixture, F10 can regress on any template edit and we'd discover it only on the next smoke test.

## Options considered

**Option A — Fix all four in one PR**
- Pro: matches Wave 0 narrative (one big audit answered with one big fix).
- Con: PR is huge; review hard; bisect impossible.

**Option B — One PR per sub-fix (RECOMMENDED)**
- Pro: each sub-fix reviewable in isolation. Each commit traceable.
- Con: needs care that sub-fixes don't conflict (e.g., the Prettier pass touches the same workflow files as the SHA pin).

**Option C — Generate-then-check-then-fail**
- Add a post-`arbiter init` step that runs L1 internally and refuses to write files if any fail.
- Pro: makes the violation impossible.
- Con: chicken-and-egg with first init; also tightly couples CLI to gate.

## Recommended: Option B with explicit ordering

Sub-fix order in implementation:

1. **Sub-4** (Prettier) — depends on ADR-003; do not start until ADR-003 ships.
2. **Sub-1** (SHA pins) — independent of others; can run in parallel after Sub-4.
3. **Sub-2** (permissions) — independent; parallel.
4. **Sub-3** (runner label) — independent; parallel.
5. **Sub-5** (fixture) — last, binds INV-32, asserts the previous four worked.

Each sub-fix is one PR. Each PR adds the corresponding gate enforcement on `src/templates/**` (so it can't regress within arbiter's own L1).

## Test plan

- Per sub-fix: add a unit test that runs the check (e.g., `check-action-pins.mjs`) against the generated workflow output and asserts zero violations.
- Aggregate: Sub-5's fixture asserts the full L1 is green.
- Negative: in Sub-1, deliberately break one SHA pin in the template, assert the new self-test catches it.

## File impact survey

Same as ADR-003 for Sub-4. Beyond that:

| File | Change |
|---|---|
| `src/templates/github/workflows/*.ejs` (12+ files) | SHA pin all action refs; add `permissions:`; use `CI_BUILD_RUNNER_LABEL` var |
| `src/templates/github/actions/sign-and-attest/action.yml` | Same audit |
| `src/templates/scripts/check-action-pins.mjs.ejs` | Self-check: this check also runs against generated templates in CI |
| `__tests__/fixtures/real-projects/typescript-express-L3/` (new) | Fixture project |
| `__tests__/fixtures/real-projects/typescript-express-L3/manifest.json` (new) | Per INV-32 schema (`language`, `archetype`, `levels`) |
| `__tests__/fixtures/typescript-express-L3.test.ts` (new) | Runs arbiter init + asserts L1 green |
| `scripts/check-matrix-fixtures.mjs` | Verify fixture is recognized |

## Acceptance criteria

- [ ] Sub-1: zero non-SHA action refs in any `src/templates/github/workflows/*.ejs` (assertable in CI)
- [ ] Sub-2: every generated workflow has top-level `permissions:` (assertable)
- [ ] Sub-3: every generated workflow uses `${{ vars.CI_BUILD_RUNNER_LABEL || 'docker-ci-build' }}` in `runs-on:`
- [ ] Sub-4: `prettier --check` on freshly generated output returns 0
- [ ] Sub-5: fixture-based test runs in CI, asserts `node scripts/check-all.mjs L1` exit 0 on the fixture
- [ ] Wave 0 smoke test on fresh haben checkout (post all sub-fixes) shows 0 of the previous 4 L1 failures
- [ ] L2 green
- [ ] Reviewed by Claude

## Open questions

1. Are all 9 action SHA pins lookupable today, or are some upstream actions deleted/renamed since templates were written? (Survey)
2. Is there an existing arbiter self-dogfood path that already runs L1 against generated templates? If yes, why didn't it catch this? (Bug in self-dogfood is itself a finding.)
3. For the INV-32 fixture: archetype `backend-web-db` × `typescript/express` × L3 is the haben config. Should we also add a fixture for L1 and L2 to assert the level downgrade path?
4. Does `CI_BUILD_RUNNER_LABEL` need to fall back to `ubuntu-latest` for public OSS users without a self-hosted runner? (Affects the `||` default in the var.)
