// SPDX-License-Identifier: Apache-2.0
// Vitest setup — #820 console→process.std{out,err}.write migration shim.
//
// Production code was migrated from console.* to process.stdout.write /
// process.stderr.write / structured logger (#635). Many existing tests
// still spy on console.log / console.warn / console.error. To avoid a
// 75-site mechanical test rewrite in the same PR, we tee writes from
// process.stdout/stderr into console.log/warn so existing spies keep
// firing. Real stdout/stderr writes still happen (no double-output to
// real terminal because vitest captures console).
//
// Remove this shim once tests are migrated to spy on
// process.stdout.write / process.stderr.write directly (#820 follow-up).

const origStdoutWrite = process.stdout.write.bind(process.stdout)
const origStderrWrite = process.stderr.write.bind(process.stderr)

type WriteArgs = Parameters<typeof process.stdout.write>

function toMsg(chunk: WriteArgs[0]): string | null {
  if (typeof chunk === 'string') return chunk
  if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString('utf-8')
  return null
}

process.stdout.write = ((...args: WriteArgs): boolean => {
  const msg = toMsg(args[0])
  if (msg !== null) {
    // strip trailing newline since console.log adds its own
    // eslint-disable-next-line no-console
    console.log(msg.endsWith('\n') ? msg.slice(0, -1) : msg)
  }
  return origStdoutWrite(...args)
}) as typeof process.stdout.write

process.stderr.write = ((...args: WriteArgs): boolean => {
  const msg = toMsg(args[0])
  if (msg !== null) {
    // eslint-disable-next-line no-console
    console.warn(msg.endsWith('\n') ? msg.slice(0, -1) : msg)
  }
  return origStderrWrite(...args)
}) as typeof process.stderr.write
