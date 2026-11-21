import assert from 'node:assert/strict';
import test from 'node:test';
import { TeamworkManager } from '../../src/core/orchestrator.mjs';

test('StallMonitor detects idle swarm, alerts coordinator with stalled #seq, and stops on [done]', () => {
  const manager = new TeamworkManager({ inMemory: true });
  const swarm = manager.createSwarm({
    id: 'stall-test',
    title: '停滞测试蜂群',
    enableMonitor: true,
    monitorIntervalMs: 60_000,
    stallThresholdMs: 100
  });

  swarm.addMember({
    name: 'worker',
    role: 'author',
    driver: 'human',
    postBrief: false
  });

  // Post a message that mentions nobody
  const m1 = swarm.postMessage({ author: 'worker', text: '我改完了但忘了 @ 任何人' });
  assert.equal(m1.seq, 1);

  // Simulate time elapsed beyond stallThresholdMs
  const alert = swarm.monitor.checkNow(Date.now() + 500);
  assert.ok(alert, 'Expected StallMonitor to emit a stall alert');
  assert.equal(alert.author, 'monitor');
  assert.ok(alert.mentions.includes('coordinator'));
  assert.ok(alert.text.includes('#1'));

  // Calling checkNow again at same head does not spam
  const second = swarm.monitor.checkNow(Date.now() + 1000);
  assert.equal(second, null);

  // Posting [done] silences monitor permanently
  swarm.postMessage({ author: 'coordinator', text: '[done] 流程已结束' });
  assert.equal(swarm.board.done, true);
  assert.equal(swarm.monitor.checkNow(Date.now() + 5000), null);

  manager.disposeAll();
});
