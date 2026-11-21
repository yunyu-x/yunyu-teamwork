import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { TeamworkManager } from '../../src/core/orchestrator.mjs';
import { runShowcaseDemo } from '../../src/demo/showcase-scenario.mjs';
import { createDefaultDriverRegistry } from '../../src/drivers/registry.mjs';

test('Full GitLab + Multi-Agent Worktree E2E: Architect -> Parallel Authors -> QA Defect Ticket -> Auto-Fix -> Merge -> MR -> Done', async () => {
  const manager = new TeamworkManager({
    inMemory: true,
    driverRegistry: createDefaultDriverRegistry()
  });

  const demo = await runShowcaseDemo({ manager, keepOpen: false });
  try {
    const { swarm, gitlabMock, repoDir } = demo;
    const msgs = swarm.board.read({ since: 0, limit: 100 }).messages;

    // 1. Verify full collaborative trajectory including QA Round 1 defect ticket & Round 2 pass
    assert.ok(msgs.length >= 10, `Expected >= 10 collaborative messages, got ${msgs.length}`);
    assert.equal(swarm.board.done, true, 'Swarm should finish with [done]');
    const defectMsg = msgs.find((m) => m.kind === 'defect' && m.author === 'qa');
    assert.ok(defectMsg, 'Expected QA to file a P1 defect ticket on Round 1');
    assert.equal(defectMsg.metadata.guardBlocked, true, 'Expected QA write to src/ to be blocked by OwnershipGuard');

    const qaPassMsg = msgs.find((m) => m.author === 'qa' && m.metadata?.passed === true);
    assert.ok(qaPassMsg, 'Expected QA Round 2 verification to pass after backend auto-fix');

    // 2. Verify non-destructive Chinese display translation overlay on English CI message
    const ciMsg = msgs.find((m) => m.metadata?.pipelineId === 501);
    assert.ok(ciMsg, 'Expected GitLab CI pipeline message');
    assert.ok(ciMsg.text.includes('SUCCESS'));
    assert.ok(ciMsg.translations['zh-CN'].includes('成功'));

    // 3. Verify real files landed in main git repo after WorktreeManager merges
    assert.ok(fs.existsSync(path.join(repoDir, 'CONTRACT.json')));
    assert.ok(fs.existsSync(path.join(repoDir, 'src', 'rate-limiter.mjs')));
    assert.ok(fs.existsSync(path.join(repoDir, 'web', 'dashboard-widget.mjs')));
    assert.ok(fs.existsSync(path.join(repoDir, 'tests', 'rate-limiter.test.mjs')));

    // 4. Verify bidirectional GitLab sync updated Issue #1 notes, labels, and merged MR !1
    const issue1 = gitlabMock.state.issues.find((i) => i.iid === 1);
    assert.ok(issue1.notes.length >= 3, `Expected mirrored progress notes on GitLab Issue #1, got ${issue1.notes.length}`);
    assert.ok(issue1.labels.includes('teamwork::done'), `Expected teamwork::done label, got ${JSON.stringify(issue1.labels)}`);
    assert.equal(gitlabMock.state.mergeRequests.length, 1);
    assert.equal(gitlabMock.state.mergeRequests[0].state, 'merged');
  } finally {
    await demo.cleanup();
    manager.disposeAll();
  }
});
