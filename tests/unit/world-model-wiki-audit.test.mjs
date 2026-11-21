import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ProjectAuditor } from '../../src/core/auditor.mjs';
import { OwnershipGuard } from '../../src/core/ownership.mjs';
import { SwarmStorage } from '../../src/core/storage.mjs';
import { ProjectWiki } from '../../src/core/wiki.mjs';
import { ProjectWorldModel } from '../../src/core/world-model.mjs';

function createFixtureRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yunyu-world-fixture-'));
  fs.mkdirSync(path.join(dir, 'src', 'core'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'server'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tests', 'unit'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });

  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture-app', version: '1.0.0', type: 'module', scripts: { test: 'node --test' } }, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(dir, 'src', 'core', 'math.mjs'),
    `export const PI = 3.14;\nexport function add(a, b) { return a + b; }\nexport class Calculator { sum(a, b) { return add(a, b); } }\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(dir, 'src', 'core', 'service.mjs'),
    `import { Calculator, add } from './math.mjs';\nexport function computeTotal(x, y) { return new Calculator().sum(x, y) + add(1, 0); }\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(dir, 'src', 'server', 'api.mjs'),
    `import { computeTotal } from '../core/service.mjs';\nexport function handleCalc(a, b) { return { total: computeTotal(a, b) }; }\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(dir, 'tests', 'unit', 'math.test.mjs'),
    `import { computeTotal } from '../../src/core/service.mjs';\nexport const tested = computeTotal(1, 2);\n`,
    'utf8'
  );
  fs.writeFileSync(path.join(dir, 'docs', 'OVERVIEW.md'), '# Fixture App\nA modular test repo.\n', 'utf8');
  return dir;
}

test('ProjectWorldModel builds static module dependency graph, detects cycles, and simulates blast-radius impact', () => {
  const repoDir = createFixtureRepo();
  try {
    const guard = new OwnershipGuard({
      ownership: {
        core: { role: 'author', owns: ['src/core/**'] },
        backend: { role: 'author', owns: ['src/server/**'] },
        qa: { role: 'verifier', owns: ['tests/**'] }
      }
    });

    const wm = new ProjectWorldModel({ repoPath: repoDir, ownershipGuard: guard });
    const snap = wm.refresh();

    assert.ok(snap.stats.totalFiles >= 5);
    assert.ok(snap.stats.totalExports >= 4);
    assert.equal(snap.cycles.length, 0);

    const mathFile = snap.files.find((f) => f.path === 'src/core/math.mjs');
    assert.ok(mathFile);
    assert.ok(mathFile.exports.includes('Calculator'));
    assert.ok(mathFile.exports.includes('add'));
    assert.deepEqual(mathFile.owners, ['core']);

    // Blast radius simulation for changing src/core/math.mjs
    const impact = wm.simulateChangeImpact(['src/core/math.mjs']);
    assert.ok(impact.directDependents.includes('src/core/service.mjs'));
    assert.ok(impact.transitiveImpacted.includes('src/server/api.mjs'));
    assert.ok(impact.impactedTests.includes('tests/unit/math.test.mjs'));
    assert.ok(impact.notifiedOwners.includes('backend'));
    assert.ok(['medium', 'high', 'critical'].includes(impact.riskLevel));

    // Introduce a circular dependency and confirm cycle detection catches it
    fs.writeFileSync(
      path.join(repoDir, 'src', 'core', 'math.mjs'),
      `import { computeTotal } from './service.mjs';\nexport function add(a, b) { return a + b + (computeTotal ? 0 : 0); }\n`,
      'utf8'
    );
    const snapCycle = wm.refresh();
    assert.ok(snapCycle.cycles.length >= 1, 'Expected circular dependency to be detected');
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});

test('ProjectWiki auto-generates living multi-page Wiki from WorldModel, tracks append-only revisions, and exports Markdown', () => {
  const repoDir = createFixtureRepo();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yunyu-wiki-data-'));
  const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yunyu-wiki-export-'));

  try {
    const wm = new ProjectWorldModel({ repoPath: repoDir });
    const snap = wm.refresh();

    const s1 = new SwarmStorage({ dataDir });
    const wiki1 = new ProjectWiki({ swarmId: 'wiki-test', storage: s1 });
    const generated = wiki1.generateFromWorldModel(snap, { projectName: 'Fixture App' });

    assert.ok(generated.length >= 4, `Expected >= 4 generated wiki pages, got ${generated.length}`);
    const home = wiki1.getPage('home');
    assert.ok(home && home.content.includes('Fixture App'));
    assert.equal(home.version, 1);

    // Edit page -> version increments to 2 with revision history preserved
    const v2 = wiki1.upsertPage({
      slug: 'home',
      title: '项目总览与核心约定',
      content: `${home.content}\n\n## 人工补充\n严禁引入循环依赖。`,
      author: 'architect',
      summary: '补充循环依赖约束说明'
    });
    assert.equal(v2.version, 2);
    assert.equal(v2.revisions.length, 2);

    // Replay from append-only events.jsonl in fresh instance
    const s2 = new SwarmStorage({ dataDir });
    const wiki2 = new ProjectWiki({ swarmId: 'wiki-test', storage: s2 });
    wiki2.replayFromStorage();
    assert.equal(wiki2.getPage('home').version, 2);
    assert.ok(wiki2.search({ q: '循环依赖' }).some((p) => p.slug === 'home'));

    // Export to Markdown directory
    const exported = wiki2.exportToDir(exportDir);
    assert.ok(exported.files.length >= 4);
    assert.ok(fs.existsSync(path.join(exportDir, 'home.md')));
    assert.ok(fs.existsSync(path.join(exportDir, 'README.md')));
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(exportDir, { recursive: true, force: true });
  }
});

test('ProjectAuditor detects hardcoded secrets, dangerous eval, external deps, and passes clean zero-dep repos', () => {
  const repoDir = createFixtureRepo();
  try {
    const wm = new ProjectWorldModel({ repoPath: repoDir });
    const cleanAudit = ProjectAuditor.run({ repoPath: repoDir, worldModel: wm });
    assert.ok(cleanAudit.score >= 85, `Expected high score on clean repo, got ${cleanAudit.score}`);
    assert.equal(cleanAudit.findings.filter((f) => f.severity === 'P0').length, 0);

    // Inject a P0 hardcoded secret & eval call + runtime dependency
    fs.writeFileSync(
      path.join(repoDir, 'src', 'core', 'leak.mjs'),
      `export const token = "ghp_1234567890abcdefghijklmnopqrstuvwxyz1234";\nexport const run = (s) => eval(s);\n`,
      'utf8'
    );
    fs.writeFileSync(
      path.join(repoDir, 'package.json'),
      JSON.stringify({ name: 'bad-app', version: '1.0.0', dependencies: { lodash: '^4.17.21' } }),
      'utf8'
    );

    const badAudit = ProjectAuditor.run({ repoPath: repoDir, worldModel: wm });
    assert.ok(badAudit.findings.some((f) => f.category === 'security' && f.severity === 'P0'));
    assert.ok(badAudit.findings.some((f) => f.category === 'invariant'));
    assert.ok(badAudit.score < cleanAudit.score);
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});
