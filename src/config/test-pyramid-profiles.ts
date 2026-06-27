// SPDX-License-Identifier: Apache-2.0
import type { Archetype } from '../wizard/types.js'

interface TestLevel {
  /** Machine-readable level ID, e.g. "L1", "L2", "L3" */
  id: string
  /** Short label, e.g. "L1 Unit" */
  name: string
  /** One-sentence description of what this level covers */
  description: string
  /** Comma-separated tool names or framework examples */
  tools: string
}

export interface TestPyramidProfile {
  archetype: Archetype
  /** Unit / function tests — always true */
  hasUnitTests: boolean
  /** Container-backed integration tests (Testcontainers, Docker Compose, etc.) */
  hasContainerIntegration: boolean
  /** Property-based / fuzz / generative tests */
  hasPropertyTests: boolean
  /** Browser-level end-to-end tests (Playwright, Cypress) */
  hasE2ETests: boolean
  /** Performance / load / stress tests */
  hasPerformanceTests: boolean
  /** Consumer-driven contract tests (Pact, etc.) */
  hasContractTests: boolean
  /** Ordered test levels for TEST_TAXONOMY.md */
  levels: TestLevel[]
}

const PROFILES: Record<Archetype, TestPyramidProfile> = {
  'backend-web-db': {
    archetype: 'backend-web-db',
    hasUnitTests: true,
    hasContainerIntegration: true,
    hasPropertyTests: false,
    hasE2ETests: true,
    hasPerformanceTests: true,
    hasContractTests: true,
    levels: [
      {
        id: 'L1',
        name: 'L1 Unit',
        description: 'Fast, isolated unit tests for business logic and domain models',
        tools: 'JUnit/pytest/vitest/cargo test',
      },
      {
        id: 'L2',
        name: 'L2 Integration',
        description: 'Service + DB integration using Testcontainers or Docker Compose',
        tools: 'Testcontainers, RestAssured, TestClient',
      },
      {
        id: 'L3',
        name: 'L3 Contract',
        description: 'Consumer-driven contract tests to verify API compatibility',
        tools: 'Pact, Spring Cloud Contract',
      },
      {
        id: 'L4',
        name: 'L4 E2E',
        description: 'End-to-end browser / API flows against a running environment',
        tools: 'Playwright, Cypress, Postman',
      },
      {
        id: 'L5',
        name: 'L5 Performance',
        description: 'Load and stress tests verifying SLAs under production-like load',
        tools: 'k6, Gatling, Locust',
      },
    ],
  },

  cli: {
    archetype: 'cli',
    hasUnitTests: true,
    hasContainerIntegration: false,
    hasPropertyTests: false,
    hasE2ETests: false,
    hasPerformanceTests: false,
    hasContractTests: false,
    levels: [
      {
        id: 'L1',
        name: 'L1 Unit',
        description: 'Unit tests for individual commands, parsers, and handlers',
        tools: 'JUnit/pytest/vitest/cargo test',
      },
      {
        id: 'L2',
        name: 'L2 CLI Integration',
        description: 'Integration tests invoking the CLI binary with real arguments',
        tools: 'bats, pytest subprocess, assert_cmd',
      },
    ],
  },

  library: {
    archetype: 'library',
    hasUnitTests: true,
    hasContainerIntegration: false,
    hasPropertyTests: true,
    hasE2ETests: false,
    hasPerformanceTests: false,
    hasContractTests: false,
    levels: [
      {
        id: 'L1',
        name: 'L1 Unit',
        description: 'Unit tests for all public API surface — every exported function/class',
        tools: 'JUnit/pytest/vitest/cargo test',
      },
      {
        id: 'L2',
        name: 'L2 Property-Based',
        description: 'Generative / property-based tests to find edge cases',
        tools: 'fast-check, Hypothesis, proptest, QuickCheck',
      },
    ],
  },

  'data-pipeline': {
    archetype: 'data-pipeline',
    hasUnitTests: true,
    hasContainerIntegration: true,
    hasPropertyTests: false,
    hasE2ETests: false,
    hasPerformanceTests: false,
    hasContractTests: true,
    levels: [
      {
        id: 'L1',
        name: 'L1 Unit',
        description: 'Unit tests for transforms, parsers, and aggregation logic',
        tools: 'pytest/vitest/cargo test',
      },
      {
        id: 'L2',
        name: 'L2 Integration',
        description: 'Pipeline integration with real or containerised data stores',
        tools: 'Testcontainers, pytest-docker',
      },
      {
        id: 'L3',
        name: 'L3 Contract',
        description: 'Schema / data contract tests ensuring upstream/downstream compatibility',
        tools: 'Great Expectations, Pact, soda-core',
      },
    ],
  },

  'frontend-spa': {
    archetype: 'frontend-spa',
    hasUnitTests: true,
    hasContainerIntegration: false,
    hasPropertyTests: false,
    hasE2ETests: true,
    hasPerformanceTests: false,
    hasContractTests: false,
    levels: [
      {
        id: 'L1',
        name: 'L1 Unit',
        description: 'Unit tests for utilities, hooks, and pure functions',
        tools: 'vitest, jest',
      },
      {
        id: 'L2',
        name: 'L2 Component',
        description: 'Component-level rendering and interaction tests',
        tools: 'Testing Library, Storybook, Enzyme',
      },
      {
        id: 'L3',
        name: 'L3 E2E',
        description: 'Full browser flows against a running or mocked backend',
        tools: 'Playwright, Cypress',
      },
    ],
  },

  embedded: {
    archetype: 'embedded',
    hasUnitTests: true,
    hasContainerIntegration: false,
    hasPropertyTests: false,
    hasE2ETests: false,
    hasPerformanceTests: false,
    hasContractTests: false,
    levels: [
      {
        id: 'L1',
        name: 'L1 Unit',
        description: 'Host-side unit tests for logic, state machines, and protocols',
        tools: 'Unity, cargo test, pytest',
      },
      {
        id: 'L2',
        name: 'L2 Hardware Integration',
        description: 'Tests against simulator, emulator, or real hardware in CI',
        tools: 'QEMU, Renode, JTAG-based harness',
      },
    ],
  },
}

/**
 * Return the test pyramid profile for the given archetype.
 * Profiles are statically defined — no I/O.
 *
 * #1671: fail loudly on an unknown archetype instead of returning `undefined`.
 * An un-validated caller (e.g. a blind-cast CLI flag) previously got `undefined`
 * here and then dereferenced `.levels` for an opaque
 * `Cannot read properties of undefined (reading 'levels')`. A typed error names
 * the offending value at the source.
 */
export function getTestPyramidProfile(archetype: Archetype): TestPyramidProfile {
  // Look up through a widened index type: the `Record<Archetype, …>` declaration
  // claims the access is always defined, but an un-validated caller can pass a
  // value outside the union (blind cast), so the runtime guard is real.
  const profile = (PROFILES as Record<string, TestPyramidProfile | undefined>)[archetype]
  if (profile === undefined) {
    throw new Error(`unknown archetype "${archetype}" — no test pyramid profile defined for it`)
  }
  return profile
}
