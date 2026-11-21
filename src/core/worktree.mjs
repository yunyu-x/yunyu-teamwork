import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { WORKSPACE_MODES } from './constants.mjs';
import { sanitizeId } from './storage.mjs';

function runGit(cwd, args, { trimLeading = true } = {}) {
  const out = execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return trimLeading ? out.trim() : out.replace(/[\r\n]+$/, '');
}

export function isGitRepo(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return false;
  try {
    return runGit(dirPath, ['rev-parse', '--is-inside-work-tree']) === 'true';
  } catch {
    return false;
  }
}

export function hasHeadCommit(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return false;
  try {
    runGit(dirPath, ['rev-parse', '--verify', 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Manages real Git Worktrees (`share`), isolated clones (`branch`), and shared root (`inherit`)
 * so concurrent AI agents never step on each other's working tree or build artifacts.
 */
export class WorktreeManager {
  constructor({ repoPath, worktreeRoot = null, swarmId = 'default', ownershipGuard = null }) {
    this.repoPath = repoPath ? path.resolve(repoPath) : null;
    this.swarmId = sanitizeId(swarmId);
    this.worktreeRoot = worktreeRoot
      ? path.resolve(worktreeRoot)
      : this.repoPath
        ? path.join(this.repoPath, '.worktrees', this.swarmId)
        : null;
    this.ownershipGuard = ownershipGuard;
    this.workspaces = new Map(); // agentName -> WorkspaceInfo
  }

  get available() {
    return Boolean(this.repoPath && isGitRepo(this.repoPath) && hasHeadCommit(this.repoPath));
  }

  getCurrentBranch() {
    if (!this.available) return 'main';
    try {
      return runGit(this.repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'main';
    } catch {
      return 'main';
    }
  }

  getHeadSha(cwd = this.repoPath) {
    if (!cwd || !isGitRepo(cwd)) return null;
    try {
      return runGit(cwd, ['rev-parse', '--short', 'HEAD']);
    } catch {
      return null;
    }
  }

  /**
   * Provision a workspace for an agent according to mode (`share` | `branch` | `inherit`).
   */
  provision(agentName, mode = WORKSPACE_MODES.INHERIT, { baseBranch = null } = {}) {
    const cleanAgent = sanitizeId(agentName);
    if (!this.available || mode === WORKSPACE_MODES.INHERIT) {
      const info = {
        agent: agentName,
        mode: WORKSPACE_MODES.INHERIT,
        dir: this.repoPath,
        branch: this.available ? this.getCurrentBranch() : null,
        baseBranch: this.available ? this.getCurrentBranch() : null,
        isolated: false,
        merged: false,
        createdAt: new Date().toISOString()
      };
      this.workspaces.set(agentName, info);
      return info;
    }

    const base = baseBranch || this.getCurrentBranch();
    const branchName = `yunyu/${this.swarmId}/${cleanAgent}`;
    const targetDir = path.join(this.worktreeRoot, cleanAgent);
    fs.mkdirSync(this.worktreeRoot, { recursive: true });

    if (fs.existsSync(targetDir)) {
      this._forceRemovePath(targetDir);
    }

    if (mode === WORKSPACE_MODES.SHARE) {
      // Remove stale branch if left over from an interrupted run
      try {
        runGit(this.repoPath, ['worktree', 'prune']);
      } catch {}
      try {
        runGit(this.repoPath, ['branch', '-D', branchName]);
      } catch {}
      runGit(this.repoPath, ['worktree', 'add', '-b', branchName, targetDir, base]);
    } else if (mode === WORKSPACE_MODES.BRANCH) {
      runGit(this.repoPath, ['clone', '--no-hardlinks', '--branch', base, this.repoPath, targetDir]);
      runGit(targetDir, ['checkout', '-b', branchName]);
    } else {
      throw new Error(`不支持的工作区模式 "${mode}"`);
    }

    const info = {
      agent: agentName,
      mode,
      dir: targetDir,
      branch: branchName,
      baseBranch: base,
      isolated: true,
      merged: false,
      createdAt: new Date().toISOString()
    };
    this.workspaces.set(agentName, info);
    return info;
  }

  getWorkspace(agentName) {
    return this.workspaces.get(agentName) || null;
  }

  listWorkspaces() {
    return [...this.workspaces.values()].map((w) => ({
      ...w,
      headSha: this.getHeadSha(w.dir),
      changedFiles: this.listChangedFiles(w.agent)
    }));
  }

  /**
   * Return files changed in the agent's workspace (committed on its branch + uncommitted working tree).
   */
  listChangedFiles(agentName) {
    const ws = this.workspaces.get(agentName);
    if (!ws || !ws.dir || !isGitRepo(ws.dir)) return [];
    const files = new Set();
    try {
      const statusOut = runGit(ws.dir, ['status', '--porcelain'], { trimLeading: false });
      for (const line of statusOut.split(/\r?\n/).filter(Boolean)) {
        let f = line.slice(3).trim();
        if (f.includes(' -> ')) f = f.split(' -> ').pop().trim();
        f = f.replace(/^"|"$/g, '');
        if (f) files.add(f.replace(/\\/g, '/'));
      }
    } catch {}
    if (ws.isolated && ws.baseBranch) {
      try {
        const diffOut = runGit(ws.dir, ['diff', '--name-only', `${ws.baseBranch}...HEAD`]);
        for (const f of diffOut.split('\n').filter(Boolean)) {
          files.add(f.trim().replace(/\\/g, '/'));
        }
      } catch {}
    }
    return [...files].sort();
  }

  /**
   * Stage and commit changes inside an agent's workspace after OwnershipGuard validation.
   */
  commitChanges(agentName, message, { authorName = null, authorEmail = null } = {}) {
    const ws = this.workspaces.get(agentName);
    if (!ws || !ws.dir || !isGitRepo(ws.dir)) {
      throw new Error(`成员 @${agentName} 没有可用的 Git 工作区`);
    }
    const changed = this.listChangedFiles(agentName);
    if (changed.length === 0) {
      return { committed: false, sha: this.getHeadSha(ws.dir), files: [] };
    }

    if (this.ownershipGuard) {
      const audit = this.ownershipGuard.auditChangedFiles(agentName, changed);
      if (!audit.passed) {
        const details = audit.violations.map((v) => `${v.path}: ${v.reason}`).join('; ');
        throw new Error(`文件所有权守卫拦截提交：${details}`);
      }
    }

    runGit(ws.dir, ['add', '-A']);
    const commitArgs = [
      '-c',
      `user.name=${authorName || `yunyu-${agentName}`}`,
      '-c',
      `user.email=${authorEmail || `${agentName}@yunyu-teamwork.local`}`,
      'commit',
      '-m',
      message
    ];
    runGit(ws.dir, commitArgs);
    return {
      committed: true,
      sha: this.getHeadSha(ws.dir),
      branch: ws.branch,
      files: changed
    };
  }

  /**
   * Merge an isolated agent branch back into the main working copy after ownership verification.
   */
  mergeToBase(agentName, { commitMessage = null } = {}) {
    const ws = this.workspaces.get(agentName);
    if (!ws) throw new Error(`未找到成员 @${agentName} 的工作区`);
    if (!ws.isolated) {
      ws.merged = true;
      return { merged: true, branch: ws.branch, sha: this.getHeadSha(this.repoPath), files: [] };
    }

    const changed = this.listChangedFiles(agentName);
    if (this.ownershipGuard && changed.length > 0) {
      const audit = this.ownershipGuard.auditChangedFiles(agentName, changed);
      if (!audit.passed) {
        const details = audit.violations.map((v) => `${v.path}: ${v.reason}`).join('; ');
        throw new Error(`文件所有权守卫拒绝合并 @${agentName}：${details}`);
      }
    }

    if (ws.mode === WORKSPACE_MODES.BRANCH) {
      runGit(this.repoPath, ['fetch', ws.dir, `${ws.branch}:${ws.branch}`]);
    }

    const msg = commitMessage || `chore(swarm): merge ${ws.branch} from @${agentName}`;
    runGit(this.repoPath, [
      '-c',
      'user.name=yunyu-coordinator',
      '-c',
      'user.email=coordinator@yunyu-teamwork.local',
      'merge',
      '--no-ff',
      '-m',
      msg,
      ws.branch
    ]);
    ws.merged = true;
    return {
      merged: true,
      branch: ws.branch,
      sha: this.getHeadSha(this.repoPath),
      files: changed
    };
  }

  /**
   * Cleanly release and delete an isolated worktree when a worker is killed.
   */
  cleanup(agentName, { force = false } = {}) {
    const ws = this.workspaces.get(agentName);
    if (!ws) return { removed: false };
    if (!ws.isolated) {
      this.workspaces.delete(agentName);
      return { removed: false, mode: ws.mode };
    }
    const changed = this.listChangedFiles(agentName);
    if (!ws.merged && changed.length > 0 && !force) {
      throw new Error(
        `成员 @${agentName} 的隔离工作区 (${ws.branch}) 存在未合并改动 (${changed.join(', ')})，请先合并再销毁或指定 force:true`
      );
    }

    if (ws.mode === WORKSPACE_MODES.SHARE && this.available) {
      try {
        runGit(this.repoPath, ['worktree', 'remove', '--force', ws.dir]);
      } catch {
        this._forceRemovePath(ws.dir);
        try {
          runGit(this.repoPath, ['worktree', 'prune']);
        } catch {}
      }
      try {
        runGit(this.repoPath, ['branch', '-D', ws.branch]);
      } catch {}
    } else if (ws.mode === WORKSPACE_MODES.BRANCH) {
      this._forceRemovePath(ws.dir);
      try {
        runGit(this.repoPath, ['branch', '-D', ws.branch]);
      } catch {}
    }

    this.workspaces.delete(agentName);
    return { removed: true, branch: ws.branch };
  }

  _forceRemovePath(targetDir) {
    try {
      fs.rmSync(targetDir, { recursive: true, force: true });
    } catch {}
  }
}
