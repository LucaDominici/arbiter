import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectBuildCommands } from '../../src/detectors/build.js';
import { createTestProject, cleanupTestProject } from '../helpers.js';

describe('detectBuildCommands', () => {
  let dir: string;

  afterEach(() => { cleanupTestProject(dir); });

  describe('typescript', () => {
    beforeEach(() => { dir = createTestProject('typescript'); });

    it('detects build/test/lint from package.json scripts', () => {
      const result = detectBuildCommands(dir, 'typescript');
      expect(result.buildTool).toBe('npm');
      expect(result.buildCommand).toBe('npm run build');
      expect(result.testCommand).toBe('npm run test');
      expect(result.lintCommand).toBe('npm run lint');
    });

    it('detects prettier when present in dependencies', () => {
      const result = detectBuildCommands(dir, 'typescript');
      expect(result.formatCommand).toBe('npx prettier --check .');
    });

    it('falls back when no scripts exist', () => {
      writeFileSync(join(dir, 'package.json'), '{}');
      const result = detectBuildCommands(dir, 'typescript');
      expect(result.buildCommand).toBe('npm run build');
      expect(result.testCommand).toBe('npm test');
    });

    it('reports no lint when lint script missing', () => {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { build: 'tsc' } }));
      const result = detectBuildCommands(dir, 'typescript');
      expect(result.lintCommand).toBe('echo "no lint configured"');
    });

    it('reports no formatter when prettier absent', () => {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: {}, devDependencies: {} }));
      const result = detectBuildCommands(dir, 'typescript');
      expect(result.formatCommand).toBe('echo "no formatter configured"');
    });
  });

  describe('rust', () => {
    beforeEach(() => { dir = createTestProject('rust'); });

    it('uses cargo commands', () => {
      const result = detectBuildCommands(dir, 'rust');
      expect(result.buildTool).toBe('cargo');
      expect(result.buildCommand).toBe('cargo build');
      expect(result.testCommand).toBe('cargo test');
      expect(result.lintCommand).toContain('cargo clippy');
      expect(result.lintCommand).toContain('-D warnings');
      expect(result.formatCommand).toContain('cargo fmt');
      expect(result.formatCommand).toContain('--check');
    });
  });

  describe('java', () => {
    beforeEach(() => { dir = createTestProject('java'); });

    it('uses gradle with wrapper when gradlew exists', () => {
      writeFileSync(join(dir, 'gradlew'), '#!/bin/sh');
      const result = detectBuildCommands(dir, 'java');
      expect(result.buildTool).toBe('gradle');
      expect(result.buildCommand).toBe('./gradlew build -x test');
      expect(result.testCommand).toBe('./gradlew test');
      expect(result.lintCommand).toBe('./gradlew checkstyleMain');
    });

    it('uses gradle without wrapper when gradlew missing', () => {
      const result = detectBuildCommands(dir, 'java');
      expect(result.buildCommand).toBe('gradle build -x test');
      expect(result.testCommand).toBe('gradle test');
    });
  });

  describe('go', () => {
    beforeEach(() => { dir = createTestProject('go'); });

    it('uses go commands', () => {
      const result = detectBuildCommands(dir, 'go');
      expect(result.buildTool).toBe('go');
      expect(result.buildCommand).toBe('go build ./...');
      expect(result.testCommand).toBe('go test ./...');
      expect(result.lintCommand).toBe('golangci-lint run');
      expect(result.formatCommand).toBe('gofmt -l .');
    });
  });

  describe('python', () => {
    beforeEach(() => { dir = createTestProject('python'); });

    it('uses pip/pytest/ruff commands', () => {
      const result = detectBuildCommands(dir, 'python');
      expect(result.buildTool).toBe('pip');
      expect(result.buildCommand).toBe('pip install -e .');
      expect(result.testCommand).toBe('pytest');
      expect(result.lintCommand).toBe('ruff check .');
      expect(result.formatCommand).toBe('ruff format --check .');
    });
  });

  describe('unknown', () => {
    beforeEach(() => { dir = createTestProject('unknown'); });

    it('returns placeholder commands', () => {
      const result = detectBuildCommands(dir, 'unknown');
      expect(result.buildTool).toBe('unknown');
      expect(result.buildCommand).toContain('configure');
      expect(result.testCommand).toContain('configure');
    });
  });
});
