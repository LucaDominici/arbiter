import { existsSync } from "node:fs";
import { join } from "node:path";

export interface ExistingState {
  agentsMd: boolean;
  claudeDir: boolean;
  agentsDir: boolean;
  aiRulez: boolean;
  settingsJson: boolean;
  checkAllSh: boolean;
}

export function detectExisting(dir: string): ExistingState {
  return {
    agentsMd: existsSync(join(dir, "AGENTS.md")),
    claudeDir: existsSync(join(dir, ".claude")),
    agentsDir: existsSync(join(dir, ".agents")),
    aiRulez:
      existsSync(join(dir, ".ai-rulez")) ||
      existsSync(join(dir, "ai-rulez.yml")),
    settingsJson: existsSync(join(dir, ".claude", "settings.json")),
    checkAllSh: existsSync(join(dir, "scripts", "check-all.sh")),
  };
}
