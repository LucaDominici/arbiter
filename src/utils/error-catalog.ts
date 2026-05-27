// SPDX-License-Identifier: Apache-2.0

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
      summary: 'arbiter.json is invalid after the requested changes',
      detail:
        'The resulting configuration would fail schema validation. This typically means a required field is missing or a value is out of range.',
      recovery:
        'Fix the configuration errors listed above, or delete arbiter.json and re-run `arbiter init`.',
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
        'Check the error details above. Remove the failing plugin with `arbiter plugin remove <name>` and retry.',
      docUrl: 'https://arbiter.dev/reference/cli#plugin',
    },
  ],
  [
    'E_WORK_NOT_FOUND',
    {
      code: 'E_WORK_NOT_FOUND',
      summary: 'Work unit not found',
      detail: 'The requested work unit ID does not exist in the current decomposition.',
      recovery: 'Run `arbiter work list` to see available work unit IDs.',
      docUrl: 'https://arbiter.dev/reference/cli#work',
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
        'Check that the plugin package is installed and compatible with the current arbiter version. Run `npm ls` to verify plugin dependencies.',
      docUrl: 'https://arbiter.dev/reference/cli#plugins',
    },
  ],
])
