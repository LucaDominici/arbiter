---
title: 'Tests are written after the fact and pass without verifying behavior'
doc_version: '1.0.0'
status: active
last_review: '2026-06-01'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Tests are written after the fact and pass without verifying behavior

> Tests get added once the code already works, so they encode the implementation rather than the requirement — and a green suite proves little.

## The problem

After-the-fact tests rarely fail for the right reason; they assert what the code happens to do. A
passing suite then gives false confidence. TDD discipline ("see it fail first") is easy to skip and
hard to prove was followed.

## Who feels it

- Teams that mandate TDD but can't tell whether it actually happened.
- Reviewers who can't distinguish a meaningful test from a tautology.

## How arbiter enforces it

`arbiter init` generates TDD evidence enforcement at **L2**:

- **INV-26 (TDD evidence):** `arbiter task record-red` captures the failing-test run; `arbiter verify
tdd` runs in the L2 gate and at `arbiter task advance --to green`. Advancing to implementation
  without a recorded red test is blocked.
- **INV-30 (mutation testing, Java, L2+):** generated pitest config enforces a mutation-score /
  line-coverage threshold as a HARD gate — this narrows "tests that don't actually assert behavior."
- **INV-34 (real-DB integration, L2+):** Testcontainers-backed tests with anti-fake-DB gates.

Source: invariant catalog (INV-26, INV-30, INV-34); [Enforcement Philosophy](/governance/) level
matrix.

## How to verify

In a generated L2 project:

```bash
# Write implementation with no recorded red test, then:
arbiter verify tdd            # blocks — no failing-test evidence
# Java projects:
node scripts/check-all.mjs L2 # runs the generated pitest mutation gate
```

## What it does NOT do

- It is **not a replacement for engineering judgment** — TDD evidence proves a red test existed
  before the code, not that its assertions are meaningful. Mutation testing narrows this, but only
  for the languages/layers where it is wired (Java domain/app at L2+).
- It is **not free of trade-offs** — recording red evidence and running mutation/real-DB suites adds
  developer and CI time.

## Related

- [Standards documented but not enforced](/problems/enforced-not-advisory)
- [Direct pushes / bot self-approval](/problems/branch-protection)
