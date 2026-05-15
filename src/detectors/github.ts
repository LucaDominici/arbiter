// SPDX-License-Identifier: Apache-2.0
import { runCli } from '../utils/run-cli.js'

export interface GithubAccess {
  available: boolean
  authenticated: boolean
  username: string | null
  error: string | null
}

export function detectGithubAccess(): GithubAccess {
  // Check gh CLI is installed
  const ghVersion = runCmd('gh', ['--version'])
  if (ghVersion === null) {
    return {
      available: false,
      authenticated: false,
      username: null,
      error: 'gh CLI not found. Install from https://cli.github.com',
    }
  }

  // Try JSON auth status first (newer gh versions), fall back to text parsing
  const authStatus = runCmd('gh', ['auth', 'status', '--json', 'loggedIn,activeToken,user'])
  if (authStatus !== null) {
    try {
      const parsed = JSON.parse(authStatus) as {
        loggedIn?: boolean
        user?: { login?: string }
      }
      if (parsed.loggedIn === false) {
        return {
          available: true,
          authenticated: false,
          username: null,
          error: 'Not authenticated. Run: gh auth login',
        }
      }
      return {
        available: true,
        authenticated: true,
        username: parsed.user?.login ?? null,
        error: null,
      }
    } catch {
      // fall through to text-based check
    }
  }

  // Text-based fallback (works with all gh versions)
  const textStatus = runCmd('gh', ['auth', 'status'])
  const isAuthed =
    textStatus !== null &&
    (textStatus.includes('Logged in to') || textStatus.includes('Active account: true'))
  const userMatch = /account\s+(\S+)/.exec(textStatus ?? '')
  const username = userMatch?.[1] ?? null
  return {
    available: true,
    authenticated: isAuthed,
    username,
    error: isAuthed ? null : 'Not authenticated. Run: gh auth login',
  }
}

function runCmd(cmd: string, args: string[]): string | null {
  try {
    return runCli(cmd, args).stdout.trim()
  } catch {
    return null
  }
}
