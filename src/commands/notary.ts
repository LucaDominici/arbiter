/**
 * arbiter notary — Notary system commands.
 *
 * Subcommands:
 *   check    — validate Notary footer for staged doc changes
 *   template — print footer template for staged doc changes
 *
 * Existing Code Survey (CANON-16):
 *   - grep for "export.*notary\|export.*Notary" src/ --include="*.ts" -l → no matches
 *   - Decision: new file — no existing notary command in src/commands/
 *
 * CANON-06: unit test at __tests__/commands/notary.test.ts
 *
 * #256
 */
import { resolve } from 'node:path'
import { loadConfig } from '../utils/config.js'
import { getStagedDocFiles, getStagedCommitMessage } from '../notary/staged.js'
import { parseNotaryFooter, validateNotaryFooter } from '../notary/parser.js'
import { getRequiredPatches } from '../notary/patch-deps.js'

export interface NotaryOptions {
  dir?: string | undefined
}

/** Default exemption list — can be overridden by arbiter.json notary.exemptions[] */
const DEFAULT_EXEMPTIONS: ReadonlyArray<string> = ['.evidence/', '.claude/plans/', 'archives/']

function isExempted(filePath: string, exemptions: ReadonlyArray<string>): boolean {
  const normalized = filePath.replace(/\\/g, '/')
  return exemptions.some((prefix) => normalized.startsWith(prefix))
}

function loadExemptions(dir: string): ReadonlyArray<string> {
  const config = loadConfig(dir)
  if (
    config &&
    typeof config === 'object' &&
    'notary' in config &&
    config.notary !== null &&
    typeof config.notary === 'object' &&
    'exemptions' in config.notary &&
    Array.isArray((config.notary as Record<string, unknown>)['exemptions'])
  ) {
    return (config.notary as Record<string, unknown>)['exemptions'] as string[]
  }
  return DEFAULT_EXEMPTIONS
}

/**
 * Check staged changes for required Notary footer.
 *
 * Exit codes:
 *   0 = pass (no doc changes, or valid footer present, or all files exempted)
 *   1 = fail (doc changes staged without a valid Notary footer)
 */
export function runNotaryCheck(opts: NotaryOptions): void {
  const dir = resolve(opts.dir ?? '.')
  const exemptions = loadExemptions(dir)

  const allStagedDocs = getStagedDocFiles(dir)
  const stagedDocs = allStagedDocs.filter((f) => !isExempted(f, exemptions))

  // No doc changes that require a footer
  if (stagedDocs.length === 0) {
    process.stdout.write('arbiter notary: no doc changes require a Notary footer\n')
    return
  }

  const commitMsg = getStagedCommitMessage(dir)
  const parsed = parseNotaryFooter(commitMsg)

  if (!parsed) {
    process.stderr.write(
      `arbiter notary: doc changes staged but no Notary footer found\n` +
        `  Changed files: ${stagedDocs.join(', ')}\n` +
        `  Run: arbiter notary template  to generate the footer\n`,
    )
    process.exit(1)
    return
  }

  const errors = validateNotaryFooter(parsed)
  if (errors.length > 0) {
    process.stderr.write(
      `arbiter notary: Notary footer validation failed:\n` +
        errors.map((e) => `  - ${e}`).join('\n') +
        '\n',
    )
    process.exit(1)
    return
  }

  process.stdout.write('arbiter notary: Notary footer valid\n')
}

/**
 * Print an expected Notary footer template for the staged changes.
 */
export function runNotaryTemplate(opts: NotaryOptions): void {
  const dir = resolve(opts.dir ?? '.')
  const exemptions = loadExemptions(dir)

  const allStagedDocs = getStagedDocFiles(dir)
  const stagedDocs = allStagedDocs.filter((f) => !isExempted(f, exemptions))

  if (stagedDocs.length === 0) {
    process.stdout.write('arbiter notary: no doc changes staged\n')
    return
  }

  // Build patch list from all unique required index files
  const patchSet = new Set<string>()
  for (const file of stagedDocs) {
    for (const patch of getRequiredPatches(file)) {
      patchSet.add(patch)
    }
  }

  const deltaLines = stagedDocs.map((f) => `- Delta: ${f} §<SECTION> (<TYPE>, +N -N)`).join('\n')

  const patchLine =
    patchSet.size > 0
      ? Array.from(patchSet)
          .map((p) => `${p} (<update|N/A>)`)
          .join(', ')
      : '<INDEX> (N/A)'

  const template = [
    '',
    'Notary:',
    deltaLines,
    '- Intent: <REASON> [per <ADR|INV|TASK>]',
    `- Patch: ${patchLine}`,
    '',
  ].join('\n')

  process.stdout.write(template)
}
