---
title: 'ADR-038: Mission Elevation — v1.0 Scope'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# ADR-038: Mission Elevation — v1.0 Scope

**Date:** 2026-05-10
**Status:** Accepted
**Supersedes:** N/A

---

## Context

Approaching v1.0, arbiter has accumulated scope that does not align with the core mission: install a production-grade AI governance stack into any project in one command. Specifically:

1. **Obsidian vault feature** — a POC for generating an Obsidian knowledge base from project structure. Useful in demos; expensive to maintain; not governance.
2. **Plugin API stability** — the plugin API shipped in M32 is functional but not field-tested. Advertising it as stable before external consumers exist would create premature compatibility obligations.
3. **Java enforcement stack** — ArchUnit hexagonal suite (production baseline parity) is partially shipped; three templates are missing.
4. **ADR-037 collision** — two ADRs share the number 037 (`037-evidence-harness-target-projects.md` and `037-java-static-analysis-baseline.md`). ADR-038 is the next clean number.

---

## Decision

### 1. Remove Obsidian vault from arbiter core

The Obsidian vault feature is deleted in its entirety. This closes issues #335, #168, #123, #323, #182, #396.

**Rationale:** Obsidian vault generation is a documentation convenience feature, not a governance mechanism. It couples arbiter to a proprietary knowledge base tool, adds ~30 source files, and is not covered by the core mission. The effort required to maintain it at production quality exceeds the value it delivers relative to the target user (developer who runs `npx arbiter init`).

The code is recoverable from git history. It is not deleted from the project's past; it is removed from v1.0 scope.

### 2. Mark plugin API @beta

The plugin API (`src/types/plugin.ts`, exported as `@arbiter/cli/plugin`) is marked `@beta`. Breaking changes are possible before v1.0. See ADR-031 for graduation criteria.

### 3. Complete Java + TypeScript enforcement stacks

v1.0 scope = Java + TypeScript enforcement stacks at full production baseline parity. Other stacks (Rust, Go, Python) are present and functional; their enforcement templates follow after v1.0 if community demand warrants.

---

## Consequences

### Positive

- Codebase reduces by ~30 files; the remaining code is entirely within scope
- Plugin API users get an honest stability signal; no surprise breaking changes post-v1.0
- v1.0 milestone is achievable with the remaining work (ArchUnit parity + empirical hook tests)

### Negative

- Users who were experimenting with the Obsidian vault feature lose it; they can self-serve from git history
- Plugin authors cannot rely on API stability until graduation criteria are met (see ADR-031)

---

## ADR-037 Collision Note

Both `037-evidence-harness-target-projects.md` and `037-java-static-analysis-baseline.md` use number 037. This is a pre-existing numbering error. ADR-038 is the next clean slot. A future cleanup commit will renumber one of the 037 files to 037a or a higher number; that cleanup is deferred to avoid churn during the v1.0 sprint.

---

## See Also

- ADR-031: Plugin API v1 (including beta graduation criteria)
- Issues #396, #397, #398, #400 — implementation issues for this decision
