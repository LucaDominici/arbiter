// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('platform detection (#543)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('isWindows() returns false on linux/mac', async () => {
    vi.stubGlobal('process', { ...process, platform: 'linux' })
    const { isWindows } = await import('../../src/utils/platform.js')
    expect(isWindows()).toBe(false)
  })

  it('isWindows() returns true when platform is win32', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' })
    const { isWindows } = await import('../../src/utils/platform.js')
    expect(isWindows()).toBe(true)
  })

  it('isWSL2() returns false when WSL env vars absent', async () => {
    const env = { ...process.env }
    delete env['WSL_DISTRO_NAME']
    delete env['WSLENV']
    delete env['WSL_INTEROP']
    vi.stubGlobal('process', { ...process, env })
    const { isWSL2 } = await import('../../src/utils/platform.js')
    expect(isWSL2()).toBe(false)
  })

  it('isWSL2() returns true when WSL_DISTRO_NAME set', async () => {
    vi.stubGlobal('process', {
      ...process,
      env: { ...process.env, WSL_DISTRO_NAME: 'Ubuntu' },
    })
    const { isWSL2 } = await import('../../src/utils/platform.js')
    expect(isWSL2()).toBe(true)
  })

  it('isWSL2() returns true when WSLENV set', async () => {
    vi.stubGlobal('process', {
      ...process,
      env: { ...process.env, WSLENV: 'WT_SESSION' },
    })
    const { isWSL2 } = await import('../../src/utils/platform.js')
    expect(isWSL2()).toBe(true)
  })

  it('isWSL2() returns true when WSL_INTEROP set', async () => {
    vi.stubGlobal('process', {
      ...process,
      env: { ...process.env, WSL_INTEROP: '/run/WSL/9_interop' },
    })
    const { isWSL2 } = await import('../../src/utils/platform.js')
    expect(isWSL2()).toBe(true)
  })
})
