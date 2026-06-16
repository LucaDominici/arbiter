---
generated: true
source: 'docs/REFERENCE/anti-fake-green.md'
source_sha: '6b55f6338ad8bd8639e05c0412c9ee6d126c20f7'
last_updated: '2026-06-16'
---

# Reference: Anti-fake-green guards

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/anti-fake-green.md](../docs/REFERENCE/anti-fake-green.md)

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

| Guard                                          | Class      | Fake-green it catches                                     | Detection                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------- | ---------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check-muted-test.mjs` (#1)                    | file-scan  | a **gate test silenced** by a skip/disable marker         | Greps gate test dirs for cross-stack skip markers (it/test/describe`.skip`, `xit/xtest`, `@Disabled`/`@Ignore`, `#[ignore]`, `pytest.mark.skip`, `t.Skip(`) anchored to statement/annotation position. **NO-DATA (no test files) = SKIP at exit 0**, never a pass. Inline opt-out: `// muted-test-exempt: <rationale>`. |
| `check-skip-critical-e2e.mjs` (#6)             | file-scan  | a **skipped critical-path e2e** spec                      | Scans playwright/cypress/wdio e2e spec dirs for skipped specs, worst-case when tagged `@critical-path`. **No e2e config ⇒ NA (exit 0)** — nothing to skip, never a manufactured fail. Opt-out: `// skip-critical-e2e-exempt: <rationale>`.                                                                              |
| `check-no-stub-redirects.mjs` (E10)            | file-scan  | a **stale "Moved →" stub** `.md` (redirect husk)          | Flags a `.md` that is a redirect-verb heading + short body + a single `.md` link. Allowlist (`.stub-redirects-allowlist`) entries **require a hard `EXPIRES: YYYY-MM-DD`** — an open-ended or lapsed exemption fails closed (it is itself a fake-green).                                                                |
| Tier-1 reality-contact veto (#8)               | score-side | a high **process score masking a missing outcome**        | `src/conformance/score.ts:computeConformance` — any reality-contact Tier-1 dimension (`dimensions.ts` family `reality-contact`, tier 1, e.g. `D-LIVE-E2E`) with verdict N vetoes the whole score to 0. **Not a separate script** — equivalence documented here.                                                         |
| `check-min-review-time.mjs` (#9)               | gh-audit   | same-day / no-real-review merge — "review was decorative" | `gh` post-merge: **0 non-author approvals** (via `latestReviews`, not stale `reviews[]`) AND merge window < threshold (code 4h / doc 1h). Exempt: `min-review-exempt` label, dependabot patch/minor, trunk-solo+ADR-091.                                                                                                |
| `check-ownership-distribution.mjs` (#10 / O-9) | gh-audit   | single-owner governance theater                           | `gh issue list`: % of open P0/P1 unassigned OR held by the **empirically dominant** assignee > threshold (default 30%). A configured `--owner` that matches nothing yields NO-DATA, never PASS.                                                                                                                         |
| `check-anti-fake-green.mjs` (aggregate)        | aggregate  | a guard disarmed by being broken                          | file-scan child `exit 1` = hard fail; gh-audit child `exit 1` = advisory; **any child `exit 2` (broken) fails the aggregate unconditionally** — you cannot disarm a guard by breaking it.                                                                                                                               |

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

### Rollout note (downstream generation)

The three file-scan guards (#1, #6, E10) are **selfOnly** for now — they run against the arbiter
repo only. Downstream consumer-project generation (the `.ejs` templates that emit these guards into
initialised projects) is **deferred to #1419 (LU-1)**, which consolidates the #1412 / #1413 / #1374
downstream generation in one pass.

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
