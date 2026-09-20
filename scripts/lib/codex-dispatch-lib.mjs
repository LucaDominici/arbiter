// SPDX-License-Identifier: Apache-2.0
import { join } from 'node:path'

function commonArgs({ model, effort, outPath }) {
  return [
    '-m',
    model,
    '-c',
    `model_reasoning_effort=${effort}`,
    '-c',
    'approval_policy=never',
    '-o',
    outPath,
  ]
}

/** Build argv for a Codex writer dispatch. Caller resolves gitDir/commonGitDir/briefText
 *  (I/O) before calling in — this stays a pure argv builder. */
export function buildCodexArgs({
  worktreePath,
  model,
  effort,
  gitDir,
  commonGitDir,
  briefText,
  outPath,
  resumeSessionId,
}) {
  const args = resumeSessionId ? ['exec', 'resume', resumeSessionId] : ['exec']
  args.push(...commonArgs({ model, effort, outPath }))
  if (!resumeSessionId) {
    const viteTempDir = join(worktreePath, 'node_modules', '.vite-temp')
    const writableRoots = [...new Set([commonGitDir, gitDir, viteTempDir])]
    args.push(
      '-s',
      'workspace-write',
      '-c',
      `sandbox_workspace_write.writable_roots=${JSON.stringify(writableRoots)}`,
    )
  }
  args.push(briefText)
  return args
}

/** Build argv for a read-only Codex reviewer dispatch. */
export function buildCodexReviewArgs({ model, effort, outPath }) {
  return ['exec', ...commonArgs({ model, effort, outPath }), '-s', 'read-only']
}
