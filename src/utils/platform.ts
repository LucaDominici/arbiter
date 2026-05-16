// SPDX-License-Identifier: Apache-2.0
export function isWindows(): boolean {
  return process.platform === 'win32'
}

export function isWSL2(): boolean {
  return (
    typeof process.env.WSL_DISTRO_NAME === 'string' ||
    (typeof process.env.WSLENV === 'string' && process.env.WSLENV.length > 0) ||
    typeof process.env.WSL_INTEROP === 'string'
  )
}
