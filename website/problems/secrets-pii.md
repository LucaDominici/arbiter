---
title: 'Secrets or PII keep slipping into commits, tests, or logs'
doc_version: '1.0.0'
status: active
last_review: '2026-06-01'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Secrets or PII keep slipping into commits, tests, or logs

> An API key in a test fixture, a real email in a seed file, a token in a debug log — and we only find out after it's in history.

## The problem

Credentials and personal data leak into repositories through fixtures, examples, logs, and hasty
commits. Once in git history they are expensive to purge, and a warning-only scan gets ignored.

## Who feels it

- Teams under data-protection or customer-trust pressure.
- Anyone who has had to rotate a leaked key or rewrite history.

## How arbiter enforces it

At **L2**, `arbiter init` generates two always-active HARD checks:

- **INV-11 (secret scan):** gitleaks runs as a `security-early-fail` CI job _before_ lint and tests,
  and in the local L2 gate. A detected secret fails the build.
- **INV-12 (PII scan):** `pii-scan.mjs` is a HARD early-fail with **no grace period**, plus a
  `check-no-pii.mjs` Claude PostToolUse hook that blocks PII at edit time.

Both are `alwaysActive` once the project is at L2 or higher.

Source: invariant catalog (INV-11, INV-12); [Enforcement Philosophy](/governance/) per-level matrix
(secrets/PII are HARD at L2).

## How to verify

In a generated L2 project:

```bash
# Plant a fake credential, then:
node scripts/check-all.mjs L2          # gitleaks blocks
node scripts/pii-scan.mjs              # PII scan blocks
cat .claude/hooks/check-no-pii.mjs     # the edit-time hook
```

## What it does NOT do

- It is **not a compliance certification** — passing the scan is not GDPR / SOC 2 / ISO 27001
  certification. That requires audit and third-party review; arbiter only mechanically blocks the
  patterns it is configured to detect.

## Related

- [Vulnerable dependencies reach prod](/problems/vulnerable-deps)
- [Suppressions become permanent](/problems/suppression-expiry)
- [Governance & Legal](/governance/)
