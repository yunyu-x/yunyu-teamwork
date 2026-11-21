import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { WORKSPACE_MODES } from '../../src/core/constants.mjs';
import { OwnershipGuard } from '../../src/core/ownership.mjs';
import { WorktreeManager } from '../../src/core/worktree.mjs';
import { createDemoGitRepo } from '../../src/demo/showcase-scenario.mjs';

test('WorktreeManager provisions real git worktrees, enforces OwnershipGuard, merges cleanly, and protects unmerged work', () => {
  const repoDir = createDemoGitRepo();
  try {
    const guard = new OwnershipGuard({
      ownership: {
        backend: { role: 'author', owns: ['src/**'], mustNotTouch: ['web/**'] },
        qa: { role: 'verifier', owns: ['tests/**'] }
      }
    });
    const wm = new WorktreeManager({ repoPath: repoDir, swarmId: 'wt-test', ownershipGuard: guard });
    assert.equal(wm.available, true);

    // Provision real isolated git worktree for backend
    const ws = wm.provision('backend', WORKSPACE_MODES.SHARE);
    assert.equal(ws.isolated, true);
    assert.ok(fs.existsSync(ws.dir));
    assert.match(ws.branch, /^yunyu\/wt-test\/backend$/);

    // Unauthorized edit to web/ is blocked by OwnershipGuard on commit
    fs.writeFileSync(path.join(ws.dir, 'web', 'illegal.js'), 'export const bad = 1;\n', 'utf8');
    assert.throws(() => wm.commitChanges('backend', 'illegal edit'), /所有权守卫拦截/);
    fs.unlinkSync(path.join(ws.dir, 'web', 'illegal.js'));

    // Authorized edit to src/ succeeds
    fs.writeFileSync(path.join(ws.dir, 'src', 'feature.mjs'), 'export const ok = 42;\n', 'utf8');
    const committed = wm.commitChanges('backend', 'feat: add feature.mjs');
    assert.equal(committed.committed, true);
    assert.deepEqual(committed.files, ['src/feature.mjs']);

    // Cleanup without merge refuses to destroy unmerged work
    assert.throws(() => wm.cleanup('backend'), /存在未合并改动/);

    // Merge into base branch lands src/feature.mjs into main repo
    const merged = wm.mergeToBase('backend');
    assert.equal(merged.merged, true);
    assert.ok(fs.existsSync(path.join(repoDir, 'src', 'feature.mjs')));

    // Cleanup now succeeds cleanly
    const cleaned = wm.cleanup('backend');
    assert.equal(cleaned.removed, true);
    assert.equal(fs.existsSync(ws.dir), false);
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});
