import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MEMBER_ROLES, WORKSPACE_MODES } from '../../src/core/constants.mjs';
import { OwnershipGuard } from '../../src/core/ownership.mjs';
import { TeamworkManager } from '../../src/core/orchestrator.mjs';
import { AGENT_PRESETS, TEAM_TEMPLATES, listAgentPresets } from '../../src/core/templates.mjs';
import { WorktreeManager } from '../../src/core/worktree.mjs';
import { createDemoGitRepo } from '../../src/demo/showcase-scenario.mjs';
import { createGuardedWorkspaceTools } from '../../src/drivers/base.mjs';
import { createDefaultDriverRegistry } from '../../src/drivers/registry.mjs';

test('OwnershipGuard enforces read-only source isolation on reviewer role and Git tools support diff/log/protected push', () => {
  const repoDir = createDemoGitRepo();
  const bareRemote = fs.mkdtempSync(path.join(os.tmpdir(), 'yunyu-bare-remote-'));

  try {
    // Initialize a real local bare git remote and attach as origin
    execFileSync('git', ['init', '--bare'], { cwd: bareRemote, stdio: 'ignore' });
    execFileSync('git', ['remote', 'add', 'origin', bareRemote], { cwd: repoDir, stdio: 'ignore' });
    execFileSync('git', ['push', '-u', 'origin', 'main'], { cwd: repoDir, stdio: 'ignore' });

    const guard = new OwnershipGuard({
      ownership: {
        developer: { role: MEMBER_ROLES.AUTHOR, owns: ['src/**'] },
        reviewer: { role: MEMBER_ROLES.REVIEWER, owns: ['docs/reviews/**'] },
        verifier: { role: MEMBER_ROLES.VERIFIER, owns: ['tests/**'] }
      }
    });

    // Reviewer MUST NOT write to src/ or web/
    const revCheck = guard.checkWrite('reviewer', 'src/index.mjs');
    assert.equal(revCheck.allowed, false);
    assert.equal(guard.checkWrite('reviewer', 'docs/reviews/r1.md').allowed, true);

    const wm = new WorktreeManager({ repoPath: repoDir, swarmId: 'git-ops', ownershipGuard: guard });
    const devWs = wm.provision('developer', WORKSPACE_MODES.SHARE);
    wm.provision('reviewer', WORKSPACE_MODES.INHERIT);

    // Make compliant code edit, inspect git_status & git_diff, commit, log, and push
    fs.writeFileSync(path.join(devWs.dir, 'src', 'auth.mjs'), 'export const verify = () => true;\n', 'utf8');
    const stBefore = wm.getStatus('developer');
    assert.ok(stBefore.changedFiles.includes('src/auth.mjs'));

    const committed = wm.commitChanges('developer', 'feat(auth): add verify helper');
    assert.equal(committed.committed, true);

    const diff = wm.getDiff('developer');
    assert.ok(diff.includes('verify = () => true'), 'Expected real git diff output');

    const logs = wm.getLog('developer', { limit: 3 });
    assert.ok(logs.some((l) => l.subject.includes('feat(auth): add verify helper')));

    // Protected branch push & force push MUST be blocked
    assert.throws(() => wm.pushBranch('reviewer', { remote: 'origin' }), /禁止推送受保护分支/);
    assert.throws(() => wm.pushBranch('developer', { remote: 'origin', force: true }), /严禁使用 force/);

    // Non-protected agent branch push succeeds to real bare remote
    const pushed = wm.pushBranch('developer', { remote: 'origin' });
    assert.equal(pushed.pushed, true);
    assert.equal(pushed.branch, 'yunyu/git-ops/developer');
    const remoteHeads = execFileSync('git', ['branch', '-a'], { cwd: bareRemote, encoding: 'utf8' });
    assert.ok(remoteHeads.includes('yunyu/git-ops/developer'));
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
    fs.rmSync(bareRemote, { recursive: true, force: true });
  }
});

test('git-dev-lifecycle template and AGENT_PRESETS provide full develop -> commit -> review -> verify workflow tools', () => {
  const repoDir = createDemoGitRepo();
  const manager = new TeamworkManager({
    inMemory: true,
    driverRegistry: createDefaultDriverRegistry(),
    defaultRepoPath: repoDir
  });

  try {
    assert.ok(TEAM_TEMPLATES['git-dev-lifecycle'], 'Expected git-dev-lifecycle template');
    const presets = listAgentPresets();
    for (const id of ['git-developer', 'git-committer', 'git-reviewer', 'git-verifier', 'personal-twin']) {
      assert.ok(AGENT_PRESETS[id], `Expected preset ${id}`);
      assert.ok(presets.some((p) => p.id === id));
    }

    const swarm = manager.createSwarm({
      id: 'git-lifecycle-test',
      title: 'Git 完整研发生命周期测试',
      templateId: 'git-dev-lifecycle',
      repoPath: repoDir,
      enableMonitor: false
    });

    const dev = swarm.members.get('developer');
    const rev = swarm.members.get('reviewer');
    const ver = swarm.members.get('verifier');
    assert.ok(dev && rev && ver);

    const devTools = createGuardedWorkspaceTools({
      swarm,
      member: dev,
      ownership: swarm.ownership,
      worktrees: swarm.worktrees,
      gitlab: swarm.gitlab
    });
    const revTools = createGuardedWorkspaceTools({
      swarm,
      member: rev,
      ownership: swarm.ownership,
      worktrees: swarm.worktrees,
      gitlab: swarm.gitlab
    });
    const verTools = createGuardedWorkspaceTools({
      swarm,
      member: ver,
      ownership: swarm.ownership,
      worktrees: swarm.worktrees,
      gitlab: swarm.gitlab
    });

    assert.equal(devTools.write_file({ path: 'src/calc.mjs', content: 'export const add = (a, b) => a + b;\n' }).ok, true);
    const c = devTools.git_commit({ message: 'feat(calc): add sum function' });
    assert.equal(c.committed, true);

    const reviewReport = revTools.git_review_branch({ targetMember: 'developer' });
    assert.equal(reviewReport.audit.passed, true);
    assert.ok(reviewReport.diff.includes('add = (a, b) => a + b'));
    assert.ok(revTools.write_file({ path: 'src/calc.mjs', content: '// hack' }).error, 'Reviewer cannot modify src/');

    const verifyReport = verTools.run_verification({ command: 'node --check src/index.mjs' });
    assert.equal(verifyReport.passed, true);
  } finally {
    manager.disposeAll();
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});
