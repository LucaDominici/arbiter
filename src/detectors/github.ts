import { execFileSync } from 'node:child_process';

export interface GithubAccess {
  available: boolean;
  authenticated: boolean;
  username: string | null;
  error: string | null;
}

export function detectGithubAccess(): GithubAccess {
  // Check gh CLI is installed
  const ghVersion = runCmd('gh', ['--version']);
  if (ghVersion === null) {
    return { available: false, authenticated: false, username: null, error: 'gh CLI not found. Install from https://cli.github.com' };
  }

  // Check authentication
  const authStatus = runCmd('gh', ['auth', 'status', '--json', 'loggedIn,activeToken,user']);
  if (authStatus === null) {
    return { available: true, authenticated: false, username: null, error: 'Not authenticated. Run: gh auth login' };
  }

  try {
    const parsed = JSON.parse(authStatus) as { loggedIn?: boolean; user?: { login?: string } };
    if (parsed.loggedIn === false) {
      return { available: true, authenticated: false, username: null, error: 'Not authenticated. Run: gh auth login' };
    }
    return {
      available: true,
      authenticated: true,
      username: parsed.user?.login ?? null,
      error: null,
    };
  } catch {
    // gh auth status has different output format depending on version - try simpler check
    const simpleStatus = runCmd('gh', ['auth', 'status']);
    const isAuthed = simpleStatus !== null && simpleStatus.includes('Logged in');
    return {
      available: true,
      authenticated: isAuthed,
      username: null,
      error: isAuthed ? null : 'Not authenticated. Run: gh auth login',
    };
  }
}

function runCmd(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
  } catch {
    return null;
  }
}
