import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, readdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  saveConfig,
  saveConfigAndSnapshot,
  writeSnapshot,
  loadConfig,
  loadSnapshot,
} from '../../src/utils/config.js'
import { validateConfig } from '../../src/config/schema.js'
import { defaultConfig } from '../helpers/default-config.js'

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'arbiter-config-test-'))
}

describe('arbiter config', () => {
  let dir: string

  beforeEach(() => {
    dir = tmpDir()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('saveConfig creates arbiter.json', async () => {
    await saveConfig(dir, defaultConfig())
    expect(existsSync(join(dir, 'arbiter.json'))).toBe(true)
  })

  it('loadConfig returns null when no file exists', () => {
    expect(loadConfig(dir)).toBeNull()
  })

  it('saveConfig + loadConfig round-trips v2 config correctly', async () => {
    const config = defaultConfig()
    await saveConfig(dir, { ...config, permitGitHub: true })
    const loaded = loadConfig(dir)
    expect(loaded?.permitGitHub).toBe(true)
    expect(loaded?.version).toBe('0.2')
    expect(loaded?.features).toBeDefined()
    expect(loaded?.thresholds).toBeDefined()
  })

  it('defaultConfig returns L2 with claude+codex', () => {
    const config = defaultConfig()
    expect(config.governanceLevel).toBe('L2')
    expect(config.tools).toEqual(['claude', 'codex'])
    expect(config.permitGitHub).toBe(false)
  })

  it('loadConfig throws on malformed JSON (#679)', () => {
    const path = join(dir, 'arbiter.json')
    writeFileSync(path, '{invalid json', 'utf-8')
    expect(() => loadConfig(dir)).toThrow(/invalid JSON/)
  })

  // #2367 (ADR-119): "all tool types" is now exactly claude + codex.
  it('saveConfig preserves all tool types', async () => {
    const config = {
      version: '0.1',
      tools: ['claude', 'codex'] as const,
      governanceLevel: 'L3' as const,
      useGitHub: false,
    }
    await saveConfig(dir, config)
    const loaded = loadConfig(dir)
    expect(loaded!.tools).toEqual(['claude', 'codex'])
    expect(loaded!.governanceLevel).toBe('L3')
  })

  it('saveConfig + loadConfig round-trips invariantTiers', async () => {
    const config = {
      version: '0.1',
      tools: ['claude'] as const,
      governanceLevel: 'L2' as const,
      useGitHub: false,
      invariantTiers: ['architectural', 'data', 'governance'] as const,
    }
    await saveConfig(dir, config)
    const loaded = loadConfig(dir)
    expect(loaded!.invariantTiers).toEqual(['architectural', 'data', 'governance'])
  })

  it('loadConfig returns config without invariantTiers for old format (backwards compat)', () => {
    const path = join(dir, 'arbiter.json')
    writeFileSync(
      path,
      JSON.stringify({
        version: '0.1',
        tools: ['claude'],
        governanceLevel: 'L2',
        useGitHub: false,
      }),
      'utf-8',
    )
    const loaded = loadConfig(dir)
    expect(loaded).not.toBeNull()
    expect(loaded!.invariantTiers).toBeUndefined()
  })

  it('defaultConfig includes invariantTiers for L2 (standard preset)', () => {
    const config = defaultConfig()
    expect(config.invariantTiers).toBeDefined()
    expect(config.invariantTiers).toContain('architectural')
    expect(config.invariantTiers).toContain('governance')
    expect(config.invariantTiers).toContain('data')
    expect(config.invariantTiers).toContain('operational')
  })
})

describe('arbiter config — MK grace-period fields (ADR-028)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-config-grace-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('round-trips graceEndsAt and graceFromLevel through save/load', async () => {
    const grace = '2026-05-16T00:00:00.000Z'
    await saveConfig(dir, {
      version: '0.1',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
      graceEndsAt: grace,
      graceFromLevel: 'L1',
    })
    const loaded = loadConfig(dir)
    expect(loaded?.graceEndsAt).toBe(grace)
    expect(loaded?.graceFromLevel).toBe('L1')
  })

  it('defaultConfig does NOT include graceEndsAt or graceFromLevel', () => {
    const config = defaultConfig()
    expect(config.graceEndsAt).toBeUndefined()
    expect(config.graceFromLevel).toBeUndefined()
  })

  it('loadConfig tolerates arbiter.json without grace fields (backward compat)', () => {
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({
        version: '0.1',
        tools: ['claude'],
        governanceLevel: 'L1',
        useGitHub: false,
      }),
      'utf-8',
    )
    const loaded = loadConfig(dir)
    expect(loaded).not.toBeNull()
    expect(loaded?.graceEndsAt).toBeUndefined()
    expect(loaded?.graceFromLevel).toBeUndefined()
  })
})

describe('loadSnapshot — migration parity with loadConfig (#277 #7)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-snapshot-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('migrates a v1 snapshot through to v2 instead of returning raw v1 shape', () => {
    // Write a v1-style snapshot (no v2-only fields like `features`).
    writeFileSync(
      join(dir, '.arbiter-generated.json'),
      JSON.stringify({
        version: '0.1',
        tools: ['claude'],
        governanceLevel: 'L2',
        useGitHub: false,
      }),
      'utf-8',
    )
    const loaded = loadSnapshot(dir)
    expect(loaded).not.toBeNull()
    // After migration, the v2 fields are present and the version is normalised.
    expect(loaded?.version).toBe('0.2')
    expect(loaded?.features).toBeDefined()
    expect(loaded?.thresholds).toBeDefined()
  })

  it('returns null with a warning when snapshot JSON is malformed', () => {
    vi.spyOn(console, 'warn').mockImplementationOnce(() => undefined)
    writeFileSync(join(dir, '.arbiter-generated.json'), '{not json', 'utf-8')
    expect(loadSnapshot(dir)).toBeNull()
    vi.restoreAllMocks()
  })

  it('returns null when no snapshot exists', () => {
    expect(loadSnapshot(dir)).toBeNull()
  })
})

describe('arbiter config — ML contractType field (ADR-028)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-config-contract-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('round-trips contractType through save/load', async () => {
    await saveConfig(dir, {
      version: '0.1',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
      contractType: 'graphql',
    })
    const loaded = loadConfig(dir)
    expect(loaded?.contractType).toBe('graphql')
  })

  it('loadConfig tolerates arbiter.json without contractType (backward compat)', () => {
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({
        version: '0.1',
        tools: ['claude'],
        governanceLevel: 'L2',
        useGitHub: false,
      }),
      'utf-8',
    )
    const loaded = loadConfig(dir)
    expect(loaded).not.toBeNull()
    expect(loaded?.contractType).toBeUndefined()
  })
})

describe('saveConfigAndSnapshot (#772)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-save-pair-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes both arbiter.json and .arbiter-generated.json', () => {
    saveConfigAndSnapshot(dir, defaultConfig())
    expect(existsSync(join(dir, 'arbiter.json'))).toBe(true)
    expect(existsSync(join(dir, '.arbiter-generated.json'))).toBe(true)
  })

  it('snapshot wraps the config in a versioned envelope with checksum (#607 #619)', () => {
    saveConfigAndSnapshot(dir, defaultConfig())
    const snapshot = JSON.parse(
      readFileSync(join(dir, '.arbiter-generated.json'), 'utf-8'),
    ) as Record<string, unknown>
    expect(typeof snapshot['.checksum']).toBe('string')
    expect(snapshot.$schemaVersion).toBe(1)
    expect(snapshot.config).toBeDefined()
    // arbiter.json remains the raw config (no envelope)
    const config = JSON.parse(readFileSync(join(dir, 'arbiter.json'), 'utf-8')) as Record<
      string,
      unknown
    >
    expect(config['.checksum']).toBeUndefined()
    expect(config.$schemaVersion).toBeUndefined()
  })

  it('content is valid JSON that round-trips through loadConfig', () => {
    const original = defaultConfig()
    saveConfigAndSnapshot(dir, original)
    const loaded = loadConfig(dir)
    expect(loaded?.version).toBe(original.version)
    expect(loaded?.governanceLevel).toBe(original.governanceLevel)
  })

  it('loadSnapshot reads the unwrapped config from envelope', () => {
    const original = defaultConfig()
    saveConfigAndSnapshot(dir, original)
    const snap = loadSnapshot(dir)
    expect(snap?.governanceLevel).toBe(original.governanceLevel)
  })

  it('loadSnapshot throws SnapshotChecksumError on tamper (#619)', () => {
    saveConfigAndSnapshot(dir, defaultConfig())
    const snapPath = join(dir, '.arbiter-generated.json')
    const tampered = JSON.parse(readFileSync(snapPath, 'utf-8')) as Record<string, unknown>
    ;(tampered.config as Record<string, unknown>).governanceLevel = 'L3'
    writeFileSync(snapPath, JSON.stringify(tampered, null, 2))
    expect(() => loadSnapshot(dir)).toThrow(/checksum mismatch/i)
  })

  it('loadSnapshot auto-migrates a v0 (pre-envelope) snapshot without throwing', async () => {
    await saveConfig(dir, defaultConfig())
    // v0 snapshot = bare config (legacy shape) — no envelope, no checksum
    writeFileSync(
      join(dir, '.arbiter-generated.json'),
      JSON.stringify(defaultConfig(), null, 2),
      'utf-8',
    )
    const snap = loadSnapshot(dir)
    expect(snap).not.toBeNull()
    expect(snap?.governanceLevel).toBe('L2')
  })

  it('saveConfigAndSnapshot rotates .bak.<ts> for previous snapshot', () => {
    saveConfigAndSnapshot(dir, defaultConfig())
    saveConfigAndSnapshot(dir, defaultConfig())
    const files = readdirSync(dir)
    expect(files.some((f) => f.startsWith('.arbiter-generated.json.bak.'))).toBe(true)
  })
})

describe('arbiter config — automation block (#1291, ADR-093 §4)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-automation-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('round-trips automation.autonomy through save/load', async () => {
    await saveConfig(dir, {
      version: '0.1',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
      automation: { autonomy: 'L3' },
    })
    expect(loadConfig(dir)?.automation?.autonomy).toBe('L3')
  })

  it('loadConfig tolerates arbiter.json without the block (backward compat → resolves L0 downstream)', async () => {
    await saveConfig(dir, {
      version: '0.1',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
    })
    const loaded = loadConfig(dir)
    expect(loaded).not.toBeNull()
    expect(loaded?.automation).toBeUndefined()
  })

  it('validateConfig rejects an unknown autonomy level (fail-closed)', () => {
    const result = validateConfig({
      version: '0.1',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
      features: {},
      thresholds: {},
      automation: { autonomy: 'L9' },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toContain('automation.autonomy')
  })
})

// ── kit.lock crash-safety / reentrancy (#1517) ────────────────────────────────
//
// Regression: saveConfig used to acquire kit.lock via the brittle `withLock`
// (open 'wx', cleanup only in finally). A crash/abort orphaned the lock and every
// subsequent saveConfig failed forever with a raw EEXIST that doctor could not
// repair. saveConfig now uses the robust `acquireLock` (file-lock.ts), which
// performs stale-takeover, so an orphaned kit.lock no longer bricks config writes.
// #2541: arbiter.json and .arbiter-generated.json are never generator-emitted
// (no `src/generators/*.ts` targets either — see docs/REFERENCE/file-stability.md,
// which documents arbiter.json's own load→mutate→save merge as the user-edit
// protection, and .arbiter-generated.json as machine-written provenance). Both
// are therefore exempt from `writeFile`'s `arbiter:preserve` marker — a real,
// end-to-end proof (no mocks) that a preserve-marked arbiter.json/snapshot is
// still overwritten rather than silently frozen.
describe('saveConfig/saveConfigAndSnapshot/writeSnapshot — preserve-marker exemption (#2541)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-config-preserve-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('saveConfig overwrites arbiter.json even when its on-disk content quotes arbiter:preserve', async () => {
    const path = join(dir, 'arbiter.json')
    writeFileSync(
      path,
      JSON.stringify({ note: 'quoted from AGENTS.md: <!-- arbiter:preserve -->' }),
      'utf-8',
    )
    await saveConfig(dir, { ...defaultConfig(), permitGitHub: true })
    const loaded = loadConfig(dir)
    expect(loaded?.permitGitHub).toBe(true)
  })

  it('saveConfigAndSnapshot overwrites both files even when marked arbiter:preserve', () => {
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ note: 'arbiter:preserve' }), 'utf-8')
    writeFileSync(
      join(dir, '.arbiter-generated.json'),
      JSON.stringify({ note: 'arbiter:preserve' }),
      'utf-8',
    )
    saveConfigAndSnapshot(dir, { ...defaultConfig(), permitGitHub: true })
    expect(loadConfig(dir)?.permitGitHub).toBe(true)
    expect(loadSnapshot(dir)?.permitGitHub).toBe(true)
  })

  it('writeSnapshot overwrites .arbiter-generated.json even when marked arbiter:preserve', () => {
    writeFileSync(
      join(dir, '.arbiter-generated.json'),
      JSON.stringify({ note: 'arbiter:preserve' }),
      'utf-8',
    )
    writeSnapshot(dir, { ...defaultConfig(), permitGitHub: true })
    expect(loadSnapshot(dir)?.permitGitHub).toBe(true)
  })
})

describe('saveConfig kit.lock is crash-safe (#1517)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-kitlock-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('recovers from an orphaned (stale) kit.lock via stale-takeover instead of failing forever', async () => {
    const os = await import('node:os')
    const lockDir = join(dir, '.arbiter')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(lockDir, { recursive: true })
    const lockPath = join(lockDir, 'kit.lock')

    // Orphaned lock from a crashed run: valid lock-info but a different boot id,
    // which `isStale` treats as unconditionally stale (machine rebooted).
    const stale = {
      pid: process.pid,
      hostname: os.hostname(),
      bootId: 'orphaned-boot-id-from-a-previous-crash',
      startedAt: new Date(Date.now() - 10_000).toISOString(),
      cmd: 'arbiter init',
      nonce: 'orphaned-nonce',
    }
    writeFileSync(lockPath, JSON.stringify(stale), 'utf-8')

    // With the old `withLock`, this rejects with a raw EEXIST. With `acquireLock`
    // it takes over the stale lock and the write succeeds.
    await expect(saveConfig(dir, defaultConfig())).resolves.toBeUndefined()

    const loaded = loadConfig(dir)
    expect(loaded).not.toBeNull()
    // Lock is released after a clean run — no orphan left behind.
    expect(existsSync(lockPath)).toBe(false)
  })

  it('serialises config writes through kit.lock and releases it after a clean run', async () => {
    await saveConfig(dir, defaultConfig())
    expect(existsSync(join(dir, 'arbiter.json'))).toBe(true)
    // Lock must not linger after the write completes.
    expect(existsSync(join(dir, '.arbiter', 'kit.lock'))).toBe(false)
  })
})
