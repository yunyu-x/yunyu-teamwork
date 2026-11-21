import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { BudgetGovernor } from '../../src/core/budget.mjs';
import { KNOWLEDGE_CATEGORIES, MEMBER_ROLES, MEMBER_STATES } from '../../src/core/constants.mjs';
import { KnowledgeVault } from '../../src/core/knowledge.mjs';
import { TeamworkManager } from '../../src/core/orchestrator.mjs';
import { ResearchEngine } from '../../src/core/research.mjs';
import { SwarmStorage } from '../../src/core/storage.mjs';
import { AGENT_PRESETS, TEAM_TEMPLATES } from '../../src/core/templates.mjs';
import { createDemoGitRepo } from '../../src/demo/showcase-scenario.mjs';
import { createDefaultDriverRegistry } from '../../src/drivers/registry.mjs';

test('BudgetGovernor enforces swarm & member token/turn limits and prevents runaway turns in SwarmInstance', async () => {
  const gov = new BudgetGovernor({ maxTokens: 1000, maxTurns: 10, warnRatio: 0.8, costPer1kTokensUsd: 0.01 });
  assert.equal(gov.checkAllow('dev').allowed, true);

  const u1 = gov.recordUsage('dev', { tokens: 850, turns: 1 });
  assert.equal(u1.warningTriggered, true);
  assert.equal(gov.getSummary().status, 'warning');

  gov.recordUsage('dev', { tokens: 200, turns: 1 });
  const check = gov.checkAllow('dev');
  assert.equal(check.allowed, false);
  assert.match(check.reason, /Token 预算上限/);

  // Integration with SwarmInstance
  const manager = new TeamworkManager({
    inMemory: true,
    driverRegistry: createDefaultDriverRegistry()
  });

  try {
    let execCount = 0;
    const swarm = manager.createSwarm({
      id: 'budget-test',
      title: '预算治理测试蜂群',
      budget: { maxTokens: 500, maxTurns: 2 },
      enableMonitor: false
    });
    swarm.addMember({
      name: 'coder',
      role: 'author',
      driver: 'simulated',
      postBrief: false,
      driverConfig: {
        handler: async () => {
          execCount++;
          return { reply: `完成第 ${execCount} 轮`, tokensUsed: 300 };
        }
      }
    });

    swarm.postMessage({ author: 'coordinator', text: '@coder 执行任务 1' });
    await swarm.waitIdle({ timeoutMs: 5000 });
    assert.equal(execCount, 1);

    swarm.postMessage({ author: 'coordinator', text: '@coder 执行任务 2' });
    await swarm.waitIdle({ timeoutMs: 5000 });
    assert.equal(execCount, 2); // Now 600 tokens >= 500 maxTokens!

    // Turn 3 must be blocked by BudgetGovernor!
    swarm.postMessage({ author: 'coordinator', text: '@coder 执行任务 3（应被预算熔断）' });
    await swarm.waitIdle({ timeoutMs: 5000 });
    assert.equal(execCount, 2, 'Expected BudgetGovernor to block turn 3 after exceeding maxTokens');
    assert.equal(swarm.members.get('coder').state, MEMBER_STATES.STOPPED);

    const msgs = swarm.board.read({ since: 0, limit: 20 }).messages;
    assert.ok(msgs.some((m) => m.metadata?.budgetExceeded === true));
  } finally {
    manager.disposeAll();
  }
});

test('KnowledgeVault persists entries append-only in events.jsonl and supports full-text & tag search', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yunyu-kv-'));
  try {
    const s1 = new SwarmStorage({ dataDir });
    const kv1 = new KnowledgeVault({ swarmId: 'kv-swarm', storage: s1 });

    const added = kv1.addEntry({
      title: 'Qoder-CN Issue 模式与 Beads DAG 对比调研',
      category: KNOWLEDGE_CATEGORIES.RESEARCH,
      summary: '结合 Qoder 6 态 Issue 流程与 Beads DAG 依赖锁，消除并发 Agent 抢跑问题。',
      content: '详细分析内容：Spec 冻结后再进入待开始队列，并采用 TTL 租约防重复认领。',
      sources: [{ title: 'Qoder Docs', url: 'https://qoder.com', snippet: 'Spec-Driven Issue workflow' }],
      tags: ['qoder', 'beads', 'architecture'],
      author: 'researcher'
    });
    assert.ok(added.id.startsWith('kb-'));

    // Rehydrate in fresh instance
    const s2 = new SwarmStorage({ dataDir });
    const kv2 = new KnowledgeVault({ swarmId: 'kv-swarm', storage: s2 });
    kv2.replayFromStorage();

    const hits = kv2.search({ q: 'TTL 租约', category: KNOWLEDGE_CATEGORIES.RESEARCH });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].title, added.title);
    assert.equal(hits[0].sources[0].url, 'https://qoder.com');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('ResearchSynthesizerDriver gathers local workspace + web HTML + swarm context, enforces read-only guard, and saves to KnowledgeVault', async () => {
  const repoDir = createDemoGitRepo();
  fs.writeFileSync(
    path.join(repoDir, 'docs', 'ARCHITECTURE_NOTES.md'),
    '# Order Service Notes\nUse TokenBucketLimiter for burst protection and DAG scheduling.\n',
    'utf8'
  );

  const webMock = http.createServer((req, res) => {
    const html = `<!doctype html><html><head><title>Qoder Multi-Agent Spec Guide</title>
      <meta name="description" content="Spec-driven Issue Kanban with Planning, Ready, In Progress, Acceptance." />
      <style>body { color: red; }</style><script>console.log("ignore me")</script></head>
      <body><h1>Qoder Spec Workflow</h1><p>Issues flow through Planning, Ready, In Progress, Pending Acceptance, and Done.</p>
      <h2>Best Practices</h2><p>Always freeze acceptance criteria and run diff review before merging worktrees.</p></body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html) });
    res.end(html);
  });
  await new Promise((r) => webMock.listen(0, '127.0.0.1', r));
  const webUrl = `http://127.0.0.1:${webMock.address().port}/qoder-guide`;

  const manager = new TeamworkManager({
    inMemory: true,
    driverRegistry: createDefaultDriverRegistry(),
    defaultRepoPath: repoDir
  });

  try {
    assert.ok(TEAM_TEMPLATES['research-to-delivery']);
    assert.ok(AGENT_PRESETS['info-synthesizer']);

    // Direct ResearchEngine web extraction check
    const fetched = await ResearchEngine.fetchWebSource(webUrl, { allowPrivate: true });
    assert.equal(fetched.ok, true);
    assert.equal(fetched.title, 'Qoder Multi-Agent Spec Guide');
    assert.equal(fetched.text.includes('ignore me'), false, 'Script tags must be stripped');
    assert.ok(fetched.text.includes('Pending Acceptance'));

    const swarm = manager.createSwarm({
      id: 'research-e2e',
      title: '多源情报搜集与整合演练',
      repoPath: repoDir,
      enableMonitor: false
    });

    swarm.addMember({
      name: 'researcher',
      role: MEMBER_ROLES.RESEARCHER,
      driver: 'research-synthesizer',
      owns: ['docs/research/**'],
      postBrief: false,
      driverConfig: { allowPrivateUrls: true }
    });

    // Verify researcher is read-only protected against src/
    assert.equal(swarm.ownership.checkWrite('researcher', 'src/index.mjs').allowed, false);

    // Create an Issue and dispatch @researcher with an embedded URL + workspace keywords
    const issue = swarm.tasks.createTask({
      title: '调研 Qoder Issue 工作流与 TokenBucketLimiter 方案',
      assignee: 'researcher'
    });

    swarm.postMessage({
      author: 'coordinator',
      text: `@researcher 请搜集并整合 TokenBucketLimiter 与 Qoder Spec 工作流资料，参考 ${webUrl}`,
      metadata: { taskId: issue.id }
    });
    await swarm.waitIdle({ timeoutMs: 8000 });

    const msgs = swarm.board.read({ since: 0, limit: 20 }).messages;
    const reportMsg = msgs.find((m) => m.author === 'researcher');
    assert.ok(reportMsg, 'Expected researcher to post synthesized report');
    assert.ok(reportMsg.text.includes('Qoder Multi-Agent Spec Guide'));
    assert.ok(reportMsg.text.includes('ARCHITECTURE_NOTES.md'));
    assert.ok(reportMsg.metadata?.knowledgeId, 'Expected report saved to KnowledgeVault');

    // Verify KnowledgeVault persisted entry & linked back to Issue
    const kbEntries = swarm.knowledge.listEntries();
    assert.equal(kbEntries.length, 1);
    assert.ok(kbEntries[0].sources.some((s) => s.url === webUrl));
    const updatedIssue = swarm.tasks.getTask(issue.id);
    assert.ok(updatedIssue.linkedKnowledgeIds.includes(kbEntries[0].id));
  } finally {
    manager.disposeAll();
    await new Promise((r) => {
      webMock.close(r);
      webMock.closeAllConnections?.();
    });
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});
