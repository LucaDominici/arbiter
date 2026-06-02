---
title: 'Rust Context-Aware INV-04 Checkers and Rebased-Aware Docs-Check'
doc_version: '1.0.0'
status: active
last_review: '2026-05-14'
owner: ''
canonical_id: '087'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-087: Rust Context-Aware INV-04 Checkers and Rebased-Aware Docs-Check

**Project:** arbiter
**Date:** 2026-05-14
**Status:** Accepted
**Reference:** Issues #356, #360 (from umbrella #344); CANON-01, CANON-02

> **Note:** This decision was originally recorded in `docs/SYSTEM/DECISIONS.md` as a second `## ADR-042` entry.
> That ID was already in use for a different decision (Three-Tier Gate System, `docs/ADR/042-gate-tiers.md`).
> Content extracted here as ADR-087 to resolve the collision.

## Context

Two Phase 7 gaps from haben-parity audit:

**#360 (Phase 7H):** haben ships `inv-20-no-unwrap.sh` and `inv-04-no-unsafe.sh` shell scripts that use awk to take a context-aware production slice of Rust source (everything before the first `#[cfg(test)]` line), skip `lib.rs`, filter comment lines, and HARD-fail on `.unwrap()`/`.expect(...)`/`unsafe`. arbiter's clippy-only gate caught the keyword but not the production-vs-test context — `unwrap()` inside `#[cfg(test)]` modules was incorrectly flagged.

**#356 (Phase 7D):** the existing `scripts/check-docs.mjs` used a strict-linear `origin/main..HEAD` range that mis-classifies rebased branches and offered no escape hatch for intentional non-doc commits.

## Decision

**#360 Rust checkers:** Two new templates `src/templates/scripts/checks/check-rust-no-unwrap.mjs.ejs` and `check-rust-no-unsafe.mjs.ejs` — Node.js (not awk) for cross-platform portability. Logic mirrors haben's awk pipeline: walk `src/**/*.rs`, skip `lib.rs`, slice production code before the first `#[cfg(test)]` line, strip comment-only lines, HARD-fail on `.unwrap()`/`.expect(`/bare `unsafe` (with `forbid|deny|allow(unsafe_code)` lint declarations excluded). Emission gated in `generateCheckAll` on `language === 'rust'`. Wired at L1 in `check-all.mjs.ejs` rust block.

**#356 docs-check refactor:** New template `src/templates/scripts/check-docs.mjs.ejs` plus refactor of live `scripts/check-docs.mjs` (CANON-01 dual-declination). Diff range now resolved via `git merge-base HEAD origin/main` with fallback to plain refs. Bypass: any commit message in the range containing `[skip-docs]` causes the gate to PASS. CI `docs-check` job in `ci.yml.ejs` updated identically.

CANON-16 surveys: #360 — grepped `src/templates/scripts/` for similar Rust-specific gates; none found. `src/templates/scripts/checks/` justified as new namespace. #356 — `scripts/check-docs.mjs` refactored in place; new template justified by CANON-01 dual-declination.

## Consequences

### Positive

- Rust target projects gain context-aware INV-04 enforcement (no false positives on test modules).
- arbiter's own docs gate (and the gate emitted to L2+ target projects) tolerates rebased branches and offers a documented `[skip-docs]` escape hatch.

### Negative

- Behavior shift for arbiter contributors: `scripts/check-docs.mjs` semantics change from `origin/main..HEAD` (linear) to `merge-base HEAD origin/main` (rebased-aware).

## Links

- Issues: #356, #360
