import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PROTECTED_BRANCHES_DEFAULT, WORKSPACE_MODES } from './constants.mjs';
import { matchGlob } from './ownership.mjs';
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

  branchExists(branchName) {
    if (!this.available || !branchName) return false;
    try {
      runGit(this.repoPath, ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Scan actual Git worktrees attached to this repository via `git worktree list --porcelain`.
   */
  listGitWorktrees() {
    if (!this.available) return [];
    try {
      const out = runGit(this.repoPath, ['worktree', 'list', '--porcelain'], { trimLeading: false });
      const blocks = out.split(/\r?\n\r?\n/).filter((b) => b.trim());
      const result = [];
      for (const block of blocks) {
        const entry = { dir: null, head: null, branch: null, prunable: false };
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith('worktree ')) entry.dir = path.resolve(line.slice(9).trim());
          else if (line.startsWith('HEAD ')) entry.head = line.slice(5).trim();
          else if (line.startsWith('branch ')) entry.branch = line.slice(7).trim().replace(/^refs\/heads\//, '');
          else if (line.startsWith('prunable')) entry.prunable = true;
        }
        if (entry.dir) result.push(entry);
      }
      return result;
    } catch {
      return [];
    }
  }

  exportState() {
    return [...this.workspaces.values()].map((w) => ({
      agent: w.agent,
      mode: w.mode,
      dir: w.dir,
      branch: w.branch,
      baseBranch: w.baseBranch,
      isolated: Boolean(w.isolated),
      merged: Boolean(w.merged),
      status: w.status || 'ready',
      createdAt: w.createdAt || null
    }));
  }

  /**
   * Rehydrate workspace mappings after process restart by scanning actual Git worktrees on disk,
   * optionally auto-repairing missing `share` worktree directories when their Git branch survives.
   */
  rehydrate(savedWorktrees = [], members = [], { autoRepair = true } = {}) {
    const normPath = (p) => (p ? (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p)) : '');
    const gitWorktrees = this.listGitWorktrees();
    const byDir = new Map(gitWorktrees.map((g) => [normPath(g.dir), g]));
    const byBranch = new Map(gitWorktrees.filter((g) => g.branch).map((g) => [g.branch, g]));

    const candidates = new Map();
    for (const w of Array.isArray(savedWorktrees) ? savedWorktrees : []) {
      if (w?.agent) candidates.set(w.agent, { ...w });
    }
    for (const m of Array.isArray(members) ? members : []) {
      if (!m?.name || m.killed) continue;
      if (!candidates.has(m.name)) {
        candidates.set(m.name, {
          agent: m.name,
          mode: m.workspaceMode || WORKSPACE_MODES.INHERIT,
          dir: m.workspaceDir || this.repoPath,
          branch: m.branch || null,
          baseBranch: m.baseBranch || (this.available ? this.getCurrentBranch() : null),
          isolated: m.workspaceMode === WORKSPACE_MODES.SHARE || m.workspaceMode === WORKSPACE_MODES.BRANCH,
          merged: false,
          createdAt: m.addedAt || new Date().toISOString()
        });
      }
    }

    const restored = [];
    for (const [agentName, entry] of candidates.entries()) {
      const mode = entry.mode || WORKSPACE_MODES.INHERIT;
      if (mode === WORKSPACE_MODES.INHERIT || !entry.isolated) {
        const info = {
          agent: agentName,
          mode: WORKSPACE_MODES.INHERIT,
          dir: this.repoPath,
          branch: this.available ? this.getCurrentBranch() : entry.branch || null,
          baseBranch: this.available ? this.getCurrentBranch() : entry.baseBranch || null,
          isolated: false,
          merged: Boolean(entry.merged),
          rehydrated: true,
          status: 'ready',
          createdAt: entry.createdAt || new Date().toISOString()
        };
        this.workspaces.set(agentName, info);
        restored.push(info);
        continue;
      }

      const cleanAgent = sanitizeId(agentName);
      const expectedBranch = entry.branch || `yunyu/${this.swarmId}/${cleanAgent}`;
      const expectedDir = entry.dir || (this.worktreeRoot ? path.join(this.worktreeRoot, cleanAgent) : null);
      const baseBranch = entry.baseBranch || (this.available ? this.getCurrentBranch() : 'main');

      if (mode === WORKSPACE_MODES.SHARE) {
        const gitMatch = (expectedDir && byDir.get(normPath(expectedDir))) || byBranch.get(expectedBranch) || null;
        const resolvedDir = gitMatch?.dir || expectedDir;

        if (resolvedDir && fs.existsSync(resolvedDir) && isGitRepo(resolvedDir)) {
          const info = {
            agent: agentName,
            mode,
            dir: resolvedDir,
            branch: gitMatch?.branch || expectedBranch,
            baseBranch,
            isolated: true,
            merged: Boolean(entry.merged),
            rehydrated: true,
            status: 'ready',
            createdAt: entry.createdAt || new Date().toISOString()
          };
          this.workspaces.set(agentName, info);
          restored.push(info);
          continue;
        }

        if (autoRepair && this.available && (expectedDir || resolvedDir) && this.branchExists(expectedBranch)) {
          const repairDir = expectedDir || resolvedDir;
          try {
            this._assertSafeWorktreeTarget(repairDir);
            try {
              runGit(this.repoPath, ['worktree', 'prune']);
            } catch {}
            fs.mkdirSync(path.dirname(repairDir), { recursive: true });
            runGit(this.repoPath, ['worktree', 'add', repairDir, expectedBranch]);
            const info = {
              agent: agentName,
              mode,
              dir: repairDir,
              branch: expectedBranch,
              baseBranch,
              isolated: true,
              merged: Boolean(entry.merged),
              rehydrated: true,
              repaired: true,
              status: 'repaired',
              createdAt: entry.createdAt || new Date().toISOString()
            };
            this.workspaces.set(agentName, info);
            restored.push(info);
            continue;
          } catch {}
        }

        const missingInfo = {
          agent: agentName,
          mode,
          dir: resolvedDir,
          branch: expectedBranch,
          baseBranch,
          isolated: true,
          merged: Boolean(entry.merged),
          rehydrated: true,
          status: 'missing',
          createdAt: entry.createdAt || new Date().toISOString()
        };
        this.workspaces.set(agentName, missingInfo);
        restored.push(missingInfo);
      } else if (mode === WORKSPACE_MODES.BRANCH) {
        const exists = Boolean(expectedDir && fs.existsSync(expectedDir) && isGitRepo(expectedDir));
        const info = {
          agent: agentName,
          mode,
          dir: expectedDir,
          branch: expectedBranch,
          baseBranch,
          isolated: true,
          merged: Boolean(entry.merged),
          rehydrated: true,
          status: exists ? 'ready' : 'missing',
          createdAt: entry.createdAt || new Date().toISOString()
        };
        this.workspaces.set(agentName, info);
        restored.push(info);
      }
    }
    return restored;
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
    const targetDir = path.resolve(this.worktreeRoot, cleanAgent);
    this._assertSafeWorktreeTarget(targetDir);
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
    const shaCache = new Map();
    const inheritFilesCache = new Map();
    return [...this.workspaces.values()].map((w) => {
      let headSha = null;
      if (w.dir) {
        if (!shaCache.has(w.dir)) shaCache.set(w.dir, this.getHeadSha(w.dir));
        headSha = shaCache.get(w.dir);
      }
      let changedFiles;
      if (!w.isolated && w.dir) {
        if (!inheritFilesCache.has(w.dir)) inheritFilesCache.set(w.dir, this.listChangedFiles(w.agent));
        changedFiles = inheritFilesCache.get(w.dir);
      } else {
        changedFiles = this.listChangedFiles(w.agent);
      }
      return {
        ...w,
        headSha,
        changedFiles
      };
    });
  }

  /**
   * Return files changed in the agent's workspace (committed on its branch + uncommitted working tree).
   */
  listChangedFiles(agentName) {
    const ws = this.workspaces.get(agentName);
    if (!ws || !ws.dir || !isGitRepo(ws.dir)) return [];
    const files = new Set();
    try {
      const statusOut = runGit(ws.dir, ['-c', 'core.quotePath=false', 'status', '--porcelain', '-uall'], {
        trimLeading: false
      });
      for (const line of statusOut.split(/\r?\n/).filter(Boolean)) {
        let f = line.slice(3).trim();
        if (f.includes(' -> ')) f = f.split(' -> ').pop().trim();
        f = f.replace(/^"|"$/g, '');
        if (f) files.add(f.replace(/\\/g, '/'));
      }
    } catch {}
    if (ws.isolated && ws.baseBranch) {
      try {
        const diffOut = runGit(ws.dir, ['-c', 'core.quotePath=false', 'diff', '--name-only', `${ws.baseBranch}...HEAD`]);
        for (const f of diffOut.split('\n').filter(Boolean)) {
          files.add(f.trim().replace(/\\/g, '/'));
        }
      } catch {}
    }
    return [...files].sort();
  }

  /**
   * Structured git status summary for an agent's workspace.
   */
  getStatus(agentName) {
    const ws = this.workspaces.get(agentName);
    if (!ws || !ws.dir || !isGitRepo(ws.dir)) {
      return { available: false, agent: agentName, branch: null, headSha: null, changedFiles: [], porcelain: '' };
    }
    let porcelain = '';
    try {
      porcelain = runGit(ws.dir, ['status', '--porcelain'], { trimLeading: false });
    } catch {}
    return {
      available: true,
      agent: agentName,
      mode: ws.mode,
      dir: ws.dir,
      branch: ws.branch,
      baseBranch: ws.baseBranch,
      headSha: this.getHeadSha(ws.dir),
      merged: Boolean(ws.merged),
      changedFiles: this.listChangedFiles(agentName),
      porcelain
    };
  }

  /**
   * Produce unified git diff for an agent's branch (committed vs baseBranch + working tree).
   */
  getDiff(agentName, { base = null, maxChars = 24_000 } = {}) {
    const ws = this.workspaces.get(agentName);
    if (!ws || !ws.dir || !isGitRepo(ws.dir)) {
      throw new Error(`成员 @${agentName} 没有可用的 Git 工作区`);
    }
    const parts = [];
    const baseRef = base || ws.baseBranch;
    if (baseRef && (String(baseRef).startsWith('-') || !/^[A-Za-z0-9._/@~^-]+$/.test(String(baseRef)))) {
      throw new Error(`安全拦截：非法 git 基线引用 "${baseRef}"`);
    }
    if (ws.isolated && baseRef) {
      try {
        const committedDiff = runGit(ws.dir, ['diff', `${baseRef}...HEAD`, '--'], { trimLeading: false });
        if (committedDiff.trim()) parts.push(committedDiff);
      } catch {}
    }
    try {
      const workingDiff = runGit(ws.dir, ['diff', 'HEAD', '--'], { trimLeading: false });
      if (workingDiff.trim() && !parts.includes(workingDiff)) {
        parts.push(workingDiff);
      }
    } catch {}
    if (parts.length === 0 && ws.isolated && ws.merged) {
      try {
        const lastCommitDiff = runGit(ws.dir, ['show', '--no-color', '--format=commit %h · %s', 'HEAD'], {
          trimLeading: false
        });
        if (lastCommitDiff.trim()) parts.push(lastCommitDiff);
      } catch {}
    }
    const combined = parts.join('\n').trim();
    return combined.length > maxChars ? `${combined.slice(0, maxChars)}\n... (diff 已截断)` : combined;
  }

  /**
   * Read recent git commit log entries for an agent's workspace.
   */
  getLog(agentName, { limit = 10 } = {}) {
    const ws = this.workspaces.get(agentName);
    if (!ws || !ws.dir || !isGitRepo(ws.dir)) return [];
    try {
      const out = runGit(ws.dir, ['log', `-n`, String(limit), '--pretty=format:%h%x1f%an%x1f%aI%x1f%s']);
      if (!out) return [];
      return out.split(/\r?\n/).map((line) => {
        const [sha, author, date, subject] = line.split('\x1f');
        return { sha, author, date, subject };
      });
    } catch {
      return [];
    }
  }

  /**
   * Safely push an isolated agent branch to a remote after protected-branch & OwnershipGuard verification.
   */
  pushBranch(agentName, { remote = 'origin', force = false, protectedBranches = PROTECTED_BRANCHES_DEFAULT } = {}) {
    if (force) {
      throw new Error('安全门禁拦截：严禁使用 force 强推远端分支');
    }
    const cleanRemote = String(remote || 'origin').trim();
    if (!cleanRemote || cleanRemote.startsWith('-') || !/^[A-Za-z0-9._-]+$/.test(cleanRemote)) {
      throw new Error(`安全门禁拦截：非法远端名 "${remote}"`);
    }
    const ws = this.workspaces.get(agentName);
    if (!ws || !ws.dir || !isGitRepo(ws.dir)) {
      throw new Error(`成员 @${agentName} 没有可用的 Git 工作区`);
    }
    const branch = ws.branch || runGit(ws.dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (!branch || branch.startsWith('-') || protectedBranches.some((pat) => matchGlob(branch, pat))) {
      throw new Error(`安全门禁拦截：禁止推送受保护分支 "${branch}"，请先在隔离工作分支提交并通过复核/MR 合入`);
    }

    const changed = this.listChangedFiles(agentName);
    if (this.ownershipGuard && changed.length > 0) {
      const audit = this.ownershipGuard.auditChangedFiles(agentName, changed);
      if (!audit.passed) {
        const details = audit.violations.map((v) => `${v.path}: ${v.reason}`).join('; ');
        throw new Error(`文件所有权守卫拦截推送：${details}`);
      }
    }

    runGit(ws.dir, ['push', '-u', '--', cleanRemote, branch]);
    return {
      pushed: true,
      remote: cleanRemote,
      branch,
      sha: this.getHeadSha(ws.dir),
      files: changed
    };
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

    // Prevent silently losing uncommitted edits inside isolated worktrees before marking merged
    const dirtyWs = runGit(ws.dir, ['-c', 'core.quotePath=false', 'status', '--porcelain', '-uall'], {
      trimLeading: false
    }).trim();
    if (dirtyWs) {
      throw new Error(`成员 @${agentName} 工作区尚有未提交改动，请先 commitChanges() 后再合并，防止丢失改动`);
    }

    if (ws.baseBranch) {
      const currentBase = this.getCurrentBranch();
      if (currentBase !== ws.baseBranch) {
        throw new Error(`主仓库当前分支为 "${currentBase}"，与目标基线分支 "${ws.baseBranch}" 不一致，已中止合并`);
      }
    }

    if (ws.mode === WORKSPACE_MODES.BRANCH) {
      runGit(this.repoPath, ['fetch', ws.dir, `${ws.branch}:${ws.branch}`]);
    }

    const msg = commitMessage || `chore(swarm): merge ${ws.branch} from @${agentName}`;
    try {
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
    } catch (err) {
      try {
        runGit(this.repoPath, ['merge', '--abort']);
      } catch {}
      throw err;
    }
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

  _assertSafeWorktreeTarget(targetDir) {
    if (!this.worktreeRoot) {
      throw new Error('worktreeRoot 未初始化');
    }
    const canonical = (p) => {
      const abs = path.resolve(p);
      let probe = abs;
      const tail = [];
      while (!fs.existsSync(probe)) {
        const parent = path.dirname(probe);
        if (parent === probe) break;
        tail.unshift(path.basename(probe));
        probe = parent;
      }
      let base = probe;
      if (fs.existsSync(probe)) {
        try {
          base = fs.realpathSync.native ? fs.realpathSync.native(probe) : fs.realpathSync(probe);
        } catch {}
      }
      const full = tail.length ? path.join(base, ...tail) : base;
      return process.platform === 'win32' ? full.toLowerCase() : full;
    };
    const absRoot = canonical(this.worktreeRoot);
    const absTarget = canonical(targetDir);
    const rel = path.relative(absRoot, absTarget);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`安全拦截：工作树目录 "${targetDir}" 越出 worktreeRoot 边界`);
    }
    if (this.repoPath && absTarget === canonical(this.repoPath)) {
      throw new Error('安全拦截：禁止操作主仓库根目录作为隔离工作树');
    }
  }

  _forceRemovePath(targetDir) {
    try {
      this._assertSafeWorktreeTarget(targetDir);
      fs.rmSync(targetDir, { recursive: true, force: true, maxRetries: 4, retryDelay: 120 });
    } catch {}
  }
}
