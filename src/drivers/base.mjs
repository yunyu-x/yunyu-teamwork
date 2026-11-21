import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { MEMBER_ROLES } from '../core/constants.mjs';
import { ResearchEngine } from '../core/research.mjs';

const READ_ONLY_ROLES = new Set([
  MEMBER_ROLES.VERIFIER,
  MEMBER_ROLES.REVIEWER,
  MEMBER_ROLES.RESEARCHER,
  'qa'
]);

const SENSITIVE_ENV_RE = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|COOKIE|AUTH|PRIVATE)/i;

function sanitizeChildEnv() {
  const clean = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === 'NODE_TEST_CONTEXT') continue;
    if (SENSITIVE_ENV_RE.test(k)) continue;
    clean[k] = v;
  }
  return clean;
}

const ALLOWED_VERIFY_COMMANDS = new Map([
  ['npm test', ['npm', ['test']]],
  ['npm run test', ['npm', ['test']]],
  ['npm run check', ['npm', ['run', 'check']]],
  ['npm run audit', ['npm', ['run', 'audit']]],
  ['npm run verify', ['npm', ['run', 'verify']]],
  ['npm run test:unit', ['npm', ['run', 'test:unit']]],
  ['npm run test:integration', ['npm', ['run', 'test:integration']]]
]);

function parseSafeVerificationCommand(rawCommand) {
  const cmd = String(rawCommand || 'npm test').trim();
  if (ALLOWED_VERIFY_COMMANDS.has(cmd)) {
    return ALLOWED_VERIFY_COMMANDS.get(cmd);
  }
  // Allow `node --test <safe-relative-test-paths>` or `node --check <safe-relative-path>` without shell metacharacters
  if (/^node\s+--(?:test|check)(?:\s+[A-Za-z0-9._/*-]+)+$/.test(cmd)) {
    const parts = cmd.split(/\s+/);
    return [process.execPath, parts.slice(1)];
  }
  return null;
}

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
 * Resolve a relative path strictly inside rootDir, blocking lexical traversal and symlink escapes.
 */
export function resolveInsideWorkspace(rootDir, relPath) {
  if (!rootDir) throw new Error('当前成员未绑定本地工作区目录');
  const absRoot = path.resolve(rootDir);
  const absTarget = path.resolve(absRoot, relPath);
  const rel = path.relative(absRoot, absTarget);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`安全拦截：路径 "${relPath}" 越出工作区根目录`);
  }

  // Symlink containment check via realpathSync on existing target or nearest existing parent
  if (fs.existsSync(absRoot)) {
    const realRoot = fs.realpathSync(absRoot);
    let probe = absTarget;
    while (!fs.existsSync(probe)) {
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
    if (fs.existsSync(probe)) {
      const realProbe = fs.realpathSync(probe);
      const realRel = path.relative(realRoot, realProbe);
      if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
        throw new Error(`安全拦截：符号链接路径 "${relPath}" 越出工作区根目录`);
      }
    }
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
      if (READ_ONLY_ROLES.has(member.role) || ['qa', 'verifier', 'reviewer', 'researcher'].includes(member.name)) {
        return {
          ok: false,
          error: `安全铁律拦截：只读角色 @${member.name} (${member.role}) 禁止调用任意 run_command，请改用受控的 run_verification 或 git_review_branch`
        };
      }
      try {
        const cleanEnv = sanitizeChildEnv();
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

    git_status({ targetMember = null } = {}) {
      return worktrees.getStatus(targetMember || member.name);
    },

    git_diff({ targetMember = null, base = null } = {}) {
      return {
        member: targetMember || member.name,
        diff: worktrees.getDiff(targetMember || member.name, { base })
      };
    },

    git_log({ targetMember = null, limit = 10 } = {}) {
      return {
        member: targetMember || member.name,
        commits: worktrees.getLog(targetMember || member.name, { limit })
      };
    },

    git_commit({ message }) {
      return worktrees.commitChanges(member.name, message);
    },

    git_push({ remote = 'origin', force = false } = {}) {
      return worktrees.pushBranch(member.name, { remote, force });
    },

    git_review_branch({ targetMember }) {
      if (!targetMember) return { error: '缺少 targetMember 参数' };
      const status = worktrees.getStatus(targetMember);
      const diff = worktrees.getDiff(targetMember);
      const audit = ownership.auditChangedFiles(targetMember, status.changedFiles || []);
      const commits = worktrees.getLog(targetMember, { limit: 5 });
      return {
        targetMember,
        branch: status.branch,
        headSha: status.headSha,
        changedFiles: status.changedFiles,
        audit,
        commits,
        diff
      };
    },

    run_verification({ command = 'npm test', timeoutMs = 30_000 } = {}) {
      if (!cwd) return { passed: false, error: '未绑定工作区目录' };
      const parsedCmd = parseSafeVerificationCommand(command);
      if (!parsedCmd) {
        return {
          passed: false,
          command,
          error: '安全门禁拦截：run_verification 仅允许执行白名单验证命令（npm test / npm run check / npm run audit / npm run verify / node --test <file> / node --check <file>）'
        };
      }
      const [bin, args] = parsedCmd;
      try {
        const cleanEnv = sanitizeChildEnv();
        const stdout = execFileSync(bin, args, {
          cwd,
          env: cleanEnv,
          encoding: 'utf8',
          timeout: timeoutMs,
          shell: process.platform === 'win32' && bin === 'npm',
          stdio: ['ignore', 'pipe', 'pipe']
        });
        return {
          passed: true,
          command,
          exitCode: 0,
          stdout: stdout.slice(0, 8000)
        };
      } catch (err) {
        return {
          passed: false,
          command,
          exitCode: err.status ?? 1,
          stdout: String(err.stdout || '').slice(0, 4000),
          stderr: String(err.stderr || err.message || '').slice(0, 4000)
        };
      }
    },

    read_board({ since = 0, limit = 20, channel = null } = {}) {
      return swarm.board.read({ since, limit, channel, member: member.name });
    },

    post_message({ text, channel = 'main', kind = null }) {
      const msg = swarm.postMessage({ author: member.name, text, channel, kind });
      return { ok: true, seq: msg.seq };
    },

    research_workspace({ query, maxMatches = 10 }) {
      return {
        query,
        hits: ResearchEngine.searchWorkspace(cwd, query, { maxMatches })
      };
    },

    async research_web({ url }) {
      return await ResearchEngine.fetchWebSource(url, { allowPrivate: false });
    },

    knowledge_search({ q = '', category = 'all', tag = '', limit = 15 } = {}) {
      if (!swarm.knowledge) return { entries: [] };
      return { entries: swarm.knowledge.search({ q, category, tag, limit }) };
    },

    knowledge_save({ title, category = 'research', summary = '', content = '', sources = [], tags = [], linkedIssueId = null }) {
      if (!swarm.knowledge) return { error: 'KnowledgeVault 未启用' };
      return swarm.knowledge.addEntry({
        title,
        category,
        summary,
        content,
        sources,
        tags,
        author: member.name,
        linkedIssueId
      });
    },

    issue_ready() {
      return { readyTasks: swarm.tasks?.listReadyTasks({ excludeClaimedByOthersFor: member.name }) || [] };
    },

    issue_claim({ taskId, ttlMs = 300_000 }) {
      return swarm.tasks.claimTask(taskId, member.name, { ttlMs });
    },

    world_model_overview({ refresh = false } = {}) {
      if (!swarm.repoPath) return { available: false, reason: '未绑定仓库路径' };
      return refresh ? swarm.refreshWorldModel() : swarm.getWorldModelOverview();
    },

    world_model_impact({ targets = [] } = {}) {
      if (!swarm.repoPath) return { error: '未绑定仓库路径' };
      return swarm.simulateChangeImpact(targets);
    },

    wiki_list({ q = '', category = 'all' } = {}) {
      if (!swarm.wiki) return { pages: [] };
      return { pages: swarm.wiki.search({ q, category, limit: 30 }) };
    },

    wiki_read({ slug }) {
      if (!swarm.wiki) return { error: 'Wiki 未初始化' };
      const page = swarm.wiki.getPage(slug);
      return page || { error: `未找到 Wiki 页面: ${slug}` };
    },

    wiki_upsert({ slug, title, category = 'custom', content = '', summary = '更新 Wiki 档案', tags = [] }) {
      if (!swarm.wiki) return { error: 'Wiki 未初始化' };
      return swarm.wiki.upsertPage({
        slug,
        title,
        category,
        content,
        summary,
        tags,
        author: member.name
      });
    },

    project_audit({ createIssues = false } = {}) {
      if (!swarm.repoPath) return { error: '未绑定仓库路径' };
      return swarm.runProjectAudit({ createIssues: Boolean(createIssues), author: member.name });
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
