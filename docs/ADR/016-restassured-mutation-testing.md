---
title: 'ADR-016: RestAssured + Mutation Testing — 3-Layer Java Enforcement'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# ADR-016: RestAssured + Mutation Testing — 3-Layer Java Enforcement

**Status:** Superseded by ADR-029
**Date:** 2026-04-08
**Deciders:** Luca Dominici
**Issue:** #61

## Context

MockMvc tests the controller layer through a mock servlet container, bypassing real HTTP serialization, filter chains, exception handlers, and content negotiation. Bugs that live in those layers pass MockMvc tests and break in production. RestAssured (or WebTestClient for reactive stacks) tests the full HTTP stack with a real embedded server.

Code coverage measures which lines execute but not whether tests actually verify behavior. A test suite can achieve 90% coverage with assertions that check nothing meaningful. Mutation testing (PIT/pitest) injects small faults (mutants) into production code and verifies that tests fail — proving tests have genuine fault-detection power. A survived mutant is a test gap.

This decision originates from the prior-art baseline (2026-04-08), where the team decided to migrate from MockMvc to RestAssured and enforce mutation testing. However, the prior-art baseline enforcement is incomplete: pitest is configured locally but not in CI, and RestAssured adoption is still a plan. Arbiter, as the governance framework, must generate **stricter** enforcement than what the prior-art baseline itself currently has.

## Decision

Add two new invariants to arbiter's catalog, each with **3-layer enforcement**:

### INV-29: No MockMvc (architectural, always-active, Java-only)

1. **Edit-time:** `check-no-mockmvc.mjs` language hook blocks `MockMvc`, `AutoConfigureMockMvc`, `MockMvcBuilders`, `MockMvcRequestBuilders`, `MockMvcResultMatchers` on file save
2. **Build-time:** Generated `NoMockMvcTest.java` ArchUnit test fails the build if any class depends on `org.springframework.test.web.servlet.MockMvc` or uses `@AutoConfigureMockMvc`
3. **Policy:** AGENTS.md coding standards and testing policy document RestAssured as mandatory

### INV-30: Mutation testing required (operational, L2+, Java-only)

1. **CI gate:** `pitest` step in `check-all.mjs` L2 block (Maven: `org.pitest:pitest-maven:mutationCoverage`, Gradle: `./gradlew pitest`)
2. **Config:** Generated `pitest-setup.md` with ready-to-paste Maven plugin XML and Gradle DSL (80% mutation threshold, 85% coverage threshold, domain + application layers only)
3. **Policy:** AGENTS.md tech debt gates table documents PIT thresholds

### New capability: ArchUnit test generation

This ADR introduces a new generator (`src/generators/archunit.ts`) that produces ArchUnit test Java classes in target projects. This requires detecting the base Java package from pom.xml/build.gradle. `NoMockMvcTest.java` is the first generated ArchUnit test; the pattern is extensible for future architectural enforcement rules.

## Rationale

**Why 3 layers, not just hooks?**
Hooks only fire when an AI agent edits files. Human developers bypass them entirely. ArchUnit tests fail the build regardless of who wrote the code. The CI gate blocks merges. All three layers must be present for real enforcement.

**Why architectural tier for INV-29?**
MockMvc vs RestAssured is a test architecture decision, not a style preference. It determines whether integration tests exercise the real HTTP stack or a simulation. This is the same tier as circular dependency prevention (INV-01) and API surface control (INV-02).

**Why operational tier for INV-30 (not governance)?**
Governance tier invariants are `alwaysActive` in arbiter's catalog. Mutation testing has significant build time cost and requires pitest plugin setup, so it should be opt-in via preset selection (`standard` or `full`) at L2+. Operational tier provides exactly this behavior.

**Why stricter than the prior-art baseline?**
Arbiter generates governance for other projects. If arbiter's generated enforcement is weaker than hand-written enforcement in the prior-art baseline, there is no reason to use arbiter. The generated output must be at least as strict, and ideally stricter (since it enforces from project inception, not retrofitted).

## Alternatives Considered

1. **Hook-only enforcement (no ArchUnit):** Rejected. Hooks only fire for AI-assisted edits. Human developers can add MockMvc freely. Build-time enforcement is non-negotiable.
2. **Mutation testing at L3 only:** Rejected. L3 is audit-grade, used by few projects. Mutation testing is fundamental quality assurance that belongs at L2 (standard).
3. **Generate pitest plugin config directly into pom.xml/build.gradle:** Rejected. Arbiter cannot safely modify build files. A ready-to-paste snippet in `config/pitest-setup.md` is the right approach.

## Consequences

**Positive:**

- Java projects using arbiter get real HTTP integration testing from day one
- Mutation testing catches test gaps that coverage metrics miss
- 3-layer enforcement means no bypass path (AI, human, or CI)
- ArchUnit generation establishes a pattern for future architectural rules

**Negative:**

- Pitest adds significant build time to L2 gate (mitigated by targeting only domain + application layers)
- Existing projects with MockMvc tests will fail ArchUnit checks after `arbiter init` (migration guide needed in AGENTS.md)
- Base package detection adds complexity to Java project setup
