// SPDX-License-Identifier: Apache-2.0
import type { Archetype } from '../wizard/types.js'

export interface TestLevel {
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
        name: 'L1 Unit',
        description: 'Fast, isolated unit tests for business logic and domain models',
        tools: 'JUnit/pytest/vitest/cargo test',
      },
      {
        name: 'L2 Integration',
        description: 'Service + DB integration using Testcontainers or Docker Compose',
        tools: 'Testcontainers, RestAssured, TestClient',
      },
      {
        name: 'L3 Contract',
        description: 'Consumer-driven contract tests to verify API compatibility',
        tools: 'Pact, Spring Cloud Contract',
      },
      {
        name: 'L4 E2E',
        description: 'End-to-end browser / API flows against a running environment',
        tools: 'Playwright, Cypress, Postman',
      },
      {
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
        name: 'L1 Unit',
        description: 'Unit tests for individual commands, parsers, and handlers',
        tools: 'JUnit/pytest/vitest/cargo test',
      },
      {
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
        name: 'L1 Unit',
        description: 'Unit tests for all public API surface — every exported function/class',
        tools: 'JUnit/pytest/vitest/cargo test',
      },
      {
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
        name: 'L1 Unit',
        description: 'Unit tests for transforms, parsers, and aggregation logic',
        tools: 'pytest/vitest/cargo test',
      },
      {
        name: 'L2 Integration',
        description: 'Pipeline integration with real or containerised data stores',
        tools: 'Testcontainers, pytest-docker',
      },
      {
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
        name: 'L1 Unit',
        description: 'Unit tests for utilities, hooks, and pure functions',
        tools: 'vitest, jest',
      },
      {
        name: 'L2 Component',
        description: 'Component-level rendering and interaction tests',
        tools: 'Testing Library, Storybook, Enzyme',
      },
      {
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
        name: 'L1 Unit',
        description: 'Host-side unit tests for logic, state machines, and protocols',
        tools: 'Unity, cargo test, pytest',
      },
      {
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
 */
export function getTestPyramidProfile(archetype: Archetype): TestPyramidProfile {
  return PROFILES[archetype]
}
