// SPDX-License-Identifier: Apache-2.0

// #1735: shared doc anchor for the 10 fs-errno entries below (avoids sonarjs/no-duplicate-string).
const FS_ERRNO_DOC_URL = 'https://arbiter.dev/reference/cli#filesystem-errors'

export interface ErrorEntry {
  code: string
  summary: string
  detail: string
  recovery: string
  docUrl?: string
}

export const ERROR_CATALOG: ReadonlyMap<string, ErrorEntry> = new Map([
  [
    'E_CONFIG_NOT_FOUND',
    {
      code: 'E_CONFIG_NOT_FOUND',
      summary: 'No arbiter.json found',
      detail:
        'This error occurs when an arbiter command cannot find the project configuration file (arbiter.json) in the current directory.',
      recovery: 'Run `arbiter init` to initialize AI governance in this directory.',
      docUrl: 'https://arbiter.dev/reference/cli#init',
    },
  ],
  [
    'E_CONFIG_INVALID',
    {
      code: 'E_CONFIG_INVALID',
      summary: 'arbiter.json is invalid and could not be auto-migrated',
      detail:
        'A closed set of stale/renamed fields (e.g. an old contractType flavor or tools value) is coerced to a safe default automatically — that path only logs a WARN, it never throws. This error also covers a present invalid governanceLevel: because it defines what “green” means, it fails closed like a JSON syntax error. Other fatal cases include arbiter.json not being an object or a field that directly controls gate/threshold strictness (features, thresholds, decomposition, frontend, automation, …) having an unrecoverable shape.',
      recovery:
        'Fix the configuration errors listed above, or delete arbiter.json and re-run `arbiter init`. If a WARN about coerced fields appeared on a previous run, run `arbiter configure` to persist the cleaned-up values.',
      docUrl: 'https://arbiter.dev/reference/cli#configure',
    },
  ],
  [
    'E_INVALID_TOOL',
    {
      code: 'E_INVALID_TOOL',
      summary: 'Unknown AI tool name',
      detail: 'The --tools flag received a value that is not a recognized AI tool identifier.',
      recovery:
        'Valid tools: claude, codex, cursor, copilot, gemini, windsurf, aider. Example: `arbiter init --tools claude,codex`.',
      docUrl: 'https://arbiter.dev/reference/cli#init',
    },
  ],
  [
    'E_INVALID_LEVEL',
    {
      code: 'E_INVALID_LEVEL',
      summary: 'Unknown governance level',
      detail: 'The --level flag received a value that is not L1, L2, or L3.',
      recovery:
        'Use one of: L1 (fast/minimal), L2 (standard, default), L3 (audit-grade). Example: `arbiter init --level L2`.',
      docUrl: 'https://arbiter.dev/reference/cli#governance-levels',
    },
  ],
  [
    'E_INVALID_ARCHETYPE',
    {
      code: 'E_INVALID_ARCHETYPE',
      summary: 'Invalid project archetype',
      detail: 'The archetype value is not in the supported archetype list.',
      recovery: 'Run `arbiter configure --help` for a list of valid archetypes.',
      docUrl: 'https://arbiter.dev/reference/cli#configure',
    },
  ],
  [
    'E_INVALID_BOOL',
    {
      code: 'E_INVALID_BOOL',
      summary: 'Expected true or false',
      detail: 'A configuration field that requires a boolean received something else.',
      recovery:
        'Use `true` or `false` (lowercase). Example: `arbiter configure --set features.debtGates=true`.',
      docUrl: 'https://arbiter.dev/reference/cli#configure',
    },
  ],
  [
    'E_INVALID_NUMBER',
    {
      code: 'E_INVALID_NUMBER',
      summary: 'Expected a number',
      detail: 'A configuration field that requires a number received a non-numeric value.',
      recovery:
        'Provide an integer or decimal. Example: `arbiter configure --set thresholds.lineCoverage=80`.',
      docUrl: 'https://arbiter.dev/reference/cli#configure',
    },
  ],
  [
    'E_INVALID_FORMAT',
    {
      code: 'E_INVALID_FORMAT',
      summary: 'Invalid --set format',
      detail: 'The --set argument must use the form `path=value`.',
      recovery: 'Example: `arbiter configure --set tools=claude,codex`.',
      docUrl: 'https://arbiter.dev/reference/cli#configure',
    },
  ],
  [
    'E_UNKNOWN_PATH',
    {
      code: 'E_UNKNOWN_PATH',
      summary: 'Unknown configuration path',
      detail: 'The dotted path used in --set does not correspond to any known configuration key.',
      recovery: 'Run `arbiter configure --help` to see valid paths.',
      docUrl: 'https://arbiter.dev/reference/cli#configure',
    },
  ],
  [
    'E_TARGET_REQUIRED',
    {
      code: 'E_TARGET_REQUIRED',
      summary: '--target is required for upgrade-level',
      detail: 'The upgrade-level command needs to know which level to upgrade to.',
      recovery: 'Specify `--target L2` or `--target L3`.',
      docUrl: 'https://arbiter.dev/reference/cli#upgrade-level',
    },
  ],
  [
    'E_ALREADY_AT_LEVEL',
    {
      code: 'E_ALREADY_AT_LEVEL',
      summary: 'Already at the target governance level',
      detail: 'The project is already configured at the requested level — nothing to upgrade.',
      recovery: 'If you want to regenerate governance files, run `arbiter update` instead.',
      docUrl: 'https://arbiter.dev/reference/cli#upgrade-level',
    },
  ],
  [
    'E_DOWNGRADE_NOT_SUPPORTED',
    {
      code: 'E_DOWNGRADE_NOT_SUPPORTED',
      summary: 'Downgrading governance level is not supported via upgrade-level',
      detail:
        'arbiter does not automatically downgrade governance because that removes enforced checks.',
      recovery:
        'Edit `governanceLevel` in arbiter.json manually, then run `arbiter update` to regenerate files.',
      docUrl: 'https://arbiter.dev/reference/cli#upgrade-level',
    },
  ],
  [
    'E_GRACE_NOT_SUPPORTED',
    {
      code: 'E_GRACE_NOT_SUPPORTED',
      summary: 'Grace periods are only supported for L1 to L2 upgrades',
      detail:
        'The generated gate implements grace-period warning mode only when a project moves from L1 to L2 (ADR-028).',
      recovery:
        'To move to a higher level, run `arbiter configure --set governanceLevel=<L3|L4>` followed by `arbiter update`.',
      docUrl: 'https://arbiter.dev/reference/cli#upgrade-level',
    },
  ],
  [
    'E_NO_GRACE_PERIOD',
    {
      code: 'E_NO_GRACE_PERIOD',
      summary: 'No active grace period to extend',
      detail: 'The `--extend` flag requires an existing, non-expired grace period.',
      recovery: 'Run `arbiter upgrade-level --target L2` first to start a new grace period.',
      docUrl: 'https://arbiter.dev/reference/cli#upgrade-level',
    },
  ],
  [
    'E_GRACE_LOG_MALFORMED',
    {
      code: 'E_GRACE_LOG_MALFORMED',
      summary: 'grace-log.json is malformed',
      detail: 'The grace period log file exists but cannot be parsed as expected JSON.',
      recovery: 'Delete the grace-log.json file noted in the error message and re-run.',
      docUrl: 'https://arbiter.dev/reference/cli#upgrade-level',
    },
  ],
  [
    'E_PLUGIN_FAILED',
    {
      code: 'E_PLUGIN_FAILED',
      summary: 'One or more plugins failed during init',
      detail: 'A third-party arbiter plugin threw an error during the init run.',
      recovery:
        'Remove the failing plugin from the `plugins` array in arbiter.json, then re-run `arbiter update`.',
      docUrl: 'https://arbiter.dev/reference/cli#plugin',
    },
  ],
  [
    'E_PLUGIN_UNRESOLVABLE',
    {
      code: 'E_PLUGIN_UNRESOLVABLE',
      summary: '`plugin add` could not load the given package or path',
      detail:
        'The package/path passed to `arbiter plugin add` did not resolve or failed plugin-loader validation. arbiter.json was not modified.',
      recovery:
        'Verify the package name or path is correct and, for an npm package, that it installed successfully.',
      docUrl: 'https://arbiter.dev/reference/cli#plugin',
    },
  ],
  [
    'E_JSON_REQUIRES_YES',
    {
      code: 'E_JSON_REQUIRES_YES',
      summary: '--json requires --yes',
      detail:
        'The interactive wizard reads stdin, which is incompatible with machine-readable output.',
      recovery: 'Add `--yes` to skip the wizard: `arbiter init --yes --json`.',
      docUrl: 'https://arbiter.dev/reference/cli#init',
    },
  ],
  [
    'E_TASK_NOT_FOUND',
    {
      code: 'E_TASK_NOT_FOUND',
      summary: 'Task not found',
      detail: 'The requested task ID does not exist in the current task store.',
      recovery: 'Run `arbiter task list` to see available task IDs.',
      docUrl: 'https://arbiter.dev/reference/cli#task',
    },
  ],
  [
    'E_INVALID_PHASE',
    {
      code: 'E_INVALID_PHASE',
      summary: 'Invalid task phase',
      detail: 'The --to flag received a phase name that does not exist in the phase sequence.',
      recovery: 'Run `arbiter task advance --help` to see valid phase names.',
      docUrl: 'https://arbiter.dev/reference/cli#task',
    },
  ],
  [
    'E_GH_NOT_INSTALLED',
    {
      code: 'E_GH_NOT_INSTALLED',
      summary: 'GitHub CLI (gh) binary not found',
      detail:
        'arbiter tried to run a GitHub API operation but the `gh` CLI binary is not installed or not on PATH.',
      recovery:
        'Install the GitHub CLI: https://cli.github.com — then run `gh auth login` to authenticate.',
      docUrl: 'https://arbiter.dev/reference/cli#github-setup',
    },
  ],
  [
    'E_GH_RECOVERABLE',
    {
      code: 'E_GH_RECOVERABLE',
      summary: 'One or more GitHub API calls failed (recoverable)',
      detail:
        'A GitHub API call failed with a non-fatal error (e.g. label already exists, branch-protection requires admin access that you do not have). The command completed partial provisioning; see the list of failures above.',
      recovery:
        'Retry after granting the required permissions, or run `arbiter update --github` again once access is available.',
      docUrl: 'https://arbiter.dev/reference/cli#github-setup',
    },
  ],
  [
    'E_GH_FATAL',
    {
      code: 'E_GH_FATAL',
      summary: 'GitHub API call failed with a fatal error',
      detail:
        'A GitHub API call failed with an unrecoverable error (e.g. authentication token missing or revoked, network timeout). The command was halted.',
      recovery:
        'Run `gh auth login` to re-authenticate, then retry. Check your network connectivity.',
      docUrl: 'https://arbiter.dev/reference/cli#github-setup',
    },
  ],
  [
    'E_PLUGIN_FATAL',
    {
      code: 'E_PLUGIN_FATAL',
      summary: 'A plugin failed during command execution',
      detail:
        'A plugin raised a fatal error during generator execution (e.g. missing dependency, load failure, or runtime exception). The command was halted.',
      recovery:
        'Remove the failing plugin from the `plugins` array in arbiter.json, then re-run `arbiter update`.',
      docUrl: 'https://arbiter.dev/reference/cli#plugins',
    },
  ],
  // #1735 (CANON-17): every errno translated by FS_ERROR_KEYS in src/utils/fs.ts
  // needs a matching entry here — otherwise `arbiter explain <errno>` returns
  // unknown-code and the ArbiterError footer's hint is a dead end (#1717).
  [
    'ENOSPC',
    {
      code: 'ENOSPC',
      summary: 'Disk full',
      detail: 'A write failed because the filesystem ran out of space.',
      recovery: 'Free up disk space (check with `df -h`) and retry.',
      docUrl: FS_ERRNO_DOC_URL,
    },
  ],
  [
    'EACCES',
    {
      code: 'EACCES',
      summary: 'Permission denied',
      detail: 'An fs operation failed because the process lacks permission for the target path.',
      recovery: 'Check file ownership and directory permissions, then retry.',
      docUrl: FS_ERRNO_DOC_URL,
    },
  ],
  [
    'EROFS',
    {
      code: 'EROFS',
      summary: 'Read-only filesystem',
      detail: 'A write failed because the target filesystem is mounted read-only.',
      recovery: 'Check mount options (e.g. `mount | grep <device>`) and remount read-write.',
      docUrl: FS_ERRNO_DOC_URL,
    },
  ],
  [
    'EDQUOT',
    {
      code: 'EDQUOT',
      summary: 'Disk quota exceeded',
      detail: 'A write failed because the user or project disk quota has been exceeded.',
      recovery: 'Free up space or ask an administrator to raise your disk quota.',
      docUrl: FS_ERRNO_DOC_URL,
    },
  ],
  [
    'EPERM',
    {
      code: 'EPERM',
      summary: 'Operation not permitted',
      detail:
        'A write failed for a reason other than plain permission bits — e.g. an immutable file attribute, SELinux/AppArmor policy, or ACL.',
      recovery: 'Check the immutable bit (`lsattr`), SELinux/AppArmor context, and ACLs.',
      docUrl: FS_ERRNO_DOC_URL,
    },
  ],
  [
    'ENOTDIR',
    {
      code: 'ENOTDIR',
      summary: 'Not a directory',
      detail:
        'An fs operation failed because a component of the target path is a file, not a directory.',
      recovery: 'Check the target path — an intermediate segment exists as a file.',
      docUrl: FS_ERRNO_DOC_URL,
    },
  ],
  [
    'EISDIR',
    {
      code: 'EISDIR',
      summary: 'Is a directory',
      detail: 'An fs operation failed because the target path is a directory, not a file.',
      recovery: 'Point the command at a file path, not a directory.',
      docUrl: FS_ERRNO_DOC_URL,
    },
  ],
  [
    'ENOENT',
    {
      code: 'ENOENT',
      summary: 'No such file or directory',
      detail:
        'An fs operation failed because the target path (or its parent directory) does not exist.',
      recovery: 'Create the parent directory first, e.g. `mkdir -p <dir>`, then retry.',
      docUrl: FS_ERRNO_DOC_URL,
    },
  ],
  [
    'EBUSY',
    {
      code: 'EBUSY',
      summary: 'Resource busy or locked',
      detail:
        'An fs operation failed because the target file is open or locked by another process.',
      recovery: 'Close the file in the other process and retry.',
      docUrl: FS_ERRNO_DOC_URL,
    },
  ],
  [
    'EMFILE',
    {
      code: 'EMFILE',
      summary: 'Too many open files',
      detail: 'An fs operation failed because the process hit its open-file-descriptor limit.',
      recovery: 'Close other open files or raise the limit with `ulimit -n`, then retry.',
      docUrl: FS_ERRNO_DOC_URL,
    },
  ],
  [
    'E_GATE_MUTEX_UNSUPPORTED',
    {
      code: 'E_GATE_MUTEX_UNSUPPORTED',
      summary: 'flock(1) unavailable — gate mutex unsupported on this platform',
      detail:
        '`arbiter gate-exec` delegates the per-repo gate mutex to util-linux flock(1) because ' +
        'the kernel-backed lock survives killing the Arbiter Node PID alone and releases after ' +
        'the gate-exec supervisor is SIGKILL/OOM-killed and its process group is torn down. On platforms ' +
        'without flock (macOS base system, Windows) the mutex cannot be provided safely, and a ' +
        'lockfile emulation would reintroduce the SIGKILL hole — so gate-exec fails closed (ADR-103).',
      recovery:
        'Run the wave serially (`--max-parallel 1` — no mutex needed), or install flock ' +
        '(util-linux) and retry.',
    },
  ],
])
