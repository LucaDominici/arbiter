// SPDX-License-Identifier: Apache-2.0
// V8 CPU profiler wrapper for arbiter (#640, R1.M6).
//
// Scope (matches design decision A — whole-process):
//   - Profile starts at CLI entry, before argv parse, so startup/dispatch/plugin
//     load overhead is captured alongside command body.
//   - Output is a single `.cpuprofile` file per run, readable in Chrome DevTools.
//   - Runtime guard: detect Bun/Deno globals and degrade to no-op + warning,
//     since `node:inspector` is Node-only.

import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

// node:inspector is a built-in but typed as optional to allow the runtime guard
// to early-return on Bun/Deno without dragging the type into call sites.
import type { Session as InspectorSession } from 'node:inspector'

export interface ProfilerOptions {
  runId: string
  baseDir?: string
}

export interface ProfilerHandle {
  /** Resolves with the absolute path to the written `.cpuprofile` file. */
  stop(): Promise<string>
}

function defaultProfileBaseDir(): string {
  return join(homedir(), '.arbiter', 'profiles')
}

export interface RuntimeProbe {
  hasBun: boolean
  hasDeno: boolean
}

export function detectRuntime(globalsRef: typeof globalThis = globalThis): RuntimeProbe {
  const g = globalsRef as unknown as { Bun?: unknown; Deno?: unknown }
  return {
    hasBun: g.Bun !== undefined,
    hasDeno: g.Deno !== undefined,
  }
}

export class ProfilerNotSupportedError extends Error {
  constructor(runtime: string) {
    super(`--profile only supported on Node.js; detected: ${runtime}`)
    this.name = 'ProfilerNotSupportedError'
  }
}

export async function startProfiler(opts: ProfilerOptions): Promise<ProfilerHandle> {
  const runtime = detectRuntime()
  if (runtime.hasBun) throw new ProfilerNotSupportedError('Bun')
  if (runtime.hasDeno) throw new ProfilerNotSupportedError('Deno')

  const { Session } = await import('node:inspector')
  const session: InspectorSession = new Session()
  session.connect()

  await postPromise(session, 'Profiler.enable')
  await postPromise(session, 'Profiler.start')

  const baseDir = opts.baseDir ?? defaultProfileBaseDir()
  const outPath = resolve(baseDir, `${opts.runId}.cpuprofile`)

  return {
    async stop(): Promise<string> {
      interface ProfilerStopReturn {
        profile: unknown
      }
      const result = (await postPromise(session, 'Profiler.stop')) as ProfilerStopReturn
      session.disconnect()
      mkdirSync(dirname(outPath), { recursive: true })
      writeFileSync(outPath, JSON.stringify(result.profile))
      return outPath
    },
  }
}

function postPromise(session: InspectorSession, method: string): Promise<unknown> {
  return new Promise<unknown>((resolveP, rejectP) => {
    // The `post` overloads expect a domain-specific method name; we use it
    // generically here because the typed methods (e.g. Profiler.start) all
    // boil down to the same dispatch.
    interface PostFn {
      (m: string, cb: (err: Error | null, params: unknown) => void): void
    }
    const post = session.post.bind(session) as unknown as PostFn
    post(method, (err: Error | null, params: unknown) => {
      if (err) {
        rejectP(err)
        return
      }
      resolveP(params)
    })
  })
}
