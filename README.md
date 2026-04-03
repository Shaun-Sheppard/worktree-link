# worktree-link

Automate symlinking gitignored config files (`.env`, IDE settings, local overrides, etc.) from your main worktree into git worktrees.

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

## Usage

Run from anywhere inside a git project that has worktrees:

```bash
worktree-link
```

This will:

1. Discover all git worktrees in the current project
2. Identify the main worktree
3. Find all gitignored files on disk in the main worktree
4. Filter out common noise (`node_modules`, `dist`, `build`, `coverage`, `*.log`, etc.)
5. Let you pick which worktrees to target
6. Show the files and ask for confirmation
7. Create symlinks in the selected worktrees, preserving directory structure

### Flags

| Flag | Description |
| ----------- | ----------------------------------------------------------------- |
| `--yes, -y` | Skip all prompts — select all worktrees and symlink all files |
| `--dry-run` | Show what would be symlinked without creating anything |
| `--version` | Print the version number |
| `--help, -h`| Print usage instructions |

### Examples

**Interactive mode** — choose worktrees and confirm files:

```bash
worktree-link
```

**Auto mode** — symlink everything, no prompts:

```bash
worktree-link --yes
```

**Preview mode** — see what would happen without making changes:

```bash
worktree-link --dry-run
```

**Combine flags** — preview all files to all worktrees:

```bash
worktree-link -y --dry-run
```

## How it works

- Uses `git worktree list --porcelain` to discover worktrees
- Uses `git ls-files --others --ignored --exclude-standard` to find gitignored files
- Creates symlinks pointing from each target worktree back to the main worktree
- Skips files that already have a symlink in the target (with a warning)
- Works on macOS and Linux

## License

MIT
