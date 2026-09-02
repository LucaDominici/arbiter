---
title: 'Owner Decision Registry — the calls only the owner can make'
doc_version: '1.0.0'
status: active
last_review: '2026-09-02'
owner: ''
canonical_id: 'od-registry'
tags: ['audience/dev', 'kind/reference']
related: ['docs/internal/SYSTEM/ID-REGISTRY.md', 'scripts/data/advisory-ledger.json']
---

# Owner Decision Registry

An **owner decision** is a judgement a mechanism cannot make for itself: how hard a guard should
bite, whether a dated debt is debt or design, which of two defensible defaults the project takes.
Invariants are enforced, canon rules are followed, ADRs record architecture — an OD records that a
human with authority chose, on a date, between options none of which was wrong.

Until this file existed, `OD-14` was cited in a hook, two empirical tests, a gate test and the
advisory ledger with **nothing defining it**. A citation that resolves to no definition is
indistinguishable from an invented one, which is exactly what `scripts/check-id-registry.mjs` now
refuses: every `OD-NN` appearing anywhere in the repo must match a row below.

<!-- OD_REGISTRY_START -->

```json
{
  "registryVersion": "1.0.0",
  "decisions": [
    {
      "id": "OD-14",
      "date": "2026-07-17",
      "title": "Advisory gates are dated promotions, not a permanent tier; the context-rot enforcers ship hard",
      "decision": "Every runWarnCheck call site in scripts/check-all.mjs carries an entry in scripts/data/advisory-ledger.json that is either a dated promotion (promoteBy) or an explicit permanent:true with a rationale. The two pre-existing advisory gates inherited without a classification — 'orchestrator coverage (#1410)' and 'conformance' — were classified as dated promotions rather than permanent, on the same promoteBy window as the seeded #1943 entries. In the same decision the E5 spawn guard and the E6b finding-loss Stop hook were activated hard by default, via ARBITER_SPAWN_GUARD_HARD=1 and ARBITER_FINDING_LOSS_HARD=1 in the settings env block, rather than left advisory.",
      "rationale": "An advisory gate with no promotion date is ceremony: it reports forever, blocks nothing, and reads as coverage in an audit. Forcing every advisory into either a dated promotion or a written permanent exemption applies the suppressions-expiry discipline (INV-31) to the gate roster itself. Hardening E5/E6b followed the same logic — a guard whose failure mode is silent loss of findings earns its teeth on the day it is written, not after a bake-in nobody schedules.",
      "citedBy": [
        "scripts/data/advisory-ledger.json",
        "src/templates/claude/hooks/pre-spawn-worktree-guard.mjs",
        "__tests__/hooks/empirical/pre-spawn-worktree-guard.test.ts",
        "__tests__/hooks/empirical/stop-finding-loss.test.ts",
        "__tests__/scripts/check-bypass-ceremony.test.ts"
      ],
      "enforcement": "scripts/check-bypass-ceremony.mjs (#1949) enforces ledger completeness; scripts/check-id-registry.mjs resolves the citations above against this row.",
      "provenance": "reconstructed-2026-09-02"
    }
  ]
}
```

<!-- OD_REGISTRY_END -->

## Field contract

`provenance: reconstructed-<date>` marks a row rebuilt from its citations rather than written when
the decision was taken — the wording is inferred from how the decision is used in the ledger, the
hook headers and the tests, all of which agree. A row written at decision time omits the field.
Reconstruction is recorded rather than hidden: a reader deciding how much weight to give the
phrasing needs to know which kind of row they are reading.
