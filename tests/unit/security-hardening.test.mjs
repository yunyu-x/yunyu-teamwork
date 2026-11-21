import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ChannelBridge } from '../../src/channels/bridge.mjs';
import { ProjectAuditor } from '../../src/core/auditor.mjs';
import { MessageBoard } from '../../src/core/board.mjs';
import { BudgetGovernor } from '../../src/core/budget.mjs';
import { KnowledgeVault } from '../../src/core/knowledge.mjs';
import { TeamworkManager, redactDriverConfigForPublic, validateGitLabTokenEnvName } from '../../src/core/orchestrator.mjs';
import { OwnershipGuard } from '../../src/core/ownership.mjs';
import { ResearchEngine, isPrivateIpOrHost } from '../../src/core/research.mjs';
import { sanitizeId } from '../../src/core/storage.mjs';
import { TaskTracker } from '../../src/core/tasks.mjs';
import { ProjectWiki, sanitizeWikiSlug } from '../../src/core/wiki.mjs';
import { ProjectWorldModel } from '../../src/core/world-model.mjs';
import { createGuardedWorkspaceTools } from '../../src/drivers/base.mjs';
import { GitLabClient } from '../../src/gitlab/client.mjs';
import { YunyuServer } from '../../src/server/app.mjs';

test('Security Hardening: sanitizeId, OwnershipGuard traversal/case/qa-role, and Board prototype safety', () => {
  // 1. sanitizeId blocks traversal
  assert.throws(() => sanitizeId('..'), /非法标识符/);
  assert.throws(() => sanitizeId('...'), /非法标识符/);
  assert.equal(sanitizeId('swarm-01'), 'swarm-01');

  // 2. OwnershipGuard blocks '..' collapse, Windows case variations, and role==='qa'
  const guard = new OwnershipGuard({
    ownership: {
      qa_agent: { role: 'qa', owns: ['tests/**'] },
      reviewer: { role: 'reviewer', owns: ['docs/**'] }
    }
  });
  assert.equal(guard.checkWrite('qa_agent', 'tests/../src/index.mjs').allowed, false);
  assert.equal(guard.checkWrite('qa_agent', '../outside.mjs').allowed, false);
  assert.equal(guard.checkWrite('qa_agent', 'src/index.mjs').allowed, false);
  if (process.platform === 'win32' || process.platform === 'darwin') {
    assert.equal(guard.checkWrite('qa_agent', 'SRC/core/board.mjs').allowed, false);
  }
  assert.equal(guard.checkWrite('qa_agent', 'tests/ok.test.mjs').allowed, true);

  // 3. MessageBoard rejects __proto__ lang and syncs done on kind==='done'
  const board = new MessageBoard({ swarmId: 'sec-board' });
  const m1 = board.post({ author: 'coordinator', text: '全部验收归档完成', kind: 'done' });
  assert.equal(board.done, true);
  assert.throws(() => board.annotateTranslation(m1.seq, '__proto__', 'evil'), /非法语言标识/);
  assert.throws(() => board.annotateTranslation(m1.seq, 'constructor', 'evil'), /非法语言标识/);
});

test('Security Hardening: SSRF IPv6/redirect blocking, KnowledgeVault javascript: sanitization, and token redaction', async () => {
  // 1. IPv6 bracket & private ranges blocked
  assert.equal(isPrivateIpOrHost('[::1]'), true);
  assert.equal(isPrivateIpOrHost('::1'), true);
  assert.equal(isPrivateIpOrHost('0.0.0.0'), true);
  assert.equal(isPrivateIpOrHost('100.100.100.200'), true);
  assert.equal(isPrivateIpOrHost('[::ffff:127.0.0.1]'), true);
  assert.equal(isPrivateIpOrHost('[fe80::1]'), true);
  assert.equal(isPrivateIpOrHost('sub.localhost'), true);
  assert.equal(isPrivateIpOrHost('example.com'), false);

  const blockedIpv6 = await ResearchEngine.fetchWebSource('http://[::1]:4310/api/health');
  assert.equal(blockedIpv6.ok, false);
  assert.ok(blockedIpv6.error.includes('安全拦截'));

  // 2. KnowledgeVault strips javascript: & data: URLs while preserving https:
  const kb = new KnowledgeVault({ swarmId: 'sec-kb' });
  const entry = kb.addEntry({
    title: 'URL Sanitization Test',
    content: 'test',
    sources: [
      { title: 'evil', url: 'javascript:alert(1)' },
      { title: 'good', url: 'https://github.com/yunyu-x/yunyu-teamwork' }
    ]
  });
  assert.equal(entry.sources[0].url, null);
  assert.equal(entry.sources[1].url, 'https://github.com/yunyu-x/yunyu-teamwork');

  // 3. Token env allowlist blocks non-GitLab secrets
  assert.equal(validateGitLabTokenEnvName('GITLAB_TOKEN'), 'GITLAB_TOKEN');
  assert.equal(validateGitLabTokenEnvName('YUNYU_TEST_GITLAB_TOKEN'), 'YUNYU_TEST_GITLAB_TOKEN');
  assert.throws(() => validateGitLabTokenEnvName('OPENAI_API_KEY'), /安全拦截/);
  assert.throws(() => validateGitLabTokenEnvName('AWS_SECRET_ACCESS_KEY'), /安全拦截/);

  // 4. Nested headers / env / webhookUrl query secret redaction
  const redacted = redactDriverConfigForPublic({
    apiKey: 'secret-1',
    headers: { Authorization: 'Bearer top-secret', 'X-Safe': 'ok' },
    env: { OPENAI_API_KEY: 'sk-123' },
    channel: {
      type: 'dingtalk',
      secret: 'dt-sec',
      webhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=abc123&other=1'
    }
  });
  assert.equal(redacted.apiKey, '***');
  assert.equal(redacted.headers.Authorization, '***');
  assert.equal(redacted.headers['X-Safe'], 'ok');
  assert.equal(redacted.env.OPENAI_API_KEY, '***');
  assert.equal(redacted.channel.secret, '***');
  assert.equal(redacted.channel.webhookUrl.includes('abc123'), false);

  // 5. GitLabClient blocks path traversal in issueIid / mrIid
  const gl = new GitLabClient({ baseUrl: 'http://127.0.0.1:9999', token: 't' });
  assert.throws(() => gl.getIssue('org/repo', '../members'), /正整数/);
  assert.throws(() => gl.getMergeRequest('org/repo', '1/../../admin'), /正整数/);
});

test('Security Hardening: IM channel auth/replay/type-confusion, guarded tools isolation, and HTTP API security', async () => {
  // 1. DingTalk requires sign+timestamp when secret is configured; Slack checks signature before url_verification
  const bridge = new ChannelBridge();
  const dtMissing = bridge.parseInbound('dingtalk', {}, JSON.stringify({ text: { content: 'hi' } }), { secret: 'dt-secret' });
  assert.equal(dtMissing.accepted, false);
  assert.equal(dtMissing.statusCode, 401);

  const slackOldTs = String(Math.floor(Date.now() / 1000) - 900);
  const slackBody = JSON.stringify({ type: 'url_verification', challenge: 'chal' });
  const slackOldSig = `v0=${crypto.createHmac('sha256', 'sl-sec').update(`v0:${slackOldTs}:${slackBody}`).digest('hex')}`;
  const slackChallengeUnauth = bridge.parseInbound(
    'slack',
    { 'x-slack-request-timestamp': slackOldTs, 'x-slack-signature': slackOldSig },
    slackBody,
    { secret: 'sl-sec' }
  );
  assert.equal(slackChallengeUnauth.accepted, false);
  assert.equal(slackChallengeUnauth.statusCode, 401);
  assert.equal(slackChallengeUnauth.challengeResponse, undefined);

  // 2. ChannelBridge blocks channel-type confusion & non-twin members
  const manager = new TeamworkManager({ inMemory: true });
  const swarm = manager.createSwarm({ id: 'im-sec', title: 'IM Sec' });
  swarm.addMember({
    name: 'alice-twin',
    role: 'digital_twin',
    driver: 'digital-twin',
    postBrief: false,
    driverConfig: { channel: { type: 'slack', secret: 'sl-sec', enabled: true } }
  });
  swarm.addMember({ name: 'backend', role: 'author', driver: 'human', postBrief: false });

  const mismatch = await bridge.handleInboundForMember({
    swarm,
    memberName: 'alice-twin',
    channelType: 'wecom',
    rawBody: JSON.stringify({ content: 'forged' })
  });
  assert.equal(mismatch.accepted, false);
  assert.equal(mismatch.statusCode, 403);

  const nonTwin = await bridge.handleInboundForMember({
    swarm,
    memberName: 'backend',
    channelType: 'generic-webhook',
    rawBody: JSON.stringify({ text: 'forged' })
  });
  assert.equal(nonTwin.accepted, false);
  assert.equal(nonTwin.statusCode, 403);

  // 3. Guarded workspace tools block read-only roles from arbitrary run_command & non-allowlisted run_verification
  const qaMember = swarm.addMember({ name: 'qa', role: 'verifier', driver: 'human', postBrief: false });
  const qaTools = createGuardedWorkspaceTools({
    swarm: { ...swarm, repoPath: process.cwd() },
    member: qaMember,
    ownership: swarm.ownership,
    worktrees: swarm.worktrees,
    gitlab: null
  });
  const cmdBlocked = qaTools.run_command({ command: 'echo hack' });
  assert.equal(cmdBlocked.ok, false);
  assert.ok(cmdBlocked.error.includes('安全铁律拦截'));
  const verifyBlocked = qaTools.run_verification({ command: 'node -e "process.exit(0)"' });
  assert.equal(verifyBlocked.passed, false);
  assert.ok(verifyBlocked.error.includes('安全门禁拦截'));

  // 4. HTTP server enforces CORS restriction, optional YUNYU_API_TOKEN, custom CLI block, and member redaction
  const server = new YunyuServer({
    host: '127.0.0.1',
    port: 0,
    inMemory: true,
    apiToken: 'test-api-bearer-token'
  });
  const baseUrl = await server.start();
  try {
    const noAuth = await fetch(`${baseUrl}/api/swarms`);
    assert.equal(noAuth.status, 401);

    const withAuth = await fetch(`${baseUrl}/api/swarms`, {
      headers: { Authorization: 'Bearer test-api-bearer-token', Origin: 'https://evil.example' }
    });
    assert.equal(withAuth.status, 200);
    assert.equal(withAuth.headers.get('access-control-allow-origin'), null);
    assert.equal(withAuth.headers.get('x-content-type-options'), 'nosniff');

    const badSwarm = await fetch(`${baseUrl}/api/swarms`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-api-bearer-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '..', title: 'traversal' })
    });
    assert.equal(badSwarm.status, 400);

    const createdSw = await (
      await fetch(`${baseUrl}/api/swarms`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-api-bearer-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'sec-http', title: 'HTTP Sec' })
      })
    ).json();

    // Custom CLI command rejected over HTTP by default
    const cliBlocked = await fetch(`${baseUrl}/api/swarms/${createdSw.id}/members`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-api-bearer-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'rce',
        role: 'author',
        driver: 'cli-agent',
        brief: 'test',
        driverConfig: { command: 'calc.exe' }
      })
    });
    assert.equal(cliBlocked.status, 403);

    // POST /members redacts secrets in returned member object
    const added = await (
      await fetch(`${baseUrl}/api/swarms/${createdSw.id}/members`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-api-bearer-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'llm1',
          role: 'author',
          driver: 'openai-compatible',
          brief: 'test',
          postBrief: false,
          driverConfig: { apiKey: 'sk-super-secret-value' }
        })
      })
    ).json();
    assert.equal(added.driverConfig.apiKey, '***');
  } finally {
    await server.close();
    manager.disposeAll();
  }
});

test('Architecture Fixes: TaskTracker ISS-N mutators, Budget cost warning, Wiki idempotency/reserved slugs, Auditor template eval', () => {
  // 1. TaskTracker mutators accept ISS-N keys
  const tracker = new TaskTracker({ swarmId: 'iss-key-test' });
  const t1 = tracker.createTask({ title: 'Task One', gitlabIssueIid: '12', gitlabMrIid: '<script>' });
  assert.equal(t1.issueKey, 'ISS-1');
  assert.equal(t1.gitlabIssueIid, 12);
  assert.equal(t1.gitlabMrIid, null);

  const approved = tracker.approveSpec('ISS-1', { spec: 'Frozen' });
  assert.equal(approved.specStatus, 'approved');
  const claimed = tracker.claimTask('ISS-1', 'backend', { ttlMs: 60_000 });
  assert.equal(claimed.claimedBy, 'backend');
  const done = tracker.acceptTask('ISS-1', { reviewer: 'qa' });
  assert.equal(done.status, 'done');

  // 2. BudgetGovernor emits independent warnings for maxCostUsd
  const budget = new BudgetGovernor({ maxCostUsd: 0.1, costPer1kTokensUsd: 0.01, warnRatio: 0.8 });
  const upd = budget.recordUsage('backend', { tokens: 8500, turns: 1 });
  assert.equal(upd.warningTriggered, true);
  assert.ok(upd.warningMessage.includes('费用预算'));

  // 3. Wiki blocks reserved slugs (readme / nul) & skipIfUnchanged stays at v1 across repeated generateFromWorldModel
  assert.throws(() => sanitizeWikiSlug('README'), /保留名称/);
  assert.throws(() => sanitizeWikiSlug('nul'), /保留名称/);

  const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'yunyu-sec-wm-'));
  try {
    fs.mkdirSync(path.join(tmpRepo, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpRepo, 'package.json'), JSON.stringify({ name: 't', version: '1.0.0' }));
    fs.writeFileSync(path.join(tmpRepo, 'src', 'a.mjs'), 'export const x = 1;\n');
    const wm = new ProjectWorldModel({ repoPath: tmpRepo });
    const s1 = wm.refresh();
    const wiki = new ProjectWiki({ swarmId: 'idemp' });
    wiki.generateFromWorldModel(s1, { projectName: 'TestProj' });
    assert.equal(wiki.getPage('home').version, 1);
    const s2 = wm.refresh();
    wiki.generateFromWorldModel(s2, { projectName: 'TestProj' });
    assert.equal(wiki.getPage('home').version, 1, 'skipIfUnchanged must keep home at v1 when structure is unchanged');

    // 4. Auditor catches eval() hidden inside template literal `${eval(x)}`
    fs.writeFileSync(path.join(tmpRepo, 'src', 'tpl.mjs'), 'export const f = (s) => `${eval(s)}`;\n');
    const audit = ProjectAuditor.run({ repoPath: tmpRepo, worldModel: wm });
    assert.equal(audit.passed, false);
    assert.ok(audit.findings.some((f) => f.file === 'src/tpl.mjs' && f.severity === 'P0'));
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});
