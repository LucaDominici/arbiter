import { execFileSync } from 'node:child_process';

export interface GitInfo {
  isGitRepo: boolean;
  remoteUrl: string | null;
  githubOwner: string | null;
  githubRepo: string | null;
  projectName: string | null;
}

export function detectGitInfo(dir: string): GitInfo {
  const isGitRepo = runCmd('git', ['rev-parse', '--is-inside-work-tree'], dir) === 'true';
  if (!isGitRepo) {
    return { isGitRepo: false, remoteUrl: null, githubOwner: null, githubRepo: null, projectName: null };
  }

  const remoteUrl = runCmd('git', ['remote', 'get-url', 'origin'], dir);
  const { owner, repo } = parseGithubUrl(remoteUrl ?? '');

  return {
    isGitRepo: true,
    remoteUrl,
    githubOwner: owner,
    githubRepo: repo,
    projectName: repo,
  };
}

function parseGithubUrl(url: string): { owner: string | null; repo: string | null } {
  const sshMatch = /git@github\.com:([^/]+)\/([^.]+)(?:\.git)?/.exec(url);
  if (sshMatch) return { owner: sshMatch[1] ?? null, repo: sshMatch[2] ?? null };

  const httpsMatch = /github\.com\/([^/]+)\/([^/.]+)(?:\.git)?/.exec(url);
  if (httpsMatch) return { owner: httpsMatch[1] ?? null, repo: httpsMatch[2] ?? null };

  return { owner: null, repo: null };
}

function runCmd(cmd: string, args: string[], cwd: string): string | null {
  try {
    return execFileSync(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
  } catch {
    return null;
  }
}
