import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { TeamworkManager } from '../../src/core/orchestrator.mjs';
import { createDefaultDriverRegistry } from '../../src/drivers/registry.mjs';

function makeTempScript(dir, name, code) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, code, 'utf8');
  return filePath;
}

test('CliAgentDriver streams Claude stream-json events, persists session_id for --resume, and supports session reset', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yunyu-fake-claude-'));
  const scriptPath = makeTempScript(
    tmpDir,
    'fake-claude.mjs',
    `
let stdinData = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) stdinData += chunk;
const argv = process.argv.slice(2);
const resumeIdx = argv.indexOf('--resume');
const resumedId = resumeIdx >= 0 ? argv[resumeIdx + 1] : null;
const hasStreamJson = argv.includes('--output-format') && argv.includes('stream-json');

const emit = (obj) => process.stdout.write(JSON.stringify(obj) + '\\n');
const sid = resumedId || 'claude-sess-001';

emit({ type: 'system', subtype: 'init', session_id: sid, model: 'claude-sonnet-4' });
await new Promise((r) => setTimeout(r, 15));
emit({
  type: 'assistant',
  session_id: sid,
  message: {
    content: [
      { type: 'tool_use', name: 'Read', input: { file_path: 'CONTRACT.json' } },
      { type: 'text', text: '正在检查契约文件...' }
    ]
  }
});
await new Promise((r) => setTimeout(r, 15));
emit({
  type: 'result',
  subtype: 'success',
  session_id: sid,
  result: '@coordinator Claude 完成回复 (streamJson=' + hasStreamJson + ', resumed=' + (resumedId || 'none') + ', stdinLen=' + stdinData.length + ')',
  usage: { input_tokens: 120, output_tokens: 45 }
});
`
  );

  const manager = new TeamworkManager({
    inMemory: true,
    driverRegistry: createDefaultDriverRegistry()
  });

  try {
    const swarm = manager.createSwarm({ id: 'claude-stream-test', title: 'Claude 流式会话测试', enableMonitor: false });
    const liveLogs = [];
    swarm.on('agent_log', (ev) => liveLogs.push(ev));

    swarm.addMember({
      name: 'claude-arch',
      role: 'architect',
      driver: 'cli-agent',
      model: 'claude-sonnet-4',
      owns: ['docs/**'],
      postBrief: false,
      driverConfig: {
        preset: 'claude-code',
        command: process.execPath,
        commandPrefixArgs: [scriptPath]
      }
    });

    // Turn 1: fresh session
    swarm.postMessage({ author: 'coordinator', text: '@claude-arch 请冻结第一版架构契约' });
    await swarm.waitIdle({ timeoutMs: 8000 });

    const msgs1 = swarm.board.read({ since: 0, limit: 20 }).messages;
    const reply1 = msgs1.find((m) => m.author === 'claude-arch');
    assert.ok(reply1, 'Expected turn 1 reply');
    assert.ok(reply1.text.includes('streamJson=true'), `Unexpected reply: ${reply1.text}`);
    assert.ok(reply1.text.includes('resumed=none'));
    assert.ok(liveLogs.length >= 2, `Expected live streaming agent_log events, got ${liveLogs.length}`);

    const memAfter1 = swarm.members.get('claude-arch');
    assert.equal(memAfter1.sessionId, 'claude-sess-001');
    assert.equal(memAfter1.driverConfig.sessionId, 'claude-sess-001');
    assert.equal(memAfter1.tokensUsed, 165);

    // Turn 2: must automatically pass --resume claude-sess-001
    swarm.postMessage({ author: 'coordinator', text: '@claude-arch 请补充错误码约定' });
    await swarm.waitIdle({ timeoutMs: 8000 });

    const msgs2 = swarm.board.read({ since: reply1.seq, limit: 20 }).messages;
    const reply2 = msgs2.find((m) => m.author === 'claude-arch');
    assert.ok(reply2, 'Expected turn 2 reply');
    assert.ok(reply2.text.includes('resumed=claude-sess-001'), `Expected --resume claude-sess-001, got: ${reply2.text}`);

    // Reset session and verify turn 3 starts fresh
    swarm.resetMemberSession('claude-arch');
    assert.equal(swarm.members.get('claude-arch').sessionId, null);

    swarm.postMessage({ author: 'coordinator', text: '@claude-arch 开启全新需求评审' });
    await swarm.waitIdle({ timeoutMs: 8000 });

    const msgs3 = swarm.board.read({ since: reply2.seq, limit: 20 }).messages;
    const reply3 = msgs3.find((m) => m.author === 'claude-arch');
    assert.ok(reply3.text.includes('resumed=none'), `Expected fresh session after reset, got: ${reply3.text}`);
  } finally {
    manager.disposeAll();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('CliAgentDriver streams Codex --json events, uses exec resume, and retries fresh when stale session fails', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yunyu-fake-codex-'));
  const scriptPath = makeTempScript(
    tmpDir,
    'fake-codex.mjs',
    `
let stdinData = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) stdinData += chunk;
const argv = process.argv.slice(2);
const isResume = argv[0] === 'exec' && argv[1] === 'resume';
const hasJson = argv.includes('--json');

if (isResume && argv.includes('expired-thread-id')) {
  process.stderr.write('Error: session not found: expired-thread-id\\n');
  process.exit(1);
}

const emit = (obj) => process.stdout.write(JSON.stringify(obj) + '\\n');
const threadId = isResume ? argv.find((a) => a.startsWith('codex-thread-')) || 'codex-thread-777' : 'codex-thread-777';

emit({ type: 'thread.started', thread_id: threadId });
emit({ type: 'item.completed', item: { id: 'cmd-1', type: 'command_execution', command: 'node --test', aggregated_output: 'ok 1' } });
emit({
  type: 'item.completed',
  item: {
    id: 'msg-1',
    type: 'agent_message',
    text: '@coordinator Codex 交付完成 (json=' + hasJson + ', mode=' + (isResume ? 'resume:' + threadId : 'fresh') + ', stdinOk=' + (stdinData.includes('codex-dev')) + ')'
  }
});
emit({ type: 'turn.completed', usage: { input_tokens: 200, output_tokens: 80 } });
`
  );

  const manager = new TeamworkManager({
    inMemory: true,
    driverRegistry: createDefaultDriverRegistry()
  });

  try {
    const swarm = manager.createSwarm({ id: 'codex-stream-test', title: 'Codex 流式会话测试', enableMonitor: false });
    swarm.addMember({
      name: 'codex-dev',
      role: 'author',
      driver: 'cli-agent',
      owns: ['src/**'],
      postBrief: false,
      driverConfig: {
        preset: 'codex-cli',
        command: process.execPath,
        commandPrefixArgs: [scriptPath]
      }
    });

    // Turn 1: fresh codex exec --json -
    swarm.postMessage({ author: 'coordinator', text: '@codex-dev 请实现令牌桶模块' });
    await swarm.waitIdle({ timeoutMs: 8000 });

    const r1 = swarm.board.read({ since: 0, limit: 20 }).messages.find((m) => m.author === 'codex-dev');
    assert.ok(r1.text.includes('json=true'));
    assert.ok(r1.text.includes('mode=fresh'));
    assert.ok(r1.text.includes('stdinOk=true'));
    assert.equal(swarm.members.get('codex-dev').sessionId, 'codex-thread-777');
    assert.equal(swarm.members.get('codex-dev').tokensUsed, 280);

    // Buffered logs should be queryable
    const logs = swarm.getAgentLogs({ member: 'codex-dev' });
    assert.ok(logs.some((l) => l.text.includes('node --test')), 'Expected command execution in agent log buffer');

    // Turn 2: automatically uses codex exec resume --json codex-thread-777 -
    swarm.postMessage({ author: 'coordinator', text: '@codex-dev 请补单测' });
    await swarm.waitIdle({ timeoutMs: 8000 });
    const r2 = swarm.board.read({ since: r1.seq, limit: 20 }).messages.find((m) => m.author === 'codex-dev');
    assert.ok(r2.text.includes('mode=resume:codex-thread-777'));

    // Turn 3: simulate expired session ID -> should auto-fallback to fresh session
    swarm.members.get('codex-dev').sessionId = 'expired-thread-id';
    swarm.members.get('codex-dev').driverConfig.sessionId = 'expired-thread-id';
    swarm.postMessage({ author: 'coordinator', text: '@codex-dev 请做最终检查' });
    await swarm.waitIdle({ timeoutMs: 8000 });
    const r3 = swarm.board.read({ since: r2.seq, limit: 20 }).messages.find((m) => m.author === 'codex-dev');
    assert.ok(r3.text.includes('mode=fresh'), `Expected auto-retry fresh session, got: ${r3.text}`);
    assert.equal(swarm.members.get('codex-dev').sessionId, 'codex-thread-777');
  } finally {
    manager.disposeAll();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
