---
generated: true
source: 'docs/GOVERNANCE/GOOD-FIRST-ISSUE-POLICY.md'
source_sha: 'a4383cb804b22296b07f9f64c6e805021ca91fb6'
last_updated: '2026-06-06'
---

# Good First Issue Policy

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/GOVERNANCE/GOOD-FIRST-ISSUE-POLICY.md](../docs/GOVERNANCE/GOOD-FIRST-ISSUE-POLICY.md)

# Good First Issue Policy

Issues labeled `good first issue` are curated on-ramps for first-time contributors. This policy defines what qualifies and how maintainers manage the label.

## Criteria

An issue qualifies as a good first issue when **all** of the following are true:

| Criterion        | Rule                                                            |
| ---------------- | --------------------------------------------------------------- |
| **Size**         | ≤ `size/S` (≤ 4h estimated)                                     |
| **Scope**        | Touches ≤ 2 files; no architectural decisions required          |
| **Clarity**      | Has explicit acceptance criteria + file paths in the issue body |
| **Independence** | No blocking dependencies on other open issues                   |
| **Mentor**       | A maintainer is assigned and available for 1–2 review cycles    |

Issues that require understanding the full plugin API, schema migrations, or CI infrastructure do **not** qualify — even if they seem small.

## Labeling

- Maintainers apply `good first issue` + `size/S` (or `size/XS`) simultaneously.
- Remove `good first issue` if a dependency appears or scope grows after filing.
- The canonical filter for contributors: `is:issue is:open label:"good first issue"`.

## Issue body template

Use `docs/GOVERNANCE/GOOD-FIRST-ISSUE-TEMPLATE.md` when filing curated issues. Fill in all sections before applying the label.

## Backlog of curated launch issues

See `docs/GOVERNANCE/GOOD-FIRST-ISSUE-CURATION.md` for the 10 issues curated at launch.

## Manual welcome

First-time contributors are welcomed manually by a maintainer on PR open. The maintainer points to CONTRIBUTING.md and sets response-time expectations.
