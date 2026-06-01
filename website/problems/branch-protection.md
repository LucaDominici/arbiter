---
title: 'Anyone can push to main, or a bot can rubber-stamp its own PR'
doc_version: '1.0.0'
status: active
last_review: '2026-06-01'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Anyone can push to main, or a bot can rubber-stamp its own PR

> A direct push lands on main without review, or an automated agent approves the very PR it opened — the human gate is theater.

## The problem

Branch protection is easy to misconfigure, and "require approval" is meaningless if the approver can
be the author or another bot. As AI agents open PRs, self-approval becomes a real loophole.

## Who feels it

- Teams running AI agents that both author and review changes.
- Anyone who needs a credible "a human approved this" record.

## How arbiter enforces it

`arbiter init` generates the controls (HARD, branch-protection / CI):

- **INV-23 (no direct commits to main, always-active):** GitHub branch protection + a generated
  `.githooks/pre-push`.
- **INV-22 / INV-37:** branch-naming and the generated git hooks (pre-commit / pre-push / commit-msg).
- **INV-74 / INV-91 (`useGitHub: true`):** the generated `.github/workflows/03-human-approval.yml`
  applies the `approved-by-human` label **only** when the reviewer is _not the PR author_, _not a
  Bot account_, and the review is an approval. `01-pr-fast.yml` blocks merge until that label is
  present — so a bot cannot approve its own (or another bot's) PR.

Source: invariant catalog (INV-22, INV-23, INV-37, INV-74, INV-91).

## How to verify

In a generated GitHub-enabled project, inspect the artifacts:

```bash
cat .github/workflows/03-human-approval.yml   # the not-author + not-bot + approved triple check
cat .github/workflows/01-pr-fast.yml          # the human-approval-required merge block
cat .githooks/pre-push
```

## What it does NOT do

- It is **not a CI replacement** — these are workflow files for _your_ CI/branch-protection setup,
  which you must enable on the repo.
- It is **not free of trade-offs** — a mandatory human approval gate adds latency to every merge.

## Related

- [Tests written after the fact](/problems/tdd-evidence)
- [Can I trust the tool itself?](/problems/dogfooding-trust)
