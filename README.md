# worktree-link

Symlink config files and run setup commands in git worktrees, driven by a simple JSON config.

## Install

### From npm

```bash
npm install -g worktree-link
```

### From source

```bash
git clone https://github.com/Shaun-Sheppard/worktree-link.git
cd worktree-link
npm install
npm link
```

### Directly from GitHub

```bash
npm install -g github:Shaun-Sheppard/worktree-link
```

## Quick start

1. Create a config file in your repo root:

```bash
worktree-link --init
```

This creates `.worktree-link.json`:

```json
{
  "files": [".env", ".env.local"],
  "commands": ["npm install"]
}
```

2. Edit it to list your config files and setup commands.

3. Run from anywhere inside the project:

```bash
worktree-link
```

## Config

Place a `.worktree-link.json` file in your repo root with two optional keys:

| Key | Description |
|---|---|
| `files` | Array of file paths (relative to repo root) to symlink from the main worktree into target worktrees |
| `commands` | Array of shell commands to run in each target worktree after linking |

### Example

```json
{
  "files": [
    ".env",
    ".env.local",
    "src/appsettings.Development.json"
  ],
  "commands": [
    "npm install",
    "dotnet restore"
  ]
}
```

- **files** are symlinked (not copied), so changes in the main worktree are reflected everywhere.
- **commands** run in each target worktree after symlinking, useful for restoring dependencies.

## Flags

| Flag | Description |
|---|---|
| `--yes, -y` | Skip all prompts — select all worktrees and proceed |
| `--dry-run` | Show what would be done without making changes |
| `--init` | Create a sample `.worktree-link.json` in the repo root |
| `--version` | Print the version number |
| `--help, -h` | Print usage instructions |

## Examples

**Create config:**

```bash
worktree-link --init
```

**Interactive mode** — choose worktrees and confirm:

```bash
worktree-link
```

**Auto mode** — no prompts:

```bash
worktree-link --yes
```

**Preview mode** — see what would happen:

```bash
worktree-link --dry-run
```

**Combine flags:**

```bash
worktree-link -y --dry-run
```

## How it works

1. Discovers all worktrees via `git worktree list --porcelain`
2. Reads `.worktree-link.json` from the main worktree
3. Validates that listed files exist in the main worktree
4. Creates symlinks in selected target worktrees, preserving directory structure
5. Runs configured commands in each target worktree
6. Skips files that already have a symlink (with a warning)
7. Works on macOS and Linux

## License

MIT
