import assert from 'node:assert/strict';
import test from 'node:test';
import { TeamworkManager } from '../../src/core/orchestrator.mjs';

test('StallMonitor human-gate reminders escalate with exponential backoff, cap at 16x, and reset when gate clears', () => {
  const manager = new TeamworkManager({ inMemory: true });
  const swarm = manager.createSwarm({
    id: 'gate-backoff',
    title: '人工门禁退避测试蜂群',
    enableMonitor: true,
    monitorIntervalMs: 60_000,
    stallThresholdMs: 100
  });
  swarm.addMember({ name: 'worker', role: 'author', driver: 'human', postBrief: false });
  const member = swarm.members.get('worker');
  member.state = 'waiting_human';
  const monitor = swarm.monitor;
  const t0 = Date.now();

  // Below base threshold: silent
  assert.equal(monitor.checkNow(t0 + 50), null);

  // First reminder fires at base threshold (100ms)
  const a1 = monitor.checkNow(t0 + 150);
  assert.ok(a1, 'first human-gate reminder should fire');
  assert.ok(a1.text.includes('[人工门禁提醒]'));
  assert.equal(a1.metadata.backoffMs, 100);

  // Advance head; second reminder requires 200ms idle
  swarm.postMessage({ author: 'worker', text: '仍在等待人工确认' });
  monitor.lastActivityAt = t0 + 200;
  assert.equal(monitor.checkNow(t0 + 350), null, '150ms idle < 200ms backoff');
  const a2 = monitor.checkNow(t0 + 450);
  assert.ok(a2);
  assert.equal(a2.metadata.backoffMs, 200);

  // Third reminder requires 400ms idle
  swarm.postMessage({ author: 'worker', text: '继续等待' });
  monitor.lastActivityAt = t0 + 500;
  assert.equal(monitor.checkNow(t0 + 800), null, '300ms idle < 400ms backoff');
  const a3 = monitor.checkNow(t0 + 950);
  assert.ok(a3);
  assert.equal(a3.metadata.backoffMs, 400);

  // Backoff caps at 16x base threshold even with a long streak
  monitor.humanGateStreak = 10;
  swarm.postMessage({ author: 'worker', text: '长时间等待' });
  monitor.lastActivityAt = t0 + 1000;
  assert.equal(monitor.checkNow(t0 + 2000), null, '1000ms idle < 1600ms cap');
  const a4 = monitor.checkNow(t0 + 2700);
  assert.ok(a4);
  assert.equal(a4.metadata.backoffMs, 1600);

  // Gate clears: streak resets and normal stall detection resumes at base threshold
  member.state = 'waiting';
  swarm.postMessage({ author: 'worker', text: '人工已确认，但未 @ 后续责任人' });
  monitor.lastActivityAt = t0 + 3000;
  const cleared = monitor.checkNow(t0 + 3150);
  assert.ok(cleared);
  assert.ok(cleared.mentions.includes('coordinator'));
  assert.equal(monitor.humanGateStreak, 0);

  // A new human gate starts back over from the base threshold
  member.state = 'waiting_human';
  swarm.postMessage({ author: 'worker', text: '再次进入人工门禁' });
  monitor.lastActivityAt = t0 + 4000;
  const again = monitor.checkNow(t0 + 4150);
  assert.ok(again);
  assert.equal(again.metadata.backoffMs, 100);

  manager.disposeAll();
});