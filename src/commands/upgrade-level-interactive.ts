// SPDX-License-Identifier: Apache-2.0
// #1168 Phase 3: `arbiter upgrade-level --interactive` — pick a target governance
// level and confirm before applying. Delegates to runUpgradeLevel so the actual
// upgrade behaviour (grace period, diff, write) is unchanged.

import { intro, outro, select, confirm, isCancel, cancel } from '@clack/prompts'
import { runUpgradeLevel } from './upgrade-level.js'
import type { GovernanceLevel } from '../wizard/types.js'

export interface InteractiveUpgradeOptions {
  dir?: string
}

const LEVELS: { value: GovernanceLevel; label: string }[] = [
  { value: 'L2', label: 'L2 — standard governance (tests, gates, coverage)' },
]

/**
 * Guided level upgrade: choose a target level, confirm, then delegate to
 * runUpgradeLevel. Requires a TTY (caller guards).
 */
export async function runInteractiveUpgradeLevel(
  opts: InteractiveUpgradeOptions = {},
): Promise<void> {
  const dir = opts.dir
  intro('arbiter upgrade-level')

  const target = await select({ message: 'Upgrade to which governance level?', options: LEVELS })
  if (isCancel(target)) {
    cancel('Cancelled.')
    return
  }

  const proceed = await confirm({ message: `Apply upgrade to ${target}?` })
  if (isCancel(proceed) || !proceed) {
    cancel('Cancelled.')
    return
  }

  outro(`Upgrading to ${target}…`)
  await runUpgradeLevel({
    ...(dir !== undefined ? { dir } : {}),
    target,
    extend: false,
    json: false,
  })
}
