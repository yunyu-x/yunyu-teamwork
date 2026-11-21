import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ChannelBridge, listChannelTypes } from '../../src/channels/index.mjs';
import { AUTONOMY_MODES, MEMBER_ROLES, MEMBER_STATES } from '../../src/core/constants.mjs';
import { TeamworkManager } from '../../src/core/orchestrator.mjs';
import { TwinsStore } from '../../src/core/twins-store.mjs';
import { createDefaultDriverRegistry } from '../../src/drivers/registry.mjs';

test('ChannelBridge supports outbound & inbound protocols for Feishu, WeCom, DingTalk, Telegram, Slack, and Generic Webhook', async () => {
  const types = listChannelTypes();
  for (const id of ['feishu', 'wecom', 'dingtalk', 'telegram', 'slack', 'generic-webhook']) {
    assert.ok(types.some((t) => t.id === id), `Expected channel type ${id}`);
  }

  const received = [];
  const mockIm = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk.toString('utf8');
    received.push({
      url: req.url,
      headers: req.headers,
      body: JSON.parse(raw || '{}')
    });
    const resp = JSON.stringify({ ok: true, errcode: 0, code: 0 });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(resp) });
    res.end(resp);
  });

  await new Promise((r) => mockIm.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${mockIm.address().port}`;
  const bridge = new ChannelBridge();

  try {
    // Outbound Feishu with HMAC sign
    await bridge.sendOutbound(
      { type: 'feishu', webhookUrl: `${baseUrl}/feishu`, secret: 'fs-sec' },
      { title: '分身提醒', text: '测试飞书推送', swarmId: 's1', member: 'zhang-twin' }
    );
    assert.equal(received[0].body.msg_type, 'post');
    assert.ok(received[0].body.sign && received[0].body.timestamp);

    // Outbound DingTalk with signed query params
    await bridge.sendOutbound(
      { type: 'dingtalk', webhookUrl: `${baseUrl}/ding`, secret: 'dt-sec' },
      { title: '钉钉提醒', text: '测试钉钉推送', swarmId: 's1', member: 'zhang-twin' }
    );
    assert.ok(received[1].url.includes('timestamp=') && received[1].url.includes('sign='));
    assert.equal(received[1].body.msgtype, 'markdown');

    // Outbound WeCom markdown
    await bridge.sendOutbound(
      { type: 'wecom', webhookUrl: `${baseUrl}/wecom` },
      { title: '企微提醒', text: '测试企微推送', swarmId: 's1', member: 'zhang-twin' }
    );
    assert.equal(received[2].body.msgtype, 'markdown');

    // Outbound Generic Webhook with HMAC-SHA256 header
    await bridge.sendOutbound(
      { type: 'generic-webhook', webhookUrl: `${baseUrl}/generic`, secret: 'gen-sec' },
      { title: '通用推送', text: '测试通用机器人', swarmId: 's1', member: 'zhang-twin' }
    );
    assert.ok(String(received[3].headers['x-yunyu-signature'] || '').startsWith('sha256='));

    // Inbound Feishu url_verification challenge
    const fsChallenge = bridge.parseInbound(
      'feishu',
      {},
      JSON.stringify({ type: 'url_verification', challenge: 'chal-123', token: 'vtok' }),
      { inboundToken: 'vtok' }
    );
    assert.equal(fsChallenge.challengeResponse.challenge, 'chal-123');

    // Inbound Feishu message
    const fsMsg = bridge.parseInbound(
      'feishu',
      {},
      JSON.stringify({
        header: { token: 'vtok' },
        event: {
          sender: { sender_id: { open_id: 'ou_zhang' } },
          message: { content: JSON.stringify({ text: '同意合入主分支 @release' }) }
        }
      }),
      { inboundToken: 'vtok' }
    );
    assert.equal(fsMsg.accepted, true);
    assert.ok(fsMsg.text.includes('同意合入主分支'));

    // Inbound Telegram with secret token header
    const tgMsg = bridge.parseInbound(
      'telegram',
      { 'x-telegram-bot-api-secret-token': 'tg-sec' },
      JSON.stringify({
        message: { from: { username: 'zhang' }, text: '已确认线上发布窗口' }
      }),
      { inboundToken: 'tg-sec' }
    );
    assert.equal(tgMsg.accepted, true);
    assert.equal(tgMsg.sender, 'zhang');

    // Inbound Slack HMAC signature check
    const slackTs = String(Math.floor(Date.now() / 1000));
    const slackRaw = JSON.stringify({ event: { type: 'message', user: 'U123', text: 'LGTM ship it' } });
    const slackSig = `v0=${crypto.createHmac('sha256', 'sl-sec').update(`v0:${slackTs}:${slackRaw}`).digest('hex')}`;
    const slMsg = bridge.parseInbound(
      'slack',
      { 'x-slack-request-timestamp': slackTs, 'x-slack-signature': slackSig },
      slackRaw,
      { secret: 'sl-sec' }
    );
    assert.equal(slMsg.accepted, true);
    assert.equal(slMsg.text, 'LGTM ship it');
  } finally {
    await new Promise((r) => {
      mockIm.close(r);
      mockIm.closeAllConnections?.();
    });
  }
});

test('DigitalTwinDriver supports hybrid auto-reply + IM escalation + inbound callback + TwinsStore persistence', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yunyu-twin-data-'));
  const pushedToIm = [];

  const mockIm = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk.toString('utf8');
    pushedToIm.push(JSON.parse(raw || '{}'));
    const resp = JSON.stringify({ ok: true });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(resp) });
    res.end(resp);
  });
  await new Promise((r) => mockIm.listen(0, '127.0.0.1', r));
  const imUrl = `http://127.0.0.1:${mockIm.address().port}/im-bot`;

  const bridge = new ChannelBridge();
  const manager = new TeamworkManager({
    dataDir,
    driverRegistry: createDefaultDriverRegistry({ channelBridge: bridge })
  });

  try {
    // 1. Persist a custom Personal Digital Twin profile in TwinsStore
    const store1 = new TwinsStore({ dataDir });
    const saved = store1.saveTwin({
      id: 'zhang-personal',
      name: 'zhang-twin',
      ownerName: '张架构',
      persona: '简洁务实、关注接口稳定性与向后兼容',
      knowledge: '工作日优先在飞书回复，高风险上线必须人工确认。',
      autonomyMode: AUTONOMY_MODES.HYBRID,
      escalationKeywords: ['生产发布', '审批', '合并'],
      channel: {
        type: 'generic-webhook',
        webhookUrl: imUrl,
        secret: 'twin-secret',
        enabled: true
      }
    });
    assert.equal(saved.id, 'zhang-personal');

    // Reload from disk to verify persistence
    const store2 = new TwinsStore({ dataDir });
    const reloaded = store2.getTwin('zhang-personal');
    assert.equal(reloaded.ownerName, '张架构');
    assert.equal(reloaded.channel.webhookUrl, imUrl);

    // 2. Attach personal twin to a swarm
    const swarm = manager.createSwarm({ id: 'twin-collab', title: '数字分身协同演练', enableMonitor: false });
    swarm.addMember(store2.toMemberSpec(reloaded));

    // Routine message -> hybrid auto-replies AND copies summary to IM
    swarm.postMessage({ author: 'coordinator', text: '@zhang-twin 请同步一下目前 API 兼容原则' });
    await swarm.waitIdle({ timeoutMs: 8000 });

    const msgs1 = swarm.board.read({ since: 0, limit: 20 }).messages;
    const autoReply = msgs1.find((m) => m.author === 'zhang-twin');
    assert.ok(autoReply, 'Expected digital twin auto-reply in hybrid mode');
    assert.ok(autoReply.text.includes('张架构'), 'Expected owner identity in twin reply');
    assert.equal(pushedToIm.length, 1, 'Expected routine auto-reply summary mirrored to IM');

    // High-risk escalation message -> pauses into waiting_human & pushes IM approval card
    swarm.postMessage({ author: 'coordinator', text: '@zhang-twin 请审批是否执行生产发布并合并主干？' });
    await swarm.waitIdle({ timeoutMs: 8000 });

    assert.equal(swarm.members.get('zhang-twin').state, MEMBER_STATES.WAITING_HUMAN);
    assert.equal(pushedToIm.length, 2, 'Expected escalation alert pushed to owner IM');
    assert.ok(JSON.stringify(pushedToIm[1]).includes('生产发布'));

    // Owner responds via IM inbound webhook -> posts as @zhang-twin on board & restores waiting state
    const inboundBody = JSON.stringify({ sender: '张架构', text: '@coordinator 批准本次生产发布，请按流程执行。' });
    const sig = `sha256=${crypto.createHmac('sha256', 'twin-secret').update(inboundBody).digest('hex')}`;
    const inboundResult = await bridge.handleInboundForMember({
      swarm,
      memberName: 'zhang-twin',
      channelType: 'generic-webhook',
      headers: { 'x-yunyu-signature': sig },
      rawBody: inboundBody
    });
    assert.equal(inboundResult.accepted, true);
    assert.ok(inboundResult.message.seq > autoReply.seq);
    assert.equal(swarm.members.get('zhang-twin').state, MEMBER_STATES.WAITING);
    assert.ok(inboundResult.message.text.includes('批准本次生产发布'));
  } finally {
    manager.disposeAll();
    await new Promise((r) => {
      mockIm.close(r);
      mockIm.closeAllConnections?.();
    });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
