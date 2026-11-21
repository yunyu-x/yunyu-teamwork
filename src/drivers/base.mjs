import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Abstract base class for all heterogeneous Agent Drivers in Yunyu Teamwork.
 */
export class AgentDriver {
  constructor(id, description = '') {
    this.id = id;
    this.description = description;
  }

  /**
   * Execute a single woken turn for a member.
   * @returns {Promise<{ reply?: string, channel?: string, kind?: string, metadata?: object, alreadyPosted?: boolean, tokensUsed?: number }>}
   */
  async executeTurn(_ctx) {
    throw new Error(`Driver "${this.id}" 未实现 executeTurn()`);
  }
}

/**
 * Resolve a relative path strictly inside rootDir, blocking path traversal escapes.
 */
export function resolveInsideWorkspace(rootDir, relPath) {
  if (!rootDir) throw new Error('当前成员未绑定本地工作区目录');
  const absRoot = path.resolve(rootDir);
  const absTarget = path.resolve(absRoot, relPath);
  const rel = path.relative(absRoot, absTarget);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`安全拦截：路径 "${relPath}" 越出工作区根目录`);
  }
  return { absRoot, absTarget, rel: rel.replace(/\\/g, '/') };
}

/**
 * Create a standardized, OwnershipGuard-enforced toolset that any LLM/script driver can invoke.
 */
export function createGuardedWorkspaceTools({ swarm, member, ownership, worktrees, gitlab }) {
  const cwd = member.workspaceDir || swarm.repoPath;

  return {
    read_file({ path: relPath, maxBytes = 32_768 }) {
      const { absTarget } = resolveInsideWorkspace(cwd, relPath);
      if (!fs.existsSync(absTarget)) return { error: `文件不存在: ${relPath}` };
      const buf = fs.readFileSync(absTarget);
      return {
        path: relPath,
        bytes: buf.length,
        content: buf.subarray(0, maxBytes).toString('utf8'),
        truncated: buf.length > maxBytes
      };
    },

    list_files({ dir = '.' } = {}) {
      const { absTarget, absRoot } = resolveInsideWorkspace(cwd, dir);
      if (!fs.existsSync(absTarget)) return { error: `目录不存在: ${dir}` };
      const entries = fs
        .readdirSync(absTarget, { withFileTypes: true })
        .filter((e) => e.name !== '.git' && e.name !== 'node_modules' && e.name !== '.worktrees')
        .map((e) => ({
          name: e.name,
          type: e.isDirectory() ? 'dir' : 'file',
          path: path.relative(absRoot, path.join(absTarget, e.name)).replace(/\\/g, '/')
        }));
      return { dir, entries };
    },

    write_file({ path: relPath, content }) {
      const { absTarget, rel } = resolveInsideWorkspace(cwd, relPath);
      const check = ownership.checkWrite(member.name, rel);
      if (!check.allowed) {
        return { error: `文件所有权守卫拒绝写入: ${check.reason}` };
      }
      fs.mkdirSync(path.dirname(absTarget), { recursive: true });
      fs.writeFileSync(absTarget, String(content ?? ''), 'utf8');
      return { ok: true, path: rel, bytes: Buffer.byteLength(String(content ?? ''), 'utf8') };
    },

    edit_file({ path: relPath, target, replacement }) {
      const { absTarget, rel } = resolveInsideWorkspace(cwd, relPath);
      const check = ownership.checkWrite(member.name, rel);
      if (!check.allowed) {
        return { error: `文件所有权守卫拒绝编辑: ${check.reason}` };
      }
      if (!fs.existsSync(absTarget)) return { error: `文件不存在: ${rel}` };
      const src = fs.readFileSync(absTarget, 'utf8');
      if (!src.includes(target)) return { error: `未找到精确替换目标片段` };
      const updated = src.replace(target, replacement);
      fs.writeFileSync(absTarget, updated, 'utf8');
      return { ok: true, path: rel };
    },

    run_command({ command, timeoutMs = 20_000 }) {
      if (!cwd) return { error: '未绑定工作区目录' };
      try {
        const cleanEnv = { ...process.env };
        delete cleanEnv.NODE_TEST_CONTEXT;
        const stdout = execSync(command, {
          cwd,
          env: cleanEnv,
          encoding: 'utf8',
          timeout: timeoutMs,
          stdio: ['ignore', 'pipe', 'pipe']
        });
        return { ok: true, exitCode: 0, stdout: stdout.slice(0, 8000) };
      } catch (err) {
        return {
          ok: false,
          exitCode: err.status ?? 1,
          stdout: String(err.stdout || '').slice(0, 4000),
          stderr: String(err.stderr || err.message || '').slice(0, 4000)
        };
      }
    },

    git_commit({ message }) {
      return worktrees.commitChanges(member.name, message);
    },

    read_board({ since = 0, limit = 20, channel = null } = {}) {
      return swarm.board.read({ since, limit, channel, member: member.name });
    },

    post_message({ text, channel = 'main', kind = null }) {
      const msg = swarm.postMessage({ author: member.name, text, channel, kind });
      return { ok: true, seq: msg.seq };
    },

    async gitlab_comment_issue({ issueIid, body }) {
      if (!gitlab?.client || !gitlab?.projectId) return { error: '未配置 GitLab 连接' };
      const note = await gitlab.client.createIssueNote(gitlab.projectId, issueIid, body);
      return { ok: true, noteId: note.id };
    },

    async gitlab_create_mr({ title, description, sourceBranch = null, targetBranch = 'main' }) {
      if (!gitlab?.client || !gitlab?.projectId) return { error: '未配置 GitLab 连接' };
      const src = sourceBranch || member.branch;
      const mr = await gitlab.client.createMergeRequest(gitlab.projectId, {
        source_branch: src,
        target_branch: targetBranch,
        title,
        description
      });
      return { ok: true, iid: mr.iid, webUrl: mr.web_url };
    }
  };
}
