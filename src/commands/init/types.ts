// SPDX-License-Identifier: Apache-2.0
//
// #1839 (F3 friction cut): `InitOptions` extracted to its own module so both
// `init.ts` (the orchestrator) and `init/resolve-config.ts` can import it without
// creating a circular dependency between the two (madge flags type-only cycles too).
import type {
  ProjectPreset,
  AuthProvider,
  ObservabilityProvider,
  DeployTarget,
  Language,
  Archetype,
} from '../../wizard/types.js'

export interface InitOptions {
  yes: boolean
  tools: string | undefined
  level: string | undefined
  dir: string | undefined
  dryRun: boolean
  /** Auto-capture debt baseline after generation (brownfield day-0 lock-in). */
  brownfield: boolean
  /** Skip toolchain compatibility probes before generation. */
  noVerify: boolean
  /** Allow L3 generation with beta-maturity tools. Persisted in arbiter.json for audit. */
  acceptBetaTools?: boolean
  /** Activate live GitHub API calls and set permitGitHub:true in stored config. */
  github?: boolean
  /** Override decomposition backend (github|markdown). If absent, derived from --github flag. */
  backend?: 'github' | 'markdown'
  /** Emit machine-readable JSON envelope instead of human output. Requires --yes (wizard is incompatible). */
  json?: boolean | undefined
  /** Suppress informational banners such as the telemetry notice. */
  quiet?: boolean
  /** Override adverse git state check (detached HEAD, rebase, merge, etc.). Emits warning then continues. */
  force?: boolean
  /** Apply a meta-preset (industrial-grade | solo-homelab) after config is resolved. Default: 'none'. */
  preset?: ProjectPreset
  /** Override auth provider after preset is applied. */
  authProvider?: AuthProvider
  /** Override observability provider after preset is applied. */
  observabilityProvider?: ObservabilityProvider
  /**
   * #1677: non-interactive deploy target (--deploy-target). Mirrors the interactive
   * wizard's deployTarget question; spread into the non-interactive config so a CI
   * `arbiter init --yes --deploy-target gcp-cloud-run` persists the same axis.
   */
  deployTarget?: DeployTarget
  /** Override detected language (skips auto-detection). */
  language?: Language
  /** Override detected archetype (skips auto-detection). */
  archetype?: Archetype
  /** Path or https:// URL to a recipe JSON file for pre-configuring init options. */
  recipe?: string
  /** Expected SHA-256 hex digest of the recipe file for integrity verification. */
  recipeSha256?: string
  /**
   * ADR-051 (#1119): shorthand for collaborationMode='trunk-solo'.
   * Equivalent to the `--solo` CLI flag; overrides wizard collaborationMode question.
   */
  solo?: boolean
  /**
   * #1447 (ADR-098): progressive-adoption tier. `bootstrap` is the gentlest Day-1
   * entry — governance L1 + brownfield baseline lock-in; `L1`–`L4` are governance-level
   * aliases. Takes precedence over `--level` (desugars into level + brownfield).
   */
  tier?: string
}
