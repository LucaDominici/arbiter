---
generated: true
source: 'docs/METHOD/EXTRACTION_PLAYBOOK.md'
source_sha: 'dfc9206efac48edd8e15f536956cecbdb42fb78d'
last_updated: '2026-06-06'
---

# Extraction Playbook — PHOENIX framework-extraction pattern (M-06 port)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/METHOD/EXTRACTION_PLAYBOOK.md](../docs/METHOD/EXTRACTION_PLAYBOOK.md)

# Extraction Playbook — PHOENIX framework-extraction pattern (M-06 port)

> **Origin:** Ported from PHOENIX (reference-impl) framework-extraction docs
> (SEPARATION*ADR / PLAN / ROADMAP + ARCHITECT_PATTERNS + RED_TEAM_ANSWERS_R1-3).
> The reference-impl team executed this playbook to extract a framework from a
> production project. **arbiter executes the inverse** — it \_is* that
> extracted framework — so this playbook lives here as a strategic recipe for
> downstream projects that want to extract their own framework, not as
> day-to-day arbiter operations.

## When to use this playbook

A downstream project should consider framework-extraction when **all** of:

1. A reusable engine has crystallized inside a product codebase (≥ 2k LOC of clearly-bounded module(s) that other teams ask to depend on).
2. The cost of keeping it co-located with the product is now greater than the cost of versioning it separately (cross-team rollouts blocked on product release cadence, accidental coupling to product-specific schemas, etc.).
3. The product can survive a 3–6 month parallel-run window.

If any of these is false, **do not extract**. Premature extraction is the most common cause of premature OSS abandonware.

## Five-phase mechanism

### Phase 1 — Identify the kernel (week 1)

- Pick the **smallest** module(s) that satisfy the "engine" criteria.
- Write down what the kernel **does not depend on**: product DB schema, product auth, product config conventions, product UI strings.
- If the kernel has any of those dependencies, **stop**. Either refactor them out _before_ extraction, or extract a smaller kernel.

### Phase 2 — Shadow mode (weeks 2–6)

- Create the future framework repo as an _empty shell_ that re-exports the in-product kernel.
- Wire the product to import the shell, not the kernel directly.
- All product behaviour stays identical; the shell is a pass-through.
- This phase exists to **validate the import boundary**, not the API.

### Phase 3 — Empirical types (weeks 4–8, overlaps Phase 2)

- Treat every public symbol the shell re-exports as a contract.
- Generate type-shapes from real call sites (TS: `tsc --declaration`; Java: `javac -h`; Go: AST walk).
- Compare against the kernel's published types. **Any drift = a leak**: the shell is exposing something the framework shouldn't own. Refactor or remove.

### Phase 4 — Behavioural equivalence (weeks 6–10)

- Build a behavioural-equivalence harness: same input → same output for the in-product kernel and the shell-via-extracted-framework path.
- Run on production-like fixtures. Differences at this stage are bugs in extraction, not bugs in product. Fix in the framework.
- **Gate**: do not advance past this phase until the harness is green for two consecutive weeks.

### Phase 5 — Repo split (week 10+)

- The framework repo becomes load-bearing: the kernel source moves out of the product repo.
- The product depends on the framework via versioned release (semver, lockfile).
- The product team and the framework team now have separate release cadences. **This is the hard part**: the product team will want unreleased framework features. Resist; cut framework releases on a schedule.

## Anti-patterns (from PHOENIX red-team)

1. **"We'll fix the API after extraction."** No. The API _is_ the extraction. Fix it in Phase 1 or do not extract.
2. **"We'll keep one shared CI."** Then you haven't extracted. The framework needs its own CI with its own gate.
3. **"The product team will contribute back."** Plan for the case where they do not. The framework must be maintainable by zero product engineers.
4. **"We can skip behavioural equivalence — types are enough."** Types catch surface drift; behaviour catches semantics. Skipping Phase 4 ships subtle bugs.
5. **"We'll do all 5 phases in parallel."** The phases are sequenced because each one validates the previous. Parallelizing them removes the validation.

## Gate criteria per phase

| Phase | Gate                                                                                                                   | Failure mode if skipped                       |
| ----- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1     | Written kernel-boundary doc; zero forbidden dependencies on product internals                                          | Extracts a kernel that drags in product world |
| 2     | Product green for 2 weeks importing via shell                                                                          | Import boundary leaks                         |
| 3     | Type-equivalence harness green; no drift between shell types and kernel types                                          | Public API breaks silently                    |
| 4     | Behavioural-equivalence harness green for 2 weeks on production-like fixtures                                          | Semantic bugs ship                            |
| 5     | Framework cut its first independent release; product depends on it via lockfile; product team has approved the cadence | Framework becomes vendored fork               |

## Opt-in flag

Downstream projects can opt into the extraction-playbook reference by setting in `arbiter.json`:

```json
{
  "governance": {
    "extraction_playbook": true
  }
}
```

When enabled, arbiter generates a reminder under `docs/METHOD/` for the project pointing back to this playbook. No runtime mechanism is generated — the playbook is strategy, not enforcement.

## What arbiter does NOT generate from this playbook

- **No "extraction wizard" CLI.** The decision to extract is human + organisational, not mechanical.
- **No automated kernel-boundary detection.** Static analysis cannot tell you which symbols are "engine" vs "product" — that is a design judgment.
- **No automated shadow-mode wiring.** The shell-passthrough setup is too project-specific.

If a future port crystallizes a mechanical subset of this playbook (e.g. type-equivalence harness skeleton), it should be tracked as a separate `port` issue against this playbook.

## See also

- `docs/SYSTEM/CANON.md` — process rules
- `docs/METHOD/ENGINEERING_DEFAULTS.md` — engineering posture this playbook complements
- Source issue: #714 (M-06 port from FINDINGS.md#mech-M-06)
