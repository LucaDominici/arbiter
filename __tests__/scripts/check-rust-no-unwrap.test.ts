import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

function renderAndWrite(target: string, template: string): string {
  const out = renderTemplate(
    template,
    makeConfig('/tmp/test', {
      language: 'rust',
    }) as unknown as Record<string, unknown>,
  )
  writeFileSync(target, out)
  return target
}

function setup(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'rust-checks-'))
  mkdirSync(join(dir, 'scripts', 'checks'), { recursive: true })
  mkdirSync(join(dir, 'src'), { recursive: true })
  renderAndWrite(
    join(dir, 'scripts', 'checks', 'check-rust-no-unwrap.mjs'),
    'scripts/checks/check-rust-no-unwrap.mjs.ejs',
  )
  renderAndWrite(
    join(dir, 'scripts', 'checks', 'check-rust-no-unsafe.mjs'),
    'scripts/checks/check-rust-no-unsafe.mjs.ejs',
  )
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function runNoUnwrap(dir: string): { status: number; out: string } {
  const r = spawnSync('node', ['scripts/checks/check-rust-no-unwrap.mjs'], {
    cwd: dir,
    encoding: 'utf-8',
  })
  return { status: r.status ?? 1, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

function runNoUnsafe(dir: string): { status: number; out: string } {
  const r = spawnSync('node', ['scripts/checks/check-rust-no-unsafe.mjs'], {
    cwd: dir,
    encoding: 'utf-8',
  })
  return { status: r.status ?? 1, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

describe('check-rust-no-unwrap (#360, awk-context-aware via Node)', () => {
  it('exits 0 on clean src/ tree', () => {
    const { dir, cleanup } = setup()
    try {
      writeFileSync(join(dir, 'src', 'main.rs'), 'fn main() { println!("ok"); }\n')
      expect(runNoUnwrap(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 on .unwrap() in production code', () => {
    const { dir, cleanup } = setup()
    try {
      writeFileSync(
        join(dir, 'src', 'bad.rs'),
        'fn run() { let x: Option<i32> = Some(1); let _ = x.unwrap(); }\n',
      )
      const r = runNoUnwrap(dir)
      expect(r.status).toBe(1)
      expect(r.out).toContain('bad.rs')
    } finally {
      cleanup()
    }
  })

  it('exits 1 on .expect("...") in production code', () => {
    const { dir, cleanup } = setup()
    try {
      writeFileSync(
        join(dir, 'src', 'bad.rs'),
        'fn run() { let x: Option<i32> = Some(1); let _ = x.expect("nope"); }\n',
      )
      expect(runNoUnwrap(dir).status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when .unwrap() is inside #[cfg(test)] module (context-aware slice)', () => {
    const { dir, cleanup } = setup()
    try {
      writeFileSync(
        join(dir, 'src', 'ok.rs'),
        [
          'fn run() {}',
          '',
          '#[cfg(test)]',
          'mod tests {',
          '  #[test]',
          '  fn t() { let x: Option<i32> = Some(1); let _ = x.unwrap(); }',
          '}',
          '',
        ].join('\n'),
      )
      expect(runNoUnwrap(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when .unwrap appears in lib.rs (re-export entrypoint skipped per a prior internal project)', () => {
    const { dir, cleanup } = setup()
    try {
      writeFileSync(
        join(dir, 'src', 'lib.rs'),
        'pub use crate::foo::Bar; // mentions unwrap in a docs example\nfn x() { let v: Option<i32> = Some(1); let _ = v.unwrap(); }\n',
      )
      expect(runNoUnwrap(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when .unwrap() appears only in a comment', () => {
    const { dir, cleanup } = setup()
    try {
      writeFileSync(join(dir, 'src', 'cm.rs'), 'fn run() {}\n// Never call .unwrap() here.\n')
      expect(runNoUnwrap(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })
})

describe('check-rust-no-unsafe (#360)', () => {
  it('exits 0 on clean tree', () => {
    const { dir, cleanup } = setup()
    try {
      writeFileSync(join(dir, 'src', 'main.rs'), 'fn main() {}\n')
      expect(runNoUnsafe(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 on real unsafe block', () => {
    const { dir, cleanup } = setup()
    try {
      writeFileSync(join(dir, 'src', 'raw.rs'), 'fn x() { unsafe { core::ptr::null::<i32>(); } }\n')
      const r = runNoUnsafe(dir)
      expect(r.status).toBe(1)
      expect(r.out).toContain('raw.rs')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when forbid(unsafe_code) lint is declared (not a real unsafe block)', () => {
    const { dir, cleanup } = setup()
    try {
      writeFileSync(join(dir, 'src', 'lib.rs'), '#![forbid(unsafe_code)]\npub fn safe() {}\n')
      expect(runNoUnsafe(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when "unsafe" appears only in a comment', () => {
    const { dir, cleanup } = setup()
    try {
      writeFileSync(join(dir, 'src', 'doc.rs'), 'fn x() {}\n// avoid unsafe code here\n')
      expect(runNoUnsafe(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })
})
