#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Second half of npm's `prepare` lifecycle script (the first half, run inline in
// package.json so `scripts.prepare` keeps containing the literal
// `core.hooksPath` command — see __tests__/scripts/publish-hygiene.test.ts —
// is `git config core.hooksPath .githooks`). This half only builds, and only
// when needed:
//   1. Contributors running `npm install`/`npm ci` in this repo. cwd is a plain
//      checkout, not under npm's cache or a `node_modules` tree. No build here
//      — every CI job and dev workflow already runs `npm run build` explicitly
//      where dist is required, and building on every install here would
//      silently double that cost for jobs that don't need dist at all (#9001).
//   2. npm installing this package as a git dependency of ANOTHER project
//      (`github:LucaDominici/arbiter#<ref>`). `prepack` (which builds for `npm
//      pack`/`npm publish`) never runs for a git dependency — only `prepare`
//      does. Measured empirically (npm 11.16.0): npm runs `prepare` with cwd
//      inside its own cache (`<npm_config_cache>/_cacache/tmp/git-clone*`),
//      BEFORE packing the result into the consumer's node_modules using the
//      `files` allowlist (which includes `dist`) — so building here, in that
//      cache clone, is what makes dist ship. A registry/tarball dependency
//      would instead already be extracted straight into a `node_modules` tree
//      when prepare runs. Either location is detected below; neither is a
//      normal contributor checkout.
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const npmCache = process.env.npm_config_cache ? resolve(process.env.npm_config_cache) : null

const installedAsDependency =
  ROOT.split(sep).includes('node_modules') || (npmCache !== null && ROOT.startsWith(npmCache + sep))

try {
  if (installedAsDependency && !existsSync(resolve(ROOT, 'dist', 'cli.js'))) {
    execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' })
  }
} catch (err) {
  console.error(`prepare-lifecycle: build failed — ${err.message}`)
  process.exit(1)
}
