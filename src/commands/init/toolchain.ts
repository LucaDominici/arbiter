// SPDX-License-Identifier: Apache-2.0
//
// #2137: keep the pre-write toolchain guard outside the init orchestrator. It
// deliberately runs before `.arbiter/` is created, so a failed verification
// leaves the target directory untouched.
import { runProbes } from '../../compatibility/probe.js'
import { formatText } from '../../compatibility/report.js'
import { t } from '../../i18n/index.js'
import type { InitOptions } from './types.js'

export function verifyToolchainBeforeWrite(targetDir: string, options: InitOptions): void {
  if (options.noVerify || options.dryRun) return
  runToolchainVerify(targetDir, Boolean(options.json))
}

function runToolchainVerify(targetDir: string, jsonMode = false): void {
  const writeHuman = (message: string): void => {
    if (jsonMode) process.stderr.write(message)
    else process.stdout.write(message)
  }
  writeHuman(`${t('cli.init.verifying_toolchain')}\n`)
  let report: ReturnType<typeof runProbes>
  try {
    report = runProbes(targetDir)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(
      `\n  Toolchain verification failed unexpectedly: ${message}\n` +
        '  No files were generated or modified. Use --no-verify to skip verification.\n',
    )
    process.exit(1)
  }
  writeHuman(`${formatText(report)}\n`)
  if (report.hasFailures) {
    process.stderr.write(
      '\n  arbiter init aborted: toolchain incompatibilities detected.\n' +
        '  Fix the issues above and re-run, or use --no-verify to skip.\n',
    )
    process.exit(1)
  }
}
