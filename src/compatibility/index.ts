// SPDX-License-Identifier: Apache-2.0
// Public barrel for @arbiter/cli/compatibility (#598)
// Re-exports stable public types and probe functions — internal parsers are not exposed.
export { runProbes, validateMatrix } from './probe.js'
export type {
  MatrixEntry,
  LanguageMatrix,
  ProbeResult,
  ProbeStatus,
  VerifyReport,
} from './schema.js'
export {
  loadSkillsMatrix,
  validateSkillsMatrix,
  getSkillsMatrixEntries,
} from './skills-validator.js'
export type { SkillsMatrix } from './skills-validator.js'
