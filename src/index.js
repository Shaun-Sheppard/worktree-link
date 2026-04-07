#!/usr/bin/env node

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import inquirer from "inquirer";

const VERSION = "2.0.0";
const CONFIG_FILENAME = ".worktree-link.json";

function parseArgs(args) {
  const flags = { yes: false, dryRun: false, version: false, help: false, init: false };
  for (const arg of args) {
    if (arg === "--yes" || arg === "-y") flags.yes = true;
    else if (arg === "--dry-run") flags.dryRun = true;
    else if (arg === "--version") flags.version = true;
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg === "--init") flags.init = true;
  }
  return flags;
}

function printHelp() {
  console.log(`
${chalk.bold("worktree-link")} — Symlink config files and run setup commands in git worktrees

${chalk.bold("USAGE")}
  worktree-link [options]

${chalk.bold("OPTIONS")}
  --yes, -y     Skip all confirmation prompts (select all worktrees)
  --dry-run     Show what would be done without making changes
  --init        Create a sample ${CONFIG_FILENAME} in the current directory
  --version     Print the version number
  --help, -h    Print this help message

${chalk.bold("CONFIG")}
  Place a ${chalk.cyan(CONFIG_FILENAME)} file in your repo root:

  {
    "files": [".env", ".env.local"],
    "commands": ["npm install"]
  }

  ${chalk.bold("files")}     — Files to symlink from the main worktree into targets
  ${chalk.bold("commands")}  — Commands to run in each target worktree after linking

${chalk.bold("EXAMPLES")}
  worktree-link --init        Create a sample config file
  worktree-link               Interactive mode
  worktree-link --yes         Auto-run for all worktrees, no prompts
  worktree-link --dry-run     Preview what would happen
  worktree-link -y --dry-run  Preview for all worktrees
`);
}

function exec(cmd, cwd) {
  return execSync(cmd, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function execPassthrough(cmd, cwd) {
  execSync(cmd, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
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

function loadConfig(mainWorktreePath) {
  const configPath = path.join(mainWorktreePath, CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) {
    return null;
  }
  const raw = fs.readFileSync(configPath, "utf-8");
  const config = JSON.parse(raw);
  return {
    files: Array.isArray(config.files) ? config.files : [],
    commands: Array.isArray(config.commands) ? config.commands : [],
  };
}

function validateFiles(mainWorktreePath, files) {
  const valid = [];
  const missing = [];
  for (const f of files) {
    const fullPath = path.join(mainWorktreePath, f);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      valid.push(f);
    } else {
      missing.push(f);
    }
  }
  return { valid, missing };
}

function createSampleConfig(dir) {
  const configPath = path.join(dir, CONFIG_FILENAME);
  if (fs.existsSync(configPath)) {
    console.log(chalk.yellow(`${CONFIG_FILENAME} already exists.`));
    return;
  }
  const sample = {
    files: [".env", ".env.local"],
    commands: ["npm install"],
  };
  fs.writeFileSync(configPath, JSON.stringify(sample, null, 2) + "\n");
  console.log(chalk.green(`Created ${CONFIG_FILENAME}`));
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

  if (flags.init) {
    console.log(chalk.dim(`worktree-link v${VERSION}`));
    createSampleConfig(gitRoot);
    process.exit(0);
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
    console.error(chalk.yellow("No additional worktrees found — nothing to do."));
    process.exit(0);
  }

  // Load config
  const config = loadConfig(mainWorktree.path);
  if (!config) {
    console.error(
      chalk.red(`Error: No ${CONFIG_FILENAME} found in ${mainWorktree.path}`),
    );
    console.error(chalk.dim(`Run ${chalk.cyan("worktree-link --init")} to create one.`));
    process.exit(1);
  }

  if (config.files.length === 0 && config.commands.length === 0) {
    console.log(chalk.yellow(`${CONFIG_FILENAME} has no files or commands configured.`));
    process.exit(0);
  }

  console.log(chalk.dim(`worktree-link v${VERSION}`));
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

  // Validate configured files
  const { valid: files, missing } = validateFiles(mainWorktree.path, config.files);

  if (missing.length > 0) {
    for (const f of missing) {
      console.log(chalk.yellow(`  ⚠ File not found in main worktree: ${f}`));
    }
  }

  // Show plan
  if (files.length > 0) {
    console.log(chalk.bold(`\nFiles to symlink (${files.length}):\n`));
    for (const f of files) {
      console.log(`  ${f}`);
    }
  }

  if (config.commands.length > 0) {
    console.log(chalk.bold(`\nCommands to run (${config.commands.length}):\n`));
    for (const cmd of config.commands) {
      console.log(`  ${cmd}`);
    }
  }

  console.log();

  // Confirm
  if (!flags.yes) {
    const { proceed } = await inquirer.prompt([
      {
        type: "confirm",
        name: "proceed",
        message: `Proceed with ${selectedWorktrees.length} worktree(s)?`,
        default: true,
      },
    ]);
    if (!proceed) {
      console.log("Aborted.");
      process.exit(0);
    }
  }

  // Process each worktree
  let linkedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let commandsRun = 0;
  let commandsFailed = 0;

  for (const wt of selectedWorktrees) {
    console.log(chalk.bold(`\n→ ${wt.path}`));

    // Symlink files
    for (const relFile of files) {
      const source = path.join(mainWorktree.path, relFile);
      const target = path.join(wt.path, relFile);

      // Check if symlink already exists
      try {
        const lstat = fs.lstatSync(target);
        if (lstat.isSymbolicLink()) {
          console.log(chalk.yellow(`  ⚠ SKIP (already symlinked): ${relFile}`));
          skippedCount++;
          continue;
        }
        console.log(chalk.yellow(`  ⚠ SKIP (file already exists): ${relFile}`));
        skippedCount++;
        continue;
      } catch {
        // File doesn't exist — good, we'll create the symlink
      }

      if (flags.dryRun) {
        console.log(chalk.cyan(`  [dry-run] would symlink: ${relFile}`));
        linkedCount++;
        continue;
      }

      try {
        const targetDir = path.dirname(target);
        fs.mkdirSync(targetDir, { recursive: true });
        fs.symlinkSync(source, target);
        console.log(chalk.green(`  ✓ ${relFile}`));
        linkedCount++;
      } catch (err) {
        console.error(chalk.red(`  ✗ ${relFile}: ${err.message}`));
        failedCount++;
      }
    }

    // Run commands
    for (const cmd of config.commands) {
      if (flags.dryRun) {
        console.log(chalk.cyan(`  [dry-run] would run: ${cmd}`));
        commandsRun++;
        continue;
      }

      try {
        console.log(chalk.dim(`  Running: ${cmd}`));
        execPassthrough(cmd, wt.path);
        console.log(chalk.green(`  ✓ ${cmd}`));
        commandsRun++;
      } catch (err) {
        console.error(chalk.red(`  ✗ ${cmd}: ${err.message}`));
        commandsFailed++;
      }
    }
  }

  // Summary
  console.log(chalk.bold("\n— Summary —"));
  const prefix = flags.dryRun ? "Would symlink" : "Symlinked";
  const cmdPrefix = flags.dryRun ? "Would run" : "Commands run";
  if (files.length > 0) {
    console.log(chalk.green(`  ${prefix}: ${linkedCount}`));
    if (skippedCount > 0) console.log(chalk.yellow(`  Skipped: ${skippedCount}`));
    if (failedCount > 0) console.log(chalk.red(`  Failed: ${failedCount}`));
  }
  if (config.commands.length > 0) {
    console.log(chalk.green(`  ${cmdPrefix}: ${commandsRun}`));
    if (commandsFailed > 0) console.log(chalk.red(`  Commands failed: ${commandsFailed}`));
  }
}

run().catch((err) => {
  console.error(chalk.red("Unexpected error:"), err.message);
  process.exit(1);
});
