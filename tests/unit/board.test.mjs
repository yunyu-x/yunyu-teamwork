import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MessageBoard, parseMessageTokens } from '../../src/core/board.mjs';
import { SwarmStorage } from '../../src/core/storage.mjs';

test('parseMessageTokens extracts @member, @#channel, @all, and #seq refs accurately', () => {
  const res = parseMessageTokens('@backend @qa 请检查 @#frontend 频道里的 #3 和 #12，必要时 @all 同步');
  assert.deepEqual(res.mentions, ['backend', 'qa']);
  assert.deepEqual(res.channelMentions, ['frontend']);
  assert.equal(res.broadcastAll, true);
  assert.deepEqual(res.refs, [3, 12]);
});

test('MessageBoard enforces append-only monotonicity, non-destructive translation, and JSONL replay', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yunyu-board-test-'));
  try {
    const storage = new SwarmStorage({ dataDir: tmpDir });
    const board = new MessageBoard({ swarmId: 's1', storage });
    board.createChannel({ name: 'backend', topic: '后端研发' });
    board.subscribe('backend', 'backend');

    const m1 = board.post({ author: 'coordinator', text: '@backend 请实现限流器', channel: 'backend' });
    const m2 = board.post({ author: 'backend', text: 'Implemented rate limiter (ref #1)', channel: 'backend' });
    assert.equal(m1.seq, 1);
    assert.equal(m2.seq, 2);

    // Attach non-destructive Chinese display translation without modifying original m2.text
    board.annotateTranslation(2, 'zh-CN', '已实现限流器（引用 #1）');
    assert.equal(board.getMessage(2).text, 'Implemented rate limiter (ref #1)');
    assert.equal(board.getMessage(2).translations['zh-CN'], '已实现限流器（引用 #1）');

    // Mark [done]
    const m3 = board.post({ author: 'coordinator', text: '[done] 全部交付完成' });
    assert.equal(m3.kind, 'done');
    assert.equal(board.done, true);

    // Archive channel blocks further posts
    board.archiveChannel('backend');
    assert.throws(() => board.post({ author: 'backend', text: 'late post', channel: 'backend' }), /已归档/);

    // Replay from JSONL into a fresh board
    const replayed = new MessageBoard({ swarmId: 's1', storage });
    replayed.replayFromStorage();
    assert.equal(replayed.head, 3);
    assert.equal(replayed.done, true);
    assert.equal(replayed.getMessage(2).text, 'Implemented rate limiter (ref #1)');
    assert.equal(replayed.getMessage(2).translations['zh-CN'], '已实现限流器（引用 #1）');

    // Graph slice upToSeq=1 shows edge coordinator -> backend
    const g1 = replayed.buildGraph({ upToSeq: 1 });
    assert.equal(g1.edges.length, 1);
    assert.equal(g1.edges[0].from, 'coordinator');
    assert.equal(g1.edges[0].to, 'backend');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
