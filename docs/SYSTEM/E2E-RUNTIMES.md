---
title: 'E2E Runtime Matrix'
doc_version: '1.0.0'
status: active
last_review: '2026-05-24'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/method']
related: ['CI-TIER-MODEL.md', 'AGENTS.md']
---

# E2E Runtime Matrix

## Context

Arbiter ships five library fixtures under `__tests__/fixtures/real-projects/`, one per
proven-tier language (TypeScript, Python, Go, Java/Gradle, Rust). INV-32 requires every
proven-tier language to have at least one runnable fixture here.

The native-toolchain E2E test (`__tests__/integration/e2e/native/fixture-native.test.ts`,
wave D #1042) proves each fixture is a **genuine project** — it stages the fixture into a
tmpdir and runs its own test suite via the native toolchain (npm, pytest, go test, gradlew,
cargo). This is orthogonal to the bake tier (which tests arbiter generator output) and the
functional tier (which tests the arbiter-generated gate). INV-75 mandates that T4 nightly
runs this suite within a ≤26 h heartbeat window.

---

## Per-Stack Toolchain Matrix

| Stack       | Fixture path           | Runner command                            | Toolchain action + SHA                                                                                                                           | Tier       |
| ----------- | ---------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| TypeScript  | `ts-library/`          | `npm ci --no-audit --no-fund && npm test` | `actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e` # v6.4.0                                                                           | T4 nightly |
| Python      | `python-library/`      | `pip install -e '.[test]' && pytest`      | `actions/setup-python@a26af69b4fde46a5e1776bf3f1b1e6dd8f0dd5ca` # v5                                                                             | T4 nightly |
| Go          | `go-library/`          | `go test ./...`                           | `actions/setup-go@40f1582dade4d2f1c86a3da5e27c02b98fee3ec0` # v5                                                                                 | T4 nightly |
| Java/Gradle | `java-library-gradle/` | `./gradlew test --no-daemon`              | `actions/setup-java@c1e32368a7ca79e19b34aa7e28d3de3a8b47c8ea` # v4 + `gradle/actions/setup-gradle@0b6dd653ba04f4f93bf581ec31e66cbd7dcb644d` # v4 | T4 nightly |
| Rust        | `rust-library/`        | `cargo test --frozen`                     | `dtolnay/rust-toolchain@29eef335eb45f53c3dc45d8f50abf17af8e2b0bd` # branch:stable (see SHA-pin policy)                                           | T4 nightly |

All native E2E tests are **skipped at T1 (PR fast)** — the target runners do not have all
toolchains installed and cold downloads would exceed the T1 time budget. The `VITEST_NATIVE=1`
guard in the test file enforces this. CI sets `VITEST_NATIVE=1` only in the `bake-e2e-native`
nightly job.

---

## SHA-Pin Policy (INV-76)

Every third-party GitHub Action ref in `.github/workflows/` MUST be a 40-character commit
SHA, not a floating tag or branch. This is enforced by `check-action-pins.mjs` (gate) and
`sync-action-pins.mjs --check` (EJS template parity). See INV-76 in AGENTS.md.

### Canonical SHAs used by bake-e2e-native

| Action                        | SHA                                        | Human label   |
| ----------------------------- | ------------------------------------------ | ------------- |
| `actions/checkout`            | `de0fac2e4500dabe0009e67214ff5f5447ce83dd` | v6.0.2        |
| `actions/setup-node`          | `48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e` | v6.4.0        |
| `actions/setup-python`        | `a26af69b4fde46a5e1776bf3f1b1e6dd8f0dd5ca` | v5            |
| `actions/setup-go`            | `40f1582dade4d2f1c86a3da5e27c02b98fee3ec0` | v5            |
| `actions/setup-java`          | `c1e32368a7ca79e19b34aa7e28d3de3a8b47c8ea` | v4            |
| `gradle/actions/setup-gradle` | `0b6dd653ba04f4f93bf581ec31e66cbd7dcb644d` | v4            |
| `dtolnay/rust-toolchain`      | `29eef335eb45f53c3dc45d8f50abf17af8e2b0bd` | branch:stable |

**`dtolnay/rust-toolchain` is branch-tracked, not a tagged release.**
The SHA above is the HEAD of the `stable` branch as of 2026-05-24. It decays as upstream
advances. Refresh cadence: check the branch HEAD before each quarterly dependency bump PR.
The inline workflow comment `# branch:stable @ 2026-05-24` documents the last refresh date.
Tracked in E2E-RUNTIMES.md §Update Procedure step 5.

---

## Heartbeat Coverage (INV-75)

INV-75 mandates a T4 nightly heartbeat: the full native E2E suite must run within ≤26 h.
The `bake-e2e-native` job in `.github/workflows/06-nightly.yml` satisfies this requirement.
It runs as a matrix over `{stack: [ts, python, go, java, rust]}` so each cell runs
independently (fast-fail isolation, better failure attribution).

The job is wired in **both** `nightly-required.needs:` AND the `RESULTS=(...)` shell array
(lines ~154-161 in `06-nightly.yml`). Adding a job to `needs:` alone is **not** sufficient
to make it a blocking hard-failure — the `RESULTS` array must also include
`"${{ needs.bake-e2e-native.result }}"`. This is enforced by this documentation; there is no
automated check for RESULTS completeness (pre-existing gap, out of scope for #1042).

---

## Skip-With-Reason Policy

At T1 (PR fast, `npm test`), native E2E tests are guarded by `process.env.VITEST_NATIVE !== '1'`
in `fixture-native.test.ts`. Vitest's `describe.skipIf(!NATIVE)` causes the describe block to
show as skipped with a reason, not as zero tests. This is consistent with INV-31 (no silent
skips) and the CI-TIER-MODEL.md skip-with-reason convention.

The skip message is visible in vitest output:

```
describe.skipIf(!NATIVE)('native — toolchain smoke tests', () => { ... })
```

---

## Update Procedure

When adding a new proven-tier language or archetype:

1. Create a fixture under `__tests__/fixtures/real-projects/<stack>-<archetype>/` with a
   valid `manifest.json` containing `{language, archetype, levels}`. INV-32 is enforced by
   `check-matrix-fixtures.mjs`.
2. Add the language entry to the `STACKS` constant in `fixture-native.test.ts`.
3. Add a row to the per-stack matrix table above.
4. Wire the toolchain step in the `bake-e2e-native` matrix job in `06-nightly.yml` **and**
   mirror the same step into `src/templates/github/workflows/06-nightly.yml.ejs` (CANON-18).
   Run `npx vitest run __tests__/parity/ci-tier-render-parity.test.ts` to verify parity.
5. If using `dtolnay/rust-toolchain`, refresh the stable-branch SHA and update the inline
   `# branch:stable @ YYYY-MM-DD` comment and the table above.
6. Run `node scripts/check-action-pins.mjs` (INV-76) and
   `node scripts/sync-action-pins.mjs --check` (template parity) to confirm all pins are SHA.
7. **Do not use `npm run test:e2e:native` directly from a worktree whose path contains `#`** —
   Vite's URL parser treats `#` as a fragment separator. Use
   `node scripts/check-all.mjs check` which sets the `VITEST_ROOT` symlink at
   `/tmp/arbiter-wt-sym` automatically. See `scripts/check-all.mjs` lines ~47-53.
8. Native tier MUST stay single-file OR add `poolOptions.forks.singleFork: true` in
   `vitest.integration.config.ts` before adding more native test files, to prevent race
   conditions between concurrent forks sharing the fixture tmpdir.

---

## Known Posture

| Gap                                                              | Accepted     | Rationale                                                                                                                                                                         |
| ---------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `java-library-gradle/` has no `gradle/verification-metadata.xml` | Yes          | Minimal-fixture posture: mavenCentral artifacts flow without hash verification. Real Java projects MUST add their own `verification-metadata.xml`. Tracked as follow-up to #1042. |
| `dtolnay/rust-toolchain` is branch-tracked                       | Documented   | SHA pinned to `stable` HEAD as of 2026-05-24. Manual refresh required per §SHA-Pin Policy above.                                                                                  |
| `nightly-required` RESULTS array incomplete                      | Pre-existing | `fuzz` and `soak-e2e` are in `needs:` but NOT in the `RESULTS=(...)` array. This PR adds `bake-e2e-native` to RESULTS; the broader gap is out of scope.                           |
