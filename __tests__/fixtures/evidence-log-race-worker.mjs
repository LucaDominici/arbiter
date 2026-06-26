// SPDX-License-Identifier: Apache-2.0
// Worker process for the evidence-log concurrency stress test (#1556).
// Appends `count` evidence lines, each tagged with a unique (workerId, index)
// marker, against a shared `.evidence/cmd-log.jsonl` with a tiny maxBytes so
// rotation fires constantly. The parent asserts zero line loss across the main
// log plus every rotated backup.
//
// Invoked as:
//   node --import tsx/esm worker.mjs <moduleFileUrl> <dir> <maxBytes> <count> <workerId>
const [, , modUrl, dir, maxBytesStr, countStr, workerId] = process.argv
const { appendEvidenceLine } = await import(modUrl)
const maxBytes = Number(maxBytesStr)
const count = Number(countStr)
for (let i = 0; i < count; i++) {
  appendEvidenceLine(
    {
      ts: new Date().toISOString(),
      cmd: 'race',
      args: [workerId, String(i)],
      exit: 0,
      durationMs: 0,
      headSha: workerId,
    },
    { dir, maxBytes },
  )
}
