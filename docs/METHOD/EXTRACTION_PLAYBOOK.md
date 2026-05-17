# Framework Extraction Playbook

**Method:** PHOENIX — Progressive Harvest of Existing Infrastructure into an eXternal Nucleus
**Version:** 1.0
**Scope:** Extracting a reusable governance / tooling framework out of an existing monolith

> **This document describes a methodology, not a runtime.** Nothing here executes
> against your codebase automatically. Every step requires deliberate human action.

---

## When to Use This Playbook

Extract a framework from a monolith when:

- The same governance patterns (hooks, gates, templates, invariants) are copy-pasted across ≥3 projects.
- A dedicated framework project would save ≥20% of per-project setup time.
- The patterns are architecturally stable — no major refactor planned in 6 months.

Do **not** extract prematurely. Wait for the third use; the first instance is a one-off,
the second is coincidence, the third establishes the pattern worth extracting.

---

## Phase 1 — Gradual Port (Weeks 1–4)

**Goal:** move behaviour from monolith to candidate framework without breaking the monolith.

### 1.1 Identify the extraction boundary

- List every file, function, and type that belongs to the candidate framework.
- Draw a dependency graph. Mark all imports that cross the extraction boundary.
- Categorise each cross-boundary dependency as:
  - **Pull in** — belongs in framework, bring it along
  - **Stub out** — framework should not own it; replace with a caller-supplied interface
  - **Leave behind** — monolith-specific; do not port

### 1.2 Create the framework repository

```bash
git init <framework-name>
cd <framework-name>
# Initialise with your governance tool (e.g. arbiter init)
```

### 1.3 Copy, do not move

Copy files to the framework repository. Keep originals in the monolith.
The monolith is the reference implementation throughout Phase 1 and Phase 2.
Do **not** delete monolith originals until Phase 5.

### 1.4 Decouple monolith-specific references

Replace all hardcoded monolith paths, package names, and domain constants with:

- Constructor or config parameters (dependency injection)
- Environment variables
- Template EJS variables (for file-generation frameworks)

Track each decoupling decision in the framework's ADR directory.

### 1.5 Publish the framework as a local package

```bash
# npm example
npm link                          # in framework repo
npm link <framework-name>         # in monolith repo
```

For other ecosystems: Maven local install, Go replace directive, pip editable install.

---

## Phase 2 — Shadow Execution (Weeks 3–8, overlaps Phase 1)

**Goal:** run framework and monolith implementations side-by-side; compare outputs.

### 2.1 Instrument the monolith

Add a shadow flag:

```typescript
const SHADOW_FRAMEWORK = process.env.SHADOW_FRAMEWORK === 'true'
```

When the flag is on, run both the monolith implementation and the framework implementation
for each operation. Log any diff between their outputs.

### 2.2 Define equivalence criteria

For each operation, write down what "equivalent output" means.
Examples:

- File generators: rendered output is byte-for-byte identical (or identical after normalisation of timestamps).
- Gate scripts: both exit with the same code for the same input.
- Type inference: types resolved to the same canonical form.

### 2.3 Run shadow in CI

Add a shadow CI job:

```yaml
# .github/workflows/shadow.yml
env:
  SHADOW_FRAMEWORK: 'true'
```

Gate on zero shadow diffs before advancing to Phase 3.

### 2.4 Fix divergences

Every shadow diff is a bug. Fix in the framework; never "fix" by weakening the
equivalence criteria. Document the root cause in the framework's CHANGELOG.

---

## Phase 3 — Empirical Type Inference (Weeks 6–10)

**Goal:** harden the framework's public API surface with types inferred from real usage.

### 3.1 Collect all call sites

```bash
grep -r "import.*<framework-name>" --include="*.ts" -l
```

List every place the monolith (and any other consumer) calls the framework.

### 3.2 Infer the minimal public API

For each exported symbol, determine:

- Which parameters are actually passed (eliminate overloads never used)
- Which return fields are actually consumed (eliminate unused response fields)
- Which error cases are actually handled (surface only real error types)

Write the inferred types as explicit TypeScript interfaces / Go interfaces / Java interfaces.
Do **not** carry forward phantom overloads inherited from the monolith.

### 3.3 Break the framework API intentionally

At this point, narrow the public API to the inferred minimum. Add a major-version bump.
All consumers (currently just the monolith) must adapt. This is the consolidation moment.

---

## Phase 4 — Behavioural Equivalence Verification (Weeks 8–12)

**Goal:** prove the framework produces identical observable behaviour to the extracted monolith code,
under the full test suite.

### 4.1 Port the test suite

Move tests that cover extracted behaviour from the monolith test suite to the framework test suite.
Tests that depend on monolith internals stay in the monolith.

### 4.2 Run framework tests against monolith fixtures

Use the monolith's test fixtures (real data, integration seeds) to drive framework tests.
The framework must produce output that passes the monolith's acceptance tests.

### 4.3 Coverage gate

Do not advance until:

- Framework unit test coverage ≥ 80% (or project's L2 threshold)
- All ported monolith tests pass against framework
- Shadow diff CI job reports zero divergences across the last 7 days

### 4.4 Document known exceptions

Some behaviour intentionally differs (e.g. the framework fixes a bug the monolith had).
Document each intentional divergence in the framework CHANGELOG and link to the corresponding
acceptance in the monolith. These are the observable improvements the extraction delivers.

---

## Phase 5 — Repository Split and Dependency Cutover (Week 12+)

**Goal:** remove the monolith originals and point all consumers to the framework package.

### 5.1 Publish the framework to your package registry

```bash
# npm
npm publish --access public        # or --access restricted for private

# Maven
mvn deploy

# PyPI
python -m build && twine upload dist/*
```

### 5.2 Cut over the monolith

Replace local `npm link` / `go replace` with the published version.

```bash
npm install <framework-name>@<version>
```

Run the monolith's full test suite. Fix any breakage before continuing.

### 5.3 Delete the originals from the monolith

```bash
git rm src/old-framework-code/**
git commit -m "chore: remove extracted framework code (now consumed from <framework-name>@<version>)"
```

### 5.4 Freeze shadow execution

Remove the `SHADOW_FRAMEWORK` flag and shadow CI job. The framework is now the only implementation.

### 5.5 Cutover announcement

Notify all current and prospective consumers via your standard channels.
Publish a migration guide covering: import path changes, API surface differences, and
steps to adopt the framework in a new project using your onboarding tooling.

---

## Anti-Patterns to Avoid

| Anti-pattern                                        | Why it fails                                               |
| --------------------------------------------------- | ---------------------------------------------------------- |
| Big-bang rewrite                                    | No shadow period; regressions are discovered in production |
| Extract before the third use                        | Premature abstraction; framework has one real consumer     |
| Port business entities with the framework           | Couples framework to domain; violates reusability          |
| Weaken equivalence criteria to silence shadow diffs | Hides regressions; leads to silent behavioural divergence  |
| Skip the API narrowing step (Phase 3)               | Framework carries dead surface area forever                |
| Publish v1.0 before Phase 4 completes               | Consumers adopt a framework with unproven equivalence      |

---

## Checklist

Copy this checklist into your extraction project's GitHub issue or PR description.

- [ ] Phase 1: Boundary identified, monolith originals intact
- [ ] Phase 1: Framework repository initialised and locally linked
- [ ] Phase 2: Shadow execution wired in CI, zero diffs reported for 7 days
- [ ] Phase 3: Public API narrowed to inferred minimum, major version bumped
- [ ] Phase 4: Ported test suite green, coverage ≥ 80%, equivalence proven
- [ ] Phase 5: Framework published to package registry
- [ ] Phase 5: Monolith originals deleted, full test suite passes
- [ ] Phase 5: Migration guide published, consumers notified

---

## Reference Implementations

**arbiter extracted from viafera (2025–2026):** The arbiter governance framework was extracted
from the viafera logistics platform's internal tooling. The extraction followed the five phases
above over approximately 14 months. Key findings: the IDP hard-delete GDPR gap (now captured
in the GDPR erasure runbook) was discovered during Phase 4 equivalence verification when
the extracted test suite revealed that the monolith's erasure tests only asserted soft-disable,
not hard-delete, of identity-provider accounts.
