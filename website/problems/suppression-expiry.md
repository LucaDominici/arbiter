---
title: 'Temporary waivers and suppressions become permanent and forgotten'
doc_version: '1.0.0'
status: active
last_review: '2026-06-01'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Temporary waivers and suppressions become permanent and forgotten

> Someone adds a "just for now" lint-disable or a CVE suppression, the deadline passes, and three years later it's still there with no record of why.

## The problem

Every quality system needs an escape hatch — but escape hatches without an expiry quietly become
permanent holes. The reason is lost, the owner has left, and the suppressed risk is invisible.

## Who feels it

- Teams whose `// eslint-disable` and CVE suppressions have accumulated for years.
- Auditors and leads who cannot tell which waivers are still justified.

## How arbiter enforces it

`arbiter init` generates suppression handling under **INV-31** (always-active): every suppression —
whether file-based (`.trivyignore`, `.gitleaksignore`, `pii-allowlist.json`,
`archunit-baseline.json`) or inline
(`arbiter-suppress(INV-NN, until=YYYY-MM-DD, reason=…, owner=@handle)`) — **must** carry a reason
(≥10 chars), an owner (`@handle`), and an ISO expiry date.

A suppression whose `until=` date is in the past **blocks the L1 gate**. There are no permanent
suppressions: you renew (with a fresh justification) or you remove.

Source: invariant catalog (INV-31).

## How to verify

In a generated project:

```bash
# Add a suppression with an expiry in the past, then:
node scripts/check-all.mjs L1   # the expired waiver blocks the gate
cat scripts/check-suppressions.mjs scripts/check-inline-suppressions.mjs
```

## What it does NOT do

- It is **not a replacement for engineering judgment** — arbiter forces the waiver to be re-justified
  or removed on schedule, but your team decides whether the underlying risk is still acceptable.

## Related

- [Vulnerable dependencies reach prod](/problems/vulnerable-deps)
- [Standards documented but not enforced](/problems/enforced-not-advisory)
