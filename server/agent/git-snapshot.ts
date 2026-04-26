import { execSync } from "child_process";

export function createGitSnapshot(cwd: string): string | null {
  try {
    try {
      execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "ignore", timeout: 2000 });
    } catch {
      return null; // not a git repo, skip snapshot silently
    }

    let hasCommits = true;
    try {
      execSync("git rev-parse HEAD", { cwd, stdio: "ignore", timeout: 2000 });
    } catch {
      hasCommits = false;
    }
    if (!hasCommits) return null;

    execSync("git add -A", { cwd, stdio: "ignore" });
    const sha = execSync("git stash create", {
      cwd, encoding: "utf-8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    execSync("git reset", { cwd, stdio: "ignore" });

    if (!sha) {
      return execSync("git rev-parse HEAD", { cwd, encoding: "utf-8", timeout: 3000 }).trim();
    }
    return sha;
  } catch (err) {
    console.log(`[git] snapshot failed:`, err);
    return null;
  }
}

export function getCommitsSince(cwd: string, sha: string): number {
  try {
    const count = execSync(`git rev-list --count ${sha}..HEAD`, { cwd, encoding: "utf-8", timeout: 3000 }).trim();
    return parseInt(count, 10) || 0;
  } catch {
    return -1;
  }
}

export function rollbackToSnapshot(cwd: string, sha: string): { ok: boolean; error?: string } {
  try {
    const commitsSince = getCommitsSince(cwd, sha);
    if (commitsSince > 0) {
      return { ok: false, error: `${commitsSince} commit(s) depuis ce snapshot. Rollback non securise.` };
    }
    execSync(`git checkout ${sha} -- .`, { cwd, stdio: "ignore", timeout: 10000 });
    execSync("git clean -fd --exclude=node_modules --exclude=.env", { cwd, stdio: "ignore", timeout: 10000 });
    execSync("git reset", { cwd, stdio: "ignore" });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
