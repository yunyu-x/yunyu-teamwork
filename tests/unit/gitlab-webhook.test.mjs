import assert from 'node:assert/strict';
import test from 'node:test';
import { translateGitLabWebhook, verifyGitLabWebhookToken } from '../../src/gitlab/webhook.mjs';

test('verifyGitLabWebhookToken validates X-Gitlab-Token in constant time', () => {
  assert.equal(verifyGitLabWebhookToken({ 'x-gitlab-token': 'secret-123' }, 'secret-123'), true);
  assert.equal(verifyGitLabWebhookToken({ 'x-gitlab-token': 'wrong' }, 'secret-123'), false);
  assert.equal(verifyGitLabWebhookToken({}, ''), true);
});

test('translateGitLabWebhook routes Issue, MR, Note, and Pipeline events into Chinese Swarm messages', () => {
  const issueEv = translateGitLabWebhook('Issue Hook', {
    project: { path_with_namespace: 'yunyu/demo' },
    user: { name: '张三' },
    object_attributes: { iid: 7, action: 'open', title: '支持多租户配额', description: '需要按租户限流' },
    labels: [{ title: 'agent::ready' }]
  });
  assert.equal(issueEv.accepted, true);
  assert.ok(issueEv.text.includes('@coordinator'));
  assert.ok(issueEv.text.includes('Issue #7'));

  const mrEv = translateGitLabWebhook('Merge Request Hook', {
    project: { path_with_namespace: 'yunyu/demo' },
    user: { name: '李四' },
    object_attributes: { iid: 3, action: 'open', title: 'feat: quota', source_branch: 'feat/quota', target_branch: 'main' }
  });
  assert.ok(mrEv.text.includes('@qa'));
  assert.ok(mrEv.text.includes('MR !3'));

  const noteEv = translateGitLabWebhook('Note Hook', {
    project: { path_with_namespace: 'yunyu/demo' },
    user: { name: '王五' },
    issue: { iid: 7 },
    object_attributes: { noteable_type: 'Issue', note: '@backend 请把默认配额改为 100' }
  });
  assert.ok(noteEv.text.includes('@backend'));
  assert.equal(noteEv.text.startsWith('@coordinator'), false);

  const pipeFail = translateGitLabWebhook('Pipeline Hook', {
    project: { path_with_namespace: 'yunyu/demo' },
    object_attributes: { id: 88, status: 'failed', ref: 'feat/quota', duration: 25 },
    builds: [{ stage: 'test', name: 'unit', status: 'failed' }]
  });
  assert.equal(pipeFail.kind, 'defect');
  assert.ok(pipeFail.text.includes('@qa'));
  assert.ok(pipeFail.text.includes('test/unit'));
});
