import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MESSAGE_KINDS, WORKSPACE_MODES } from '../../src/core/constants.mjs';
import { TeamworkManager } from '../../src/core/orchestrator.mjs';
import { createDemoGitRepo } from '../../src/demo/showcase-scenario.mjs';
import { createDefaultDriverRegistry } from '../../src/drivers/registry.mjs';
import { GitLabClient, GitLabMockServer, GitLabSyncService } from '../../src/gitlab/index.mjs';

test('TeamworkManager rehydrates Git Worktrees (including auto-repair), driverConfig/sessionId, and GitLab Client/Sync across restarts', async () => {
  const repoDir = createDemoGitRepo();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yunyu-rehydrate-data-'));
  const gitlabMock = new GitLabMockServer({ projectPath: 'yunyu/rehydrate-repo' });
  const mockUrl = await gitlabMock.start(0);
  const prevEnvToken = process.env.YUNYU_TEST_GITLAB_TOKEN;
  process.env.YUNYU_TEST_GITLAB_TOKEN = 'env-restored-secret';

  let manager1;
  let manager2;

  try {
    // ---- Session 1: Create swarm, provision real worktrees, commit unmerged work, link GitLab ----
    manager1 = new TeamworkManager({
      dataDir,
      driverRegistry: createDefaultDriverRegistry(),
      defaultRepoPath: repoDir
    });

    const glClient = new GitLabClient({ baseUrl: mockUrl, token: 'env-restored-secret' });
    const glSync = new GitLabSyncService({ client: glClient, projectId: 'yunyu/rehydrate-repo', issueIid: 1 });

    const swarm1 = manager1.createSwarm({
      id: 'rehydrate-e2e',
      title: '重启持久化恢复验证蜂群',
      repoPath: repoDir,
      gitlab: {
        client: glClient,
        sync: glSync,
        projectId: 'yunyu/rehydrate-repo',
        linkedIssueIid: 1,
        tokenEnv: 'YUNYU_TEST_GITLAB_TOKEN'
      },
      enableMonitor: false
    });

    swarm1.addMember({
      name: 'backend',
      role: 'author',
      driver: 'cli-agent',
      model: 'claude-sonnet',
      workspace: WORKSPACE_MODES.SHARE,
      owns: ['src/**'],
      mustNotTouch: ['web/**'],
      postBrief: false,
      driverConfig: {
        preset: 'claude-code',
        sessionId: 'claude-sess-9981'
      }
    });

    swarm1.addMember({
      name: 'frontend',
      role: 'author',
      driver: 'simulated',
      workspace: WORKSPACE_MODES.SHARE,
      owns: ['web/**'],
      mustNotTouch: ['src/**'],
      postBrief: false,
      driverConfig: {
        customTag: 'fe-v2',
        handler: async () => ({ reply: 'noop' }) // non-serializable function must be stripped safely
      }
    });

    const backendWs1 = swarm1.worktrees.getWorkspace('backend');
    const frontendWs1 = swarm1.worktrees.getWorkspace('frontend');
    assert.ok(backendWs1 && fs.existsSync(backendWs1.dir));
    assert.ok(frontendWs1 && fs.existsSync(frontendWs1.dir));

    // Commit a file in backend worktree and another in frontend worktree
    fs.writeFileSync(path.join(backendWs1.dir, 'src', 'persisted.mjs'), 'export const v = 1;\n', 'utf8');
    const c1 = swarm1.worktrees.commitChanges('backend', 'feat(backend): initial persisted commit');
    assert.equal(c1.committed, true);

    fs.writeFileSync(path.join(frontendWs1.dir, 'web', 'widget.mjs'), 'export const w = 1;\n', 'utf8');
    const c2 = swarm1.worktrees.commitChanges('frontend', 'feat(frontend): initial widget');
    assert.equal(c2.committed, true);

    // Simulate external deletion of frontend's worktree folder before restart (branch still exists in git)
    fs.rmSync(frontendWs1.dir, { recursive: true, force: true });
    assert.equal(fs.existsSync(frontendWs1.dir), false);

    // Verify meta.json does NOT leak plaintext GitLab token by default
    const metaPath = path.join(dataDir, 'swarms', 'rehydrate-e2e', 'meta.json');
    const rawMeta = fs.readFileSync(metaPath, 'utf8');
    assert.equal(rawMeta.includes('env-restored-secret'), false, 'meta.json must not persist plaintext token by default');
    const parsedMeta = JSON.parse(rawMeta);
    assert.equal(parsedMeta.gitlab.tokenEnv, 'YUNYU_TEST_GITLAB_TOKEN');

    // Shutdown Session 1 cleanly
    manager1.disposeAll();
    manager1 = null;

    // ---- Session 2: Restart TeamworkManager from the same dataDir ----
    manager2 = new TeamworkManager({
      dataDir,
      driverRegistry: createDefaultDriverRegistry(),
      defaultRepoPath: repoDir
    });

    const swarm2 = manager2.getSwarm('rehydrate-e2e');
    assert.ok(swarm2, 'Swarm must be restored from disk');

    // 1. Verify driverConfig & sessionId survived restart without function crash
    const restoredBackend = swarm2.members.get('backend');
    assert.equal(restoredBackend.driverConfig.preset, 'claude-code');
    assert.equal(restoredBackend.driverConfig.sessionId, 'claude-sess-9981');
    const restoredFrontend = swarm2.members.get('frontend');
    assert.equal(restoredFrontend.driverConfig.customTag, 'fe-v2');

    // 2. Verify backend worktree mapping restored intact
    const backendWs2 = swarm2.worktrees.getWorkspace('backend');
    assert.ok(backendWs2, 'Backend worktree mapping must be restored');
    assert.equal(backendWs2.isolated, true);
    assert.equal(backendWs2.branch, 'yunyu/rehydrate-e2e/backend');
    assert.equal(backendWs2.baseBranch, 'main');
    assert.equal(backendWs2.rehydrated, true);
    assert.deepEqual(swarm2.worktrees.listChangedFiles('backend'), ['src/persisted.mjs']);

    // Continue working in restored backend worktree and merge to main
    fs.writeFileSync(path.join(backendWs2.dir, 'src', 'persisted.mjs'), 'export const v = 2;\n', 'utf8');
    const c3 = swarm2.worktrees.commitChanges('backend', 'feat(backend): post-restart commit');
    assert.equal(c3.committed, true);
    const merged = swarm2.worktrees.mergeToBase('backend');
    assert.equal(merged.merged, true);
    assert.ok(fs.readFileSync(path.join(repoDir, 'src', 'persisted.mjs'), 'utf8').includes('v = 2'));

    // 3. Verify missing frontend worktree directory was auto-repaired from surviving git branch
    const frontendWs2 = swarm2.worktrees.getWorkspace('frontend');
    assert.ok(frontendWs2, 'Frontend worktree mapping must be restored');
    assert.equal(fs.existsSync(frontendWs2.dir), true, 'Missing worktree directory should be auto-repaired from branch');
    assert.ok(fs.existsSync(path.join(frontendWs2.dir, 'web', 'widget.mjs')));

    // 4. Verify GitLab Client & Sync Service automatically reconnected and mirror new deliverables
    assert.ok(swarm2.gitlab?.client, 'GitLabClient must be reconstructed after restart');
    assert.ok(swarm2.gitlab?.sync, 'GitLabSyncService must be reconstructed after restart');
    assert.equal(swarm2.gitlab.client.token, 'env-restored-secret');
    assert.equal(swarm2.gitlab.projectId, 'yunyu/rehydrate-repo');

    const notesBefore = await swarm2.gitlab.client.listIssueNotes('yunyu/rehydrate-repo', 1);
    swarm2.postMessage({
      author: 'backend',
      text: '@coordinator 重启后已完成 `src/persisted.mjs` v2 提交并合并主分支。',
      channel: 'main',
      kind: MESSAGE_KINDS.DELIVERABLE
    });
    await new Promise((r) => setTimeout(r, 120));
    const notesAfter = await swarm2.gitlab.client.listIssueNotes('yunyu/rehydrate-repo', 1);
    assert.equal(notesAfter.length, notesBefore.length + 1, 'Post-restart deliverable should auto-sync to GitLab Issue notes');
    assert.ok(notesAfter[notesAfter.length - 1].body.includes('src/persisted.mjs'));
  } finally {
    if (prevEnvToken === undefined) delete process.env.YUNYU_TEST_GITLAB_TOKEN;
    else process.env.YUNYU_TEST_GITLAB_TOKEN = prevEnvToken;
    manager1?.disposeAll();
    manager2?.disposeAll();
    await gitlabMock.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});
