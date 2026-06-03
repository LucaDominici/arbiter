// SPDX-License-Identifier: Apache-2.0
// #1122 Phase 2: `arbiter tui` — an arrow-key umbrella menu that routes to the
// interactive-enabled command surfaces (configure, settings, doctor,
// upgrade-level). Transactional, not a full-screen dashboard: pick an action,
// it runs, you return to the menu. Exit via the menu entry, Escape, or ^C.

import { intro, outro, select, isCancel, cancel } from '@clack/prompts'
import { runSettings } from './settings.js'

export interface TuiOptions {
  dir?: string
}

type TuiAction = 'configure' | 'settings' | 'doctor' | 'upgrade' | 'exit'

const MENU: { value: TuiAction; label: string; hint: string }[] = [
  { value: 'configure', label: 'Configure', hint: 'edit arbiter.json interactively' },
  { value: 'settings', label: 'Settings', hint: 'list all settable paths + values' },
  { value: 'doctor', label: 'Doctor', hint: 'project health check' },
  { value: 'upgrade', label: 'Upgrade level', hint: 'raise governance level' },
  { value: 'exit', label: 'Exit', hint: 'leave the menu' },
]

/** Dispatch a single chosen action. Returns false when the user chose to exit. */
async function dispatch(action: TuiAction, dir: string | undefined): Promise<boolean> {
  switch (action) {
    case 'configure': {
      const { runInteractiveConfigure } = await import('./configure-interactive.js')
      await runInteractiveConfigure(dir)
      return true
    }
    case 'settings':
      runSettings({ ...(dir !== undefined ? { dir } : {}) })
      return true
    case 'doctor': {
      const { runDoctorHealth } = await import('./doctor.js')
      await runDoctorHealth({ ...(dir !== undefined ? { dir } : {}), json: false, repair: false })
      return true
    }
    case 'upgrade': {
      const { runUpgradeLevel } = await import('./upgrade-level.js')
      await runUpgradeLevel({ ...(dir !== undefined ? { dir } : {}), extend: false, json: false })
      return true
    }
    case 'exit':
      return false
  }
}

/** Run the interactive umbrella menu. Requires a TTY (caller guards). */
export async function runTui(opts: TuiOptions = {}): Promise<void> {
  intro('arbiter tui')
  for (;;) {
    const action = await select({
      message: 'What would you like to do?',
      options: MENU.map((m) => ({ value: m.value, label: m.label, hint: m.hint })),
    })
    if (isCancel(action)) {
      cancel('Cancelled.')
      return
    }
    const keepGoing = await dispatch(action, opts.dir)
    if (!keepGoing) break
  }
  outro('Done.')
}
