import { writeFile as plainWrite, type WriteResult } from "../utils/fs.js";
import { writeVaultFile } from "../utils/vault-sync.js";

export interface ObsidianVaultOptions {
  syncMode: boolean;
  force: boolean;
}

export const DEFAULT_VAULT_OPTIONS: ObsidianVaultOptions = {
  syncMode: false,
  force: false,
};

export function writeVaultOutput(
  path: string,
  content: string,
  opts: ObsidianVaultOptions,
): WriteResult {
  if (opts.syncMode) {
    return writeVaultFile(path, content, { force: opts.force });
  }
  return plainWrite(path, content, { skipIfExists: false });
}
