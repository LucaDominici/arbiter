import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { detectFramework } from '../../src/detectors/framework.js';
import { createTestProject, cleanupTestProject } from '../helpers.js';

describe('detectFramework', () => {
  let dir: string;

  afterEach(() => { cleanupTestProject(dir); });

  describe('typescript', () => {
    beforeEach(() => { dir = createTestProject('typescript'); });

    it('detects vue from dependencies', () => {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        dependencies: { vue: '^3.0.0' },
      }));
      expect(detectFramework(dir, 'typescript')).toBe('vue');
    });

    it('detects react from dependencies', () => {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        dependencies: { react: '^18.0.0' },
      }));
      expect(detectFramework(dir, 'typescript')).toBe('react');
    });

    it('detects next from dependencies', () => {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        dependencies: { next: '^14.0.0', react: '^18.0.0' },
      }));
      expect(detectFramework(dir, 'typescript')).toBe('next');
    });

    it('detects express from dependencies', () => {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        dependencies: { express: '^4.0.0' },
      }));
      expect(detectFramework(dir, 'typescript')).toBe('express');
    });

    it('detects express+react combo', () => {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        dependencies: { express: '^4.0.0', react: '^18.0.0' },
      }));
      expect(detectFramework(dir, 'typescript')).toBe('express+react');
    });

    it('detects express+vue combo', () => {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        dependencies: { express: '^4.0.0', vue: '^3.0.0' },
      }));
      expect(detectFramework(dir, 'typescript')).toBe('express+vue');
    });

    it('detects fastify from dependencies', () => {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        dependencies: { fastify: '^4.0.0' },
      }));
      expect(detectFramework(dir, 'typescript')).toBe('fastify');
    });

    it('detects tauri from src-tauri directory', () => {
      mkdirSync(join(dir, 'src-tauri'));
      writeFileSync(join(dir, 'package.json'), '{}');
      expect(detectFramework(dir, 'typescript')).toBe('tauri');
    });

    it('detects tauri+react combo', () => {
      mkdirSync(join(dir, 'src-tauri'));
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        dependencies: { react: '^18.0.0' },
      }));
      expect(detectFramework(dir, 'typescript')).toBe('tauri+react');
    });

    it('detects tauri+vue combo', () => {
      mkdirSync(join(dir, 'src-tauri'));
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        dependencies: { vue: '^3.0.0' },
      }));
      expect(detectFramework(dir, 'typescript')).toBe('tauri+vue');
    });

    it('detects from devDependencies', () => {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        devDependencies: { vue: '^3.0.0' },
      }));
      expect(detectFramework(dir, 'typescript')).toBe('vue');
    });

    it('returns null for empty package.json', () => {
      writeFileSync(join(dir, 'package.json'), '{}');
      expect(detectFramework(dir, 'typescript')).toBeNull();
    });
  });

  describe('rust', () => {
    beforeEach(() => { dir = createTestProject('rust'); });

    it('detects tauri from src-tauri directory', () => {
      mkdirSync(join(dir, 'src-tauri'));
      expect(detectFramework(dir, 'rust')).toBe('tauri');
    });

    it('returns rust when no src-tauri', () => {
      expect(detectFramework(dir, 'rust')).toBe('rust');
    });
  });

  describe('java', () => {
    beforeEach(() => { dir = createTestProject('java'); });

    it('detects spring-boot from build.gradle', () => {
      writeFileSync(join(dir, 'build.gradle'), 'id "spring-boot" version "3.0.0"');
      expect(detectFramework(dir, 'java')).toBe('spring-boot');
    });

    it('detects quarkus from build.gradle', () => {
      writeFileSync(join(dir, 'build.gradle'), 'id "io.quarkus"');
      expect(detectFramework(dir, 'java')).toBe('quarkus');
    });

    it('returns java for plain gradle project', () => {
      writeFileSync(join(dir, 'build.gradle'), 'plugins { id "java" }');
      expect(detectFramework(dir, 'java')).toBe('java');
    });

    it('detects spring-boot from pom.xml', () => {
      writeFileSync(join(dir, 'pom.xml'), '<parent><artifactId>spring-boot-starter-parent</artifactId></parent>');
      expect(detectFramework(dir, 'java')).toBe('spring-boot');
    });
  });

  describe('other languages', () => {
    beforeEach(() => { dir = createTestProject('go'); });

    it('returns null for go', () => {
      expect(detectFramework(dir, 'go')).toBeNull();
    });

    it('returns null for python', () => {
      expect(detectFramework(dir, 'python')).toBeNull();
    });

    it('returns null for unknown', () => {
      expect(detectFramework(dir, 'unknown')).toBeNull();
    });
  });
});
