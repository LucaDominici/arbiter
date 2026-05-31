---
title: 'ADR-058: Context-economy rule + knowledge-map + track-aware post-commit (#720, #724)'
doc_version: '1.0.0'
status: active
last_review: '2026-05-31'
owner: ''
canonical_id: '058'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-058: Context-economy rule + knowledge-map + track-aware post-commit (#720, #724)

**Date:** 2026-05-16
**Status:** Accepted
**Reference:** Issues #720 (M-12), #724 (M-16); prior-art baseline ports FINDINGS.md#mech-M-12, #mech-M-16

**Context:** The prior-art baseline ships `rules/10-knowledge-map.md` (prose context-economy rule) and `hooks/post-commit-check.sh` (track-aware checklist). arbiter had scattered context-economy guidance but no explicit rule, no machine-readable routing map, and no track routing in `post-commit-check.mjs`. The issues require porting AND improving over the production baseline.

**Decision:**

- **`40-context-economy.md` rule** (static Markdown, no EJS): generated as `.claude/rules/40-context-economy.md` via `generateClaudeRules`. Defines minimum startup set (AGENTS.md + KNOWLEDGE_MAP.md + knowledge-map.json) and a track routing table (frontend/backend/docs). `skipIfExists: true` — user-customizable.
- **`knowledge-map.json`** (EJS): generated as `.claude/knowledge-map.json` from `claude/knowledge-map.json.ejs`. Injects `projectName` and `lanes` (detected at init time). Contains `tracks` object with signal paths + required/optional docs per track, plus `minimum_startup_set`. `skipIfExists: true`.
- **`pre-task-track-detect.mjs`** (EJS): generated as `.claude/hooks/pre-task-track-detect.mjs`. UserPromptSubmit hook — detects task track from `git diff --name-only HEAD` + prompt keywords; writes routing hint to stdout (non-blocking, always exits 0). Added to hooks-manifest.json as ADVISORY. `skipIfExists: true`.
- **`post-commit-check.mjs.ejs` extension** (#724): appended track-detection block after the existing INV-22 conventional commit check. Reads `git diff --name-only HEAD~1 HEAD`, classifies changed files into frontend/backend/docs tracks, and writes per-track checklist hints to stdout. Non-blocking. Graceful skip when HEAD~1 unavailable (first commit).
- **CANON-16 surveys**: `generateClaudeRules` — existing array-driven pattern extended with one new entry; no new file. `generateClaudeHooks` — existing hook-loop pattern extended inline. `knowledge-map.json` — grepped `src/templates/claude/` for similar machine-readable config; none found. New EJS template justified as distinct concern (track routing, not hook or settings).

**Consequences:** Target projects gain: (1) explicit context-economy rule in Claude rules; (2) machine-readable track routing consumable by hooks and agents; (3) UserPromptSubmit hint before every task that touches track-specific files; (4) post-commit per-track checklist guidance. `post-commit-check.mjs` content change is a template extension — existing installations with `skipIfExists: true` will not auto-update until arbiter re-init.

**Completion (#724, 2026-05-17):** Issue #724 finishes the stub-grade track-detection block. Changes: (1) `scripts/detect-track.mjs` — shared lib exporting `detectTracks(files)` and `TRACK_PATTERNS` as the canonical single source of truth; (2) 15 EJS partials at `src/templates/claude/hooks/post-commit-checklists/<stack>/<track>.ejs` — per-stack × per-track advisory text (TS/Java/Go/Python/Rust × frontend/backend/docs) baked into generated hooks at `arbiter init` time via EJS `include`; (3) `post-commit-check.mjs.ejs` updated — inline detection gains CRLF normalization, checklists replaced by stack-specific EJS partials; (4) `.claude/hooks/post-commit-check.mjs` (self-config) updated — inline detection replaced by dynamic `await import()` of `scripts/detect-track.mjs` wrapped in try-catch (RT-EH-001: static ESM import on a missing module crashes all commits). Architecture: 15 EJS files are render-time content partials (Option A), not independent hooks — eliminates the dispatcher-registration problem (RT-AR-001). See `docs/SYSTEM/POST_COMMIT_TRACKS.md` for taxonomy and extension guide.

## ADR-042: Rust context-aware INV-04 checkers + rebased-aware docs-check (#360, #356)

**Date:** 2026-05-14
**Status:** Accepted
**Reference:** Issues #356, #360 (from umbrella #344); CANON-01, CANON-02

**Context:** Two Phase 7 gaps from haben-parity audit. **#360 (Phase 7H):** haben ships `inv-20-no-unwrap.sh` and `inv-04-no-unsafe.sh` shell scripts that use awk to take a context-aware production slice of Rust source (everything before the first `#[cfg(test)]` line), skip `lib.rs` (re-export entrypoint), filter comment lines, and HARD-fail on `.unwrap()`/`.expect(...)`/`unsafe`. arbiter's clippy-only gate caught the keyword but not the production-vs-test context — `unwrap()` inside `#[cfg(test)]` modules was incorrectly flagged. **#356 (Phase 7D):** the existing `scripts/check-docs.mjs` used a strict-linear `origin/main..HEAD` range that mis-classifies rebased branches (sees main commits replayed underneath) and offered no escape hatch for intentional non-doc commits.

**Decision:**

- **#360 Rust checkers**: Two new templates `src/templates/scripts/checks/check-rust-no-unwrap.mjs.ejs` and `check-rust-no-unsafe.mjs.ejs` — Node.js (not awk) for cross-platform portability (Windows targets). Logic mirrors haben's awk pipeline: walk `src/**/*.rs`, skip `lib.rs`, slice production code before the first `#[cfg(test)]` line, strip comment-only lines, HARD-fail on `.unwrap()`/`.expect(`/bare `unsafe` (with `forbid|deny|allow(unsafe_code)` lint declarations excluded). Emission gated in `generateCheckAll` on `language === 'rust'`. Wired at L1 in `check-all.mjs.ejs` rust block.
- **#356 docs-check refactor**: New template `src/templates/scripts/check-docs.mjs.ejs` plus refactor of live `scripts/check-docs.mjs` (CANON-01 dual-declination). Diff range now resolved via `git merge-base HEAD origin/main` with fallback to plain refs. Bypass: any commit message in the range containing `[skip-docs]` causes the gate to PASS. CI `docs-check` job in `ci.yml.ejs` updated identically to use merge-base + honor `[skip-docs]`.
- **CANON-16 surveys**: #360 — grepped `src/templates/scripts/` for similar Rust-specific gates; none found. `src/templates/scripts/checks/` justified as a new namespace (language-specific gates, distinct from universal SSOT gates under `src/templates/scripts/`). #356 — `scripts/check-docs.mjs` exists at root; refactored in place to add merge-base + `[skip-docs]` rather than fork. No template existed under `src/templates/scripts/`; new file justified by CANON-01 dual-declination requirement (self-applied gate must also be templated for target projects).

**Consequences:** Rust target projects gain context-aware INV-04 enforcement that does not false-positive on test modules. arbiter's own docs gate (and the gate emitted to L2+ target projects) tolerates rebased branches and offers a documented `[skip-docs]` escape hatch for legitimate non-doc commits (typo fixes, dependency bumps). Behavior shift for arbiter contributors: the live `scripts/check-docs.mjs` semantics change from `origin/main..HEAD` (linear) to `merge-base HEAD origin/main` (rebased-aware); anyone relying on the old strict-linear behavior should rebase or use `[skip-docs]`.
