// SPDX-License-Identifier: Apache-2.0
// Reproducible "today" for emitted artifacts. Honors SOURCE_DATE_EPOCH (the
// reproducible-builds convention, seconds since epoch) so committed generated
// trees (examples/, bake goldens) do not roll every calendar day (#2274).
export function isoToday(env: NodeJS.ProcessEnv = process.env): string {
  const epoch = env.SOURCE_DATE_EPOCH
  if (epoch !== undefined && /^\d+$/.test(epoch)) {
    return new Date(Number(epoch) * 1000).toISOString().slice(0, 10)
  }
  return new Date().toISOString().slice(0, 10)
}
