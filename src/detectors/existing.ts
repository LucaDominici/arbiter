import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface ExistingState {
  agentsMd: boolean
  claudeDir: boolean
  agentsDir: boolean
  aiRulez: boolean
  settingsJson: boolean
  checkAllScript: boolean
  geminiDir: boolean
  windsurfRules: boolean
  aiderConf: boolean
}

export function detectExisting(dir: string): ExistingState {
  return {
    agentsMd: existsSync(join(dir, 'AGENTS.md')),
    claudeDir: existsSync(join(dir, '.claude')),
    agentsDir: existsSync(join(dir, '.agents')),
    aiRulez: existsSync(join(dir, '.ai-rulez')) || existsSync(join(dir, 'ai-rulez.yml')),
    settingsJson: existsSync(join(dir, '.claude', 'settings.json')),
    checkAllScript:
      existsSync(join(dir, 'scripts', 'check-all.mjs')) ||
      existsSync(join(dir, 'scripts', 'check-all.sh')),
    geminiDir: existsSync(join(dir, '.gemini')),
    windsurfRules: existsSync(join(dir, 'windsurf-instructions.md')),
    aiderConf: existsSync(join(dir, '.aider.conf.yml')),
  }
}
