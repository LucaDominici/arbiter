// SPDX-License-Identifier: Apache-2.0
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readPackageJsonSafe } from '../utils/safe-read.js'

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

export interface PackageManagerInfo {
  name: PackageManager
  /** how it was determined — used in the init log line so the user can audit the guess */
  source: 'packageManager-field' | 'lockfile' | 'default'
  /** true when this is a multi-package workspace, not a single package */
  isWorkspace: boolean
}

export function detectPackageManager(dir: string): PackageManagerInfo {
  const pkg = readPackageJsonSafe(dir)
  const configured = packageManagerFromField(pkg['packageManager'])
  const lockfile = packageManagerFromLockfile(dir)
  const name = configured ?? lockfile ?? 'npm'

  return {
    name,
    source: configured === null ? (lockfile === null ? 'default' : 'lockfile') : 'packageManager-field',
    isWorkspace: isWorkspace(dir, pkg),
  }
}

function packageManagerFromField(value: unknown): PackageManager | null {
  if (typeof value !== 'string') return null
  return packageManagerFromName(value.split('@', 1)[0] ?? '')
}

function packageManagerFromLockfile(dir: string): PackageManager | null {
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(dir, 'bun.lockb')) || existsSync(join(dir, 'bun.lock'))) return 'bun'
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(dir, 'package-lock.json'))) return 'npm'
  return null
}

function packageManagerFromName(name: string): PackageManager | null {
  switch (name) {
    case 'npm':
    case 'pnpm':
    case 'yarn':
    case 'bun':
      return name
    default:
      return null
  }
}

function isWorkspace(dir: string, pkg: Record<string, unknown>): boolean {
  if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return true

  const workspaces = pkg['workspaces']
  if (Array.isArray(workspaces)) return workspaces.length > 0
  if (typeof workspaces !== 'object' || workspaces === null) return false

  const packages = (workspaces as Record<string, unknown>)['packages']
  return Array.isArray(packages) && packages.length > 0
}
