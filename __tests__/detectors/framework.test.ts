import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { detectFramework, detectArchetypeHint } from '../../src/detectors/framework.js'
import { createTestProject, cleanupTestProject } from '../helpers.js'

describe('detectFramework', () => {
  let dir: string

  afterEach(() => {
    cleanupTestProject(dir)
  })

  describe('typescript', () => {
    beforeEach(() => {
      dir = createTestProject('typescript')
    })

    it('detects vue from dependencies', () => {
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({
          dependencies: { vue: '^3.0.0' },
        }),
      )
      expect(detectFramework(dir, 'typescript')).toBe('vue')
    })

    it('detects react from dependencies', () => {
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({
          dependencies: { react: '^18.0.0' },
        }),
      )
      expect(detectFramework(dir, 'typescript')).toBe('react')
    })

    it('detects next from dependencies', () => {
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({
          dependencies: { next: '^14.0.0', react: '^18.0.0' },
        }),
      )
      expect(detectFramework(dir, 'typescript')).toBe('next')
    })

    it('detects express from dependencies', () => {
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({
          dependencies: { express: '^4.0.0' },
        }),
      )
      expect(detectFramework(dir, 'typescript')).toBe('express')
    })

    it('detects express+react combo', () => {
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({
          dependencies: { express: '^4.0.0', react: '^18.0.0' },
        }),
      )
      expect(detectFramework(dir, 'typescript')).toBe('express+react')
    })

    it('detects express+vue combo', () => {
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({
          dependencies: { express: '^4.0.0', vue: '^3.0.0' },
        }),
      )
      expect(detectFramework(dir, 'typescript')).toBe('express+vue')
    })

    it('detects fastify from dependencies', () => {
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({
          dependencies: { fastify: '^4.0.0' },
        }),
      )
      expect(detectFramework(dir, 'typescript')).toBe('fastify')
    })

    it('detects tauri from src-tauri directory', () => {
      mkdirSync(join(dir, 'src-tauri'))
      writeFileSync(join(dir, 'package.json'), '{}')
      expect(detectFramework(dir, 'typescript')).toBe('tauri')
    })

    it('detects tauri+react combo', () => {
      mkdirSync(join(dir, 'src-tauri'))
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({
          dependencies: { react: '^18.0.0' },
        }),
      )
      expect(detectFramework(dir, 'typescript')).toBe('tauri+react')
    })

    it('detects tauri+vue combo', () => {
      mkdirSync(join(dir, 'src-tauri'))
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({
          dependencies: { vue: '^3.0.0' },
        }),
      )
      expect(detectFramework(dir, 'typescript')).toBe('tauri+vue')
    })

    it('detects from devDependencies', () => {
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({
          devDependencies: { vue: '^3.0.0' },
        }),
      )
      expect(detectFramework(dir, 'typescript')).toBe('vue')
    })

    it('returns null for empty package.json', () => {
      writeFileSync(join(dir, 'package.json'), '{}')
      expect(detectFramework(dir, 'typescript')).toBeNull()
    })
  })

  describe('rust', () => {
    beforeEach(() => {
      dir = createTestProject('rust')
    })

    it('detects tauri from src-tauri directory', () => {
      mkdirSync(join(dir, 'src-tauri'))
      expect(detectFramework(dir, 'rust')).toBe('tauri')
    })

    it('returns null when no src-tauri', () => {
      expect(detectFramework(dir, 'rust')).toBeNull()
    })
  })

  describe('java', () => {
    beforeEach(() => {
      dir = createTestProject('java')
    })

    it('detects spring-boot from build.gradle', () => {
      writeFileSync(join(dir, 'build.gradle'), 'id "spring-boot" version "3.0.0"')
      expect(detectFramework(dir, 'java')).toBe('spring-boot')
    })

    it('detects quarkus from build.gradle', () => {
      writeFileSync(join(dir, 'build.gradle'), 'id "io.quarkus"')
      expect(detectFramework(dir, 'java')).toBe('quarkus')
    })

    it('returns java for plain gradle project', () => {
      writeFileSync(join(dir, 'build.gradle'), 'plugins { id "java" }')
      expect(detectFramework(dir, 'java')).toBe('java')
    })

    it('detects spring-boot from pom.xml', () => {
      writeFileSync(
        join(dir, 'pom.xml'),
        '<parent><artifactId>spring-boot-starter-parent</artifactId></parent>',
      )
      expect(detectFramework(dir, 'java')).toBe('spring-boot')
    })
  })

  describe('other languages', () => {
    beforeEach(() => {
      dir = createTestProject('go')
    })

    it('returns null for go', () => {
      expect(detectFramework(dir, 'go')).toBeNull()
    })

    it('returns null for python', () => {
      expect(detectFramework(dir, 'python')).toBeNull()
    })

    it('returns null for unknown', () => {
      expect(detectFramework(dir, 'unknown')).toBeNull()
    })
  })
})

describe('detectArchetypeHint', () => {
  const ANY_DIR = '/does/not/matter'

  describe('framework → backend-web-db mappings', () => {
    const backendCases: Array<[string, string]> = [
      ['java', 'spring-boot'],
      ['java', 'quarkus'],
      ['typescript', 'next'],
      ['typescript', 'express'],
      ['typescript', 'express+react'],
      ['typescript', 'express+vue'],
      ['typescript', 'fastify'],
    ]
    for (const [lang, fw] of backendCases) {
      it(`${lang}:${fw} → backend-web-db`, () => {
        expect(detectArchetypeHint(ANY_DIR, lang as never, fw)).toBe('backend-web-db')
      })
    }
  })

  describe('framework → frontend-spa mappings', () => {
    const frontendCases: Array<[string, string]> = [
      ['typescript', 'tauri+react'],
      ['typescript', 'tauri+vue'],
      ['typescript', 'tauri'],
      ['typescript', 'react'],
      ['typescript', 'vue'],
      ['rust', 'tauri'],
    ]
    for (const [lang, fw] of frontendCases) {
      it(`${lang}:${fw} → frontend-spa`, () => {
        expect(detectArchetypeHint(ANY_DIR, lang as never, fw)).toBe('frontend-spa')
      })
    }
  })

  describe('language fallbacks (no framework match)', () => {
    it('java with unmapped framework falls back to library', () => {
      expect(detectArchetypeHint(ANY_DIR, 'java', 'java')).toBe('library')
    })

    it('typescript with null framework falls back to library', () => {
      expect(detectArchetypeHint(ANY_DIR, 'typescript', null)).toBe('library')
    })

    it('rust with null framework falls back to library', () => {
      expect(detectArchetypeHint(ANY_DIR, 'rust', null)).toBe('library')
    })

    it('rust with unmapped framework falls back to library', () => {
      expect(detectArchetypeHint(ANY_DIR, 'rust', 'actix-web')).toBe('library')
    })
  })

  describe('languages with no reliable archetype heuristic return null', () => {
    it('go returns null', () => {
      expect(detectArchetypeHint(ANY_DIR, 'go', null)).toBeNull()
    })

    it('python returns null', () => {
      expect(detectArchetypeHint(ANY_DIR, 'python', null)).toBeNull()
    })

    it('unknown returns null', () => {
      expect(detectArchetypeHint(ANY_DIR, 'unknown', null)).toBeNull()
    })
  })
})
