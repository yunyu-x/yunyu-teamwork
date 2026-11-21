import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { TASK_STATUSES } from '../../src/core/constants.mjs';
import { SwarmStorage } from '../../src/core/storage.mjs';
import { TaskTracker } from '../../src/core/tasks.mjs';

test('TaskTracker implements Qoder 6-state Issue lifecycle, Spec/Acceptance checklist, and query filters', () => {
  const tracker = new TaskTracker({ swarmId: 'qoder-test' });

  const iss1 = tracker.createTask({
    title: '设计统一权限网关',
    reporter: 'coordinator',
    assignee: 'architect',
    priority: 'P0',
    spec: '## 目标\n统一 JWT 与 RBAC 鉴权校验',
    acceptanceCriteria: ['支持 HS256/RS256 验签', '单元测试 100% 通过'],
    labels: ['security', 'spec']
  });

  assert.equal(iss1.issueKey, 'ISS-1');
  assert.equal(iss1.status, TASK_STATUSES.BACKLOG); // 待规划
  assert.equal(iss1.specStatus, 'draft');
  assert.equal(iss1.acceptanceCriteria.length, 2);
  assert.equal(iss1.acceptanceCriteria[0].checked, false);

  // Approve spec promotes planning (backlog) -> ready (待开始)
  const approved = tracker.approveSpec(iss1.id, {
    approver: 'coordinator',
    spec: '## 冻结方案\n采用中间件模式统一拦截'
  });
  assert.equal(approved.specStatus, 'approved');
  assert.equal(approved.status, TASK_STATUSES.READY);

  // Toggle acceptance criterion
  const toggled = tracker.toggleCriterion(iss1.id, approved.acceptanceCriteria[0].id, true);
  assert.equal(toggled.acceptanceCriteria[0].checked, true);

  // Move to review (待验收), reject with reason -> moves to in_progress with blocked=true & rejection log
  tracker.updateTask(iss1.id, { status: TASK_STATUSES.REVIEW });
  const rejected = tracker.rejectTask(iss1.id, { reviewer: 'qa', reason: '缺少过期 token 边界用例' });
  assert.equal(rejected.status, TASK_STATUSES.IN_PROGRESS);
  assert.equal(rejected.blocked, true);
  assert.ok(rejected.rejectionHistory.some((r) => r.reason.includes('过期 token')));

  // Accept moves to done & clears blocked
  const accepted = tracker.acceptTask(iss1.id, { reviewer: 'qa', summary: '全部测试绿灯验收通过' });
  assert.equal(accepted.status, TASK_STATUSES.DONE);
  assert.equal(accepted.blocked, false);

  // Cancel another issue
  const iss2 = tracker.createTask({ title: '废弃旧版 XML 导出', reporter: 'pm', assignee: 'backend', status: 'planning' });
  assert.equal(iss2.issueKey, 'ISS-2');
  assert.equal(iss2.status, TASK_STATUSES.BACKLOG);
  const cancelled = tracker.updateTask(iss2.id, { status: TASK_STATUSES.CANCELLED });
  assert.equal(cancelled.status, TASK_STATUSES.CANCELLED);

  // Query filters: scope=mine, search, status
  const mine = tracker.queryTasks({ scope: 'mine', me: 'architect' });
  assert.equal(mine.length, 1);
  assert.equal(mine[0].issueKey, 'ISS-1');

  const searched = tracker.queryTasks({ search: 'XML' });
  assert.equal(searched.length, 1);
  assert.equal(searched[0].issueKey, 'ISS-2');
});

test('TaskTracker enforces Beads-style DAG dependencies, cycle detection, ready queue, TTL claim locks, and JSONL replay', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yunyu-dag-'));
  try {
    const storage1 = new SwarmStorage({ dataDir });
    const t1 = new TaskTracker({ swarmId: 'dag-swarm', storage: storage1 });

    const a = t1.createTask({ title: 'Step A: 冻结接口契约', status: TASK_STATUSES.READY, priority: 'P0' });
    const b = t1.createTask({
      title: 'Step B: 实现后端 API',
      status: TASK_STATUSES.READY,
      dependsOn: [a.id],
      priority: 'P1'
    });
    const c = t1.createTask({
      title: 'Step C: 编写端到端测试',
      status: TASK_STATUSES.READY,
      dependsOn: [b.id],
      priority: 'P1'
    });

    // Cycle detection: A cannot depend on C (C -> B -> A -> C)
    assert.throws(() => t1.updateTask(a.id, { dependsOn: [c.id] }), /循环依赖/);

    // Only A is ready initially (B and C are blocked by unfinished dependencies)
    const ready1 = t1.listReadyTasks();
    assert.deepEqual(ready1.map((x) => x.id), [a.id]);
    assert.equal(t1.isBlockedByDeps(b.id), true);

    // Atomic TTL claim lock prevents concurrent double-claim
    const claimed = t1.claimTask(a.id, 'architect', { ttlMs: 60_000 });
    assert.equal(claimed.claimedBy, 'architect');
    assert.throws(() => t1.claimTask(a.id, 'backend', { ttlMs: 60_000 }), /已被 @architect 认领/);

    // Ready list excludes actively claimed task for other agents
    assert.equal(t1.listReadyTasks({ excludeClaimedByOthersFor: 'backend' }).length, 0);

    // Complete A -> unlocks B!
    t1.acceptTask(a.id, { reviewer: 'coordinator' });
    const ready2 = t1.listReadyTasks();
    assert.deepEqual(ready2.map((x) => x.id), [b.id]);

    // Expired claim lease can be overtaken cleanly
    t1.claimTask(b.id, 'backend-1', { ttlMs: -10 }); // already expired
    const overtaken = t1.claimTask(b.id, 'backend-2', { ttlMs: 60_000 });
    assert.equal(overtaken.claimedBy, 'backend-2');

    // Replay from JSONL storage restores issue keys, DAG deps, and claim state cleanly
    const storage2 = new SwarmStorage({ dataDir });
    const t2 = new TaskTracker({ swarmId: 'dag-swarm', storage: storage2 });
    t2.replayFromStorage();
    assert.equal(t2.getTask(a.id).status, TASK_STATUSES.DONE);
    assert.equal(t2.getTask(b.id).claimedBy, 'backend-2');
    assert.deepEqual(t2.getTask(c.id).dependsOn, [b.id]);
    // Next created issue must keep monotonically increasing issueKey (ISS-4)
    const d = t2.createTask({ title: 'Step D: 性能压测' });
    assert.equal(d.issueKey, 'ISS-4');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
