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
import { MessageBoard } from './board.mjs';
import { StallMonitor } from './monitor.mjs';
import { OwnershipGuard } from './ownership.mjs';
import { SwarmStorage } from './storage.mjs';
import { TEAM_TEMPLATES } from './templates.mjs';
import { WorktreeManager } from './worktree.mjs';

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
    contract = null,
    gitlab = null,
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
    this.gitlab = gitlab; // { client, projectId, sync, linkedIssueIid, linkedMrIid }
    this.members = new Map();
    this._activeDispatches = new Map(); // memberName -> Promise
    this._waiters = new Map(); // memberName -> Array<{ since, mentionsOnly, resolve }>
    this.ownership = new OwnershipGuard(contract);
    this.worktrees = new WorktreeManager({
      repoPath,
      worktreeRoot,
      swarmId: id,
      ownershipGuard: this.ownership
    });
    this.board = new MessageBoard({ swarmId: id, storage, defaultLang: language });
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

      this._saveMeta();
      this.emit('message', msg);
      this._resolveWaiters(msg);
      this._scheduleWakeups(msg);

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

  rehydrate() {
    this.board.replayFromStorage();
    const meta = this.storage?.loadMeta(this.id);
    if (meta) {
      this.title = meta.title || this.title;
      this.language = meta.language || this.language;
      this.createdAt = meta.createdAt || this.createdAt;
      if (meta.contract) this.ownership.loadContract(meta.contract);
      if (Array.isArray(meta.members)) {
        for (const m of meta.members) {
          this.members.set(m.name, {
            ...m,
            state: m.killed ? MEMBER_STATES.KILLED : m.state === MEMBER_STATES.WORKING ? MEMBER_STATES.STOPPED : m.state
          });
          if (m.owns || m.mustNotTouch) {
            this.ownership.setMemberRule(m.name, {
              role: m.role,
              owns: m.owns || [],
              mustNotTouch: m.mustNotTouch || []
            });
          }
        }
      }
    }
    if (this.board.done) this.monitor.stop();
  }

  _saveMeta() {
    if (!this.storage) return;
    this.storage.saveMeta(this.id, {
      id: this.id,
      title: this.title,
      repoPath: this.repoPath,
      language: this.language,
      createdAt: this.createdAt,
      done: this.board.done,
      doneSummary: this.board.doneSummary,
      gitlab: this.gitlab
        ? {
            projectId: this.gitlab.projectId,
            baseUrl: this.gitlab.client?.baseUrl || null,
            linkedIssueIid: this.gitlab.linkedIssueIid || null,
            linkedMrIid: this.gitlab.linkedMrIid || null
          }
        : null,
      contract: {
        globalForbidden: this.ownership.globalForbidden,
        ownership: Object.fromEntries(
          [...this.ownership.rules.entries()].map(([k, v]) => [
            k,
            { role: v.role, owns: v.owns, mustNotTouch: v.mustNotTouch }
          ])
        )
      },
      members: this.listMembers()
    });
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

        member.state = MEMBER_STATES.WORKING;
        member.lastError = null;
        this.emit('status', this.getStatus());

        try {
          const unread = this.board.read({ since: member.lastReadSeq, member: member.name }).messages;
          const result = await driver.executeTurn({
            swarm: this,
            member,
            triggerMessage: triggerMsg,
            unreadMessages: unread,
            board: this.board,
            ownership: this.ownership,
            worktrees: this.worktrees,
            gitlab: this.gitlab
          });

          member.lastReadSeq = Math.max(member.lastReadSeq, this.board.head);
          member.turns += 1;
          if (result?.tokensUsed) member.tokensUsed += result.tokensUsed;

          if (result?.reply && !result.alreadyPosted) {
            this.postMessage({
              author: member.name,
              text: result.reply,
              channel: result.channel || triggerMsg.channel || 'main',
              kind: result.kind || null,
              metadata: result.metadata || {}
            });
          }

          if (!member.killed && member.state === MEMBER_STATES.WORKING) {
            member.state = MEMBER_STATES.WAITING;
          }
        } catch (err) {
          member.state = MEMBER_STATES.ERROR;
          member.lastError = err.message || String(err);
          this.postMessage({
            author: 'coordinator',
            text: `⚠️ 成员 \`${member.name}\` 执行轮次异常（触发消息 #${triggerMsg.seq}）：${member.lastError}`,
            channel: 'main',
            kind: MESSAGE_KINDS.SYSTEM,
            metadata: { error: member.lastError, failedMember: member.name, noWake: true }
          });
        } finally {
          this._saveMeta();
          this.emit('status', this.getStatus());
        }
      });

    this._activeDispatches.set(member.name, run);
    return run;
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

  listMembers() {
    return [...this.members.values()].map((m) => ({
      name: m.name,
      role: m.role,
      driver: m.driver,
      model: m.model,
      workspaceMode: m.workspaceMode,
      workspaceDir: m.workspaceDir,
      branch: m.branch,
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
      lastError: m.lastError
    }));
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
      ownership: this.ownership.toJSON(),
      worktrees: this.worktrees.listWorkspaces(),
      gitlab: this.gitlab
        ? {
            connected: Boolean(this.gitlab.client),
            baseUrl: this.gitlab.client?.baseUrl || null,
            projectId: this.gitlab.projectId || null,
            linkedIssueIid: this.gitlab.linkedIssueIid || null,
            linkedMrIid: this.gitlab.linkedMrIid || null
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
  constructor({ dataDir = null, inMemory = false, driverRegistry = null, defaultRepoPath = null } = {}) {
    super();
    this.storage = new SwarmStorage({ dataDir, inMemory });
    this.driverRegistry = driverRegistry;
    this.defaultRepoPath = defaultRepoPath;
    this.swarms = new Map();
    this._restoreExisting();
  }

  _restoreExisting() {
    for (const id of this.storage.listSwarmIds()) {
      const meta = this.storage.loadMeta(id);
      if (!meta) continue;
      const swarm = new SwarmInstance({
        id,
        title: meta.title,
        repoPath: meta.repoPath || this.defaultRepoPath,
        storage: this.storage,
        driverRegistry: this.driverRegistry,
        language: meta.language || DEFAULT_CONFIG.defaultLang,
        enableMonitor: !meta.done,
        createdAt: meta.createdAt
      });
      swarm.rehydrate();
      this._wireSwarmEvents(swarm);
      this.swarms.set(id, swarm);
    }
  }

  _wireSwarmEvents(swarm) {
    swarm.on('message', (msg) => this.emit('event', { type: 'message', swarmId: swarm.id, payload: msg }));
    swarm.on('translation', (t) => this.emit('event', { type: 'translation', swarmId: swarm.id, payload: t }));
    swarm.on('status', (st) => this.emit('event', { type: 'status', swarmId: swarm.id, payload: st }));
    swarm.on('channel', (ch) => this.emit('event', { type: 'channel', swarmId: swarm.id, payload: ch }));
    swarm.on('human_required', (h) => this.emit('event', { type: 'human_required', swarmId: swarm.id, payload: h }));
  }

  createSwarm({
    id = null,
    title,
    repoPath = this.defaultRepoPath,
    worktreeRoot = null,
    contract = null,
    templateId = null,
    gitlab = null,
    language = DEFAULT_CONFIG.defaultLang,
    enableMonitor = true,
    monitorIntervalMs = DEFAULT_CONFIG.monitorIntervalMs,
    stallThresholdMs = DEFAULT_CONFIG.stallThresholdMs
  } = {}) {
    const swarmId = id || `swarm-${crypto.randomBytes(3).toString('hex')}`;
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
      contract: effectiveContract,
      gitlab,
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
  }
}
