# Plan: #347 + #352 — Mutation gate wiring + Stylelint/design-token enforcement

## Context

Two affinity-batched issues from umbrella #344, both wiring new gate steps into the
generated `src/templates/scripts/check-all.mjs.ejs` template and emitting a tool
config alongside.

- **#347** (CANON-02 / CANON-09 / CANON-15) — wire `stryker run` (TS) and
  pitest (Java Gradle/Maven) mutation steps into the L2 block, using thresholds
  from `arbiter.json`. Beta tools (Rust/Python) and `unsafe` (Go) remain unwired
  per CANON-02.
- **#352** (CANON-02 / CANON-15) — emit a new template
  `src/templates/css/.stylelintrc.json.ejs` and wire a `lint:css` step into the L1
  block for `archetype === 'frontend-spa' && language === 'typescript'`.

Both touch the same EJS template and both use the helper trinity
(`runCheck` / `runToolCheck`) shipped in #351 (PR #676, commit `780514d`).

## Scope (in this PR)

### #347 — Mutation gate wiring (L2)

1. Add new L2 mutation block to `check-all.mjs.ejs`, guarded by
   `mutationEnabled && features.mutationTesting !== false`:
   - TypeScript: `runToolCheck('mutation (stryker)', 'npx', ['stryker', 'run'])`
   - Java Gradle: `runCheck('mutation (pitest)', './gradlew', ['pitest', '-q'])`
   - Java Maven: `runCheck('mutation (pitest)', 'mvn', ['org.pitest:pitest-maven:mutationCoverage', '-q'])`
2. Pass `enableMutationTesting` through `src/generators/check-all.ts` template
   data so the template can gate on `features.mutationTesting`.
3. Render tests in `__tests__/templates/check-all-render.test.ts`:
   - TS L2 with mutation enabled → stryker step emitted
   - TS L1 → no mutation step
   - TS L2 with `enableMutationTesting: false` → no mutation step
   - Java Gradle L2 → pitest gradle step emitted
   - Java Maven L2 → pitest maven step emitted
   - Rust L2 → no mutation step (beta, CANON-02)
   - Go L2 → no mutation step (unsafe)

### #352 — Stylelint + design-token template (L1)

1. New template file `src/templates/css/.stylelintrc.json.ejs` with HARD rules:
   - `color-no-hex: true` with message pointing at design tokens
   - `length-zero-no-unit: true`
   - `custom-property-no-missing-var-function: true`
2. New step in L1 block of `check-all.mjs.ejs` guarded by
   `archetype === 'frontend-spa' && language === 'typescript'`:
   - `runToolCheck('lint:css', 'npx', ['stylelint', 'src/**/*.css'])`
3. Render test:
   - TS frontend-spa L1 → stylelint step emitted
   - TS library L1 → no stylelint step
   - Rust frontend-spa L1 → no stylelint step
4. Update matrix: add `style_tokens.typescript` row marked `proven` in
   `src/compatibility/cross-language-matrix.json`.

## Out of scope (deferred to follow-ups)

Per advisor guidance, the following acceptance items are **deferred**:

- `__tests__/integration/mutation-gate.test.ts` running on a fixture — needs
  pitest jars + stryker install in CI which exceeds this PR's gate-wiring scope.
- CI workflow mutation job — separate from gate wiring; `check-all.mjs.ejs` is
  the canonical gate ledger and `ci alignment` does NOT require parity for
  `./gradlew` or `mvn` commands (only for `npx:<tool>`, `node scripts/`,
  `npm:test`, `npm:audit`).
- INV-30 enforcement-claim wording tweak in AGENTS.md — INV-30 already cites
  pitest in check-all.mjs L2, which becomes literally true after this PR.
- Fixture additions for `__tests__/fixtures/real-projects/java-backend-web-db-gradle/`.

For #352 the deferred items are:

- Integration test rendering a project and asserting `gate fails` on a hex color.
- `theme.css` template + cross-ref to `UI-UX-STANDARDS.md`.

## CI-alignment safety check

`scripts/check-all.mjs`'s `ci alignment` gate normalizes `npx:<tool>` keys.
The two `npx`-prefixed steps added here are:

- `npx stryker run` → key `npx:stryker` — emitted only for TS L2.
- `npx stylelint src/**/*.css` → key `npx:stylelint` — emitted only for TS
  frontend-spa L1.

Neither key appears in arbiter's own `check-all.mjs` (this is the meta-template;
arbiter itself doesn't run stryker or stylelint), so the alignment check on
arbiter-self is unaffected. The check runs against generated projects, and the
generated CI workflow does not currently invoke either tool — out of scope for
this PR.

## Existing Code Survey

- **Target:** `src/templates/css/.stylelintrc.json.ejs`
- **Decision:** `new file justified`

### Evidence

- `grep -rn "stylelint\|lint:css" src/ __tests__/` → 0 hits, no prior scaffolding
- `ls src/templates/` → no `css/` directory exists (mutation, coverage, security
  exist as analogous tool-specific config dirs)
- `grep -rn "color-no-hex\|custom-property-no-missing-var-function" src/` → 0 hits

### Rationale

No existing stylelint configuration template exists in the repo. The closest
analogues are `src/templates/mutation/stryker.conf.json.ejs` and
`src/templates/static-analysis/` for ESLint configs — both are single-tool config
directories under `src/templates/<tool-or-domain>/`. The stylelint configuration
is a net-new CSS-domain enforcement asset (no shared abstraction with ESLint JSON
configs, since stylelint has its own rule namespace and plugin model). The new
`css/` directory mirrors the existing `mutation/`, `coverage/`, `security/`
layout pattern — one folder per domain, EJS template per emitted file. Refactor
into an existing folder is not viable because the rule shape, the file location
in the consumer project (`.stylelintrc.json` at repo root), and the runner
(`npx stylelint`) are all distinct from any other emitter; folding it into
`static-analysis/` would mix CSS and JS/TS lint concerns and obscure the
language-domain pivot used elsewhere.

## Commit plan

1. `feat(#347): wire mutation testing gate steps (CANON-02/09/15)`
2. `feat(#352): stylelint + design-token enforcement template (CANON-02/15)`

## Gate strategy

- L1 after each commit.
- L2 before push.
- knip false-positive on `node_modules`-only deps is acceptable per prior PRs.
