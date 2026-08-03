import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject } from '../helpers.js'
import { detectPackageManager } from '../../src/detectors/package-manager.js'

describe('detectPackageManager', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('unknown')
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it.each([
    {
      name: 'uses a pnpm Corepack packageManager field',
      packageJson: { packageManager: 'pnpm@11.1.1' },
      expected: { name: 'pnpm', source: 'packageManager-field', isWorkspace: false },
    },
    {
      name: 'uses a yarn Corepack packageManager field with a sha suffix',
      packageJson: { packageManager: 'yarn@4.1.0+sha512.abc' },
      expected: { name: 'yarn', source: 'packageManager-field', isWorkspace: false },
    },
    {
      name: 'falls through from an unknown packageManager field to yarn.lock',
      packageJson: { packageManager: 'corn@1' },
      files: ['yarn.lock'],
      expected: { name: 'yarn', source: 'lockfile', isWorkspace: false },
    },
    {
      name: 'detects pnpm from pnpm-lock.yaml',
      files: ['pnpm-lock.yaml'],
      expected: { name: 'pnpm', source: 'lockfile', isWorkspace: false },
    },
    {
      name: 'detects bun from bun.lockb',
      files: ['bun.lockb'],
      expected: { name: 'bun', source: 'lockfile', isWorkspace: false },
    },
    {
      name: 'detects bun from bun.lock',
      files: ['bun.lock'],
      expected: { name: 'bun', source: 'lockfile', isWorkspace: false },
    },
    {
      name: 'prefers pnpm lockfile over package-lock.json',
      files: ['pnpm-lock.yaml', 'package-lock.json'],
      expected: { name: 'pnpm', source: 'lockfile', isWorkspace: false },
    },
    {
      name: 'defaults a bare package.json to npm',
      packageJson: {},
      expected: { name: 'npm', source: 'default', isWorkspace: false },
    },
    {
      name: 'detects a pnpm workspace file',
      packageJson: {},
      files: ['pnpm-workspace.yaml'],
      expected: { name: 'npm', source: 'default', isWorkspace: true },
    },
    {
      name: 'detects array-form workspaces',
      packageJson: { workspaces: ['packages/*'] },
      expected: { name: 'npm', source: 'default', isWorkspace: true },
    },
    {
      name: 'detects yarn object-form workspaces',
      packageJson: { workspaces: { packages: ['p/*'] } },
      expected: { name: 'npm', source: 'default', isWorkspace: true },
    },
    {
      name: 'reports no workspace for a package without workspace markers',
      packageJson: {},
      expected: { name: 'npm', source: 'default', isWorkspace: false },
    },
  ])('$name', ({ packageJson, files = [], expected }) => {
    if (packageJson !== undefined) {
      writeFileSync(join(dir, 'package.json'), JSON.stringify(packageJson))
    }
    for (const file of files) writeFileSync(join(dir, file), '')

    expect(detectPackageManager(dir)).toEqual(expected)
  })
})
