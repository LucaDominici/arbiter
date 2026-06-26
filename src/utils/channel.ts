// SPDX-License-Identifier: Apache-2.0
export type ReleaseChannel = 'latest' | 'beta' | 'canary'
type ChannelSource = 'flag' | 'config' | 'default'

export interface ResolvedChannel {
  value: ReleaseChannel
  source: ChannelSource
}

const VALID_CHANNELS: ReadonlySet<string> = new Set(['latest', 'beta', 'canary'])

export const CHANNEL_STABILITY: Record<ReleaseChannel, number> = {
  latest: 0,
  beta: 1,
  canary: 2,
}

function assertValidChannel(
  value: string,
  context: 'flag' | 'config',
): asserts value is ReleaseChannel {
  if (!VALID_CHANNELS.has(value)) {
    throw new Error(`invalid channel ${context}: "${value}" — must be one of latest, beta, canary`)
  }
}

/** Resolve effective channel from CLI flag > arbiter.json config > default. */
export function resolveChannel(opts: { flag?: string; config?: string }): ResolvedChannel {
  if (opts.flag !== undefined) {
    assertValidChannel(opts.flag, 'flag')
    return { value: opts.flag, source: 'flag' }
  }
  if (opts.config !== undefined) {
    assertValidChannel(opts.config, 'config')
    return { value: opts.config, source: 'config' }
  }
  return { value: 'latest', source: 'default' }
}

/**
 * True when a `--channel` flag requests a less-stable channel than an
 * EXPLICIT configured channel (i.e. config.channel is set, not default).
 *
 * Never warns when:
 *   - no flag provided (bare invocation)
 *   - no explicit config channel (default opt-in is fine)
 *   - flag is same or more-stable than config
 */
export function needsDowngradeWarn(opts: {
  flag: ReleaseChannel | undefined
  configChannel: ReleaseChannel | undefined
}): boolean {
  if (opts.flag === undefined) return false
  if (opts.configChannel === undefined) return false
  return CHANNEL_STABILITY[opts.flag] > CHANNEL_STABILITY[opts.configChannel]
}
