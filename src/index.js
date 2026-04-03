#!/usr/bin/env node

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import inquirer from "inquirer";

const VERSION = "1.0.0";

function parseArgs(args) {
  const flags = { yes: false, dryRun: false, version: false, help: false };
  for (const arg of args) {
    if (arg === "--yes" || arg === "-y") flags.yes = true;
    else if (arg === "--dry-run") flags.dryRun = true;
    else if (arg === "--version") flags.version = true;
    else if (arg === "--help" || arg === "-h") flags.help = true;
  }
  return flags;
}

function printHelp() {
  console.log(`
${chalk.bold("worktree-link")} — Symlink gitignored config files into git worktrees

${chalk.bold("USAGE")}
  worktree-link [options]

${chalk.bold("OPTIONS")}
  --yes, -y     Skip all confirmation prompts (select all worktrees and files)
  --dry-run     Show what would be symlinked without creating anything
  --version     Print the version number
  --help, -h    Print this help message

${chalk.bold("EXAMPLES")}
  worktree-link                 Interactive mode
  worktree-link --yes           Auto-symlink all files to all worktrees
  worktree-link --dry-run       Preview what would be symlinked
  worktree-link -y --dry-run    Preview all files to all worktrees
`);
}

function exec(cmd, cwd) {
  return execSync(cmd, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function findGitRoot() {
  try {
    return exec("git rev-parse --show-toplevel");
  } catch {
    return null;
  }
}

function parseWorktrees(raw) {
  const worktrees = [];
  let current = {};
  for (const line of raw.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length) };
    } else if (line === "bare") {
      current.bare = true;
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length);
    } else if (line === "") {
      if (current.path) worktrees.push(current);
      current = {};
    }
  }
  if (current.path) worktrees.push(current);
  return worktrees;
}

function discoverWorktrees() {
  const raw = exec("git worktree list --porcelain");
  return parseWorktrees(raw);
}

const EXCLUDE_DIRS = new Set([
  "node_modules",
  "bin",
  "obj",
  ".vs",
  ".idea",
  "dist",
  "build",
  "coverage",
]);

const EXCLUDE_FILES = new Set([".DS_Store"]);

function shouldExclude(filePath) {
  const parts = filePath.split(path.posix.sep);

  for (const part of parts) {
    if (EXCLUDE_DIRS.has(part)) return true;
  }

  const basename = path.posix.basename(filePath);
  if (EXCLUDE_FILES.has(basename)) return true;
  if (basename.endsWith(".log")) return true;

  return false;
}

function discoverIgnoredFiles(mainWorktree) {
  let raw;
  try {
    raw = exec(
      "git ls-files --others --ignored --exclude-standard",
      mainWorktree,
    );
  } catch {
    return [];
  }

  if (!raw) return [];

  return raw
    .split("\n")
    .filter((f) => f.length > 0)
    .filter((f) => {
      const fullPath = path.join(mainWorktree, f);
      try {
        const stat = fs.statSync(fullPath);
        return stat.isFile();
      } catch {
        return false;
      }
    })
    .filter((f) => !shouldExclude(f));
}

async function run() {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.version) {
    console.log(VERSION);
    process.exit(0);
  }

  if (flags.help) {
    printHelp();
    process.exit(0);
  }

  // Check we're in a git repo
  const gitRoot = findGitRoot();
  if (!gitRoot) {
    console.error(chalk.red("Error: Not inside a git repository."));
    process.exit(1);
  }

  // Discover worktrees
  let worktrees;
  try {
    worktrees = discoverWorktrees();
  } catch (err) {
    console.error(chalk.red("Error: Failed to list worktrees."), err.message);
    process.exit(1);
  }

  if (worktrees.length === 0) {
    console.error(chalk.red("Error: No worktrees found."));
    process.exit(1);
  }

  // First entry is the main worktree
  const mainWorktree = worktrees[0];
  const otherWorktrees = worktrees.slice(1);

  if (otherWorktrees.length === 0) {
    console.error(
      chalk.yellow("No additional worktrees found — nothing to do."),
    );
    process.exit(0);
  }

  console.log(chalk.bold("Main worktree:"), mainWorktree.path);
  console.log(
    chalk.bold("Additional worktrees:"),
    otherWorktrees.map((w) => w.path).join(", "),
  );
  console.log();

  // Select target worktrees
  let selectedWorktrees;
  if (flags.yes) {
    selectedWorktrees = otherWorktrees;
  } else {
    const { targets } = await inquirer.prompt([
      {
        type: "checkbox",
        name: "targets",
        message: "Select target worktrees:",
        choices: otherWorktrees.map((w) => ({
          name: w.path + (w.branch ? ` (${w.branch})` : ""),
          value: w,
          checked: true,
        })),
        validate: (answer) =>
          answer.length > 0 || "You must select at least one worktree.",
      },
    ]);
    selectedWorktrees = targets;
  }

  // Discover gitignored files
  const files = discoverIgnoredFiles(mainWorktree.path);

  if (files.length === 0) {
    console.log(
      chalk.yellow("No gitignored config files found in main worktree."),
    );
    process.exit(0);
  }

  console.log(
    chalk.bold(`\nDiscovered ${files.length} gitignored file(s):\n`),
  );
  for (const f of files) {
    console.log(`  ${f}`);
  }
  console.log();

  // Confirm
  if (!flags.yes) {
    const { proceed } = await inquirer.prompt([
      {
        type: "confirm",
        name: "proceed",
        message: `Symlink these ${files.length} file(s) into ${selectedWorktrees.length} worktree(s)?`,
        default: true,
      },
    ]);
    if (!proceed) {
      console.log("Aborted.");
      process.exit(0);
    }
  }

  // Create symlinks
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const wt of selectedWorktrees) {
    console.log(chalk.bold(`\n→ ${wt.path}`));

    for (const relFile of files) {
      const source = path.join(mainWorktree.path, relFile);
      const target = path.join(wt.path, relFile);

      // Check if symlink already exists
      try {
        const lstat = fs.lstatSync(target);
        if (lstat.isSymbolicLink()) {
          console.log(chalk.yellow(`  ⚠ SKIP (already symlinked): ${relFile}`));
          skipped++;
          continue;
        }
        // A real file exists — skip to avoid overwriting
        console.log(
          chalk.yellow(`  ⚠ SKIP (file already exists): ${relFile}`),
        );
        skipped++;
        continue;
      } catch {
        // File doesn't exist — good, we'll create the symlink
      }

      if (flags.dryRun) {
        console.log(chalk.cyan(`  [dry-run] would symlink: ${relFile}`));
        created++;
        continue;
      }

      try {
        // Ensure parent directory exists
        const targetDir = path.dirname(target);
        fs.mkdirSync(targetDir, { recursive: true });

        fs.symlinkSync(source, target);
        console.log(chalk.green(`  ✓ ${relFile}`));
        created++;
      } catch (err) {
        console.error(chalk.red(`  ✗ ${relFile}: ${err.message}`));
        failed++;
      }
    }
  }

  // Summary
  console.log(chalk.bold("\n— Summary —"));
  const prefix = flags.dryRun ? "Would create" : "Created";
  console.log(chalk.green(`  ${prefix}: ${created}`));
  if (skipped > 0) console.log(chalk.yellow(`  Skipped: ${skipped}`));
  if (failed > 0) console.log(chalk.red(`  Failed: ${failed}`));
}

run().catch((err) => {
  console.error(chalk.red("Unexpected error:"), err.message);
  process.exit(1);
});
