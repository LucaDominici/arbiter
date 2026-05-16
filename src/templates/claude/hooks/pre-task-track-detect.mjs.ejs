#!/usr/bin/env node
// Arbiter hook: detect task track from changed files + prompt keywords (#720)
// Hook type: UserPromptSubmit — fires before every user prompt
// stdout injected as context Claude sees before responding; always exits 0
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

let promptText = '';
try {
  const raw = readFileSync(0, 'utf-8');
  promptText = JSON.parse(raw)?.prompt ?? '';
} catch {
  process.exit(0);
}

// Detect track from staged + unstaged changed files
const diff = spawnSync('git', ['diff', '--name-only', 'HEAD'], { encoding: 'utf-8' });
const staged = spawnSync('git', ['diff', '--name-only', '--cached'], { encoding: 'utf-8' });
const files = [
  ...(diff.stdout ?? '').split('\n'),
  ...(staged.stdout ?? '').split('\n'),
].filter(Boolean);

const FE_RE = /\.(tsx?|jsx?|vue|svelte|css|scss|html)$|^(web|frontend)\//;
const BE_RE = /\.(go|py|java|rs|rb|php)$|^(api|backend|server|cmd)\//;
const DOCS_RE = /\.md$|^docs\//;

const isFE = files.some((f) => FE_RE.test(f)) || /frontend|component|css|ui |ux /i.test(promptText);
const isBE = files.some((f) => BE_RE.test(f)) || /backend|api |endpoint|database|service/i.test(promptText);
const isDocs = files.some((f) => DOCS_RE.test(f));

const tracks = [];
if (isFE) tracks.push('frontend');
if (isBE) tracks.push('backend');
if (isDocs) tracks.push('docs');

if (tracks.length === 0) process.exit(0);

process.stdout.write(
  `[context-economy] Track: ${tracks.join(' + ')}\n` +
  `Read .claude/knowledge-map.json for required docs per track.\n`,
);
