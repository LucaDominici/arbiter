// parse-check-args.mjs — argv parser for scripts/check-all.mjs
//
// Subcommands:
//   check            T1 fast checks (~2 min)
//   gate             T1+T2 extended checks (~10 min, default)
//   full             gate + T3 dry-run (~35 min)
//   simulate-nightly T4 mutation+DAST+full SCA+fuzz
//   simulate-weekly  T5 cross-DB+cross-OS+freshness+perf-trend
//
// Back-compat positional aliases:
//   L1 → check --level L1
//   L2 → gate  --level L2
//   L3 → gate  --level L3
//   L4 → gate  --level L4

export const SUBCOMMANDS = ['check', 'gate', 'full', 'simulate-nightly', 'simulate-weekly']
export const LEVELS = ['L1', 'L2', 'L3', 'L4']

/**
 * Parse argv into check-all options.
 * @param {string[]} argv  process.argv.slice(2)
 * @returns {{ subcommand: string, level: string, langs: string[]|null, noMutation: boolean, jsonPath: string|null }}
 */
export function parseCheckArgs(argv) {
  let subcommand = null
  let level = 'L2'
  let langs = null
  let noMutation = false
  let jsonPath = null // null = write to default path; '' = default; string = explicit path

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (SUBCOMMANDS.includes(arg)) {
      subcommand = arg
    } else if (arg === '--level' && i + 1 < argv.length) {
      level = argv[++i]
    } else if (arg === '--lang' && i + 1 < argv.length) {
      langs = argv[++i].split(',')
    } else if (arg === '--no-mutation') {
      noMutation = true
    } else if (arg === '--json') {
      if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
        jsonPath = argv[++i]
      } else {
        jsonPath = ''
      }
    } else if (LEVELS.includes(arg)) {
      // Back-compat: L1 → check/L1, L2/L3/L4 → gate/level
      level = arg
      if (subcommand === null) {
        subcommand = arg === 'L1' ? 'check' : 'gate'
      }
    }
  }

  if (subcommand === null) subcommand = 'gate'

  return { subcommand, level, langs, noMutation, jsonPath }
}
