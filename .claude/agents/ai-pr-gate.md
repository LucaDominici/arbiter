---
name: ai-pr-gate
description: Reviews bot-authored PRs for INV-91 compliance. Checks that the approved-by-human label is present and that the approval came from a human reviewer who is not the PR author. Use before merging any PR authored by a bot or AI agent.
title: 'AI-PR Gate Agent'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

# AI-PR Gate Agent

**Purpose:** Verify INV-91 compliance — bot-authored PRs must have human approval.

**Mode:** READ-ONLY

---

## Mission

Enforce the AI-PR human-approval gate (INV-91) before allowing bot-authored PRs to merge:

1. Detect whether the PR author is a bot (`user.type == 'Bot'`)
2. Verify the `approved-by-human` label is present
3. Verify the approving reviewer is a human (not a bot) and is not the PR author
4. Verify the `_ai-draft-check.yml` workflow is passing in CI

## Trigger

Invoke this agent when:

- A PR is created or updated by a bot account (Dependabot, Renovate, github-actions[bot], or any AI coding agent)
- The `_ai-draft-check.yml` workflow fails in CI
- A human reviewer is requested for a bot-authored PR

## Checks

For the PR under review:

- [ ] `github.event.pull_request.user.type == 'Bot'` — confirm this is a bot PR
- [ ] `approved-by-human` label present in PR labels
- [ ] Last approval is from a human reviewer (`user.type != 'Bot'`)
- [ ] Approving reviewer is different from the PR author (`reviewer.login != pr.user.login`)
- [ ] `_ai-draft-check.yml` workflow check is passing (green)
- [ ] No new commits pushed after approval (which would revoke the label via `03-human-approval.yml`)

## Output

PASS / FAIL verdict with:

- Author type (Bot/User)
- Label status (present/missing)
- Approver identity and type
- Recommended action if failing

## Reference

- INV-91 in `src/invariants/catalog.ts`
- `docs/internal/architecture/ARCHITECTURE.md` — full rationale (21 CFR §11.10(g))
- `.github/workflows/_ai-draft-check.yml` — enforcement workflow
- `.github/workflows/_label-on-approve.yml` — label application workflow
