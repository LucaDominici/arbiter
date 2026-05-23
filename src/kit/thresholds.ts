// SPDX-License-Identifier: Apache-2.0

/**
 * Brownfield class: characterizes how mature a repository is.
 * Determines which column of the threshold matrix to apply for existing code.
 * New code always uses the `new_code` column (gold-grade), regardless of class.
 *
 * Classification heuristics (from brownfield-detect.ts):
 *   gold   → greenfield or already-mature repo (< 50 source files)
 *   light  → 50–500 source files, coverage > 30 %
 *   medium → 500–2 000 source files, coverage 5–30 %
 *   heavy  → 2 000+ source files, coverage < 5 %
 */
export type BrownfieldClass = 'gold' | 'light' | 'medium' | 'heavy'

/**
 * Subset of arbiter VALID_STACKS that have a full threshold matrix.
 * 'fe' from the canonical source is mapped to 'typescript'.
 * 'infra' (Terraform / Checkov) is Phase F scope — not included here.
 */
export type ThresholdStack = 'java' | 'typescript'

/** A single threshold value keyed by brownfield class (+ new_code override). */
export interface ThresholdRow<T = number> {
  /** Final target — applies to greenfield and fully-remediated repos. */
  gold: T
  /** Always gold-grade, regardless of brownfield class. */
  new_code: T
  light: T
  medium: T
  heavy: T
}

// ─── Java ────────────────────────────────────────────────────────────────────

export interface JavaJacocoThresholds {
  /** Line coverage (0–1). */
  line: ThresholdRow
  /** Branch coverage (0–1). */
  branch: ThresholdRow
  /** Exception-package line coverage (0–1). */
  exception_pkg: ThresholdRow
}

export interface JavaCheckstyleThresholds {
  CyclomaticComplexity: ThresholdRow
  MethodLength: ThresholdRow
  ParameterNumber: ThresholdRow
  ClassFanOutComplexity: ThresholdRow
  FileLength: ThresholdRow
}

export interface JavaPmdThresholds {
  CyclomaticComplexity_method: ThresholdRow
  CyclomaticComplexity_class: ThresholdRow
  CognitiveComplexity: ThresholdRow
  TooManyMethods: ThresholdRow
  TooManyFields: ThresholdRow
  ExcessiveImports: ThresholdRow
  /** Enabled/disabled per class (heavy brownfield may disable). */
  GodClass: ThresholdRow<boolean>
}

export interface JavaSpotbugsThresholds {
  /** Build fails on any SpotBugs finding (use baseline.txt for heavy brownfield). */
  failOnError: ThresholdRow<boolean>
  /** FindSecBugs plugin enabled. */
  FindSecBugs: ThresholdRow<boolean>
}

export interface JavaPitestThresholds {
  /** Mutation score threshold (0–100). */
  mutationThreshold: ThresholdRow
  /** Line-coverage threshold required for PITest to run (0–100). */
  coverageThreshold: ThresholdRow
}

export interface JavaOwaspThresholds {
  /** CVSS score at which OWASP dependency-check fails the build. Non-negotiable: always 7.0. */
  failBuildOnCVSS: ThresholdRow
}

export interface JavaThresholds {
  jacoco: JavaJacocoThresholds
  checkstyle: JavaCheckstyleThresholds
  pmd: JavaPmdThresholds
  spotbugs: JavaSpotbugsThresholds
  pitest: JavaPitestThresholds
  owasp: JavaOwaspThresholds
}

// ─── TypeScript / FE ─────────────────────────────────────────────────────────

export interface TypeScriptCoverageThresholds {
  lines: ThresholdRow
  branches: ThresholdRow
  functions: ThresholdRow
  statements: ThresholdRow
}

export interface TypeScriptEslintThresholds {
  max_warnings: ThresholdRow
}

export interface TypeScriptStrictThresholds {
  /** Whether to enable TypeScript strict mode. */
  strict: ThresholdRow<boolean>
}

export interface TypeScriptThresholds {
  coverage: TypeScriptCoverageThresholds
  eslint: TypeScriptEslintThresholds
  typescript: TypeScriptStrictThresholds
}

// ─── Root matrix ─────────────────────────────────────────────────────────────

export interface KitThresholds {
  java: JavaThresholds
  typescript: TypeScriptThresholds
}

// ─── Data ────────────────────────────────────────────────────────────────────

export const KIT_THRESHOLDS: KitThresholds = {
  java: {
    jacoco: {
      line: { gold: 0.8, new_code: 0.8, light: 0.6, medium: 0.4, heavy: 0.2 },
      branch: { gold: 0.7, new_code: 0.7, light: 0.5, medium: 0.3, heavy: 0.15 },
      exception_pkg: { gold: 0.9, new_code: 0.9, light: 0.9, medium: 0.7, heavy: 0.5 },
    },
    checkstyle: {
      CyclomaticComplexity: { gold: 15, new_code: 15, light: 18, medium: 20, heavy: 25 },
      MethodLength: { gold: 65, new_code: 65, light: 80, medium: 120, heavy: 170 },
      ParameterNumber: { gold: 10, new_code: 10, light: 10, medium: 12, heavy: 15 },
      ClassFanOutComplexity: { gold: 25, new_code: 25, light: 30, medium: 40, heavy: 70 },
      FileLength: { gold: 940, new_code: 940, light: 1000, medium: 1200, heavy: 2200 },
    },
    pmd: {
      CyclomaticComplexity_method: { gold: 15, new_code: 15, light: 18, medium: 20, heavy: 25 },
      CyclomaticComplexity_class: { gold: 80, new_code: 80, light: 100, medium: 200, heavy: 300 },
      CognitiveComplexity: { gold: 15, new_code: 15, light: 20, medium: 25, heavy: 40 },
      TooManyMethods: { gold: 20, new_code: 20, light: 25, medium: 40, heavy: 80 },
      TooManyFields: { gold: 20, new_code: 20, light: 22, medium: 25, heavy: 30 },
      ExcessiveImports: { gold: 35, new_code: 35, light: 40, medium: 50, heavy: 80 },
      GodClass: { gold: true, new_code: true, light: true, medium: true, heavy: false },
    },
    spotbugs: {
      failOnError: { gold: true, new_code: true, light: true, medium: true, heavy: true },
      FindSecBugs: { gold: true, new_code: true, light: true, medium: false, heavy: false },
    },
    pitest: {
      mutationThreshold: { gold: 80, new_code: 80, light: 70, medium: 60, heavy: 0 },
      coverageThreshold: { gold: 85, new_code: 85, light: 75, medium: 70, heavy: 0 },
    },
    owasp: {
      failBuildOnCVSS: { gold: 7.0, new_code: 7.0, light: 7.0, medium: 7.0, heavy: 7.0 },
    },
  },

  typescript: {
    coverage: {
      lines: { gold: 85, new_code: 85, light: 50, medium: 20, heavy: 5 },
      branches: { gold: 80, new_code: 80, light: 40, medium: 15, heavy: 0 },
      functions: { gold: 85, new_code: 85, light: 50, medium: 20, heavy: 5 },
      statements: { gold: 85, new_code: 85, light: 50, medium: 20, heavy: 5 },
    },
    eslint: {
      max_warnings: { gold: 0, new_code: 0, light: 10, medium: 50, heavy: 200 },
    },
    typescript: {
      strict: { gold: true, new_code: true, light: true, medium: false, heavy: false },
    },
  },
}

/**
 * Resolve a threshold value for a given brownfield class.
 * Always use `new_code` for newly written code, regardless of class.
 */
export function resolveThreshold<T>(row: ThresholdRow<T>, cls: BrownfieldClass): T {
  return row[cls]
}

/**
 * Map an arbiter language to the threshold stack key, if one exists.
 * Languages without a matrix entry are not kit-threshold-aware yet.
 */
export function languageToThresholdStack(language: string): ThresholdStack | null {
  if (language === 'java') return 'java'
  if (language === 'typescript') return 'typescript'
  return null
}
