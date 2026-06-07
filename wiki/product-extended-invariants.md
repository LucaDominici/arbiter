---
generated: true
source: 'docs/PRODUCT/EXTENDED-INVARIANTS.md'
source_sha: 'b05d55a8042521d5ccb5be8c07e3705f5d64b5f4'
last_updated: '2026-06-07'
---

# Extended Invariants — Rationale and Usage

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/PRODUCT/EXTENDED-INVARIANTS.md](../docs/PRODUCT/EXTENDED-INVARIANTS.md)

# Extended Invariants — Rationale and Usage

Opt-in invariant set INV-62..INV-71, derived from production-grade conventions observed in
real-world projects. Enable via `arbiter.json`:

```json
{
  "governance": {
    "invariants_catalog": "extended"
  }
}
```

Without this flag, INV-62..INV-71 are excluded from generated `AGENTS.md` and `GLOBAL_INVARIANTS.md`.

---

## Invariant Summaries

### <a id="m-01-frontend-state-separation"></a> INV-62 — Frontend state separation

Async (server) and sync (UI) state must live in distinct stores. Mixing them conflates cache invalidation with UI transitions.

### <a id="m-02-ssot-atomic-update"></a> INV-63 — SSOT atomic update

Code and SSOT documentation must land in the same commit. Split commits create windows of stale documentation.

### <a id="m-03-no-magic-code"></a> INV-64 — No magic code

Non-trivial idioms must be documented in a pattern catalog. Undocumented "magic" creates maintenance risk.

### <a id="m-04-platform-abstraction"></a> INV-65 — Platform abstraction

Env-specific APIs (browser, cloud SDKs, process.env) must be accessed through an adapter, not directly in domain code.

### <a id="m-05-process-self-documentation"></a> INV-66 — Process self-documentation

`docs/METHOD/` is the canonical location for process rules. Ad-hoc rules communicated elsewhere are not canonical.

### <a id="m-06-no-internal-mocking-in-e2e"></a> INV-67 — No internal mocking in E2E

E2E tests must run against a real service. Internal mocks in the E2E layer defeat integration coverage.

### <a id="m-07-mcp-first-forensic-inspection"></a> INV-68 — MCP-first forensic inspection

Debug running systems via MCP tools before raw shell. Raw shell commands bypass audit trails.

### <a id="m-08-design-rationale-traceability"></a> INV-69 — Design rationale traceability

New abstractions must cite their motivating ADR. Untraceable abstractions accumulate as unexplained complexity.

### <a id="m-09-reuse-before-new"></a> INV-70 — Reuse before new

Search the canonical registry before creating a new module. Document the search in the PR or plan.

### <a id="m-10-track-d-rules"></a> INV-71 — Track D task completion

Docs-only changes must follow the completion checklist in `docs/METHOD/`. Lower-ceremony docs PRs cause stale cross-references.

---

## Opt-in rationale

These invariants are valuable for teams with advanced frontend/process conventions but are not
universally applicable. They are excluded by default to avoid noise for projects that do not need them.
