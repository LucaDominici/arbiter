// SPDX-License-Identifier: Apache-2.0
export interface PercentileResult {
  p50: number
  p95: number
  p99: number
  min: number
  max: number
  samples: number
}

export function measure(fn: () => void, iterations: number): PercentileResult {
  if (iterations <= 0) throw new Error(`measure: iterations must be ≥ 1, got ${iterations}`)
  const timings: number[] = []
  for (let i = 0; i < iterations; i++) {
    const start = process.hrtime.bigint()
    fn()
    const end = process.hrtime.bigint()
    timings.push(Number(end - start) / 1_000_000) // ns → ms
  }
  timings.sort((a, b) => a - b)
  const pct = (p: number) => timings[Math.ceil((p / 100) * timings.length) - 1] ?? 0
  return {
    p50: Math.round(pct(50) * 100) / 100,
    p95: Math.round(pct(95) * 100) / 100,
    p99: Math.round(pct(99) * 100) / 100,
    min: Math.round((timings[0] ?? 0) * 100) / 100,
    max: Math.round((timings[timings.length - 1] ?? 0) * 100) / 100,
    samples: timings.length,
  }
}
