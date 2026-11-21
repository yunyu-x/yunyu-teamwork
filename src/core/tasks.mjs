import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { MESSAGE_KINDS, QODER_ISSUE_COLUMNS, TASK_STATUSES } from './constants.mjs';

const PRIMARY_STATUSES = new Set(QODER_ISSUE_COLUMNS);
const STATUS_ALIASES = Object.freeze({
  planning: TASK_STATUSES.BACKLOG,
  backlog: TASK_STATUSES.BACKLOG,
  todo: TASK_STATUSES.READY,
  ready: TASK_STATUSES.READY,
  in_progress: TASK_STATUSES.IN_PROGRESS,
  running: TASK_STATUSES.IN_PROGRESS,
  review: TASK_STATUSES.REVIEW,
  qa: TASK_STATUSES.REVIEW,
  acceptance: TASK_STATUSES.REVIEW,
  done: TASK_STATUSES.DONE,
  completed: TASK_STATUSES.DONE,
  cancelled: TASK_STATUSES.CANCELLED,
  canceled: TASK_STATUSES.CANCELLED
});

const PRIORITY_RANK = { P0: 0, P1: 1, P2: 2 };

export function normalizeTaskStatus(rawStatus) {
  const key = String(rawStatus || '').trim().toLowerCase();
  if (key === 'blocked') {
    return { status: TASK_STATUSES.IN_PROGRESS, blocked: true };
  }
  const mapped = STATUS_ALIASES[key];
  if (mapped && PRIMARY_STATUSES.has(mapped)) {
    return { status: mapped, blocked: null };
  }
  return null;
}

function normalizeCriteria(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((item, idx) => {
      if (typeof item === 'string') {
        const text = item.trim();
        if (!text) return null;
        return { id: `ac-${idx + 1}-${crypto.randomBytes(2).toString('hex')}`, text, checked: false };
      }
      if (item && typeof item === 'object' && String(item.text || '').trim()) {
        return {
          id: item.id || `ac-${idx + 1}-${crypto.randomBytes(2).toString('hex')}`,
          text: String(item.text).trim(),
          checked: Boolean(item.checked)
        };
      }
      return null;
    })
    .filter(Boolean);
}

/**
 * Append-only Qoder-style Issue & Beads-style DAG Tracker persisted in `events.jsonl`.
 * Combines:
 * - Qoder 6-state lifecycle (待规划 / 待开始 / 进行中 / 待验收 / 已完成 / 已取消) + Spec & Acceptance checklist
 * - Beads-style DAG dependencies (with cycle detection), Ready Queue, and TTL Claim Leases
 * - Automatic correlation with Swarm Board `#seq` deliverables, commits, defects, Knowledge Vault, and GitLab Issues/MRs.
 */
function toPositiveIntOrNull(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export class TaskTracker extends EventEmitter {
  constructor({ swarmId, storage = null }) {
    super();
    this.swarmId = swarmId;
    this.storage = storage;
    this.tasks = new Map();
    this._order = [];
    this._nextIssueNum = 1;
  }

  replayFromStorage() {
    if (!this.storage) return;
    const events = this.storage.readEvents(this.swarmId);
    for (const ev of events) {
      if (ev.type === 'task_create' && ev.task?.id) {
        const task = this._hydrateTaskDefaults(structuredClone(ev.task));
        this.tasks.set(task.id, task);
        if (!this._order.includes(task.id)) this._order.push(task.id);
        this._syncNextIssueNum(task.issueKey);
      } else if (ev.type === 'task_update' && ev.taskId && this.tasks.has(ev.taskId)) {
        const cur = this.tasks.get(ev.taskId);
        const merged = this._hydrateTaskDefaults({ ...cur, ...ev.patch, updatedAt: ev.updatedAt || cur.updatedAt });
        this.tasks.set(ev.taskId, merged);
        this._syncNextIssueNum(merged.issueKey);
      }
    }
  }

  _syncNextIssueNum(issueKey) {
    const m = String(issueKey || '').match(/^ISS-(\d+)$/);
    if (m) {
      this._nextIssueNum = Math.max(this._nextIssueNum, Number(m[1]) + 1);
    }
  }

  _hydrateTaskDefaults(raw) {
    const norm = normalizeTaskStatus(raw.status);
    return {
      issueKey: raw.issueKey || null,
      description: '',
      spec: '',
      specStatus: 'draft',
      acceptanceCriteria: [],
      labels: [],
      reporter: 'coordinator',
      assignee: null,
      reviewer: null,
      parentId: null,
      dependsOn: [],
      blocked: norm?.blocked === true ? true : Boolean(raw.blocked),
      blockedReason: raw.blockedReason || null,
      claimedBy: raw.claimedBy || null,
      claimExpiresAt: raw.claimExpiresAt || null,
      rejectionHistory: Array.isArray(raw.rejectionHistory) ? raw.rejectionHistory : [],
      linkedKnowledgeIds: Array.isArray(raw.linkedKnowledgeIds) ? raw.linkedKnowledgeIds : [],
      deliverableSeqs: [],
      defectSeqs: [],
      commits: [],
      files: [],
      ...raw,
      status: norm ? norm.status : TASK_STATUSES.BACKLOG
    };
  }

  _resolveTaskId(idOrKey) {
    if (!idOrKey) return null;
    if (this.tasks.has(idOrKey)) return idOrKey;
    const upper = String(idOrKey).trim().toUpperCase();
    for (const [id, t] of this.tasks.entries()) {
      if (t.issueKey === upper) return id;
    }
    return null;
  }

  _enrichTask(t) {
    const copy = structuredClone(t);
    const activeClaim = this._isClaimActive(copy);
    const unresolvedDeps = (copy.dependsOn || []).filter((depRef) => {
      const depId = this._resolveTaskId(depRef);
      const dep = depId ? this.tasks.get(depId) : null;
      return !dep || dep.status !== TASK_STATUSES.DONE;
    });
    const subTasks = this._order
      .map((id) => this.tasks.get(id))
      .filter((x) => x && x.parentId === copy.id)
      .map((x) => ({ id: x.id, issueKey: x.issueKey, title: x.title, status: x.status, assignee: x.assignee }));

    copy.claimActive = activeClaim;
    if (!activeClaim) {
      copy.claimedBy = null;
      copy.claimExpiresAt = null;
    }
    copy.unresolvedDeps = unresolvedDeps;
    copy.blockedByDeps = unresolvedDeps.length > 0;
    copy.isReady =
      (copy.status === TASK_STATUSES.READY || copy.status === TASK_STATUSES.BACKLOG) &&
      unresolvedDeps.length === 0 &&
      !copy.blocked;
    copy.subTasks = subTasks;
    return copy;
  }

  _isClaimActive(task, now = Date.now()) {
    if (!task?.claimedBy) return false;
    if (!task.claimExpiresAt) return true;
    return new Date(task.claimExpiresAt).getTime() > now;
  }

  _assertNoDependencyCycle(taskId, candidateDeps = []) {
    for (const depId of candidateDeps) {
      if (depId === taskId) {
        throw new Error(`DAG 循环依赖拦截：任务 "${taskId}" 不能依赖自身`);
      }
      // DFS from depId to check whether taskId is reachable
      const visited = new Set();
      const stack = [depId];
      while (stack.length > 0) {
        const cur = stack.pop();
        if (cur === taskId) {
          throw new Error(`DAG 循环依赖拦截：添加依赖 "${depId}" 会导致死锁环路`);
        }
        if (visited.has(cur)) continue;
        visited.add(cur);
        const node = this.tasks.get(cur);
        if (node && Array.isArray(node.dependsOn)) {
          for (const nextDep of node.dependsOn) stack.push(nextDep);
        }
      }
    }
  }

  listTasks() {
    return this._order
      .map((id) => this.tasks.get(id))
      .filter(Boolean)
      .map((t) => this._enrichTask(t));
  }

  getTask(idOrKey) {
    if (this.tasks.has(idOrKey)) return this._enrichTask(this.tasks.get(idOrKey));
    const upper = String(idOrKey || '').toUpperCase();
    for (const t of this.tasks.values()) {
      if (t.issueKey === upper) return this._enrichTask(t);
    }
    return null;
  }

  isBlockedByDeps(taskId) {
    const t = this.getTask(taskId);
    return Boolean(t?.blockedByDeps);
  }

  /**
   * Beads-inspired `ready` queue: returns unblocked issues whose DAG dependencies are all `done`.
   */
  listReadyTasks({ assignee = null, excludeClaimedByOthersFor = null } = {}) {
    return this.listTasks()
      .filter((t) => {
        if (t.status !== TASK_STATUSES.READY && t.status !== TASK_STATUSES.BACKLOG) return false;
        if (t.blocked || t.blockedByDeps) return false;
        if (assignee && t.assignee !== assignee) return false;
        if (excludeClaimedByOthersFor && t.claimActive && t.claimedBy && t.claimedBy !== excludeClaimedByOthersFor) {
          return false;
        }
        return true;
      })
      .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9));
  }

  /**
   * Qoder-inspired rich filter & sort query for Issue Board.
   */
  queryTasks({
    scope = 'all',
    me = 'coordinator',
    status = 'all',
    search = '',
    priority = 'all',
    assignee = 'all',
    readyOnly = false,
    sortBy = 'priority'
  } = {}) {
    let list = this.listTasks();
    if (scope === 'mine' && me) {
      list = list.filter((t) => t.assignee === me || t.reporter === me || t.reviewer === me || t.claimedBy === me);
    }
    if (status && status !== 'all') {
      const norm = normalizeTaskStatus(status);
      if (norm) {
        if (norm.blocked === true) {
          list = list.filter((t) => t.blocked || t.blockedByDeps);
        } else {
          list = list.filter((t) => t.status === norm.status);
        }
      }
    }
    if (priority && priority !== 'all') {
      list = list.filter((t) => t.priority === priority);
    }
    if (assignee && assignee !== 'all') {
      list = list.filter((t) => t.assignee === assignee);
    }
    if (readyOnly) {
      list = list.filter((t) => t.isReady);
    }
    const q = String(search || '').trim().toLowerCase();
    if (q) {
      list = list.filter((t) => {
        const hay = `${t.issueKey || ''} ${t.id} ${t.title} ${t.description} ${t.spec} ${(t.labels || []).join(' ')} ${t.assignee || ''}`.toLowerCase();
        return hay.includes(q);
      });
    }
    if (sortBy === 'updated') {
      list.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    } else if (sortBy === 'key') {
      const num = (k) => Number(String(k || '').replace(/^ISS-/, '')) || 0;
      list.sort((a, b) => num(a.issueKey) - num(b.issueKey));
    } else {
      list.sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9));
    }
    return list;
  }

  createTask({
    id = null,
    issueKey = null,
    title,
    description = '',
    spec = '',
    specStatus = 'draft',
    acceptanceCriteria = [],
    labels = [],
    reporter = 'coordinator',
    status = TASK_STATUSES.BACKLOG,
    priority = 'P1',
    assignee = null,
    reviewer = null,
    parentId = null,
    dependsOn = [],
    blocked = false,
    blockedReason = null,
    gitlabIssueIid = null,
    gitlabMrIid = null,
    deliverableSeqs = [],
    defectSeqs = [],
    commits = [],
    files = [],
    linkedKnowledgeIds = [],
    branch = null,
    autoDerived = false
  }) {
    const cleanTitle = String(title || '').trim();
    if (!cleanTitle) throw new Error('任务标题不能为空');

    const norm = normalizeTaskStatus(status);
    const resolvedStatus = norm ? norm.status : TASK_STATUSES.BACKLOG;
    const resolvedBlocked = norm?.blocked === true ? true : Boolean(blocked);
    const taskId = id || `task-${crypto.randomBytes(3).toString('hex')}`;

    if (this.tasks.has(taskId)) {
      return this.updateTask(taskId, {
        title: cleanTitle,
        description,
        spec,
        status: resolvedStatus,
        priority,
        assignee,
        reviewer,
        gitlabIssueIid,
        gitlabMrIid
      });
    }

    const cleanDeps = [...new Set((Array.isArray(dependsOn) ? dependsOn : []).filter(Boolean))];
    this._assertNoDependencyCycle(taskId, cleanDeps);

    const assignedKey = issueKey || `ISS-${this._nextIssueNum++}`;
    this._syncNextIssueNum(assignedKey);
    const now = new Date().toISOString();

    const task = {
      id: taskId,
      issueKey: assignedKey,
      title: cleanTitle,
      description: String(description || '').trim(),
      spec: String(spec || '').trim(),
      specStatus: specStatus === 'approved' ? 'approved' : 'draft',
      acceptanceCriteria: normalizeCriteria(acceptanceCriteria),
      labels: [...new Set((Array.isArray(labels) ? labels : []).map((s) => String(s).trim()).filter(Boolean))],
      reporter: reporter || 'coordinator',
      status: resolvedStatus,
      priority: ['P0', 'P1', 'P2'].includes(priority) ? priority : 'P1',
      assignee: assignee || null,
      reviewer: reviewer || null,
      parentId: parentId || null,
      dependsOn: cleanDeps,
      blocked: resolvedBlocked,
      blockedReason: blockedReason || null,
      claimedBy: null,
      claimExpiresAt: null,
      rejectionHistory: [],
      gitlabIssueIid: toPositiveIntOrNull(gitlabIssueIid),
      gitlabMrIid: toPositiveIntOrNull(gitlabMrIid),
      deliverableSeqs: [...new Set((deliverableSeqs || []).map(Number).filter(Boolean))],
      defectSeqs: [...new Set((defectSeqs || []).map(Number).filter(Boolean))],
      commits: [...new Set((commits || []).filter(Boolean))],
      files: [...new Set((files || []).filter(Boolean))],
      linkedKnowledgeIds: [...new Set((linkedKnowledgeIds || []).filter(Boolean))],
      branch: branch || null,
      autoDerived: Boolean(autoDerived),
      createdAt: now,
      updatedAt: now
    };

    this.tasks.set(taskId, task);
    this._order.push(taskId);
    this.storage?.appendEvent(this.swarmId, { type: 'task_create', task });
    const enriched = this._enrichTask(task);
    this.emit('task', { op: 'create', task: enriched });
    return enriched;
  }

  updateTask(idOrKey, patch = {}) {
    const taskId = this._resolveTaskId(idOrKey);
    const cur = taskId ? this.tasks.get(taskId) : null;
    if (!cur) throw new Error(`未找到任务 "${idOrKey}"`);

    const next = { ...cur };
    if (patch.title !== undefined && String(patch.title).trim()) next.title = String(patch.title).trim();
    if (patch.description !== undefined) next.description = String(patch.description).trim();
    if (patch.spec !== undefined) next.spec = String(patch.spec).trim();
    if (patch.specStatus !== undefined && ['draft', 'approved'].includes(patch.specStatus)) {
      next.specStatus = patch.specStatus;
    }
    if (Array.isArray(patch.acceptanceCriteria)) {
      next.acceptanceCriteria = normalizeCriteria(patch.acceptanceCriteria);
    }
    if (Array.isArray(patch.labels)) {
      next.labels = [...new Set(patch.labels.map((s) => String(s).trim()).filter(Boolean))];
    }
    if (patch.status !== undefined) {
      const norm = normalizeTaskStatus(patch.status);
      if (!norm) throw new Error(`非法任务状态 "${patch.status}"`);
      next.status = norm.status;
      if (norm.blocked === true) next.blocked = true;
      else if (norm.status === TASK_STATUSES.DONE || norm.status === TASK_STATUSES.CANCELLED) next.blocked = false;
    }
    if (patch.blocked !== undefined) next.blocked = Boolean(patch.blocked);
    if (patch.blockedReason !== undefined) next.blockedReason = patch.blockedReason || null;
    if (patch.priority !== undefined && ['P0', 'P1', 'P2'].includes(patch.priority)) {
      next.priority = patch.priority;
    }
    if (patch.assignee !== undefined) next.assignee = patch.assignee || null;
    if (patch.reviewer !== undefined) next.reviewer = patch.reviewer || null;
    if (patch.parentId !== undefined) next.parentId = patch.parentId || null;
    if (Array.isArray(patch.dependsOn)) {
      const cleanDeps = [...new Set(patch.dependsOn.filter(Boolean).map((d) => this._resolveTaskId(d) || d))];
      this._assertNoDependencyCycle(taskId, cleanDeps);
      next.dependsOn = cleanDeps;
    }
    if (patch.claimedBy !== undefined) next.claimedBy = patch.claimedBy || null;
    if (patch.claimExpiresAt !== undefined) next.claimExpiresAt = patch.claimExpiresAt || null;
    if (Array.isArray(patch.rejectionHistory)) next.rejectionHistory = patch.rejectionHistory;
    if (patch.gitlabIssueIid !== undefined) next.gitlabIssueIid = toPositiveIntOrNull(patch.gitlabIssueIid);
    if (patch.gitlabMrIid !== undefined) next.gitlabMrIid = toPositiveIntOrNull(patch.gitlabMrIid);
    if (patch.branch !== undefined) next.branch = patch.branch || null;

    if (Array.isArray(patch.deliverableSeqs)) {
      next.deliverableSeqs = [...new Set([...cur.deliverableSeqs, ...patch.deliverableSeqs.map(Number).filter(Boolean)])];
    }
    if (Array.isArray(patch.defectSeqs)) {
      next.defectSeqs = [...new Set([...cur.defectSeqs, ...patch.defectSeqs.map(Number).filter(Boolean)])];
    }
    if (Array.isArray(patch.commits)) {
      next.commits = [...new Set([...cur.commits, ...patch.commits.filter(Boolean)])];
    }
    if (Array.isArray(patch.files)) {
      next.files = [...new Set([...cur.files, ...patch.files.filter(Boolean)])];
    }
    if (Array.isArray(patch.linkedKnowledgeIds)) {
      next.linkedKnowledgeIds = [...new Set([...(cur.linkedKnowledgeIds || []), ...patch.linkedKnowledgeIds.filter(Boolean)])];
    }

    const updatedAt = new Date().toISOString();
    next.updatedAt = updatedAt;
    this.tasks.set(taskId, next);

    const storedPatch = {};
    for (const k of Object.keys(next)) {
      if (k !== 'id' && k !== 'createdAt') storedPatch[k] = next[k];
    }
    this.storage?.appendEvent(this.swarmId, { type: 'task_update', taskId, patch: storedPatch, updatedAt });
    const enriched = this._enrichTask(next);
    this.emit('task', { op: 'update', task: enriched });
    return enriched;
  }

  approveSpec(idOrKey, { spec = undefined, acceptanceCriteria = undefined, approver = 'coordinator' } = {}) {
    const taskId = this._resolveTaskId(idOrKey);
    const cur = taskId ? this.tasks.get(taskId) : null;
    if (!cur) throw new Error(`未找到任务 "${idOrKey}"`);
    const patch = {
      specStatus: 'approved',
      reviewer: cur.reviewer || approver
    };
    if (spec !== undefined) patch.spec = spec;
    if (Array.isArray(acceptanceCriteria)) patch.acceptanceCriteria = acceptanceCriteria;
    if (cur.status === TASK_STATUSES.BACKLOG) {
      patch.status = TASK_STATUSES.READY;
    }
    return this.updateTask(taskId, patch);
  }

  toggleCriterion(idOrKey, criterionId, checked = null) {
    const taskId = this._resolveTaskId(idOrKey);
    const cur = taskId ? this.tasks.get(taskId) : null;
    if (!cur) throw new Error(`未找到任务 "${idOrKey}"`);
    const list = (cur.acceptanceCriteria || []).map((c) =>
      c.id === criterionId ? { ...c, checked: checked === null ? !c.checked : Boolean(checked) } : c
    );
    return this.updateTask(taskId, { acceptanceCriteria: list });
  }

  claimTask(idOrKey, memberName, { ttlMs = 300_000 } = {}) {
    const taskId = this._resolveTaskId(idOrKey);
    const cur = taskId ? this.tasks.get(taskId) : null;
    if (!cur) throw new Error(`未找到任务 "${idOrKey}"`);
    if (cur.status === TASK_STATUSES.DONE || cur.status === TASK_STATUSES.CANCELLED) {
      throw new Error(`任务 ${cur.issueKey} 已处于终态 (${cur.status})，无法认领`);
    }
    if (this._isClaimActive(cur) && cur.claimedBy !== memberName) {
      throw new Error(`任务 ${cur.issueKey} 已被 @${cur.claimedBy} 认领且租约未过期`);
    }
    const rawTtl = Number(ttlMs);
    if (!Number.isFinite(rawTtl)) {
      throw new Error(`非法租约时长 ttlMs: "${ttlMs}"`);
    }
    const expiresAt = new Date(Date.now() + rawTtl).toISOString();
    return this.updateTask(taskId, {
      claimedBy: memberName,
      claimExpiresAt: expiresAt,
      assignee: cur.assignee || memberName
    });
  }

  releaseTask(idOrKey, memberName = null) {
    const taskId = this._resolveTaskId(idOrKey);
    const cur = taskId ? this.tasks.get(taskId) : null;
    if (!cur) throw new Error(`未找到任务 "${idOrKey}"`);
    if (memberName && this._isClaimActive(cur) && cur.claimedBy !== memberName) {
      throw new Error(`只有当前认领人 @${cur.claimedBy} 或协调者可释放该任务租约`);
    }
    return this.updateTask(taskId, { claimedBy: null, claimExpiresAt: null });
  }

  acceptTask(idOrKey, { reviewer = 'coordinator', summary = '' } = {}) {
    const taskId = this._resolveTaskId(idOrKey);
    const cur = taskId ? this.tasks.get(taskId) : null;
    if (!cur) throw new Error(`未找到任务 "${idOrKey}"`);
    const criteria = (cur.acceptanceCriteria || []).map((c) => ({ ...c, checked: true }));
    return this.updateTask(taskId, {
      status: TASK_STATUSES.DONE,
      blocked: false,
      blockedReason: null,
      reviewer,
      claimedBy: null,
      claimExpiresAt: null,
      acceptanceCriteria: criteria,
      description: summary ? `${cur.description ? `${cur.description}\n` : ''}✅ 验收结论：${summary}` : cur.description
    });
  }

  rejectTask(idOrKey, { reviewer = 'qa', reason = '未通过验收标准，请返工修复' } = {}) {
    const taskId = this._resolveTaskId(idOrKey);
    const cur = taskId ? this.tasks.get(taskId) : null;
    if (!cur) throw new Error(`未找到任务 "${idOrKey}"`);
    const entry = {
      reviewer,
      reason: String(reason || '未通过验收标准').trim(),
      time: new Date().toISOString()
    };
    return this.updateTask(taskId, {
      status: TASK_STATUSES.IN_PROGRESS,
      blocked: true,
      blockedReason: entry.reason,
      reviewer,
      rejectionHistory: [...(cur.rejectionHistory || []), entry]
    });
  }

  /**
   * Automatically correlate board posts (briefs, GitLab issues, deliverables, defects, done)
   * with Issue cards so deliverables and `#seq` proofs stay continuously synchronized.
   */
  onBoardMessage(msg, swarm) {
    if (!msg) return;
    const explicitTaskId = msg.metadata?.taskId;
    if (explicitTaskId && this.tasks.has(explicitTaskId)) {
      const patch = {};
      if (msg.kind === MESSAGE_KINDS.DELIVERABLE) {
        patch.deliverableSeqs = [msg.seq];
        if (msg.metadata?.commitSha) patch.commits = [msg.metadata.commitSha];
        if (Array.isArray(msg.metadata?.files)) patch.files = msg.metadata.files;
        if (msg.metadata?.gitlabMrIid) patch.gitlabMrIid = msg.metadata.gitlabMrIid;
        if (msg.metadata?.knowledgeId) patch.linkedKnowledgeIds = [msg.metadata.knowledgeId];
      } else if (msg.kind === MESSAGE_KINDS.DEFECT) {
        patch.defectSeqs = [msg.seq];
        patch.status = TASK_STATUSES.IN_PROGRESS;
        patch.blocked = true;
        patch.blockedReason = msg.text.slice(0, 140);
      } else if (msg.kind === MESSAGE_KINDS.DONE) {
        patch.deliverableSeqs = [msg.seq];
        patch.status = TASK_STATUSES.DONE;
        patch.blocked = false;
      }
      if (Object.keys(patch).length > 0) {
        this.updateTask(explicitTaskId, patch);
      }
      return;
    }

    // Auto-create / update card from member brief
    if (msg.kind === MESSAGE_KINDS.BRIEF && msg.metadata?.briefFor) {
      const assignee = msg.metadata.briefFor;
      const autoId = `auto-member-${assignee}`;
      const memberObj = swarm?.members?.get(assignee);
      if (!this.tasks.has(autoId)) {
        this.createTask({
          id: autoId,
          title: `@${assignee} 职责交付（${msg.metadata.role || memberObj?.role || 'author'}）`,
          description: msg.text.slice(0, 180),
          spec: msg.text,
          specStatus: 'approved',
          status: TASK_STATUSES.IN_PROGRESS,
          priority: 'P1',
          assignee,
          gitlabIssueIid: swarm?.gitlab?.linkedIssueIid || null,
          branch: memberObj?.branch || null,
          deliverableSeqs: [msg.seq],
          autoDerived: true
        });
      }
      return;
    }

    // Auto-create task when GitLab Issue opens / dispatches
    if (msg.kind === MESSAGE_KINDS.GITLAB && msg.metadata?.gitlabEvent === 'issue' && msg.metadata?.gitlabIssueIid) {
      const iid = msg.metadata.gitlabIssueIid;
      const autoId = `auto-gitlab-issue-${iid}`;
      if (!this.tasks.has(autoId)) {
        const firstLine = msg.text.split(/\r?\n/)[0] || `GitLab Issue #${iid}`;
        const assignee = msg.mentions?.[0] || 'coordinator';
        this.createTask({
          id: autoId,
          title: `GitLab Issue #${iid} · ${firstLine.replace(/^@[a-z0-9_-]+\s*/gi, '').slice(0, 80)}`,
          description: msg.text.slice(0, 200),
          spec: msg.text,
          specStatus: 'approved',
          status: TASK_STATUSES.IN_PROGRESS,
          priority: 'P0',
          assignee,
          labels: ['gitlab'],
          gitlabIssueIid: iid,
          deliverableSeqs: [msg.seq],
          autoDerived: true
        });
      }
      return;
    }

    // Correlate deliverables by author
    if (msg.kind === MESSAGE_KINDS.DELIVERABLE) {
      const target =
        this.listTasks().find(
          (t) => t.assignee === msg.author && t.status !== TASK_STATUSES.DONE && t.status !== TASK_STATUSES.CANCELLED
        ) || this.tasks.get(`auto-member-${msg.author}`);

      const memberObj = swarm?.members?.get(msg.author);
      const nextStatus =
        msg.author === 'qa' || msg.author === 'verifier' || msg.author === 'release'
          ? TASK_STATUSES.DONE
          : TASK_STATUSES.REVIEW;

      if (target) {
        this.updateTask(target.id, {
          status: nextStatus,
          blocked: false,
          blockedReason: null,
          deliverableSeqs: [msg.seq],
          commits: msg.metadata?.commitSha ? [msg.metadata.commitSha] : undefined,
          files: Array.isArray(msg.metadata?.files) ? msg.metadata.files : undefined,
          gitlabMrIid: msg.metadata?.gitlabMrIid ?? target.gitlabMrIid,
          linkedKnowledgeIds: msg.metadata?.knowledgeId ? [msg.metadata.knowledgeId] : undefined,
          branch: memberObj?.branch || target.branch
        });
      } else {
        this.createTask({
          id: `auto-member-${msg.author}`,
          title: `@${msg.author} 阶段交付`,
          description: msg.text.slice(0, 180),
          status: nextStatus,
          priority: 'P1',
          assignee: msg.author,
          gitlabIssueIid: swarm?.gitlab?.linkedIssueIid || null,
          gitlabMrIid: msg.metadata?.gitlabMrIid || swarm?.gitlab?.linkedMrIid || null,
          deliverableSeqs: [msg.seq],
          commits: msg.metadata?.commitSha ? [msg.metadata.commitSha] : [],
          files: Array.isArray(msg.metadata?.files) ? msg.metadata.files : [],
          linkedKnowledgeIds: msg.metadata?.knowledgeId ? [msg.metadata.knowledgeId] : [],
          branch: memberObj?.branch || null,
          autoDerived: true
        });
      }
      return;
    }

    // Correlate QA / Reviewer defect tickets
    if (msg.kind === MESSAGE_KINDS.DEFECT) {
      const targetAssignee = msg.mentions?.[0] || null;
      const target = targetAssignee
        ? this.listTasks().find(
            (t) =>
              t.assignee === targetAssignee && t.status !== TASK_STATUSES.DONE && t.status !== TASK_STATUSES.CANCELLED
          )
        : null;
      if (target) {
        this.updateTask(target.id, {
          status: TASK_STATUSES.IN_PROGRESS,
          blocked: true,
          blockedReason: msg.text.slice(0, 140),
          defectSeqs: [msg.seq]
        });
      } else {
        this.createTask({
          id: `auto-defect-${msg.seq}`,
          title: `缺陷工单 #${msg.seq}${targetAssignee ? ` (@${targetAssignee})` : ''}`,
          description: msg.text.slice(0, 180),
          status: TASK_STATUSES.IN_PROGRESS,
          blocked: true,
          blockedReason: msg.text.slice(0, 140),
          priority: 'P0',
          assignee: targetAssignee || 'developer',
          reviewer: msg.author,
          gitlabIssueIid: swarm?.gitlab?.linkedIssueIid || null,
          defectSeqs: [msg.seq],
          autoDerived: true
        });
      }
      return;
    }

    // On [done], mark auto-derived active tasks as done
    if (msg.kind === MESSAGE_KINDS.DONE) {
      for (const t of this.tasks.values()) {
        if (t.autoDerived && t.status !== TASK_STATUSES.DONE && t.status !== TASK_STATUSES.CANCELLED) {
          this.updateTask(t.id, {
            status: TASK_STATUSES.DONE,
            blocked: false,
            blockedReason: null,
            deliverableSeqs: [msg.seq],
            gitlabMrIid: swarm?.gitlab?.linkedMrIid || t.gitlabMrIid
          });
        }
      }
    }
  }
}
