// SPDX-License-Identifier: Apache-2.0
import type { ReleaseChannel } from './channel.js'
import { needsDowngradeWarn } from './channel.js'

/**
 * Prompts the user to confirm a channel downgrade when `--channel` flag
 * requests a less-stable channel than the explicit config value.
 *
 * Behavior:
 *  - No flag, or no explicit config channel → returns without prompt.
 *  - Non-TTY → exits 1 (with diagnostic). Set ARBITER_ALLOW_CHANNEL_DOWNGRADE=1 to bypass.
 *  - TTY + user declines → exits 1.
 *  - TTY + user confirms → returns normally.
 */
export async function confirmChannelDowngrade(
  flagChannel: ReleaseChannel | undefined,
  configChannel: ReleaseChannel | undefined,
): Promise<void> {
  if (!needsDowngradeWarn({ flag: flagChannel, configChannel })) return

  const isTTY = process.stdin.isTTY
  const allowEnv = process.env['ARBITER_ALLOW_CHANNEL_DOWNGRADE'] === '1'

  if (allowEnv) return

  if (!isTTY) {
    process.stderr.write(
      `[arbiter] error: --channel ${flagChannel ?? ''} is less stable than the configured channel (${configChannel ?? 'latest'}).\n` +
        `  In non-TTY environments, set ARBITER_ALLOW_CHANNEL_DOWNGRADE=1 to allow this.\n`,
    )
    process.exit(1)
  }

  const inquirer = await import('inquirer')
  const { confirmed } = (await inquirer.default.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message: `--channel ${flagChannel ?? ''} is less stable than your configured channel (${configChannel ?? 'latest'}). Continue?`,
      default: false,
    },
  ] as Parameters<typeof inquirer.default.prompt>[0])) as { confirmed: boolean }

  if (!confirmed) {
    process.stderr.write('[arbiter] Channel downgrade cancelled.\n')
    process.exit(1)
  }
}
