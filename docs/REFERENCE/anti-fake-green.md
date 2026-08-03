---
title: 'Reference: Anti-fake-green guards'
doc_version: '1.0.0'
status: active
last_review: '2026-08-02'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: ['096-probe-incidental-discovery-loop']
---

# Reference: Anti-fake-green guards

A **fake-green** (falso-green) is any condition where a passing signal — a CI check, a score, a
gate — is satisfied by something _other than the real property it is supposed to attest_. These
guards each pick one such gap and make the signal depend, deterministically, on the real property.

> Doctrine: every guard **fails closed** (uncertainty ⇒ non-pass), treats **NO-DATA as not a pass**
> (an explicit skip, never green), is **self-audited** (a guard that can't detect its own violation
> is itself a fake-green), and **does not over-claim** (only shipped guards are listed here).

## Shipped guards (#1412)

Catalog honesty (INV-114): this table lists **only guards that actually ship**. Each row is wired
into the gate via the `check-anti-fake-green.mjs` aggregate (class `gh-audit` = remote/advisory,
`file-scan` = deterministic/hard-fail), except guard #8 which is the score-side Tier-1 veto.

| Guard                                          | Class      | Fake-green it catches                                                               | Detection                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------- | ---------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check-muted-test.mjs` (#1)                    | file-scan  | a **gate test silenced** by a skip/disable marker                                   | Greps gate test dirs for cross-stack skip markers (it/test/describe`.skip`, `xit/xtest`, `@Disabled`/`@Ignore`, `#[ignore]`, `pytest.mark.skip`, `t.Skip(`) anchored to statement/annotation position. **NO-DATA (no test files) = SKIP at exit 0**, never a pass. Inline opt-out: `// muted-test-exempt: <rationale>`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `check-skip-critical-e2e.mjs` (#6)             | file-scan  | a **skipped critical-path e2e** spec                                                | Scans playwright/cypress/wdio e2e spec dirs for skipped specs, worst-case when tagged `@critical-path`. **No e2e config ⇒ NA (exit 0)** — nothing to skip, never a manufactured fail. Opt-out: `// skip-critical-e2e-exempt: <rationale>`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `check-no-stub-redirects.mjs` (E10)            | file-scan  | a **stale "Moved →" stub** `.md` (redirect husk)                                    | Flags a `.md` that is a redirect-verb heading + short body + a single `.md` link. Allowlist (`.stub-redirects-allowlist`) entries **require a hard `EXPIRES: YYYY-MM-DD`** — an open-ended or lapsed exemption fails closed (it is itself a fake-green).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `check-secret-presence.mjs` (A1, #1497)        | file-scan  | a **CI step that silently skips on an empty secret**                                | Scans `.github/workflows` run-steps for the silent-skip-on-empty-secret idiom — an emptiness test on a secret-backed env/assignment var that reaches `exit 0` WITHOUT an explicit `vars.SKIP_<NAME>` opt-out, so a missing secret would turn the gate green with the real work never done. The ONLY sanctioned skip is `vars.SKIP_<NAME>=true`; otherwise the empty-secret branch must `exit 1` loud: `test -n "$SECRET" \|\| { [ "${SKIP_X}" = "true" ] && exit 0 \|\| { echo "::error::..."; exit 1; }; }`. `secrets.GITHUB_TOKEN` (always provided) and informational workflows (heartbeat/nightly/weekly/monthly/notify) are exempt. In the arbiter repo it ALSO vets the shipped workflow TEMPLATES so a poisoned `.ejs` cannot ship a fake-green to every generated project. **NO-DATA (no secret steps) = PASS.** Dual-track: emitted into generated projects via the anti-drift family.                                                                                                                                                                                                                                           |
| `check-continue-on-error.mjs` (A3, #1497)      | file-scan  | a **GATING job/step that swallows its own failure**                                 | Parser-backed: reads the `continue-on-error` value through the YAML 1.1 boolean grammar, so the const-true forms a plain regex misses are caught — `on`/`yes`/`y` (YAML-1.1 → `true`) and `${{ true }}` — on any job/step that runs a recognized gate/test/check command. A swallowed gate turns a red run green. `js-yaml` confirms when installed; a tolerant YAML-1.1 token set is the fallback (so the `on:`→`true` trap is caught with or without it). A dynamic expression (`${{ <expr> }}`) is indeterminate ⇒ NOT flagged. The SOLE sanctioned step is an artifact up/download; informational workflows (heartbeat/nightly/weekly/monthly/notify), an audited `# arbiter-allow-continue-on-error` marker, and the drift-shadow `parity` step are exempt. In the arbiter repo it ALSO vets the shipped workflow TEMPLATES so a poisoned `.ejs` cannot ship a swallowed gate to every generated project. **NO-DATA (no workflows) = PASS.** Dual-track: emitted into generated projects via the anti-drift family. Complements the regex sibling `check-workflow-test-integrity.mjs` (which it cannot parse the `on:`→`true` trap). |
| Tier-1 reality-contact veto (#8)               | score-side | a high **process score masking a missing outcome**                                  | `src/conformance/score.ts:computeConformance` — any reality-contact Tier-1 dimension (`dimensions.ts` family `reality-contact`, tier 1, e.g. `D-LIVE-E2E`) with verdict N vetoes the whole score to 0. **Not a separate script** — equivalence documented here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `check-min-review-time.mjs` (#9)               | gh-audit   | same-day / no-real-review merge — "review was decorative"                           | `gh` post-merge: **0 non-author approvals** (via `latestReviews`, not stale `reviews[]`) AND merge window < threshold (code 4h / doc 1h). Exempt: `min-review-exempt` label, dependabot patch/minor, trunk-solo+ADR-091.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `check-ownership-distribution.mjs` (#10 / O-9) | gh-audit   | single-owner governance theater                                                     | `gh issue list`: % of open P0/P1 unassigned OR held by the **empirically dominant** assignee > threshold (default 30%). A configured `--owner` that matches nothing yields NO-DATA, never PASS.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `check-oracle-discrimination.mjs` (#2160)      | file-scan  | an E2E wait that accepts **error/empty state as success**                           | Port of a proven consumer-project guard, generalized. Scans e2e specs for a terminal-state wait (`.or(...).toBeVisible()`/`waitFor`) whose branch reads as a failure state (empty/error/not-found) and asserts nothing discriminates WHICH state arrived right after — the missing test is invisible, not red. Ratchet baseline (`oracle-discrimination-baseline.json`), same shape as `check-muted-test.mjs`: **missing baseline is fail-closed (exit 1)**, never auto-generated; only explicit `--update-baseline` grows it. **Consumer-only**: emitted by generator only where an E2E harness is applicable (archetype `frontend-spa`/`backend-web-db`, same predicate as `generateE2eConstitution`) — arbiter itself has no Playwright/E2E harness, so this guard is not in arbiter's own aggregate roster, and a target without one gets no file and the roster reports it `absent` rather than fabricating a pass.                                                                                                                                                                                                                  |
| `check-assertion-delta.mjs` (#2161)            | file-scan  | a **reward-hacking-shaped diff** — assertions cut, or skips added, to turn CI green | Diffs a commit range for the test-stack assertion patterns (JUnit/AssertJ, Vitest/Playwright `expect(`) in a data table (not hardcoded to one stack): assertions removed with none added, or the skip-marker count rising, fails **unless** a commit in the range carries an `Assertion-Delta-Override: <reason>` trailer — checked across the WHOLE range, not just the tip commit, so an override buried a few commits back is still honored. The override is visible to INV-119 commit-footer accounting. Shipped both in arbiter's own aggregate (any test stack applies) and emitted unconditionally into every generated project.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `check-anti-fake-green.mjs` (aggregate)        | aggregate  | a guard disarmed by being broken                                                    | file-scan child `exit 1` = hard fail; gh-audit child `exit 1` = advisory; **any child `exit 2` (broken) fails the aggregate unconditionally** — you cannot disarm a guard by breaking it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

### Meta-gates (engine-level, not aggregate children)

- **N1 — fail-closed disarm**: `scripts/gold-audit.mjs --check --require-baseline` HARD-FAILS when
  a configured engine's committed baseline is missing, so deleting the baseline cannot silently
  erase the regression record. Wired into the committed `check-all.mjs` gold-audit no-regress
  step (`scripts/gold-audit.mjs --check --require-baseline`), so the self-gate enforces it.
- **N2 — self-audit ("audit the auditors")**:
  `__tests__/conformance/anti-fake-green-self-audit.test.ts` exercises every guard against
  synthetic violations — gh-audit guards via the I/O-free `scripts/lib/anti-fake-green-core.mjs`,
  and the file-scan guards (#1/#6/E10) end-to-end on fixtures — proving each still _detects_ its
  fake-green (a violation BLOCKS; clean / NA PASSES) before it is trusted in the gate.
- **N3 — no-regress**: already enforced on the `scripts/gold-audit.mjs --check` path (a Y→N /
  score drop vs the committed `.gold-audit-baseline.json` fails the gate), wired into
  `scripts/check-all.mjs` as the `gold-audit no-regress` step. **Not re-implemented** in
  `src/conformance/` — the single `checkNoRegress` lives in `scripts/lib/gold-audit-lib.mjs`.
- **N4 — gates bite (`arbiter doctor --prove-gates`, #1817)**: every tier-1 (must-pass)
  conformance dimension has ONE intentional-violation fixture proving the gate actually _bites_.
  For each tier-1 dimension, `src/conformance/gate-proofs.ts` seeds an isolated `mkdtemp` fixture
  that violates the rule, runs the **real** probe against it, and asserts the verdict is failing
  (`N` or `P` — the same `score.ts` `tier1Fails` predicate that flips a repo to NON-CONFORMANT).
  A gate that cannot reach a failing verdict is installed in name only — a fake-green. This
  replaces the anti-pattern of per-script self-test suites (dozens of `test-*.sh` scripts testing
  the gate scripts) with one small negative fixture per gate. `arbiter doctor --prove-gates`
  (text or `--json`) runs all proofs and exits `1` if any gate does not bite. Surfaced finding:
  `D-INVARIANTS-ENFORCED` has no reachable `N` verdict (rescoped to presence-only per #1698
  RT-02), so it reports `[NO-BITE]` today — the tool doing its job. Impl:
  `src/commands/doctor.ts` (`runDoctorProveGates`), tests in
  `__tests__/conformance/gate-proofs.test.ts` + `__tests__/commands/doctor-prove-gates.test.ts`.

## `arbiter doctor` diagnostics for target repos (#2162)

The guards above catch arbiter faking green on **its own** gate. `arbiter doctor tool-pins` and
`arbiter doctor fail-open-census` catch the same doctrine failure in an arbitrary **target**
repo's local dev loop, one layer below CI:

- **`tool-pins`**: a local gate tool older than the CI-pinned version still runs and prints
  PASSED — worse than a missing tool, because it lies instead of warning. Extracts pins from the
  target's own `.github/workflows/*.yml` and compares against a real `<tool> --version` probe.
- **`fail-open-census`**: censuses presence-gate patterns — a gate that silently no-ops when its
  tool is absent instead of failing closed — across the target's `scripts/` and `.githooks/`.
  Both spellings count: the explicit `command -v X || <fail-open>` forms, and the positive
  `if command -v X … then … fi` form where the skip is the implicit empty else (an else that only
  warns is still a skip; an else that falls back to another tool is not).
  Non-negotiable allowlist contract: an entry with no
  `reason` is a malformed exemption, not a normal finding, and exits `2` per the same
  Exit-code contract (INV-53) below.

Both are read-only diagnostics (no writes to the target) — see `website/reference/cli.md` for the
full flag reference. Impl: `src/commands/doctor/tool-pins.ts`, `tool-pin-extract.ts`,
`fail-open-census.ts`.

### Rollout note (downstream generation)

The three file-scan guards (#1, #6, E10) are **selfOnly** for now — they run against the arbiter
repo only. Downstream consumer-project generation (the `.ejs` templates that emit these guards into
initialised projects) is **deferred to #1419 (LU-1)**, which consolidates the #1412 / #1413 / #1374
downstream generation in one pass.

## Muted-tests baseline

The **consumer-side** `check-muted-test.mjs` (the `.ejs`-generated guard shipped into initialised
projects) supports brownfield grandfathering (#1884): a legacy repo can carry dozens of
pre-existing `@Disabled` tests (dead remote fixtures) that are not fixable in one adoption step,
and a guard that fails closed on all of them blocks gold adoption entirely.

`node scripts/check-muted-test.mjs --update-baseline` records the CURRENT per-file /
per-marker-kind **counts** into `muted-tests-baseline.json` (counts, not line numbers — they
survive unrelated edits). From then on only **new** muted tests fail: a marker in a new file, a
new marker kind, or a count above the grandfathered one. Removing muted tests never fails; an
unparseable baseline **fails closed at exit 2** (it can never silently disable the guard). The
empty baseline emitted at init is equivalent to no baseline — strict by default. Same policy
shape as `spotbugs-baseline.json` (security findings there are never baselined; here the analog
is: NEW mutes are never grandfathered implicitly).

## Exit-code contract (INV-53)

`0` = PASS / advisory · `1` = FAIL (`--enforce` + violations, or a hard/broken child) · `2` =
ERROR (the guard itself malfunctioned). **NO-DATA is `0`, never `2`** — a missing `gh` is an
environment condition, not a broken guard.

## Rollout

The **gh-audit** guards (#9, #10) are report-only (advisory, exit 0) by default and promote to
blocking with `--enforce` once trusted — the `check-anti-proforma` precedent. The **file-scan**
guards (#1, #6, E10) are deterministic and **hard-fail by default** (a child exit 1 fails the
aggregate); they require no `--enforce`. All are wired into `check-all.mjs` via the aggregate. The
score-side veto (#8) is already Tier-1 in the conformance engine. Tracked under epic #1411
(GKv2-1, #1412).
