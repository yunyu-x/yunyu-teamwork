import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MESSAGE_KINDS, TASK_STATUSES } from '../../src/core/constants.mjs';
import { GitLabMockServer } from '../../src/gitlab/index.mjs';
import { YunyuServer } from '../../src/server/app.mjs';

test('v0.2.0 REST API & MCP: Kanban Tasks, GitLab Issue Notes preview/reply, CLI Logs, Personal Twins & IM Inbound', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yunyu-v020-api-'));
  const gitlabMock = new GitLabMockServer({ projectPath: 'yunyu/kanban-demo' });
  const glUrl = await gitlabMock.start(0);

  const imReceived = [];
  const mockIm = http.createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c.toString('utf8');
    imReceived.push(JSON.parse(raw || '{}'));
    const body = JSON.stringify({ ok: true });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
  });
  await new Promise((r) => mockIm.listen(0, '127.0.0.1', r));
  const imUrl = `http://127.0.0.1:${mockIm.address().port}/hook`;

  const server = new YunyuServer({
    host: '127.0.0.1',
    port: 0,
    dataDir,
    repoPath: null
  });
  const baseUrl = await server.start();

  try {
    // 1. Health check exposes v0.2.0 presets & channel types
    const health = await (await fetch(`${baseUrl}/api/health`)).json();
    assert.equal(health.ok, true);
    assert.ok(Array.isArray(health.agentPresets) && health.agentPresets.length >= 5);
    assert.ok(Array.isArray(health.channelTypes) && health.channelTypes.length >= 6);

    // 2. Create swarm linked to GitLab mock
    const createRes = await fetch(`${baseUrl}/api/swarms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'v020-swarm',
        title: 'v0.2.0 综合 API 验证蜂群',
        templateId: 'git-dev-lifecycle',
        gitlab: {
          baseUrl: glUrl,
          projectId: 'yunyu/kanban-demo',
          token: 'gl-tok',
          linkedIssueIid: 1
        }
      })
    });
    assert.equal(createRes.status, 201);

    // 3. Kanban Tasks CRUD + status move + auto-linked deliverables
    const tCreateRes = await fetch(`${baseUrl}/api/swarms/v020-swarm/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '实现 OAuth2 令牌刷新接口',
        assignee: 'developer',
        reviewer: 'reviewer',
        priority: 'P0',
        gitlabIssueIid: 1
      })
    });
    assert.equal(tCreateRes.status, 201);
    const task = await tCreateRes.json();
    assert.equal(task.status, TASK_STATUSES.BACKLOG);

    // Move task to in_progress
    const tMoveRes = await fetch(`${baseUrl}/api/swarms/v020-swarm/tasks/${encodeURIComponent(task.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: TASK_STATUSES.REVIEW, deliverableSeqs: [1] })
    });
    assert.equal(tMoveRes.status, 200);
    const moved = await tMoveRes.json();
    assert.equal(moved.status, TASK_STATUSES.REVIEW);

    // Post a deliverable message and confirm Kanban tracks it
    await fetch(`${baseUrl}/api/swarms/v020-swarm/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        author: 'developer',
        text: '已完成 OAuth2 令牌刷新实现（Commit `abc1234`），请 @reviewer 复核。',
        kind: MESSAGE_KINDS.DELIVERABLE,
        metadata: { taskId: task.id, commitSha: 'abc1234', files: ['src/oauth.mjs'] }
      })
    });
    const tasksData = await (await fetch(`${baseUrl}/api/swarms/v020-swarm/tasks`)).json();
    const updatedTask = tasksData.tasks.find((x) => x.id === task.id);
    assert.ok(updatedTask.commits.includes('abc1234'));
    assert.ok(updatedTask.deliverableSeqs.length >= 1);

    // 4. GitLab Issue Notes Preview & Direct Reply (with board mirror)
    const notePostRes = await fetch(`${baseUrl}/api/swarms/v020-swarm/gitlab/issues/1/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: '请优先补充单元测试覆盖边界场景 @verifier',
        author: 'pm-lin',
        postToBoard: true
      })
    });
    assert.equal(notePostRes.status, 201);
    const notesList = await (await fetch(`${baseUrl}/api/swarms/v020-swarm/gitlab/issues/1/notes`)).json();
    assert.ok(notesList.notes.some((n) => n.body.includes('请优先补充单元测试')));

    // Verify mirrored to board
    const boardAfterNote = await (await fetch(`${baseUrl}/api/swarms/v020-swarm/messages?limit=50`)).json();
    assert.ok(boardAfterNote.messages.some((m) => m.text.includes('GitLab Issue #1') && m.text.includes('请优先补充单元测试')));

    // 5. Personal Digital Twin CRUD, Attach, Outbound IM Test, and Inbound IM Webhook
    const twinSaveRes = await fetch(`${baseUrl}/api/twins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'lin-twin-profile',
        name: 'lin-twin',
        ownerName: '林总监',
        persona: '重视上线稳定性与验收闭环',
        autonomyMode: 'hybrid',
        channel: {
          type: 'generic-webhook',
          webhookUrl: imUrl,
          secret: 'im-hmac-key',
          enabled: true
        }
      })
    });
    assert.equal(twinSaveRes.status, 201);

    const attachRes = await fetch(`${baseUrl}/api/swarms/v020-swarm/twins/lin-twin-profile/attach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(attachRes.status, 201);

    // Test outbound channel connectivity
    const testPushRes = await fetch(`${baseUrl}/api/swarms/v020-swarm/members/lin-twin/channel/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '连通性测试成功' })
    });
    assert.equal(testPushRes.status, 200);
    assert.equal(imReceived.length, 1);

    // Test inbound IM webhook -> posts to Swarm Board
    const inboundPayload = JSON.stringify({ sender: '林总监', text: '已确认排期，同意本周五发布。' });
    const sig = `sha256=${crypto.createHmac('sha256', 'im-hmac-key').update(inboundPayload).digest('hex')}`;
    const inRes = await fetch(`${baseUrl}/api/swarms/v020-swarm/channels/inbound/generic-webhook/lin-twin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Yunyu-Signature': sig },
      body: inboundPayload
    });
    assert.equal(inRes.status, 200);
    const inJson = await inRes.json();
    assert.equal(inJson.accepted, true);
    assert.ok(inJson.message.text.includes('同意本周五发布'));

    // 6. CLI Logs & Session Reset endpoints
    const swarmObj = server.manager.getSwarm('v020-swarm');
    swarmObj.emitAgentLog({ member: 'developer', eventType: 'stdout', text: 'Running unit tests...' });
    const logsRes = await (await fetch(`${baseUrl}/api/swarms/v020-swarm/logs?member=developer`)).json();
    assert.ok(logsRes.logs.some((l) => l.text.includes('Running unit tests')));

    const resetRes = await fetch(`${baseUrl}/api/swarms/v020-swarm/members/developer/session/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(resetRes.status, 200);

    // 7. MCP JSON-RPC task_list & gitlab_comment_issue
    const mcpTaskRes = await (
      await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'task_list', arguments: { swarmId: 'v020-swarm' } }
        })
      })
    ).json();
    const mcpTasks = JSON.parse(mcpTaskRes.result.content[0].text);
    assert.ok(mcpTasks.tasks.some((x) => x.id === task.id));
  } finally {
    await server.close();
    await gitlabMock.close();
    await new Promise((r) => {
      mockIm.close(r);
      mockIm.closeAllConnections?.();
    });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
