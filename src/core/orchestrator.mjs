import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  DEFAULT_CONFIG,
  MEMBER_ROLES,
  MEMBER_STATES,
  MESSAGE_KINDS,
  RESERVED_NAMES,
  WORKSPACE_MODES
} from './constants.mjs';
import { ProjectAuditor } from './auditor.mjs';
import { MessageBoard } from './board.mjs';
import { StallMonitor } from './monitor.mjs';
import { BudgetGovernor } from './budget.mjs';
import { KnowledgeVault } from './knowledge.mjs';
import { OwnershipGuard } from './ownership.mjs';
import { SwarmStorage } from './storage.mjs';
import { TaskTracker } from './tasks.mjs';
import { TEAM_TEMPLATES } from './templates.mjs';
import { ProjectWiki } from './wiki.mjs';
import { ProjectWorldModel } from './world-model.mjs';
import { WorktreeManager } from './worktree.mjs';
import { GitLabClient } from '../gitlab/client.mjs';
import { GitLabSyncService } from '../gitlab/sync.mjs';
import { PluginHub } from '../plugins/hub.mjs';

function sanitizeForStorage(val) {
  if (val === null || val === undefined) return val;
  if (typeof val === 'function' || typeof val === 'symbol') return undefined;
  if (Array.isArray(val)) {
    return val.map(sanitizeForStorage).filter((x) => x !== undefined);
  }
  if (typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      const clean = sanitizeForStorage(v);
      if (clean !== undefined) out[k] = clean;
    }
    return out;
  }
  return val;
}

const SENSITIVE_FIELD_RE = /(key|token|secret|password|passwd|authorization|cookie|private)/i;

function redactWebhookUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl));
    for (const k of [...u.searchParams.keys()]) {
      if (SENSITIVE_FIELD_RE.test(k)) u.searchParams.set(k, '***');
    }
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '***';
  }
}

export function redactDriverConfigForPublic(cfg = {}) {
  const clean = sanitizeForStorage(cfg) || {};
  const maskObj = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(maskObj);
    const res = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'env' && v && typeof v === 'object') {
        res[k] = Object.fromEntries(Object.keys(v).map((ek) => [ek, '***']));
      } else if (k === 'headers' && v && typeof v === 'object') {
        const maskedHeaders = {};
        for (const [hk, hv] of Object.entries(v)) {
          maskedHeaders[hk] = SENSITIVE_FIELD_RE.test(hk) ? '***' : hv;
        }
        res[k] = maskedHeaders;
      } else if (k === 'webhookUrl' && typeof v === 'string' && v.length > 0) {
        res[k] = redactWebhookUrl(v);
      } else if (SENSITIVE_FIELD_RE.test(k) && typeof v === 'string' && v.length > 0) {
        res[k] = '***';
      } else if (v && typeof v === 'object') {
        res[k] = maskObj(v);
      } else {
        res[k] = v;
      }
    }
    return res;
  };
  return maskObj(clean);
}

export function validateGitLabTokenEnvName(tokenEnv = 'GITLAB_TOKEN') {
  const clean = String(tokenEnv || 'GITLAB_TOKEN').trim();
  if (!/^(?:YUNYU_[A-Z0-9_]*GITLAB|GITLAB)[A-Z0-9_]*TOKEN$/.test(clean)) {
    throw new Error(`安全拦截：tokenEnv 必须符合 GITLAB_*TOKEN 命名白名单，拒绝读取 "${clean}"`);
  }
  return clean;
}

/**
 * Single Swarm instance: combines an immutable MessageBoard, Roster, OwnershipGuard,
 * Git WorktreeManager, StallMonitor, Heterogeneous Agent Drivers, and optional GitLab sync.
 */
export class SwarmInstance extends EventEmitter {
  constructor({
    id,
    title,
    repoPath = null,
    worktreeRoot = null,
    storage = null,
    driverRegistry = null,
    plugins = null,
    contract = null,
    gitlab = null,
    budget = null,
    language = DEFAULT_CONFIG.defaultLang,
    enableMonitor = true,
    monitorIntervalMs = DEFAULT_CONFIG.monitorIntervalMs,
    stallThresholdMs = DEFAULT_CONFIG.stallThresholdMs,
    createdAt = null
  }) {
    super();
    this.id = id;
    this.title = title || `云驭协同蜂群 · ${id}`;
    this.repoPath = repoPath;
    this.language = language;
    this.createdAt = createdAt || new Date().toISOString();
    this.storage = storage;
    this.driverRegistry = driverRegistry;
    this.plugins = plugins;
    this.gitlab = gitlab; // { client, projectId, sync, linkedIssueIid, linkedMrIid }
    this.members = new Map();
    this._activeDispatches = new Map(); // memberName -> Promise
    this._waiters = new Map(); // memberName -> Array<{ since, mentionsOnly, resolve }>
    this.agentLogs = [];
    this.ownership = new OwnershipGuard(contract);
    this.worktrees = new WorktreeManager({
      repoPath,
      worktreeRoot,
      swarmId: id,
      ownershipGuard: this.ownership
    });
    this.board = new MessageBoard({ swarmId: id, storage, defaultLang: language });
    this.tasks = new TaskTracker({ swarmId: id, storage });
    this.tasks.on('task', (payload) => {
      this.emit('task', payload);
      if (this.plugins?.hooks && (payload?.op === 'update' || payload?.op === 'accept')) {
        this.plugins.hooks
          .run('OnIssueTransition', {
            swarmId: this.id,
            taskId: payload.task?.id,
            status: payload.task?.status,
            assignee: payload.task?.assignee
          }, { cwd: this.repoPath })
          .catch(() => {});
      }
    });
    this.knowledge = new KnowledgeVault({ swarmId: id, storage });
    this.knowledge.on('knowledge', (payload) => {
      this.emit('knowledge', payload);
    });
    this.worldModel = repoPath ? new ProjectWorldModel({ repoPath, ownershipGuard: this.ownership }) : null;
    this.wiki = new ProjectWiki({ swarmId: id, storage });
    this.wiki.on('wiki', (payload) => {
      this.emit('wiki', payload);
    });
    this.lastAudit = null;
    this.budget = new BudgetGovernor(budget || {});
    this.monitor = new StallMonitor({
      swarm: this,
      intervalMs: monitorIntervalMs,
      stallThresholdMs
    });

    this._bindBoardEvents();
    if (enableMonitor) {
      this._ensureMonitorMember();
      this.monitor.start();
    }
  }

  _ensureMonitorMember() {
    if (!this.members.has('monitor')) {
      this.members.set('monitor', {
        name: 'monitor',
        role: MEMBER_ROLES.MONITOR,
        driver: 'builtin-monitor',
        model: 'watchdog-v1',
        workspaceMode: WORKSPACE_MODES.INHERIT,
        workspaceDir: this.repoPath,
        branch: null,
        state: MEMBER_STATES.WAITING,
        killed: false,
        channels: ['main'],
        owns: [],
        mustNotTouch: ['**'],
        brief: '内置防停滞看门狗：静默定时检测全员停滞并唤醒对应责任节点。',
        lastReadSeq: 0,
        lastPostSeq: 0,
        lastPostTime: null,
        turns: 0,
        tokensUsed: 0,
        lastError: null,
        driverConfig: {}
      });
    }
  }

  _bindBoardEvents() {
    this.board.on('message', (msg) => {
      this.monitor.recordActivity();
      const authorMember = this.members.get(msg.author);
      if (authorMember) {
        authorMember.lastPostSeq = msg.seq;
        authorMember.lastPostTime = msg.time;
        authorMember.lastReadSeq = Math.max(authorMember.lastReadSeq, msg.seq);
      }

      if (msg.kind === MESSAGE_KINDS.DONE) {
        this.monitor.stop();
      }

      try {
        this.tasks.onBoardMessage(msg, this);
      } catch {}

      this._saveMeta();
      this.emit('message', msg);
      this._resolveWaiters(msg);
      this._scheduleWakeups(msg);

      if (this.plugins?.hooks && !msg.metadata?.noWake) {
        this.plugins.hooks
          .run('OnMessage', {
            swarmId: this.id,
            seq: msg.seq,
            author: msg.author,
            channel: msg.channel,
            text: msg.text
          }, { cwd: this.repoPath })
          .catch(() => {});
      }

      if (this.plugins?.skills && !msg.metadata?.noWake && !msg.metadata?.commandExpanded && /^\/[a-zA-Z0-9_-]+/.test(msg.text.trim())) {
        const matchedCmd = this.plugins.skills.matchCommand(msg.text);
        if (matchedCmd) {
          this.postMessage({
            author: 'coordinator',
            text: `⚡ 【插件斜杠命令 \`/${matchedCmd.command.name}\` 已匹配】（来源插件：\`${matchedCmd.command.pluginId}\`）\n\n${matchedCmd.command.content}${matchedCmd.args ? `\n\n参数：\`${matchedCmd.args}\`` : ''}`,
            channel: msg.channel,
            kind: MESSAGE_KINDS.SYSTEM,
            metadata: { noWake: true, commandExpanded: true, pluginCommand: matchedCmd.command.id }
          });
        }
      }

      if (this.gitlab?.sync) {
        Promise.resolve(this.gitlab.sync.onBoardMessage(this, msg)).catch((err) => {
          if (this.listenerCount('error') > 0) this.emit('error', err);
        });
      }
    });

    this.board.on('translation', (payload) => {
      this.emit('translation', payload);
    });

    this.board.on('channel', (payload) => {
      this._saveMeta();
      this.emit('channel', payload);
    });
  }

  connectGitLab({
    baseUrl,
    projectId,
    token = '',
    tokenEnv = 'GITLAB_TOKEN',
    linkedIssueIid = null,
    linkedMrIid = null,
    mirrorKinds = null,
    persistToken = false
  } = {}) {
    if (!baseUrl || !projectId) {
      throw new Error('GitLab 连接缺少必要参数：baseUrl 与 projectId');
    }
    const safeTokenEnv = validateGitLabTokenEnvName(tokenEnv || 'GITLAB_TOKEN');
    const resolvedToken = token || process.env[safeTokenEnv] || '';
    const client = new GitLabClient({ baseUrl, token: resolvedToken });
    const sync = new GitLabSyncService({
      client,
      projectId,
      issueIid: linkedIssueIid,
      mrIid: linkedMrIid,
      mirrorKinds
    });
    this.gitlab = {
      client,
      sync,
      projectId,
      baseUrl: client.baseUrl,
      linkedIssueIid,
      linkedMrIid,
      tokenEnv: safeTokenEnv,
      mirrorKinds: [...sync.mirrorKinds],
      persistToken: Boolean(persistToken)
    };
    this._saveMeta();
    this.emit('status', this.getStatus());
    return this.gitlab;
  }

  rehydrate({ gitlabTokenResolver = null, defaultGitlabToken = '', autoRepairWorktrees = true } = {}) {
    this.board.replayFromStorage();
    this.tasks.replayFromStorage();
    this.knowledge.replayFromStorage();
    this.wiki.replayFromStorage();
    const meta = this.storage?.loadMeta(this.id);
    if (meta) {
      this.title = meta.title || this.title;
      this.language = meta.language || this.language;
      this.createdAt = meta.createdAt || this.createdAt;
      if (meta.worktreeRoot) this.worktrees.worktreeRoot = meta.worktreeRoot;
      if (meta.budget) this.budget.load(meta.budget);
      if (meta.contract) this.ownership.loadContract(meta.contract);
      if (Array.isArray(meta.members)) {
        for (const m of meta.members) {
          const driverConfig = sanitizeForStorage(m.driverConfig) || {};
          const sessionId = m.sessionId || driverConfig.sessionId || null;
          if (sessionId && !driverConfig.sessionId) driverConfig.sessionId = sessionId;
          this.members.set(m.name, {
            ...m,
            baseBranch: m.baseBranch || null,
            sessionId,
            driverConfig,
            state: m.killed ? MEMBER_STATES.KILLED : m.state === MEMBER_STATES.WORKING ? MEMBER_STATES.STOPPED : m.state
          });
          if (!m.killed && (m.owns || m.mustNotTouch)) {
            this.ownership.setMemberRule(m.name, {
              role: m.role,
              owns: m.owns || [],
              mustNotTouch: m.mustNotTouch || []
            });
          } else if (m.killed) {
            this.ownership.removeMemberRule(m.name);
          }
        }
      }

      // Restore Git Worktree mappings and reconcile member workspace metadata
      const restoredWorktrees = this.worktrees.rehydrate(meta.worktrees || [], [...this.members.values()], {
        autoRepair: autoRepairWorktrees
      });
      for (const ws of restoredWorktrees) {
        const mem = this.members.get(ws.agent);
        if (mem) {
          mem.workspaceMode = ws.mode;
          mem.workspaceDir = ws.dir;
          mem.branch = ws.branch;
          mem.baseBranch = ws.baseBranch;
        }
      }

      // Reconstruct GitLab Client & Bidirectional Sync Service if persisted
      if (!this.gitlab && meta.gitlab?.baseUrl && meta.gitlab?.projectId) {
        const gl = meta.gitlab;
        const tokenEnv = gl.tokenEnv || 'GITLAB_TOKEN';
        const resolvedToken =
          (typeof gitlabTokenResolver === 'function' ? gitlabTokenResolver(gl, this) : '') ||
          gl.token ||
          (tokenEnv ? process.env[tokenEnv] || '' : '') ||
          defaultGitlabToken ||
          '';
        const client = new GitLabClient({ baseUrl: gl.baseUrl, token: resolvedToken });
        const sync = new GitLabSyncService({
          client,
          projectId: gl.projectId,
          issueIid: gl.linkedIssueIid || null,
          mrIid: gl.linkedMrIid || null,
          mirrorKinds: gl.mirrorKinds || null
        });
        this.gitlab = {
          client,
          sync,
          projectId: gl.projectId,
          baseUrl: client.baseUrl,
          linkedIssueIid: gl.linkedIssueIid || null,
          linkedMrIid: gl.linkedMrIid || null,
          tokenEnv,
          mirrorKinds: [...sync.mirrorKinds],
          persistToken: Boolean(gl.persistToken),
          rehydrated: true
        };
      }
    }
    if (this.board.done) this.monitor.stop();
  }

  _serializeMembersForStorage() {
    return [...this.members.values()].map((m) => ({
      name: m.name,
      role: m.role,
      driver: m.driver,
      model: m.model,
      workspaceMode: m.workspaceMode,
      workspaceDir: m.workspaceDir,
      branch: m.branch,
      baseBranch: m.baseBranch || null,
      state: m.state,
      killed: m.killed,
      channels: this.board.getMemberChannels(m.name),
      owns: m.owns,
      mustNotTouch: m.mustNotTouch,
      brief: m.brief,
      lastReadSeq: m.lastReadSeq,
      lastPostSeq: m.lastPostSeq,
      lastPostTime: m.lastPostTime,
      turns: m.turns,
      tokensUsed: m.tokensUsed,
      lastError: m.lastError,
      sessionId: m.sessionId || m.driverConfig?.sessionId || null,
      driverConfig: sanitizeForStorage(m.driverConfig) || {},
      addedAt: m.addedAt || null
    }));
  }

  _saveMeta() {
    if (!this.storage) return;
    let gitlabMeta = null;
    if (this.gitlab) {
      gitlabMeta = {
        projectId: this.gitlab.projectId,
        baseUrl: this.gitlab.client?.baseUrl || this.gitlab.baseUrl || null,
        linkedIssueIid: this.gitlab.linkedIssueIid || null,
        linkedMrIid: this.gitlab.linkedMrIid || null,
        tokenEnv: this.gitlab.tokenEnv || 'GITLAB_TOKEN',
        mirrorKinds: this.gitlab.sync ? [...this.gitlab.sync.mirrorKinds] : this.gitlab.mirrorKinds || null,
        persistToken: Boolean(this.gitlab.persistToken)
      };
      if (this.gitlab.persistToken && this.gitlab.client?.token) {
        gitlabMeta.token = this.gitlab.client.token;
      }
    }
    this.storage.saveMeta(this.id, {
      id: this.id,
      title: this.title,
      repoPath: this.repoPath,
      worktreeRoot: this.worktrees.worktreeRoot,
      language: this.language,
      createdAt: this.createdAt,
      done: this.board.done,
      doneSummary: this.board.doneSummary,
      gitlab: gitlabMeta,
      budget: this.budget.toJSON(),
      worktrees: this.worktrees.exportState(),
      contract: {
        globalForbidden: this.ownership.globalForbidden,
        ownership: Object.fromEntries(
          [...this.ownership.rules.entries()].map(([k, v]) => [
            k,
            { role: v.role, owns: v.owns, mustNotTouch: v.mustNotTouch }
          ])
        )
      },
      members: this._serializeMembersForStorage()
    });
  }

  emitAgentLog({ member, stream = 'stdout', eventType = 'log', text = '', meta = null }) {
    const entry = {
      swarmId: this.id,
      member,
      stream,
      eventType,
      text: String(text || ''),
      meta: meta || null,
      time: new Date().toISOString()
    };
    this.agentLogs.push(entry);
    if (this.agentLogs.length > 300) this.agentLogs.shift();
    this.storage?.appendAgentLog?.(this.id, entry);
    this.emit('agent_log', entry);
    return entry;
  }

  getAgentLogs({ member = null, limit = 100 } = {}) {
    let list = this.agentLogs;
    if (list.length === 0 && this.storage?.readAgentLogs) {
      list = this.storage.readAgentLogs(this.id, { member, limit });
      return list;
    }
    if (member) list = list.filter((e) => e.member === member);
    return limit > 0 ? list.slice(-limit) : [...list];
  }

  resetMemberSession(memberName) {
    const member = this.members.get(memberName);
    if (!member) throw new Error(`未找到成员 "${memberName}"`);
    member.sessionId = null;
    if (member.driverConfig) {
      delete member.driverConfig.sessionId;
    }
    this._saveMeta();
    this.emit('status', this.getStatus());
    return member;
  }

  setTitle(title) {
    this.title = String(title || '').trim() || this.title;
    this._saveMeta();
    this.emit('status', this.getStatus());
    return this.title;
  }

  /**
   * Add one member (or a numbered group via `n` or `tasks`) to the swarm roster.
   */
  addMember({
    name,
    role = MEMBER_ROLES.AUTHOR,
    driver = 'simulated',
    model = 'default',
    workspace = WORKSPACE_MODES.INHERIT,
    brief = '',
    channels = ['main'],
    owns = [],
    mustNotTouch = [],
    driverConfig = {},
    postedBy = 'coordinator',
    postBrief = true,
    n = 1,
    tasks = null
  }) {
    const baseName = String(name || '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9_-]*$/.test(baseName)) {
      throw new Error(`非法成员名 "${name}"：请使用小写字母开头，仅含数字、下划线或连字符`);
    }
    if (RESERVED_NAMES.has(baseName)) {
      throw new Error(`成员名 "${baseName}" 为保留关键字，请更换其他名称`);
    }
    const normRole = String(role || MEMBER_ROLES.AUTHOR).trim().toLowerCase();
    const validRoles = new Set(Object.values(MEMBER_ROLES));
    if (!validRoles.has(normRole)) {
      throw new Error(`非法成员角色 "${role}"，可选：${[...validRoles].join(', ')}`);
    }
    role = normRole;

    const targets = Array.isArray(tasks) && tasks.length > 0
      ? tasks.map((slice, idx) => ({
          memberName: `${baseName}-${idx + 1}`,
          memberBrief: `${brief}\n\n【分配切片目标】：${slice}`.trim()
        }))
      : n > 1
        ? Array.from({ length: n }, (_, idx) => ({
            memberName: `${baseName}-${idx + 1}`,
            memberBrief: brief
          }))
        : [{ memberName: baseName, memberBrief: brief }];

    const created = [];
    for (const item of targets) {
      const existing = this.members.get(item.memberName);
      if (existing) {
        if (existing.killed) {
          throw new Error(`成员 "${item.memberName}" 已被销毁（killed），不可复用原名，请使用 "${item.memberName}-2"`);
        }
        throw new Error(`成员 "${item.memberName}" 已存在于蜂群名册中`);
      }

      const subChannels = Array.isArray(channels) && channels.length > 0 ? channels : ['main'];
      for (const ch of subChannels) {
        this.board.subscribe(item.memberName, ch);
      }

      this.ownership.setMemberRule(item.memberName, { role, owns, mustNotTouch });
      const wsInfo = this.worktrees.provision(item.memberName, workspace);

      const member = {
        name: item.memberName,
        role,
        driver,
        model,
        workspaceMode: wsInfo.mode,
        workspaceDir: wsInfo.dir,
        branch: wsInfo.branch,
        baseBranch: wsInfo.baseBranch,
        state: MEMBER_STATES.WAITING,
        killed: false,
        channels: this.board.getMemberChannels(item.memberName),
        owns: this.ownership.getMemberRule(item.memberName)?.owns || [],
        mustNotTouch: this.ownership.getMemberRule(item.memberName)?.mustNotTouch || [],
        brief: item.memberBrief,
        lastReadSeq: this.board.head,
        lastPostSeq: 0,
        lastPostTime: null,
        turns: 0,
        tokensUsed: 0,
        lastError: null,
        sessionId: driverConfig?.sessionId || null,
        driverConfig: { ...driverConfig },
        addedAt: new Date().toISOString()
      };

      this.members.set(item.memberName, member);
      created.push(member);

      if (postBrief && item.memberBrief && role !== MEMBER_ROLES.MONITOR) {
        const primaryChannel = subChannels.find((c) => c !== 'main') || 'main';
        const formatted = item.memberBrief.includes(`@${item.memberName}`)
          ? item.memberBrief
          : `@${item.memberName} ${item.memberBrief}`;
        this.postMessage({
          author: postedBy,
          text: formatted,
          channel: primaryChannel,
          kind: MESSAGE_KINDS.BRIEF,
          metadata: {
            briefFor: item.memberName,
            role,
            driver,
            workspaceMode: wsInfo.mode,
            owns: member.owns
          }
        });
      }
    }

    this._saveMeta();
    this.emit('status', this.getStatus());
    return created.length === 1 ? created[0] : created;
  }

  switchModel(memberName, newModel, { reason = '用户或协调者切换模型' } = {}) {
    const member = this.members.get(memberName);
    if (!member) throw new Error(`未找到成员 "${memberName}"`);
    if (member.killed) throw new Error(`成员 "${memberName}" 已销毁，无法切换模型`);
    if (member.state === MEMBER_STATES.WORKING) {
      throw new Error(`成员 "${memberName}" 当前处于 working 状态，请待其完成当前轮次后再切换模型`);
    }
    const oldModel = member.model;
    member.model = newModel;
    member.state = MEMBER_STATES.WAITING;
    member.lastError = null;
    this._saveMeta();
    this.emit('status', this.getStatus());
    this.postMessage({
      author: 'coordinator',
      text: `@${memberName} 模型已由 \`${oldModel}\` 切换为 \`${newModel}\`（原因：${reason}），请基于既有上下文继续推进未完成任务。`,
      channel: 'main',
      kind: MESSAGE_KINDS.SYSTEM
    });
    return member;
  }

  killMember(memberName, { force = false } = {}) {
    const member = this.members.get(memberName);
    if (!member) throw new Error(`未找到成员 "${memberName}"`);
    if (member.killed) return member;
    this.worktrees.cleanup(memberName, { force });
    this.ownership.removeMemberRule(memberName);
    member.state = MEMBER_STATES.KILLED;
    member.killed = true;
    this._saveMeta();
    this.emit('status', this.getStatus());
    return member;
  }

  postMessage({ author, text, channel = 'main', kind = null, metadata = {}, translations = null }) {
    return this.board.post({ author, text, channel, kind, metadata, translations });
  }

  /**
   * Long-poll / wait helper for external MCP or HTTP clients to sleep at zero cost until a mention arrives.
   */
  waitForMention(memberName, { since = 0, mentionsOnly = true, timeoutMs = 30_000 } = {}) {
    const existing = this.board.read({ since, member: memberName });
    const match = existing.messages.find((m) => this._shouldWakeMember(memberName, m, mentionsOnly));
    if (match) {
      return Promise.resolve({ wokenBy: match, messages: existing.messages, head: existing.head });
    }
    return new Promise((resolve) => {
      const entry = { since, mentionsOnly, resolve, timer: null };
      if (!this._waiters.has(memberName)) this._waiters.set(memberName, []);
      this._waiters.get(memberName).push(entry);
      entry.timer = setTimeout(() => {
        const list = this._waiters.get(memberName) || [];
        const idx = list.indexOf(entry);
        if (idx !== -1) list.splice(idx, 1);
        resolve({ wokenBy: null, messages: [], head: this.board.head, timedOut: true });
      }, timeoutMs);
      if (typeof entry.timer.unref === 'function') entry.timer.unref();
    });
  }

  _resolveWaiters(msg) {
    for (const [memberName, list] of this._waiters.entries()) {
      for (let i = list.length - 1; i >= 0; i--) {
        const w = list[i];
        if (msg.seq > w.since && this._shouldWakeMember(memberName, msg, w.mentionsOnly)) {
          clearTimeout(w.timer);
          list.splice(i, 1);
          const data = this.board.read({ since: w.since, member: memberName });
          w.resolve({ wokenBy: msg, messages: data.messages, head: data.head });
        }
      }
    }
  }

  _shouldWakeMember(memberName, msg, mentionsOnly = true) {
    if (msg.author === memberName) return false;
    const member = this.members.get(memberName);
    if (!member || member.killed) return false;
    if (member.role === MEMBER_ROLES.MONITOR) return false;

    if (msg.broadcastAll) return true;
    if (msg.mentions.includes(memberName)) return true;
    if (msg.mentions.some((prefix) => memberName.startsWith(`${prefix}-`))) return true;

    const subs = this.board.getMemberChannels(memberName);
    if ((msg.channelMentions || []).some((ch) => subs.includes(ch))) return true;

    if (!mentionsOnly && subs.includes(msg.channel)) return true;
    return false;
  }

  _scheduleWakeups(msg) {
    if (!this.driverRegistry) return;
    if (msg.metadata?.noWake || msg.metadata?.error) return;
    for (const member of this.members.values()) {
      if (member.killed || member.role === MEMBER_ROLES.MONITOR) continue;
      if (!this._shouldWakeMember(member.name, msg, true)) continue;
      if (member.turns >= 50) continue;
      if (member.driver === 'human') {
        member.state = MEMBER_STATES.WAITING_HUMAN;
        this._saveMeta();
        this.emit('status', this.getStatus());
        this.emit('human_required', { swarmId: this.id, member: member.name, message: msg });
        continue;
      }
      this._triggerMemberTurn(member, msg);
    }
  }

  _triggerMemberTurn(member, triggerMsg) {
    const prev = this._activeDispatches.get(member.name) || Promise.resolve();
    const run = prev
      .catch(() => {})
      .then(async () => {
        if (member.killed) return;
        const driver = this.driverRegistry.get(member.driver);
        if (!driver) return;

        // Paperclip-inspired Budget & Cost Governor check before invoking agent
        const budgetCheck = this.budget.checkAllow(member.name);
        if (!budgetCheck.allowed) {
          member.state = MEMBER_STATES.STOPPED;
          member.lastError = budgetCheck.reason;
          this.postMessage({
            author: 'coordinator',
            text: `🛑 【预算治理熔断】已拦截 \`${member.name}\` 对 #${triggerMsg.seq} 的唤醒：${budgetCheck.reason}`,
            channel: 'main',
            kind: MESSAGE_KINDS.SYSTEM,
            metadata: { noWake: true, budgetExceeded: true, member: member.name }
          });
          this._saveMeta();
          this.emit('status', this.getStatus());
          return;
        }

        // Lifecycle PreTurn hook gate (TeamAI / Claude Code / Routa Guard semantics)
        let pluginHookContext = '';
        if (this.plugins?.hooks) {
          const preTurn = await this.plugins.hooks.run(
            'PreTurn',
            {
              swarmId: this.id,
              member: member.name,
              role: member.role,
              triggerSeq: triggerMsg.seq,
              text: triggerMsg.text
            },
            { cwd: member.workspaceDir || this.repoPath }
          );
          if (!preTurn.allowed) {
            if (member.killed) return;
            member.state = MEMBER_STATES.STOPPED;
            member.lastError = preTurn.reason;
            this.postMessage({
              author: 'coordinator',
              text: `🛡️ 【生命周期 Hook 拦截】已阻止 \`${member.name}\` 执行 #${triggerMsg.seq}：${preTurn.reason}`,
              channel: 'main',
              kind: MESSAGE_KINDS.SYSTEM,
              metadata: { noWake: true, hookBlocked: true, member: member.name }
            });
            this._saveMeta();
            this.emit('status', this.getStatus());
            return;
          }
          pluginHookContext = preTurn.additionalContext || '';
        }

        if (member.killed) return;
        member.state = MEMBER_STATES.WORKING;
        member.lastError = null;
        this.emit('status', this.getStatus());

        try {
          const readUpToSeq = this.board.head;
          const unread = this.board.read({ since: member.lastReadSeq, member: member.name }).messages;
          const result = await driver.executeTurn({
            swarm: this,
            member,
            triggerMessage: triggerMsg,
            unreadMessages: unread,
            board: this.board,
            ownership: this.ownership,
            worktrees: this.worktrees,
            gitlab: this.gitlab,
            plugins: this.plugins,
            pluginHookContext
          });

          member.lastReadSeq = Math.max(member.lastReadSeq, readUpToSeq);
          member.turns += 1;
          if (result?.tokensUsed) member.tokensUsed += result.tokensUsed;
          const usageUpdate = this.budget.recordUsage(member.name, {
            tokens: result?.tokensUsed || 0,
            turns: 1
          });
          if (usageUpdate.warningTriggered && usageUpdate.warningMessage) {
            this.postMessage({
              author: 'coordinator',
              text: usageUpdate.warningMessage,
              channel: 'main',
              kind: MESSAGE_KINDS.SYSTEM,
              metadata: { noWake: true, budgetWarning: true }
            });
          }
          if (result?.sessionId) {
            member.sessionId = result.sessionId;
            member.driverConfig = { ...(member.driverConfig || {}), sessionId: result.sessionId };
          }

          if (!member.killed && result?.reply && !result.alreadyPosted) {
            this.postMessage({
              author: member.name,
              text: result.reply,
              channel: result.channel || triggerMsg.channel || 'main',
              kind: result.kind || null,
              metadata: result.metadata || {}
            });
          }

          if (this.plugins?.hooks) {
            await this.plugins.hooks
              .run(
                'PostTurn',
                {
                  swarmId: this.id,
                  member: member.name,
                  role: member.role,
                  triggerSeq: triggerMsg.seq,
                  ok: true,
                  tokensUsed: result?.tokensUsed || 0,
                  text: String(result?.reply || '').slice(0, 600)
                },
                { cwd: member.workspaceDir || this.repoPath }
              )
              .catch(() => {});
          }

          if (result?.awaitingHuman && !member.killed) {
            member.state = MEMBER_STATES.WAITING_HUMAN;
            this.emit('human_required', { swarmId: this.id, member: member.name, message: triggerMsg, reason: result.reason || null });
          } else if (!member.killed && member.state === MEMBER_STATES.WORKING) {
            member.state = MEMBER_STATES.WAITING;
          }
        } catch (err) {
          if (!member.killed) {
            member.state = MEMBER_STATES.ERROR;
            member.lastError = err.message || String(err);
          }
          if (this.plugins?.hooks) {
            await this.plugins.hooks
              .run(
                'PostTurn',
                {
                  swarmId: this.id,
                  member: member.name,
                  role: member.role,
                  triggerSeq: triggerMsg.seq,
                  ok: false,
                  text: String(err.message || err).slice(0, 400)
                },
                { cwd: member.workspaceDir || this.repoPath }
              )
              .catch(() => {});
          }
          this.postMessage({
            author: 'coordinator',
            text: `⚠️ 成员 \`${member.name}\` 执行轮次异常（触发消息 #${triggerMsg.seq}）：${member.lastError || err.message}`,
            channel: 'main',
            kind: MESSAGE_KINDS.SYSTEM,
            metadata: { error: member.lastError || err.message, failedMember: member.name, noWake: true }
          });
        } finally {
          this._saveMeta();
          this.emit('status', this.getStatus());
        }
      });

    const tracked = run.finally(() => {
      if (this._activeDispatches.get(member.name) === tracked) {
        this._activeDispatches.delete(member.name);
      }
    });
    this._activeDispatches.set(member.name, tracked);
    return tracked;
  }

  /**
   * Wait until all currently scheduled agent turns settle (handy for deterministic tests and CLI flows).
   */
  async waitIdle({ timeoutMs = 15_000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const pending = [...this._activeDispatches.values()];
      await Promise.allSettled(pending);
      const anyWorking = [...this.members.values()].some((m) => m.state === MEMBER_STATES.WORKING);
      if (!anyWorking) {
        // Yield microtask & short tick to capture follow-up peer-to-peer wakeups
        await new Promise((r) => setTimeout(r, 25));
        const stillWorking = [...this.members.values()].some((m) => m.state === MEMBER_STATES.WORKING);
        if (!stillWorking) return true;
      }
    }
    return false;
  }

  toPublicMember(m) {
    if (!m) return null;
    return {
      name: m.name,
      role: m.role,
      driver: m.driver,
      model: m.model,
      workspaceMode: m.workspaceMode,
      workspaceDir: m.workspaceDir,
      branch: m.branch,
      baseBranch: m.baseBranch || null,
      state: m.state,
      killed: m.killed,
      channels: this.board.getMemberChannels(m.name),
      owns: m.owns,
      mustNotTouch: m.mustNotTouch,
      brief: m.brief,
      lastReadSeq: m.lastReadSeq,
      lastPostSeq: m.lastPostSeq,
      lastPostTime: m.lastPostTime,
      turns: m.turns,
      tokensUsed: m.tokensUsed,
      lastError: m.lastError,
      sessionId: m.sessionId || m.driverConfig?.sessionId || null,
      driverConfig: redactDriverConfigForPublic(m.driverConfig)
    };
  }

  listMembers() {
    return [...this.members.values()].map((m) => this.toPublicMember(m));
  }

  refreshWorldModel() {
    if (!this.repoPath) {
      return { available: false, reason: '当前蜂群未绑定本地代码仓库路径 (repoPath)' };
    }
    if (!this.worldModel) {
      this.worldModel = new ProjectWorldModel({ repoPath: this.repoPath, ownershipGuard: this.ownership });
    }
    this.worldModel.refresh({ swarm: this });
    const overview = { available: true, ...this.worldModel.getOverview(), lastAudit: this.lastAudit };
    this.emit('world_model', { healthScore: overview.healthScore, generatedAt: overview.generatedAt });
    return overview;
  }

  getWorldModelOverview() {
    if (!this.repoPath) {
      return { available: false, reason: '当前蜂群未绑定本地代码仓库路径 (repoPath)' };
    }
    if (!this.worldModel) {
      this.worldModel = new ProjectWorldModel({ repoPath: this.repoPath, ownershipGuard: this.ownership });
    }
    if (!this.worldModel.snapshot) {
      this.worldModel.refresh({ swarm: this });
    }
    return { available: true, ...this.worldModel.getOverview(), lastAudit: this.lastAudit };
  }

  simulateChangeImpact(targetPaths) {
    if (!this.repoPath) {
      throw new Error('当前蜂群未绑定本地代码仓库路径，无法执行变更爆炸半径分析');
    }
    if (!this.worldModel) {
      this.worldModel = new ProjectWorldModel({ repoPath: this.repoPath, ownershipGuard: this.ownership });
    }
    if (!this.worldModel.snapshot) {
      this.worldModel.refresh({ swarm: this });
    }
    return this.worldModel.simulateChangeImpact(targetPaths);
  }

  runProjectAudit({ createIssues = false, author = 'auditor' } = {}) {
    if (!this.repoPath) {
      throw new Error('当前蜂群未绑定本地代码仓库路径，无法运行全仓审计');
    }
    if (!this.worldModel) {
      this.worldModel = new ProjectWorldModel({ repoPath: this.repoPath, ownershipGuard: this.ownership });
    }
    const report = ProjectAuditor.run({ repoPath: this.repoPath, worldModel: this.worldModel, swarm: this });
    this.lastAudit = report;

    const createdIssues = [];
    if (createIssues) {
      const existingTitles = new Set(this.tasks.listTasks().map((t) => t.title));
      for (const f of report.findings) {
        if (f.severity !== 'P0' && f.severity !== 'P1') continue;
        const issueTitle = `[${f.severity}/${f.category}] ${f.file ? `${f.file}: ` : ''}${f.message.slice(0, 60)}`;
        if (existingTitles.has(issueTitle)) continue;
        existingTitles.add(issueTitle);
        const created = this.tasks.createTask({
          title: issueTitle,
          description: `${f.message}\n\n修复建议：${f.fixHint || '请核查并修复。'}`,
          spec: `## 审计缺陷单\n- 严重度：${f.severity}\n- 分类：${f.category}\n- 位置：\`${f.file || 'repo'}:${f.line || 1}\`\n- 修复建议：${f.fixHint || '—'}`,
          status: 'ready',
          priority: f.severity,
          labels: ['audit', f.category],
          reporter: author
        });
        createdIssues.push(created);
      }
    }

    this.emit('audit', { score: report.score, passed: report.passed, summary: report.summary });
    if (this.plugins?.hooks) {
      this.plugins.hooks
        .run('OnAudit', { swarmId: this.id, score: report.score, passed: report.passed, summary: report.summary }, { cwd: this.repoPath })
        .catch(() => {});
    }
    return { ...report, createdIssues };
  }

  generateWiki({ projectName = null, author = 'world-model' } = {}) {
    if (!this.repoPath) {
      throw new Error('当前蜂群未绑定本地代码仓库路径，无法从世界模型自动生成 Wiki');
    }
    if (!this.worldModel) {
      this.worldModel = new ProjectWorldModel({ repoPath: this.repoPath, ownershipGuard: this.ownership });
    }
    const snap = this.worldModel.refresh({ swarm: this });
    if (!this.lastAudit) {
      this.lastAudit = ProjectAuditor.run({ repoPath: this.repoPath, worldModel: this.worldModel, swarm: this });
    }
    const pages = this.wiki.generateFromWorldModel(snap, {
      projectName: projectName || snap.packageInfo?.name || this.title,
      swarm: this,
      knowledge: this.knowledge,
      auditReport: this.lastAudit,
      author
    });
    this.emit('status', this.getStatus());
    return { generatedCount: pages.length, pages: this.wiki.listPages() };
  }

  getStatus() {
    return {
      id: this.id,
      title: this.title,
      repoPath: this.repoPath,
      language: this.language,
      createdAt: this.createdAt,
      head: this.board.head,
      done: this.board.done,
      doneSummary: this.board.doneSummary,
      channels: this.board.listChannels(),
      members: this.listMembers(),
      tasks: this.tasks.listTasks(),
      budget: this.budget.getSummary(),
      knowledgeCount: this.knowledge.listEntries().length,
      wikiCount: this.wiki.listPages().length,
      pluginCount: this.plugins ? this.plugins.registry.getCounts().enabledPlugins : 0,
      skillCount: this.plugins ? this.plugins.registry.getCounts().enabledSkills : 0,
      hookCount: this.plugins ? this.plugins.hooks.hooks.length : 0,
      worldHealthScore: this.worldModel?.snapshot?.healthScore ?? null,
      lastAuditScore: this.lastAudit?.score ?? null,
      ownership: this.ownership.toJSON(),
      worktrees: this.worktrees.listWorkspaces(),
      gitlab: this.gitlab
        ? {
            connected: Boolean(this.gitlab.client),
            rehydrated: Boolean(this.gitlab.rehydrated),
            baseUrl: this.gitlab.client?.baseUrl || null,
            projectId: this.gitlab.projectId || null,
            linkedIssueIid: this.gitlab.linkedIssueIid || null,
            linkedMrIid: this.gitlab.linkedMrIid || null,
            tokenEnv: this.gitlab.tokenEnv || 'GITLAB_TOKEN'
          }
        : null
    };
  }

  dispose() {
    this.monitor.stop();
    for (const list of this._waiters.values()) {
      for (const w of list) {
        clearTimeout(w.timer);
        w.resolve({ wokenBy: null, messages: [], head: this.board.head, disposed: true });
      }
    }
    this._waiters.clear();
  }
}

/**
 * Top-level Teamwork Manager holding multiple SwarmInstances with persistent recovery.
 */
export class TeamworkManager extends EventEmitter {
  constructor({
    dataDir = null,
    inMemory = false,
    driverRegistry = null,
    defaultRepoPath = null,
    gitlabTokenResolver = null,
    defaultGitlabToken = '',
    pluginHub = null
  } = {}) {
    super();
    this.storage = new SwarmStorage({ dataDir, inMemory });
    this.driverRegistry = driverRegistry;
    this.defaultRepoPath = defaultRepoPath;
    this.gitlabTokenResolver = gitlabTokenResolver;
    this.defaultGitlabToken = defaultGitlabToken;
    this._ownsPluginHub = !pluginHub;
    this.plugins = pluginHub || new PluginHub({ dataDir, inMemory, repoPath: defaultRepoPath });
    this._onPluginsChanged = (ev) => this.emit('event', { type: 'plugins_changed', swarmId: null, payload: ev });
    this._onHookRun = (rec) => this.emit('event', { type: 'hook_run', swarmId: null, payload: rec });
    this.plugins.on('plugins_changed', this._onPluginsChanged);
    this.plugins.on('hook_run', this._onHookRun);
    this.swarms = new Map();
    this._restoreExisting();
  }

  _restoreExisting() {
    for (const id of this.storage.listSwarmIds()) {
      try {
        const meta = this.storage.loadMeta(id);
        if (!meta) continue;
        const swarm = new SwarmInstance({
          id,
          title: meta.title,
          repoPath: meta.repoPath || this.defaultRepoPath,
          worktreeRoot: meta.worktreeRoot || null,
          storage: this.storage,
          driverRegistry: this.driverRegistry,
          plugins: this.plugins,
          language: meta.language || DEFAULT_CONFIG.defaultLang,
          enableMonitor: !meta.done,
          createdAt: meta.createdAt
        });
        swarm.rehydrate({
          gitlabTokenResolver: this.gitlabTokenResolver,
          defaultGitlabToken: this.defaultGitlabToken
        });
        this._wireSwarmEvents(swarm);
        this.swarms.set(id, swarm);
      } catch (err) {
        console.error(`[yunyu] 恢复蜂群 "${id}" 失败（已跳过损坏实例）:`, err.message || err);
      }
    }
  }

  _wireSwarmEvents(swarm) {
    swarm.on('message', (msg) => this.emit('event', { type: 'message', swarmId: swarm.id, payload: msg }));
    swarm.on('translation', (t) => this.emit('event', { type: 'translation', swarmId: swarm.id, payload: t }));
    swarm.on('status', (st) => this.emit('event', { type: 'status', swarmId: swarm.id, payload: st }));
    swarm.on('channel', (ch) => this.emit('event', { type: 'channel', swarmId: swarm.id, payload: ch }));
    swarm.on('human_required', (h) => this.emit('event', { type: 'human_required', swarmId: swarm.id, payload: h }));
    swarm.on('agent_log', (log) => this.emit('event', { type: 'agent_log', swarmId: swarm.id, payload: log }));
    swarm.on('task', (taskEv) => this.emit('event', { type: 'task', swarmId: swarm.id, payload: taskEv }));
    swarm.on('knowledge', (kbEv) => this.emit('event', { type: 'knowledge', swarmId: swarm.id, payload: kbEv }));
    swarm.on('wiki', (wikiEv) => this.emit('event', { type: 'wiki', swarmId: swarm.id, payload: wikiEv }));
    swarm.on('world_model', (wmEv) => this.emit('event', { type: 'world_model', swarmId: swarm.id, payload: wmEv }));
    swarm.on('audit', (auditEv) => this.emit('event', { type: 'audit', swarmId: swarm.id, payload: auditEv }));
  }

  createSwarm({
    id = null,
    title,
    repoPath = this.defaultRepoPath,
    worktreeRoot = null,
    contract = null,
    templateId = null,
    gitlab = null,
    budget = null,
    language = DEFAULT_CONFIG.defaultLang,
    enableMonitor = true,
    monitorIntervalMs = DEFAULT_CONFIG.monitorIntervalMs,
    stallThresholdMs = DEFAULT_CONFIG.stallThresholdMs
  } = {}) {
    const swarmId = id ? String(id).trim() : `swarm-${crypto.randomBytes(3).toString('hex')}`;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(swarmId)) {
      throw new Error(`非法蜂群 ID "${swarmId}"：仅支持字母/数字开头，含字母、数字、下划线或连字符（最长 64 字符）`);
    }
    if (this.swarms.has(swarmId)) {
      throw new Error(`蜂群 ID "${swarmId}" 已存在`);
    }

    const tpl = templateId ? TEAM_TEMPLATES[templateId] : null;
    const effectiveContract = contract || (tpl ? { globalForbidden: tpl.globalForbidden } : null);

    const swarm = new SwarmInstance({
      id: swarmId,
      title: title || tpl?.name || `云驭协同 · ${swarmId}`,
      repoPath,
      worktreeRoot,
      storage: this.storage,
      driverRegistry: this.driverRegistry,
      plugins: this.plugins,
      contract: effectiveContract,
      gitlab,
      budget,
      language,
      enableMonitor,
      monitorIntervalMs,
      stallThresholdMs
    });

    this._wireSwarmEvents(swarm);
    this.swarms.set(swarmId, swarm);

    if (tpl) {
      for (const ch of tpl.channels || []) {
        swarm.board.createChannel(ch);
      }
      for (const m of tpl.members || []) {
        swarm.addMember({ ...m, postBrief: false });
      }
    }

    swarm._saveMeta();
    this.emit('event', { type: 'swarm_created', swarmId, payload: swarm.getStatus() });
    if (this.plugins?.hooks) {
      this.plugins.hooks
        .run('SessionStart', { swarmId, title: swarm.title, repoPath: swarm.repoPath }, { cwd: swarm.repoPath })
        .then((res) => {
          if (swarm.repoPath && res?.results?.some((r) => r.builtinAction === 'refresh_world_model')) {
            try {
              if (!swarm.worldModel?.snapshot) swarm.getWorldModelOverview();
            } catch {}
          }
        })
        .catch(() => {});
    }
    return swarm;
  }

  getSwarm(swarmId) {
    return this.swarms.get(swarmId) || null;
  }

  listSwarms() {
    return [...this.swarms.values()].map((s) => ({
      id: s.id,
      title: s.title,
      head: s.board.head,
      done: s.board.done,
      memberCount: s.listMembers().filter((m) => !m.killed).length,
      createdAt: s.createdAt,
      gitlab: s.gitlab ? { projectId: s.gitlab.projectId, linkedIssueIid: s.gitlab.linkedIssueIid } : null
    }));
  }

  disposeAll() {
    for (const s of this.swarms.values()) s.dispose();
    if (this.plugins) {
      this.plugins.off('plugins_changed', this._onPluginsChanged);
      this.plugins.off('hook_run', this._onHookRun);
      if (this._ownsPluginHub) {
        return this.plugins.dispose?.().catch?.(() => {});
      }
    }
    return Promise.resolve();
  }
}
