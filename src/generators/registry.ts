import { generateAgentsMd } from "./agents-md.js";
import { generateClaude } from "./claude.js";
import { generateCodex } from "./codex.js";
import { generateGithub } from "./github.js";
import { generateRoot } from "./root.js";
import { generateCheckAll } from "./check-all.js";
import { generateCursor } from "./cursor.js";
import { generateCopilot } from "./copilot.js";
import { generateCoverage } from "./coverage.js";
import { generateDebtGates } from "./debt-gates.js";
import { generateDebtRatchet } from "./debt-ratchet.js";
import { generateSuppressions } from "./suppressions.js";
import { generateSecurity } from "./security.js";
import { generateStrideEnforcement } from "./stride-enforcement.js";
import { generateEvidenceRetention } from "./evidence-retention.js";
import { generateTestTaxonomy } from "./test-taxonomy.js";
import { generateArchUnit } from "./archunit.js";
import { generateEslintBoundaries } from "./boundaries.js";
import { generateRustBoundaries } from "./rust-boundaries.js";
import { generateGoBoundaries } from "./go-boundaries.js";
import { generatePythonBoundaries } from "./python-boundaries.js";
import { generateMutation } from "./mutation.js";
import { generateNightly } from "./nightly.js";
import { generateIntegrationTesting } from "./integration-testing.js";
import { generateContractTesting } from "./contract-testing.js";
import { generateGlobalInvariants } from "./global-invariants.js";
import { generateSkills } from "./skills.js";
import { generateAgentsClaude } from "./agents-claude.js";
import { generateSsot } from "./ssot.js";
import { generateObsidianVault } from "./obsidian-vault.js";
import { generateBehavioralTests } from "./behavioral-tests.js";
import { generateGithooks } from "./githooks.js";
import type { ProjectConfig } from "../wizard/types.js";
import type { WriteResult } from "../utils/fs.js";
import type { GeneratorKey } from "../config/diff.js";

export interface GeneratorSpec {
  key: GeneratorKey;
  enabled: boolean;
  run: () => WriteResult[];
}

function buildAiToolSpecs(config: ProjectConfig): GeneratorSpec[] {
  const noAiRulez = !config.existing.aiRulez;
  return [
    { key: "agents-md", enabled: true, run: () => [generateAgentsMd(config)] },
    {
      key: "global-invariants",
      enabled: true,
      run: () => [generateGlobalInvariants(config)],
    },
    {
      key: "claude",
      enabled: noAiRulez && config.tools.includes("claude"),
      run: () => generateClaude(config).files,
    },
    {
      key: "codex",
      enabled: noAiRulez && config.tools.includes("codex"),
      run: () => generateCodex(config).files,
    },
    {
      key: "cursor",
      enabled: noAiRulez && config.tools.includes("cursor"),
      run: () => generateCursor(config).files,
    },
    {
      key: "copilot",
      enabled: noAiRulez && config.tools.includes("copilot"),
      run: () => generateCopilot(config).files,
    },
    {
      key: "skills",
      enabled: noAiRulez,
      run: () => generateSkills(config).files,
    },
    {
      key: "agents-claude",
      enabled: noAiRulez,
      run: () => generateAgentsClaude(config).files,
    },
  ];
}

function buildInfraSpecs(config: ProjectConfig): GeneratorSpec[] {
  return [
    {
      key: "github",
      enabled: config.useGitHub,
      run: () => generateGithub(config).files,
    },
    {
      key: "root",
      enabled: config.useGitHub,
      run: () => generateRoot(config).files,
    },
    {
      key: "check-all",
      enabled: true,
      run: () => generateCheckAll(config).files,
    },
    {
      key: "debt-gates",
      enabled: config.enableDebtGates,
      run: () => generateDebtGates(config).files,
    },
    {
      key: "debt-ratchet",
      enabled: config.enableDebtGates,
      run: () => generateDebtRatchet(config).files,
    },
    {
      key: "coverage",
      enabled: config.enableDebtGates,
      run: () => generateCoverage(config).files,
    },
    {
      key: "suppressions",
      enabled: config.enableSuppressions,
      run: () => generateSuppressions(config).files,
    },
    {
      key: "security",
      enabled: config.enableSecurityScanning,
      run: () => generateSecurity(config).files,
    },
    {
      key: "stride-enforcement",
      enabled: config.enableDebtGates,
      run: () => generateStrideEnforcement(config).files,
    },
    {
      key: "githooks",
      enabled: true,
      run: () => generateGithooks(config).files,
    },
  ];
}

function buildAnalysisSpecs(config: ProjectConfig): GeneratorSpec[] {
  return [
    {
      key: "archunit",
      enabled: true,
      run: () => generateArchUnit(config).files,
    },
    {
      key: "eslint-boundaries",
      enabled: true,
      run: () => generateEslintBoundaries(config).files,
    },
    {
      key: "rust-boundaries",
      enabled: true,
      run: () => generateRustBoundaries(config).files,
    },
    {
      key: "go-boundaries",
      enabled: true,
      run: () => generateGoBoundaries(config).files,
    },
    {
      key: "python-boundaries",
      enabled: true,
      run: () => generatePythonBoundaries(config).files,
    },
    {
      key: "mutation",
      enabled: config.enableMutationTesting !== false,
      run: () => generateMutation(config).files,
    },
    { key: "nightly", enabled: true, run: () => generateNightly(config).files },
    {
      key: "integration-testing",
      enabled: config.enableContractTesting !== false,
      run: () => generateIntegrationTesting(config).files,
    },
    {
      key: "contract-testing",
      enabled: config.enableContractTesting !== false,
      run: () => generateContractTesting(config).files,
    },
    {
      key: "evidence-retention",
      enabled: config.enableEvidenceHarness !== false,
      run: () => generateEvidenceRetention(config).files,
    },
    {
      key: "test-taxonomy",
      enabled: true,
      run: () => generateTestTaxonomy(config).files,
    },
    {
      key: "behavioral-tests",
      enabled: true,
      run: () => generateBehavioralTests(config).files,
    },
    { key: "ssot", enabled: true, run: () => generateSsot(config).files },
    {
      key: "obsidian-vault",
      enabled: config.enableObsidianVault === true,
      run: () => generateObsidianVault(config).files,
    },
  ];
}

export function buildRegistry(config: ProjectConfig): GeneratorSpec[] {
  return [
    ...buildAiToolSpecs(config),
    ...buildInfraSpecs(config),
    ...buildAnalysisSpecs(config),
  ];
}

export function runGeneratorsFromRegistry(
  specs: GeneratorSpec[],
): WriteResult[] {
  return specs.filter((s) => s.enabled).flatMap((s) => s.run());
}

export function runGeneratorsSelective(
  specs: GeneratorSpec[],
  keys: Set<GeneratorKey | "*">,
): WriteResult[] {
  if (keys.has("*")) {
    return runGeneratorsFromRegistry(specs);
  }
  return specs
    .filter((s) => s.enabled && keys.has(s.key))
    .flatMap((s) => s.run());
}
