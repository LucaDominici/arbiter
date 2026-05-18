# GDPR Art.17 Erasure Cascade Runbook (M-05) — Port Notes

**Date:** 2026-05-17
**Origin:** #713 — "M-05 — GDPR Art.17 erasure cascade runbook (with Keycloak-record-delete fix)"

## What landed

`src/templates/governance/gdpr-erasure-runbook.md.ejs` — 14-step erasure cascade ported from `reference-impl/docs/SYSTEM/PRIVACY_MODEL.md:86-120`. Includes the **Keycloak DELETE fix** discovered during the reference-impl audit (their implementation only DISABLED the Keycloak record; that is incomplete Art.17 — the identifier is still recoverable from a disabled-but-present user).

## The 14 steps

1. Lock subject record (no new writes)
2. Snapshot audit trail (retain for legal claims)
3. Anonymise application database
4. Anonymise read replicas
5. Delete cached artifacts
6. Delete object-storage artifacts
7. Invalidate active sessions
8. Delete from analytics warehouse
9. Delete from search index
10. Notify third-party processors
11. Delete from email provider
12. **DELETE Keycloak record (NOT disable)** — M-05 audit fix
13. Delete from backup retention (document window)
14. Final user-facing confirmation

Each step has an exit assertion. Failure halts the cascade and escalates to DPO.

## Multi-stack hook stubs

The runbook embeds skeleton snippets for TS/Express, Java/Spring, and Go/chi. These are stubs — projects implement the actual `step1.js` / `Step1Service.java` / `step1.go` against their data model.

## Anti-patterns documented in the template

- Soft-delete-only (a timestamp is not erasure)
- Disable instead of delete (the Keycloak gotcha)
- Skipping backups
- Skipping third-party processors
- Treating erasure as a one-step DB delete

## CANON references

- **CANON-04** (every .ejs has a render test): satisfied — `__tests__/templates/governance-render.test.ts` asserts no EJS leaks, projectName, all 14 step headings, the Keycloak fix, multi-stack stubs, anti-patterns, and the opt-in flag.

## Opt-in flag

```jsonc
{
  "compliance": {
    "gdpr_erasure": true,
  },
}
```

## What this port does NOT include

- **Right to object (Art.21)** — different request type, different flow. Separate runbook if needed.
- **Right to portability (Art.20)** — export, not delete. Separate runbook.
- **Cross-controller orchestration** — co-controller flows are contract-specific.
- **Identity-verification step** — belongs in your access-control SOP, not in the cascade.

## Source

#713 (M-05).
