// SPDX-License-Identifier: Apache-2.0
// BDD step definitions (#1040): spawn the real arbiter CLI binary and assert
// observable output/exit-code invariants.
import { Given, When, Then, After, World } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync, execFileSync } from 'node:child_process'

const CLI = fileURLToPath(new URL('../../dist/cli.js', import.meta.url))
const NODE = process.execPath

interface CliWorld extends World {
  projectDir: string | null
  lastResult: { stdout: string; stderr: string; status: number } | null
}

function spawnCli(
  args: string[],
  cwd?: string,
): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(NODE, [CLI, ...args], {
    cwd,
    encoding: 'utf-8',
    timeout: 30_000,
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  }
}

function initGit(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@arbiter.dev'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'Arbiter Test'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' })
}

Given('a clean TypeScript project directory', function (this: CliWorld) {
  this.projectDir = mkdtempSync(join(tmpdir(), 'arbiter-bdd-'))
  writeFileSync(
    join(this.projectDir, 'package.json'),
    JSON.stringify({ name: 'bdd-test-pkg', version: '1.0.0' }),
  )
  initGit(this.projectDir)
})

When('I run {string}', function (this: CliWorld, command: string) {
  const parts = command.replace(/^arbiter\s+/, '').split(/\s+/)
  this.lastResult = spawnCli(parts, this.projectDir ?? undefined)
})

Then('the exit code is {int}', function (this: CliWorld, code: number) {
  assert.ok(this.lastResult, 'No command has been run yet')
  assert.equal(
    this.lastResult.status,
    code,
    `stdout: ${this.lastResult.stdout}\nstderr: ${this.lastResult.stderr}`,
  )
})

Then('stdout contains {string}', function (this: CliWorld, expected: string) {
  assert.ok(this.lastResult, 'No command has been run yet')
  assert.ok(
    this.lastResult.stdout.includes(expected),
    `Expected stdout to contain "${expected}" but got:\n${this.lastResult.stdout}`,
  )
})

Then('stdout matches semver format', function (this: CliWorld) {
  assert.ok(this.lastResult, 'No command has been run yet')
  assert.match(this.lastResult.stdout.trim(), /^\d+\.\d+\.\d+/)
})

Then('{string} exists in the project directory', function (this: CliWorld, filename: string) {
  assert.ok(this.projectDir, 'No project directory created')
  assert.ok(
    existsSync(join(this.projectDir, filename)),
    `Expected ${filename} to exist in ${this.projectDir}`,
  )
})

Then(
  '{string} does not exist in the project directory',
  function (this: CliWorld, filename: string) {
    assert.ok(this.projectDir, 'No project directory created')
    assert.ok(
      !existsSync(join(this.projectDir, filename)),
      `Expected ${filename} NOT to exist in ${this.projectDir}`,
    )
  },
)

After(function (this: CliWorld) {
  if (this.projectDir) {
    rmSync(this.projectDir, { recursive: true, force: true })
    this.projectDir = null
  }
})
