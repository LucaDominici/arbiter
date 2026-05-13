import { runCli } from '../utils/run-cli.js'

export interface GitInfo {
  isGitRepo: boolean
  remoteUrl: string | null
  githubOwner: string | null
  githubRepo: string | null
  projectName: string | null
}

export function detectGitInfo(dir: string): GitInfo {
  const isGitRepo = runCmd('git', ['rev-parse', '--is-inside-work-tree'], dir) === 'true'
  if (!isGitRepo) {
    return {
      isGitRepo: false,
      remoteUrl: null,
      githubOwner: null,
      githubRepo: null,
      projectName: null,
    }
  }

  const remoteUrl = runCmd('git', ['remote', 'get-url', 'origin'], dir)
  const { owner, repo } = parseGithubUrl(remoteUrl ?? '')

  return {
    isGitRepo: true,
    remoteUrl,
    githubOwner: owner,
    githubRepo: repo,
    projectName: repo,
  }
}

// Repo names with dots (e.g. `my.project`) were previously truncated because the prior
// pattern excluded `.` from the repo capture group. The anchored optional `.git` suffix
// already covers the only legitimate trailing dot. (#278 finding #5)
const SSH_RE = /git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/
const HTTPS_RE = /github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/

function parseGithubUrl(url: string): {
  owner: string | null
  repo: string | null
} {
  const sshMatch = SSH_RE.exec(url)
  if (sshMatch) return { owner: sshMatch[1] ?? null, repo: sshMatch[2] ?? null }

  const httpsMatch = HTTPS_RE.exec(url)
  if (httpsMatch) return { owner: httpsMatch[1] ?? null, repo: httpsMatch[2] ?? null }

  return { owner: null, repo: null }
}

function runCmd(cmd: string, args: string[], cwd: string): string | null {
  try {
    return runCli(cmd, args, { cwd }).stdout.trim()
  } catch {
    return null
  }
}
