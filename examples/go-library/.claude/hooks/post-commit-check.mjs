#!/usr/bin/env node
// Arbiter hook: block non-conventional commit messages after git commit (INV-22)
// Fires on: PostToolUse → Bash
import { spawnSync } from 'node:child_process';
import { resolveToolInputCommand } from './lib.mjs';

// Resolve the command from stdin-JSON (real Claude Code) or the env var (Codex).
// Reading only the env var made this guard silently inert under Claude Code (#1565).
const command = resolveToolInputCommand();

// Only act on git commit commands
if (!/^git commit/.test(command)) process.exit(0);

// Get last commit message
const result = spawnSync('git', ['log', '-1', '--format=%s'], {
  encoding: 'utf-8',
});
const msg = (result.stdout ?? '').trim();

// git log failed or no commits yet — skip check
if (result.status !== 0 || !msg) process.exit(0);

// Check conventional commit format: type(scope): summary
const CONVENTIONAL =
  /^(feat|fix|refactor|test|docs|ci|chore|perf|style|build|revert)(\([^)]+\))?: .{1,72}$/;
if (!CONVENTIONAL.test(msg)) {
  process.stderr.write(
    `[arbiter] INV-22: Commit message does not follow convention: ${msg}\n`,
  );
  process.stderr.write(
    `[arbiter] Expected: type(scope): summary (e.g., feat(auth): add login)\n`,
  );
  process.stderr.write(`[arbiter] Run \`arbiter explain INV-22\` for details.\n`);
  process.exit(2);
}

// Track-aware post-commit checklist (#724)
// CRLF stripped: git diff --name-only can emit CRLF on Windows
const trackDiff = spawnSync('git', ['diff', '--name-only', 'HEAD~1', 'HEAD'], { encoding: 'utf-8' });
const commitFiles = trackDiff.status === 0
  ? (trackDiff.stdout ?? '').split('\n').map((f) => f.replace(/\r/g, '')).filter(Boolean)
  : [];

const FE_RE = /\.(tsx?|jsx?|vue|svelte|css|scss)$|^(web|frontend)\//;
const BE_RE = /\.(go|py|java|rs|rb)$|^(api|backend|server|cmd)\//;
const DOCS_RE = /\.md$|^docs\//;

const hasFE = commitFiles.some((f) => FE_RE.test(f));
const hasBE = commitFiles.some((f) => BE_RE.test(f));
const hasDocs = commitFiles.some((f) => DOCS_RE.test(f));

const tracks = [];
if (hasFE) tracks.push('frontend');
if (hasBE) tracks.push('backend');
if (hasDocs) tracks.push('docs');

if (tracks.length > 0) {
  const label = tracks.length > 1 ? 'Tracks' : 'Track';
  process.stdout.write(`[arbiter] ${label}: ${tracks.join(' + ')}\n`);


if (hasFE) {
  process.stdout.write('  FE: go test -race ./...\n');
  process.stdout.write('  FE: go vet ./... (static analysis)\n');
}

if (hasBE) {
  process.stdout.write('  BE: go test -race ./...\n');
  process.stdout.write('  BE: golangci-lint run (no new warnings)\n');
}

if (hasDocs) {
  process.stdout.write('  Docs: go doc ./... (check godoc compiles)\n');
  process.stdout.write('  Docs: verify internal links resolve\n');
}

}
