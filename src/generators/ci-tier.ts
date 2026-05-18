// SPDX-License-Identifier: Apache-2.0
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface CiTierGeneratorResult {
  files: WriteResult[]
}

// Orchestrator for 6-tier CI workflows (T1–T6).
// Tasks 4–12 add workflow templates here; each emitted as a numbered .github/workflows file.
export function generateCiTier(config: ProjectConfig): CiTierGeneratorResult {
  void config
  return { files: [] }
}
