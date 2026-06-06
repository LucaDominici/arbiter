---
generated: true
source: 'docs/install/windows.md'
source_sha: '0c7f0eb311422d571b4a15c46854f1aba1e1ecc1'
last_updated: '2026-06-06'
---

# Windows Setup (WSL2)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/install/windows.md](../docs/install/windows.md)

# Windows Setup (WSL2)

**Issue:** #543

arbiter does not support native Win32. Use WSL2 (Windows Subsystem for Linux).

---

## Requirements

- Windows 10 version 2004+ or Windows 11
- WSL2 enabled (not WSL1)
- Ubuntu 22.04 or later distribution recommended

---

## Step 1: Enable WSL2

Open PowerShell as Administrator:

```powershell
wsl --install
```

This installs WSL2 + Ubuntu by default. Restart when prompted.

Verify WSL2 is the default version:

```powershell
wsl --set-default-version 2
```

---

## Step 2: Install Node.js inside WSL2

Open the Ubuntu terminal and run:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version  # should print v22.x.x
```

---

## Step 3: Install arbiter

```bash
npm install -g @arbiter/cli
arbiter --version
```

---

## Step 4: Verify your environment

```bash
arbiter doctor
```

All checks should PASS. If `git` is missing:

```bash
sudo apt-get install -y git
```

---

## Step 5: Initialize a project

```bash
cd /path/to/your/project
arbiter init
```

Your Windows filesystem is mounted at `/mnt/c/`. Example:

```bash
cd /mnt/c/Users/YourName/projects/my-app
arbiter init
```

---

## Troubleshooting

| Symptom                      | Fix                                                       |
| ---------------------------- | --------------------------------------------------------- |
| `arbiter: command not found` | Check `npm bin -g` is in `$PATH`                          |
| `git not found`              | `sudo apt-get install git`                                |
| Slow filesystem on `/mnt/c/` | Clone repos inside `/home/<user>/` for better performance |
| WSL1 detected                | `wsl --set-version Ubuntu 2`                              |

---

## Decision Record

arbiter supports WSL2 only (not native Win32) — see locked decision in `docs/PRODUCT/DECISIONS.md` (C7). The rationale: bash-based hooks and shell scripts require a POSIX environment. WSL2 provides this without significant friction for Windows developers.
