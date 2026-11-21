import assert from 'node:assert/strict';
import test from 'node:test';
import { YunyuServer } from '../../src/server/app.mjs';

test('HTTP REST API, SSE broadcast, translation overlay, and GitLab Webhook verification work end-to-end', async () => {
  const server = new YunyuServer({
    host: '127.0.0.1',
    port: 0,
    inMemory: true,
    repoPath: null,
    webhookSecret: 'yunyu-secret-token'
  });
  const baseUrl = await server.start();

  try {
    // 1. Health endpoint
    const health = await (await fetch(`${baseUrl}/api/health`)).json();
    assert.equal(health.ok, true);
    assert.ok(health.drivers.length >= 5);
    assert.ok(health.templates.length >= 3);

    // 2. Create swarm from template
    const swRes = await fetch(`${baseUrl}/api/swarms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'API 集成测试蜂群', templateId: 'gitlab-fullstack' })
    });
    assert.equal(swRes.status, 201);
    const swarm = await swRes.json();

    // 3. Subscribe to SSE stream and verify live message delivery
    const sseController = new AbortController();
    const sseRes = await fetch(`${baseUrl}/api/events?swarmId=${encodeURIComponent(swarm.id)}`, {
      signal: sseController.signal
    });
    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();

    // Read initial connected event
    const firstChunk = await reader.read();
    assert.ok(decoder.decode(firstChunk.value).includes('event: connected'));

    // 4. Reject invalid GitLab Webhook secret
    const badWh = await fetch(`${baseUrl}/api/webhooks/gitlab?swarmId=${encodeURIComponent(swarm.id)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gitlab-Event': 'Issue Hook',
        'X-Gitlab-Token': 'invalid-secret'
      },
      body: JSON.stringify({ object_attributes: { iid: 9, title: 'Unauthorized' } })
    });
    assert.equal(badWh.status, 401);

    // 5. Accept valid GitLab Webhook and verify SSE emits it
    const okWh = await fetch(`${baseUrl}/api/webhooks/gitlab?swarmId=${encodeURIComponent(swarm.id)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gitlab-Event': 'Issue Hook',
        'X-Gitlab-Token': 'yunyu-secret-token'
      },
      body: JSON.stringify({
        project: { path_with_namespace: 'yunyu/api' },
        user: { name: '测试工程师' },
        object_attributes: { iid: 9, action: 'open', title: '支持 OAuth2 登录' },
        labels: [{ title: 'agent::ready' }]
      })
    });
    assert.equal(okWh.status, 200);
    const whJson = await okWh.json();
    assert.equal(whJson.ok, true);

    const sseChunk = await reader.read();
    const sseText = decoder.decode(sseChunk.value);
    assert.ok(sseText.includes('event: message'));
    assert.ok(sseText.includes('Issue #9'));
    sseController.abort();

    // 6. Test non-destructive translation endpoint & Graph endpoint
    const transRes = await fetch(`${baseUrl}/api/swarms/${encodeURIComponent(swarm.id)}/messages/${whJson.seq}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: 'en-US', text: 'GitLab Issue #9 opened: Support OAuth2 Login' })
    });
    assert.equal(transRes.status, 200);
    const translated = await transRes.json();
    assert.equal(translated.translations['en-US'], 'GitLab Issue #9 opened: Support OAuth2 Login');

    const graph = await (await fetch(`${baseUrl}/api/swarms/${encodeURIComponent(swarm.id)}/graph`)).json();
    assert.ok(graph.nodes.length >= 2);
  } finally {
    await server.close();
  }
});
