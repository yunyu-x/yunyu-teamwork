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

const READ_ONLY_NAMES = new Set(['qa', 'verifier', 'reviewer', 'researcher']);

function isReadOnlyMember(member) {
  const role = String(member?.role || '').trim().toLowerCase();
  const name = String(member?.name || '').trim().toLowerCase();
  return READ_ONLY_ROLES.has(role) || READ_ONLY_NAMES.has(name);
}

const SENSITIVE_ENV_RE = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|COOKIE|AUTH|PRIVATE|CREDENTIAL|BEARER|DATABASE_URL|POSTGRES|REDIS|SSH_AUTH_SOCK|AWS_SESSION)/i;

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
export function createGuardedWorkspaceTools({ swarm, member, ownership, worktrees, gitlab, skipSyncHooks = false }) {
  const cwd = member.workspaceDir || swarm.repoPath;
  const runSyncToolPolicy = (event, payload) => {
    if (skipSyncHooks || !swarm?.plugins?.hooks) return null;
    const pre = swarm.plugins.hooks.runSyncPolicies(event, payload);
    return pre.allowed ? null : pre;
  };

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
      const blocked = runSyncToolPolicy('PreToolUse', {
        tool: 'write_file',
        member: member.name,
        input: { path: rel, content: String(content ?? '').slice(0, 8000) }
      });
      if (blocked) {
        return { ok: false, blockedByHook: true, error: `生命周期 Hook 拒绝写入: ${blocked.reason}` };
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
      const blocked = runSyncToolPolicy('PreToolUse', {
        tool: 'edit_file',
        member: member.name,
        input: { path: rel, replacement: String(replacement ?? '').slice(0, 8000) }
      });
      if (blocked) {
        return { ok: false, blockedByHook: true, error: `生命周期 Hook 拒绝编辑: ${blocked.reason}` };
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
      if (isReadOnlyMember(member)) {
        return {
          ok: false,
          error: `安全铁律拦截：只读角色 @${member.name} (${member.role}) 禁止调用任意 run_command，请改用受控的 run_verification 或 git_review_branch`
        };
      }
      const blocked = runSyncToolPolicy('PreToolUse', {
        tool: 'run_command',
        member: member.name,
        command,
        input: { command }
      });
      if (blocked) {
        return { ok: false, blockedByHook: true, error: `生命周期 Hook 拦截命令执行: ${blocked.reason}` };
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
      const blockedTool = runSyncToolPolicy('PreToolUse', { tool: 'git_commit', member: member.name, input: { message } });
      if (blockedTool) return { ok: false, blockedByHook: true, error: `生命周期 Hook 拦截提交: ${blockedTool.reason}` };
      const blockedCommit = runSyncToolPolicy('PreCommit', { tool: 'git_commit', member: member.name, text: message, input: { message } });
      if (blockedCommit) return { ok: false, blockedByHook: true, error: `PreCommit Hook 拦截提交: ${blockedCommit.reason}` };
      return worktrees.commitChanges(member.name, message);
    },

    git_push({ remote = 'origin', force = false } = {}) {
      const blocked = runSyncToolPolicy('PreToolUse', { tool: 'git_push', member: member.name, input: { remote, force } });
      if (blocked) return { ok: false, blockedByHook: true, error: `生命周期 Hook 拦截推送: ${blocked.reason}` };
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

    skill_list() {
      if (!swarm?.plugins?.registry) return { skills: [] };
      return {
        skills: swarm.plugins.registry.listSkills({ enabledOnly: true }).map((s) => ({
          id: s.id,
          name: s.name,
          pluginId: s.pluginId,
          description: s.description,
          triggers: s.triggers
        }))
      };
    },

    skill_match({ text = '', limit = 5 } = {}) {
      if (!swarm?.plugins?.skills) return { matched: [] };
      return {
        matched: swarm.plugins.skills.matchSkills({ text, member, limit }).map((s) => ({
          id: s.id,
          name: s.name,
          pluginId: s.pluginId,
          score: s.score,
          description: s.description
        }))
      };
    },

    skill_read({ skillId }) {
      if (!swarm?.plugins?.registry) return { error: '插件中心未启用' };
      const skill = swarm.plugins.registry.getSkill(skillId);
      if (!skill) return { error: `未找到技能: ${skillId}` };
      return skill;
    },

    mcp_connector_list() {
      if (!swarm?.plugins?.mcpClients) return { servers: [], tools: [] };
      return {
        servers: swarm.plugins.mcpClients.listServers(),
        tools: swarm.plugins.mcpClients.getAllDiscoveredTools()
      };
    },

    async mcp_connector_call({ serverId, toolName, args = {} }) {
      if (isReadOnlyMember(member)) {
        return {
          ok: false,
          error: `安全铁律拦截：只读角色 @${member.name} (${member.role}) 禁止直接调用外部写操作 MCP 连接器`
        };
      }
      if (!swarm?.plugins?.mcpClients) return { error: '外部 MCP 客户端管理器未启用' };
      return await swarm.plugins.mcpClients.callTool(serverId, toolName, args);
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

/**
 * Execute a guarded workspace tool or dynamically bridged external MCP tool
 * with full async PreToolUse / PostToolUse lifecycle hooks.
 */
export async function invokeToolWithHooks(tools, toolName, args = {}, { swarm = null, member = null } = {}) {
  const cwd = member?.workspaceDir || swarm?.repoPath || null;

  // Enforce Hard Invariant #3 BEFORE running hooks so read-only roles can never escalate via hooks or external MCP
  if (isReadOnlyMember(member)) {
    if (toolName === 'run_command') {
      return {
        ok: false,
        error: `安全铁律拦截：只读角色 @${member.name} (${member.role}) 禁止调用任意 run_command，请改用受控的 run_verification 或 git_review_branch`
      };
    }
    if (toolName === 'mcp_connector_call' || toolName.startsWith('mcp__')) {
      return {
        ok: false,
        error: `安全铁律拦截：只读角色 @${member.name} (${member.role}) 禁止直接调用外部 MCP 工具 ${toolName}`
      };
    }
  }

  if (swarm?.plugins?.hooks) {
    const pre = await swarm.plugins.hooks.run(
      'PreToolUse',
      {
        swarmId: swarm?.id,
        member: member?.name,
        role: member?.role,
        tool: toolName,
        command: args?.command,
        input: args
      },
      { cwd }
    );
    if (!pre.allowed) {
      return {
        ok: false,
        blockedByHook: true,
        error: `生命周期 Hook 拦截工具 ${toolName}: ${pre.reason}`,
        hookResults: pre.results
      };
    }
    if (toolName === 'git_commit') {
      const preCommit = await swarm.plugins.hooks.run(
        'PreCommit',
        { swarmId: swarm?.id, member: member?.name, tool: 'git_commit', text: args?.message, input: args },
        { cwd }
      );
      if (!preCommit.allowed) {
        return {
          ok: false,
          blockedByHook: true,
          error: `PreCommit Hook 拦截提交: ${preCommit.reason}`,
          hookResults: preCommit.results
        };
      }
    }
  }

  let output;
  let threw = false;
  try {
    const fn = tools?.[toolName];
    if (typeof fn === 'function') {
      output = await fn(args);
    } else if (toolName.startsWith('mcp__') && swarm?.plugins?.mcpClients) {
      const discovered = swarm.plugins.mcpClients.getAllDiscoveredTools();
      const match = discovered.find((t) => t.namespacedName === toolName);
      if (!match) {
        output = { error: `未知或未连接的外部 MCP 工具: ${toolName}` };
      } else {
        output = await swarm.plugins.mcpClients.callTool(match.serverId, match.toolName, args);
      }
    } else {
      output = { error: `未知工具: ${toolName}` };
    }
    return output;
  } catch (err) {
    threw = true;
    throw err;
  } finally {
    if (swarm?.plugins?.hooks) {
      await swarm.plugins.hooks
        .run(
          'PostToolUse',
          {
            swarmId: swarm?.id,
            member: member?.name,
            tool: toolName,
            ok: !threw && output?.ok !== false && !output?.error
          },
          { cwd }
        )
        .catch(() => {});
    }
  }
}
