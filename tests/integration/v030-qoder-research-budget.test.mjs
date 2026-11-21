import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { TASK_STATUSES } from '../../src/core/constants.mjs';
import { createDemoGitRepo } from '../../src/demo/showcase-scenario.mjs';
import { YunyuServer } from '../../src/server/app.mjs';

test('v0.3.0 REST API & MCP: Qoder Issue Spec/Start/Accept/Reject, Beads Ready/Claim, Budget Governor, and Knowledge/Research', async () => {
  const repoDir = createDemoGitRepo();
  fs.writeFileSync(
    path.join(repoDir, 'docs', 'SPEC_GUIDE.md'),
    '# Spec Guide\nQoder Issue workflow: Planning -> Ready -> In Progress -> Pending Acceptance -> Done.\n',
    'utf8'
  );

  const server = new YunyuServer({
    host: '127.0.0.1',
    port: 0,
    inMemory: true,
    repoPath: repoDir
  });
  const baseUrl = await server.start();

  try {
    // 1. Create swarm from research-to-delivery template
    const swRes = await fetch(`${baseUrl}/api/swarms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'qoder-v030',
        title: 'Qoder Issue 模式与调研协同演练',
        templateId: 'research-to-delivery',
        budget: { maxTokens: 20_000, maxTurns: 30 }
      })
    });
    assert.equal(swRes.status, 201);

    // 2. Create two Issues with DAG dependency (ISS-2 depends on ISS-1)
    const i1 = await (
      await fetch(`${baseUrl}/api/swarms/qoder-v030/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: '冻结多 Agent DAG 调度规范',
          assignee: 'architect',
          priority: 'P0',
          acceptanceCriteria: ['定义 dependsOn 环检测', '定义 TTL 租约字段']
        })
      })
    ).json();
    assert.equal(i1.issueKey, 'ISS-1');
    assert.equal(i1.status, TASK_STATUSES.BACKLOG);

    const i2 = await (
      await fetch(`${baseUrl}/api/swarms/qoder-v030/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: '实现 DAG 调度核心模块',
          assignee: 'developer',
          priority: 'P1',
          dependsOn: [i1.id],
          parentId: i1.id
        })
      })
    ).json();
    assert.equal(i2.issueKey, 'ISS-2');
    assert.equal(i2.blockedByDeps, true);

    // 3. Approve Spec on ISS-1 -> promotes to ready (待开始)
    const approved = await (
      await fetch(`${baseUrl}/api/swarms/qoder-v030/tasks/${encodeURIComponent(i1.id)}/approve-spec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spec: '## 冻结 Spec\n采用 DFS 环检测 + 5 分钟认领租约。' })
      })
    ).json();
    assert.equal(approved.status, TASK_STATUSES.READY);
    assert.equal(approved.specStatus, 'approved');

    // 4. Beads Ready Queue returns only ISS-1 (ISS-2 blocked by ISS-1)
    const readyData = await (await fetch(`${baseUrl}/api/swarms/qoder-v030/tasks/ready`)).json();
    assert.equal(readyData.tasks.length, 1);
    assert.equal(readyData.tasks[0].issueKey, 'ISS-1');

    // 5. Claim -> Start -> Reject -> Accept lifecycle
    const claimed = await (
      await fetch(`${baseUrl}/api/swarms/qoder-v030/tasks/${encodeURIComponent(i1.id)}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member: 'architect', ttlMs: 120_000 })
      })
    ).json();
    assert.equal(claimed.claimedBy, 'architect');

    const started = await (
      await fetch(`${baseUrl}/api/swarms/qoder-v030/tasks/${encodeURIComponent(i1.id)}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignee: 'architect', dispatchBoard: false })
      })
    ).json();
    assert.equal(started.status, TASK_STATUSES.IN_PROGRESS);

    const rejected = await (
      await fetch(`${baseUrl}/api/swarms/qoder-v030/tasks/${encodeURIComponent(i1.id)}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewer: 'reviewer', reason: '请补充并发冲突测试用例', postToBoard: true })
      })
    ).json();
    assert.equal(rejected.blocked, true);

    const accepted = await (
      await fetch(`${baseUrl}/api/swarms/qoder-v030/tasks/${encodeURIComponent(i1.id)}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewer: 'reviewer', summary: 'Spec 与测试全部通过', postToBoard: true })
      })
    ).json();
    assert.equal(accepted.status, TASK_STATUSES.DONE);

    // Completing ISS-1 unlocks ISS-2 in Ready Queue!
    const readyAfter = await (await fetch(`${baseUrl}/api/swarms/qoder-v030/tasks/ready`)).json();
    assert.equal(readyAfter.tasks.length, 1);
    assert.equal(readyAfter.tasks[0].issueKey, 'ISS-2');

    // 6. Budget Governance GET & PUT
    const budgetPut = await (
      await fetch(`${baseUrl}/api/swarms/qoder-v030/budget`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxTokens: 50_000, maxTurns: 60, maxCostUsd: 1.5 })
      })
    ).json();
    assert.equal(budgetPut.maxTokens, 50_000);
    assert.equal(budgetPut.maxCostUsd, 1.5);

    // 7. One-click Research Collection & Knowledge Vault Search
    const resRun = await (
      await fetch(`${baseUrl}/api/swarms/qoder-v030/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: 'Qoder Issue workflow',
          linkedIssueId: i2.id,
          postToBoard: true
        })
      })
    ).json();
    assert.ok(resRun.entry?.id?.startsWith('kb-'));
    assert.ok(resRun.entry.content.includes('SPEC_GUIDE.md'));

    const kbSearch = await (await fetch(`${baseUrl}/api/swarms/qoder-v030/knowledge?q=Qoder`)).json();
    assert.ok(kbSearch.entries.length >= 1);

    // 8. MCP JSON-RPC tools: issue_ready, knowledge_search, budget_status
    const mcpReady = await (
      await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 11,
          method: 'tools/call',
          params: { name: 'issue_ready', arguments: { swarmId: 'qoder-v030' } }
        })
      })
    ).json();
    const mcpReadyParsed = JSON.parse(mcpReady.result.content[0].text);
    assert.equal(mcpReadyParsed.tasks[0].issueKey, 'ISS-2');

    const mcpBudget = await (
      await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 12,
          method: 'tools/call',
          params: { name: 'budget_status', arguments: { swarmId: 'qoder-v030' } }
        })
      })
    ).json();
    const mcpBudgetParsed = JSON.parse(mcpBudget.result.content[0].text);
    assert.equal(mcpBudgetParsed.maxTokens, 50_000);
  } finally {
    await server.close();
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});
