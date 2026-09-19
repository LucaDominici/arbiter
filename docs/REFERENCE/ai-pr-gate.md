---
title: 'AI-PR Human-Approval Gate'
doc_version: '1.0.0'
status: active
last_review: '2026-09-19'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference', 'governance']
related: ['docs/internal/ADR/051-collaboration-mode-workflow-axis.md']
---

# AI-PR Human-Approval Gate

INV-91 detects AI-authored pull requests from agent commit trailers, the `ai-authored` label,
or a Bot PR author. Outside `trunk-solo`, `_ai-draft-check.yml` fails closed until a human who
is not the author applies `approved-by-human`; `dependabot[bot]` is exempt.

## Trunk-solo standing approval

Under `collaborationMode: trunk-solo`, the sole developer cannot independently approve their
own PR. Their standing owner approval therefore satisfies INV-91. The AI-PR check remains
present with the same required-check name and reports `INV-91 amended: trunk-solo — standing
owner approval (sole developer)` without a GitHub API call or a label assertion. Mechanical
local and CI gates plus independent review evidence carry the quality bar.

`peer-review`, `gated-review`, and an undefined collaboration mode retain the label-based,
fail-closed rule. The `approved-by-human` label remains defined for those modes.
