// SPDX-License-Identifier: Apache-2.0
/**
 * Task-tier label specs for GitHub-backed projects (#237).
 *
 * Used by `src/github/labels.ts::provisionLabels` to install
 * `size:XS|S|Standard` labels on the project repo. The actual `gh label`
 * invocations live in the github layer, not here.
 */

export interface LabelSpec {
  name: string
  description: string
  /** Hex color without leading "#". */
  color: string
}

export const TASK_SIZE_LABELS: readonly LabelSpec[] = [
  {
    name: 'size:XS',
    description: 'Tiny task — single file, minimal plan, 1 review agent',
    color: 'c2e0c6',
  },
  {
    name: 'size:S',
    description: 'Small task — 2–5 files, brief plan, 1 review agent',
    color: 'fef2c0',
  },
  {
    name: 'size:Standard',
    description: 'Standard task — multi-file, full plan, 2 review agents',
    color: 'fbca04',
  },
] as const
