import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import { TeamworkManager } from '../../src/core/orchestrator.mjs';
import { createDefaultDriverRegistry } from '../../src/drivers/registry.mjs';

test('CliAgentDriver spawns external CLI process with YUNYU_* env vars and posts output to board', async () => {
  const manager = new TeamworkManager({
    inMemory: true,
    driverRegistry: createDefaultDriverRegistry()
  });

  try {
    const swarm = manager.createSwarm({ id: 'cli-driver-test', title: 'CLI 驱动测试', enableMonitor: false });
    swarm.addMember({
      name: 'node-cli',
      role: 'author',
      driver: 'cli-agent',
      owns: ['src/**'],
      postBrief: false,
      driverConfig: {
        command: process.execPath,
        args: ['-e', 'console.log("@coordinator 收到触发#" + process.env.YUNYU_TRIGGER_SEQ + " 成员=" + process.env.YUNYU_AGENT_NAME + " 权限=" + process.env.YUNYU_OWNED_PATHS)']
      }
    });

    swarm.postMessage({ author: 'coordinator', text: '@node-cli 请汇报你的环境上下文' });
    await swarm.waitIdle({ timeoutMs: 8000 });

    const msgs = swarm.board.read({ since: 0, limit: 10 }).messages;
    const reply = msgs.find((m) => m.author === 'node-cli');
    assert.ok(reply, 'Expected CliAgentDriver to post reply');
    assert.ok(reply.text.includes('成员=node-cli'));
    assert.ok(reply.text.includes('权限=src/**'));
  } finally {
    manager.disposeAll();
  }
});

test('WebhookAgentDriver signs payload with HMAC-SHA256 and routes reply back to Swarm Board', async () => {
  const secret = 'webhook-hmac-secret';
  let verifiedSig = false;

  const srv = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk.toString('utf8');
    const expected = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
    verifiedSig = req.headers['x-yunyu-signature'] === expected;
    const body = JSON.parse(raw);
    const resp = JSON.stringify({
      reply: `@coordinator Webhook 节点已处理 #${body.triggerMessage.seq}（验签=${verifiedSig}）`
    });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(resp) });
    res.end(resp);
  });

  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;

  const manager = new TeamworkManager({
    inMemory: true,
    driverRegistry: createDefaultDriverRegistry()
  });

  try {
    const swarm = manager.createSwarm({ id: 'wh-driver-test', title: 'Webhook 驱动测试', enableMonitor: false });
    swarm.addMember({
      name: 'dify-bot',
      role: 'verifier',
      driver: 'webhook',
      postBrief: false,
      driverConfig: { url: `http://127.0.0.1:${port}/hook`, secret }
    });

    swarm.postMessage({ author: 'coordinator', text: '@dify-bot 请执行远端合规审核' });
    await swarm.waitIdle({ timeoutMs: 8000 });

    const msgs = swarm.board.read({ since: 0, limit: 10 }).messages;
    const reply = msgs.find((m) => m.author === 'dify-bot');
    assert.equal(verifiedSig, true, 'Expected HMAC-SHA256 signature verification to succeed');
    assert.ok(reply, 'Expected WebhookAgentDriver to post reply');
    assert.ok(reply.text.includes('验签=true'));
  } finally {
    manager.disposeAll();
    await new Promise((r) => srv.close(r));
  }
});
