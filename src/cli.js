const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const DEFAULT_PROTECTED_BRANCHES = [
  "main",
  "master",
  "develop",
  "dev",
  "staging",
  "production",
  "trunk"
];

function main(argv = process.argv.slice(2), io = defaultIo()) {
  const parsed = parseArgs(argv);

  if (parsed.help) {
    io.out(helpText());
    return Promise.resolve(0);
  }

  const repos = discoverRepositories(parsed.root, {
    only: parsed.only,
    exclude: parsed.exclude,
    includeCurrent: parsed.includeCurrent,
    includeHidden: parsed.includeHidden
  });

  const actions = {
    sync: runSync,
    status: runStatus,
    fetch: runFetch,
    branches: runBranches,
    list: runList,
    dirty: runDirty
  };

  const action = actions[parsed.command];
  if (!action) {
    throw new Error(`Unknown command: ${parsed.command}`);
  }

  const results = action(repos, parsed);
  const exitCode = determineExitCode(parsed.command, results, parsed.strict);

  if (parsed.json) {
    io.out(
      JSON.stringify(
        {
          command: parsed.command,
          root: parsed.root,
          strict: parsed.strict,
          repoCount: repos.length,
          exitCode,
          results
        },
        null,
        2
      )
    );
    return Promise.resolve(exitCode);
  }

  printResults(parsed.command, results, io);
  return Promise.resolve(exitCode);
}

function defaultIo() {
  return {
    out: (line) => console.log(line),
    err: (line) => console.error(line)
  };
}

function parseArgs(argv) {
  const parsed = {
    command: "sync",
    root: process.cwd(),
    protectedBranches: [...DEFAULT_PROTECTED_BRANCHES],
    only: [],
    exclude: [],
    includeCurrent: false,
    includeHidden: false,
    includeDirty: false,
    strict: false,
    dryRun: false,
    json: false,
    help: false
  };

  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }

    if (token === "--include-current") {
      parsed.includeCurrent = true;
      continue;
    }

    if (token === "--include-hidden") {
      parsed.includeHidden = true;
      continue;
    }

    if (token === "--include-dirty") {
      parsed.includeDirty = true;
      continue;
    }

    if (token === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }

    if (token === "--strict") {
      parsed.strict = true;
      continue;
    }

    if (token === "--json") {
      parsed.json = true;
      continue;
    }

    if (token === "--root") {
      index += 1;
      parsed.root = resolveRequiredValue(argv, index, "--root");
      continue;
    }

    if (token.startsWith("--root=")) {
      parsed.root = token.slice("--root=".length);
      continue;
    }

    if (token === "--protected") {
      index += 1;
      parsed.protectedBranches = splitCommaList(
        resolveRequiredValue(argv, index, "--protected")
      );
      continue;
    }

    if (token.startsWith("--protected=")) {
      parsed.protectedBranches = splitCommaList(
        token.slice("--protected=".length)
      );
      continue;
    }

    if (token === "--only") {
      index += 1;
      parsed.only.push(...splitCommaList(resolveRequiredValue(argv, index, "--only")));
      continue;
    }

    if (token.startsWith("--only=")) {
      parsed.only.push(...splitCommaList(token.slice("--only=".length)));
      continue;
    }

    if (token === "--exclude") {
      index += 1;
      parsed.exclude.push(
        ...splitCommaList(resolveRequiredValue(argv, index, "--exclude"))
      );
      continue;
    }

    if (token.startsWith("--exclude=")) {
      parsed.exclude.push(...splitCommaList(token.slice("--exclude=".length)));
      continue;
    }

    if (token.startsWith("-")) {
      throw new Error(`Unknown option: ${token}`);
    }

    positionals.push(token);
  }

  const knownCommands = new Set([
    "sync",
    "status",
    "fetch",
    "branches",
    "list",
    "dirty"
  ]);

  if (positionals.length > 0) {
    if (knownCommands.has(positionals[0])) {
      parsed.command = positionals[0];
      if (positionals.length > 1) {
        parsed.root = positionals[1];
      }
    } else {
      parsed.root = positionals[0];
    }
  }

  parsed.root = resolveCliPath(parsed.root);
  return parsed;
}

function resolveRequiredValue(argv, index, optionName) {
  const value = argv[index];
  if (!value) {
    throw new Error(`Missing value for ${optionName}`);
  }
  return value;
}

function resolveCliPath(value) {
  if (value === "~") {
    return os.homedir();
  }

  if (value.startsWith(`~${path.sep}`)) {
    return path.join(os.homedir(), value.slice(2));
  }

  return path.resolve(value);
}

function splitCommaList(value) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function helpText() {
  return [
    "git-batch",
    "",
    "Batch commands for all git repositories directly below a folder.",
    "",
    "Usage:",
    "  git-batch [command] [root] [options]",
    "",
    "Commands:",
    "  sync       Check for local changes, switch to a protected branch, pull",
    "  status     Show branch and worktree status for each repository",
    "  fetch      Run git fetch --all --prune for each repository",
    "  branches   Show current branch and detected protected branch",
    "  list       List discovered repositories on the current level",
    "  dirty      Show only repositories with local changes",
    "",
    "Options:",
    "  --root <path>             Root folder to scan, defaults to cwd",
    "  --protected <a,b,c>       Preferred protected branches",
    "  --only <a,b,c>            Include only matching repository names",
    "  --exclude <a,b,c>         Exclude matching repository names",
    "  --include-current         Include the current folder if it is a git repo",
    "  --include-hidden          Include hidden child directories",
    "  --include-dirty           Allow sync for dirty repositories",
    "  --strict                  Return non-zero for actionable problem states",
    "  --dry-run                 Print planned git actions without executing them",
    "  --json                    Emit JSON instead of text",
    "  --help                    Show this help",
    "",
    "Examples:",
    "  git-batch sync ~/git",
    "  git-batch status ~/git/pandora",
    "  git-batch fetch --include-current",
    "  git-batch sync --protected main,develop --dry-run",
    "  git-batch sync ~/git --only api,web",
    "  git-batch dirty ~/git --exclude '/^archive-/'",
    "  git-batch list ~/git",
    "  git-batch dirty ~/git"
  ].join("\n");
}

function discoverRepositories(root, options) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const repos = [];

  if (options.includeCurrent && looksLikeGitRepo(root)) {
    repos.push(buildRepoDescriptor(root));
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    if (!options.includeHidden && entry.name.startsWith(".")) {
      continue;
    }

    const repoPath = path.join(root, entry.name);
    if (!looksLikeGitRepo(repoPath)) {
      continue;
    }

    repos.push(buildRepoDescriptor(repoPath));
  }

  return repos
    .filter((repo) => matchesRepoFilters(repo.name, options))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function looksLikeGitRepo(repoPath) {
  return fs.existsSync(path.join(repoPath, ".git"));
}

function buildRepoDescriptor(repoPath) {
  return {
    name: path.basename(repoPath),
    path: repoPath
  };
}

function matchesRepoFilters(repoName, options) {
  const includePatterns = compilePatterns(options.only || []);
  const excludePatterns = compilePatterns(options.exclude || []);

  if (
    includePatterns.length > 0 &&
    !includePatterns.some((pattern) => pattern.test(repoName))
  ) {
    return false;
  }

  if (excludePatterns.some((pattern) => pattern.test(repoName))) {
    return false;
  }

  return true;
}

function compilePatterns(values) {
  return values.map((value) => compilePattern(value));
}

function compilePattern(value) {
  const regexLiteral = value.match(/^\/(.+)\/([a-z]*)$/i);
  if (regexLiteral) {
    return new RegExp(regexLiteral[1], regexLiteral[2]);
  }

  return new RegExp(escapeRegex(value), "i");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function runStatus(repos, options) {
  return repos.map((repo) => {
    try {
      const status = collectRepoStatus(repo.path);
      return {
        repo: repo.name,
        path: repo.path,
        currentBranch: status.branch,
        targetBranch: detectProtectedBranch(repo.path, options.protectedBranches),
        clean: status.clean,
        counts: status.counts,
        outcome: "ok"
      };
    } catch (error) {
      return repoError(repo, error);
    }
  });
}

function runBranches(repos, options) {
  return repos.map((repo) => {
    try {
      return {
        repo: repo.name,
        path: repo.path,
        currentBranch: safeBranch(repo.path),
        targetBranch: detectProtectedBranch(repo.path, options.protectedBranches),
        outcome: "ok"
      };
    } catch (error) {
      return repoError(repo, error);
    }
  });
}

function runFetch(repos, options) {
  return repos.map((repo) => {
    const result = {
      repo: repo.name,
      path: repo.path,
      actions: [],
      outcome: "ok"
    };

    try {
      executeGitCommand(repo.path, ["fetch", "--all", "--prune"], options, result);
      return result;
    } catch (error) {
      return repoError(repo, error, result.actions);
    }
  });
}

function runList(repos) {
  return repos.map((repo) => ({
    repo: repo.name,
    path: repo.path,
    outcome: "ok"
  }));
}

function runDirty(repos, options) {
  return repos
    .map((repo) => {
      try {
        const status = collectRepoStatus(repo.path);
        return {
          repo: repo.name,
          path: repo.path,
          currentBranch: status.branch,
          clean: status.clean,
          counts: status.counts,
          outcome: "ok"
        };
      } catch (error) {
        return repoError(repo, error);
      }
    })
    .filter((entry) => entry.outcome === "error" || !entry.clean);
}

function runSync(repos, options) {
  return repos.map((repo) => {
    try {
      return syncRepository(repo, options);
    } catch (error) {
      return repoError(repo, error);
    }
  });
}

function syncRepository(repo, options) {
  const status = collectRepoStatus(repo.path);
  const result = {
    repo: repo.name,
    path: repo.path,
    currentBranch: status.branch,
    clean: status.clean,
    counts: status.counts,
    targetBranch: null,
    outcome: "ok",
    actions: []
  };

  if (!status.clean && !options.includeDirty) {
    result.outcome = "skipped_dirty";
    return result;
  }

  executeGitCommand(repo.path, ["fetch", "--all", "--prune"], options, result);

  const targetBranch = detectProtectedBranch(repo.path, options.protectedBranches);
  result.targetBranch = targetBranch;

  if (!targetBranch) {
    result.outcome = "skipped_no_protected_branch";
    return result;
  }

  ensureCheckedOut(repo.path, status.branch, targetBranch, options, result);
  executeGitCommand(
    repo.path,
    ["pull", "--ff-only", "origin", targetBranch],
    options,
    result
  );

  result.currentBranch = targetBranch;
  return result;
}

function collectRepoStatus(repoPath) {
  const raw = runGit(repoPath, ["status", "--short", "--branch"]);
  const lines = raw.stdout.trim() ? raw.stdout.trim().split("\n") : [];
  const branchLine = lines.shift() || "";
  const branch = parseBranchLine(branchLine);
  const counts = {
    staged: 0,
    unstaged: 0,
    untracked: 0
  };

  for (const line of lines) {
    if (!line) {
      continue;
    }

    if (line.startsWith("??")) {
      counts.untracked += 1;
      continue;
    }

    const stagedCode = line[0];
    const unstagedCode = line[1];

    if (stagedCode && stagedCode !== " ") {
      counts.staged += 1;
    }

    if (unstagedCode && unstagedCode !== " ") {
      counts.unstaged += 1;
    }
  }

  return {
    branch,
    counts,
    clean:
      counts.staged === 0 && counts.unstaged === 0 && counts.untracked === 0
  };
}

function parseBranchLine(branchLine) {
  if (!branchLine.startsWith("## ")) {
    return "unknown";
  }

  const branchText = branchLine.slice(3);
  if (branchText.startsWith("No commits yet on ")) {
    return branchText.slice("No commits yet on ".length);
  }

  if (branchText.startsWith("HEAD (no branch)")) {
    return "detached";
  }

  return branchText.split("...")[0];
}

function detectProtectedBranch(repoPath, protectedBranches) {
  const originHead = resolveOriginHeadBranch(repoPath);
  if (originHead) {
    return originHead;
  }

  for (const branch of protectedBranches) {
    if (hasLocalBranch(repoPath, branch) || hasRemoteBranch(repoPath, branch)) {
      return branch;
    }
  }

  return null;
}

function resolveOriginHeadBranch(repoPath) {
  const result = runGit(repoPath, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], {
    allowFailure: true
  });

  if (result.code !== 0) {
    return null;
  }

  const ref = result.stdout.trim();
  if (!ref.startsWith("origin/")) {
    return null;
  }

  return ref.slice("origin/".length);
}

function hasLocalBranch(repoPath, branch) {
  return (
    runGit(repoPath, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
      allowFailure: true
    }).code === 0
  );
}

function hasRemoteBranch(repoPath, branch) {
  return (
    runGit(
      repoPath,
      ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`],
      {
        allowFailure: true
      }
    ).code === 0
  );
}

function ensureCheckedOut(repoPath, currentBranch, targetBranch, options, result) {
  if (currentBranch === targetBranch) {
    return;
  }

  if (hasLocalBranch(repoPath, targetBranch)) {
    executeGitCommand(repoPath, ["checkout", targetBranch], options, result);
    return;
  }

  if (hasRemoteBranch(repoPath, targetBranch)) {
    executeGitCommand(
      repoPath,
      ["checkout", "-b", targetBranch, "--track", `origin/${targetBranch}`],
      options,
      result
    );
    return;
  }

  throw new Error(`Branch ${targetBranch} does not exist in ${repoPath}`);
}

function executeGitCommand(repoPath, args, options, result) {
  result.actions.push({
    command: ["git", ...args].join(" "),
    dryRun: options.dryRun
  });

  if (options.dryRun) {
    return;
  }

  const execution = runGit(repoPath, args);
  if (execution.code !== 0) {
    const stderr = execution.stderr.trim() || execution.stdout.trim();
    throw new Error(`${path.basename(repoPath)}: ${stderr}`);
  }
}

function safeBranch(repoPath) {
  try {
    return collectRepoStatus(repoPath).branch;
  } catch (error) {
    return "unknown";
  }
}

function runGit(repoPath, args, extraOptions = {}) {
  try {
    const stdout = execFileSync("git", args, {
      cwd: repoPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });

    return {
      code: 0,
      stdout,
      stderr: ""
    };
  } catch (error) {
    if (extraOptions.allowFailure) {
      return {
        code: typeof error.status === "number" ? error.status : 1,
        stdout: error.stdout ? String(error.stdout) : "",
        stderr: error.stderr ? String(error.stderr) : ""
      };
    }

    const stderr = error.stderr ? String(error.stderr).trim() : "";
    const stdout = error.stdout ? String(error.stdout).trim() : "";
    throw new Error(stderr || stdout || `git ${args.join(" ")} failed`);
  }
}

function normalizeCounts(counts) {
  return {
    staged: counts && typeof counts.staged === "number" ? counts.staged : 0,
    unstaged: counts && typeof counts.unstaged === "number" ? counts.unstaged : 0,
    untracked: counts && typeof counts.untracked === "number" ? counts.untracked : 0
  };
}

function printResults(command, results, io) {
  if (results.length === 0) {
    io.out("No git repositories found on this level.");
    return;
  }

  if (command === "status") {
    for (const entry of results) {
      if (entry.outcome === "error") {
        io.out(`${entry.repo}: outcome=error message=${entry.error}`);
        continue;
      }
      const counts = normalizeCounts(entry.counts);
      io.out(
        `${entry.repo}: branch=${entry.currentBranch} target=${entry.targetBranch || "-"} clean=${entry.clean} staged=${counts.staged} unstaged=${counts.unstaged} untracked=${counts.untracked}`
      );
    }
    return;
  }

  if (command === "branches") {
    for (const entry of results) {
      if (entry.outcome === "error") {
        io.out(`${entry.repo}: outcome=error message=${entry.error}`);
        continue;
      }
      io.out(
        `${entry.repo}: current=${entry.currentBranch} target=${entry.targetBranch || "-"}`
      );
    }
    return;
  }

  if (command === "fetch") {
    for (const entry of results) {
      if (entry.outcome === "error") {
        io.out(`${entry.repo}: outcome=error message=${entry.error}`);
        continue;
      }
      io.out(`${entry.repo}: ${renderActions(entry.actions)}`);
    }
    return;
  }

  if (command === "list") {
    for (const entry of results) {
      if (entry.outcome === "error") {
        io.out(`${entry.repo}: outcome=error message=${entry.error}`);
        continue;
      }
      io.out(`${entry.repo}: ${entry.path}`);
    }
    return;
  }

  if (command === "dirty") {
    if (results.length === 0) {
      io.out("No repositories with local changes found.");
      return;
    }

    for (const entry of results) {
      if (entry.outcome === "error") {
        io.out(`${entry.repo}: outcome=error message=${entry.error}`);
        continue;
      }
      const counts = normalizeCounts(entry.counts);
      io.out(
        `${entry.repo}: branch=${entry.currentBranch} staged=${counts.staged} unstaged=${counts.unstaged} untracked=${counts.untracked}`
      );
    }
    return;
  }

  for (const entry of results) {
    if (entry.outcome === "error") {
      io.out(`${entry.repo}: outcome=error message=${entry.error}`);
      continue;
    }
    const counts = normalizeCounts(entry.counts);
    io.out(
      `${entry.repo}: outcome=${entry.outcome} current=${entry.currentBranch} target=${entry.targetBranch || "-"} clean=${entry.clean} staged=${counts.staged} unstaged=${counts.unstaged} untracked=${counts.untracked}`
    );
    if (entry.actions && entry.actions.length > 0) {
      io.out(`  ${renderActions(entry.actions)}`);
    }
  }
}

function repoError(repo, error, actions = []) {
  return {
    repo: repo.name,
    path: repo.path,
    outcome: "error",
    error: error && error.message ? error.message : String(error),
    actions
  };
}

function determineExitCode(command, results, strict) {
  if (results.some((entry) => entry.outcome === "error")) {
    return 1;
  }

  if (!strict) {
    return 0;
  }

  if (results.length === 0) {
    return 1;
  }

  if (command === "sync") {
    return results.some((entry) => entry.outcome !== "ok") ? 1 : 0;
  }

  if (command === "status") {
    return results.some((entry) => entry.clean === false) ? 1 : 0;
  }

  if (command === "dirty") {
    return results.length > 0 ? 1 : 0;
  }

  if (command === "branches") {
    return results.some((entry) => !entry.targetBranch) ? 1 : 0;
  }

  return 0;
}

function renderActions(actions) {
  return actions.map((action) => action.command).join(" -> ");
}

module.exports = {
  DEFAULT_PROTECTED_BRANCHES,
  collectRepoStatus,
  detectProtectedBranch,
  determineExitCode,
  discoverRepositories,
  helpText,
  main,
  parseArgs,
  printResults,
  resolveCliPath,
  runDirty,
  runList,
  runSync
};
