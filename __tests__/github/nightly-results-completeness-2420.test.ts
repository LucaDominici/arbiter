// SPDX-License-Identifier: Apache-2.0
// #2420 AC-3: TESTING.md admitted "there is no automated check for RESULTS completeness".
// The `nightly-required` job aggregates hard failures twice — once in `needs:` (which
// only orders the job) and once in the `RESULTS=()` shell array (which actually decides
// the exit code). A job present in `needs:` but absent from `RESULTS=()` runs, fails, and
// the nightly gate still reports green. These assertions pin the two lists together in
// arbiter's own workflow AND in the CANON-18 template twin every generated project ships.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string): string => readFileSync(resolve(p), 'utf8')

const LIVE = '.github/workflows/_nightly.yml'
const TEMPLATE = 'src/templates/github/workflows/_nightly.yml.ejs'

/** Slice the `nightly-required` job header, from `needs:` up to the `if: always()` key. */
function nightlyRequiredHeader(source: string): string {
  const jobStart = source.indexOf('\n  nightly-required:')
  expect(jobStart, `${LIVE}: nightly-required job not found`).toBeGreaterThan(-1)
  const needsStart = source.indexOf('\n    needs:', jobStart)
  expect(needsStart).toBeGreaterThan(jobStart)
  const end = source.indexOf('\n    if: always()', needsStart)
  expect(end).toBeGreaterThan(needsStart)
  return source.slice(needsStart, end)
}

/** Job names listed under `needs:`, in file order. EJS guard lines never match. */
function needsJobs(source: string): string[] {
  return [...nightlyRequiredHeader(source).matchAll(/^\s*-\s+([a-z0-9-]+)\s*$/gm)].map((m) => m[1])
}

/** Job names referenced inside the `RESULTS=(...)` array, in file order. */
function resultsJobs(source: string): string[] {
  const start = source.indexOf('RESULTS=(')
  expect(start).toBeGreaterThan(-1)
  const end = source.indexOf('\n          )', start)
  expect(end).toBeGreaterThan(start)
  const body = source.slice(start, end)
  return [...body.matchAll(/needs\.([a-z0-9-]+)\.result/g)].map((m) => m[1])
}

describe.each([
  ['live workflow', LIVE],
  ['template twin (CANON-18)', TEMPLATE],
])('#2420 AC-3 — _nightly.yml RESULTS completeness: %s', (_label, path) => {
  const source = read(path)

  it('lists at least one job in needs:', () => {
    expect(needsJobs(source).length).toBeGreaterThan(0)
  })

  it('every job in nightly-required.needs: is aggregated in RESULTS=()', () => {
    const missing = needsJobs(source).filter((job) => !resultsJobs(source).includes(job))
    expect(missing, `${path}: job(s) in needs: but not in RESULTS=() — silent fail-open`).toEqual(
      [],
    )
  })

  it('RESULTS=() references no job that is absent from needs:', () => {
    const extra = resultsJobs(source).filter((job) => !needsJobs(source).includes(job))
    expect(extra, `${path}: RESULTS=() references a job not in needs:`).toEqual([])
  })

  it('needs: and RESULTS=() list the jobs in the same order (guards stay aligned)', () => {
    expect(resultsJobs(source)).toEqual(needsJobs(source))
  })
})
