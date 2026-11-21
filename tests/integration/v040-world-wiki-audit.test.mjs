import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { APP_VERSION } from '../../src/core/constants.mjs';
import { createDemoGitRepo } from '../../src/demo/showcase-scenario.mjs';
import { YunyuServer } from '../../src/server/app.mjs';

test('v0.4.0 E2E: World Model, Blast-Radius Impact, Living Wiki, Project Auditor via HTTP REST, MCP, Restart Recovery & CLI', async () => {
  const repoDir = createDemoGitRepo();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yunyu-v040-data-'));
  const wikiOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yunyu-v040-wiki-'));

  // Add connected modules + a test file in the demo git repo
  fs.writeFileSync(
    path.join(repoDir, 'src', 'utils.mjs'),
    `export function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(repoDir, 'src', 'index.mjs'),
    `import { clamp } from './utils.mjs';\nexport const SERVICE_NAME = 'yunyu-order-service';\nexport function normalizeLimit(n) { return clamp(n, 1, 1000); }\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(repoDir, 'tests', 'index.test.mjs'),
    `import { normalizeLimit } from '../src/index.mjs';\nexport const ok = normalizeLimit(50) === 50;\n`,
    'utf8'
  );

  const server = new YunyuServer({ host: '127.0.0.1', port: 0, repoPath: repoDir, dataDir });
  const baseUrl = await server.start();

  try {
    // 1. Create swarm with repoPath
    const createRes = await fetch(`${baseUrl}/api/swarms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'v040-swarm', title: 'v0.4.0 世界模型与活文档验收', templateId: 'gitlab-fullstack' })
    });
    assert.equal(createRes.status, 201);

    // 2. REST: World Model overview + Blast Radius simulation
    const wmRes = await fetch(`${baseUrl}/api/swarms/v040-swarm/world-model`);
    assert.equal(wmRes.status, 200);
    const wm = await wmRes.json();
    assert.equal(wm.available, true);
    assert.ok(wm.stats.totalFiles >= 6);
    assert.ok(wm.healthScore >= 85);

    const impRes = await fetch(`${baseUrl}/api/swarms/v040-swarm/world-model/impact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targets: ['src/utils.mjs'] })
    });
    assert.equal(impRes.status, 200);
    const impact = await impRes.json();
    assert.ok(impact.directDependents.includes('src/index.mjs'));
    assert.ok(impact.impactedTests.includes('tests/index.test.mjs'));

    // 3. REST: Auto-generate Living Wiki + manual edit -> v2
    const genRes = await fetch(`${baseUrl}/api/swarms/v040-swarm/wiki/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectName: 'yunyu-order-service' })
    });
    assert.equal(genRes.status, 200);
    const genData = await genRes.json();
    assert.ok(genData.pages.length >= 5);

    const upsertRes = await fetch(`${baseUrl}/api/swarms/v040-swarm/wiki`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: 'adr-world-model',
        title: 'ADR-001: 项目世界模型设计决策',
        category: 'decision',
        content: '# ADR-001\n采用纯零依赖 ESM 静态解析构建代码拓扑。',
        summary: '记录世界模型选型',
        tags: ['adr', 'world-model']
      })
    });
    assert.equal(upsertRes.status, 201);
    const createdPage = await upsertRes.json();
    assert.equal(createdPage.version, 1);

    // 4. REST: Audit + createIssues on a temporary P0 violation
    const badFile = path.join(repoDir, 'src', 'bad-temp.mjs');
    fs.writeFileSync(badFile, 'export const bad = (x) => eval(x);\n', 'utf8');
    const auditRes = await fetch(`${baseUrl}/api/swarms/v040-swarm/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ createIssues: true })
    });
    assert.equal(auditRes.status, 200);
    const audit = await auditRes.json();
    assert.equal(audit.passed, false);
    assert.ok(audit.summary.p0 >= 1);
    assert.ok(audit.createdIssues.length >= 1, 'Expected P0 finding to create a Qoder Issue');
    fs.unlinkSync(badFile);

    // 5. MCP JSON-RPC 2.0 parity checks
    const callMcp = async (method, params = {}) => {
      const r = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
      });
      return await r.json();
    };

    const initRpc = await callMcp('initialize');
    assert.equal(initRpc.result.serverInfo.version, APP_VERSION);

    const wikiRpc = await callMcp('tools/call', {
      name: 'wiki_read',
      arguments: { swarmId: 'v040-swarm', slug: 'adr-world-model' }
    });
    const parsedWiki = JSON.parse(wikiRpc.result.content[0].text);
    assert.equal(parsedWiki.slug, 'adr-world-model');

    const impactRpc = await callMcp('tools/call', {
      name: 'world_model_impact',
      arguments: { swarmId: 'v040-swarm', targets: ['src/utils.mjs'] }
    });
    const parsedImpact = JSON.parse(impactRpc.result.content[0].text);
    assert.ok(parsedImpact.directDependents.includes('src/index.mjs'));

    const resRead = await callMcp('resources/read', { uri: 'yunyu://swarms/v040-swarm/wiki' });
    const parsedRes = JSON.parse(resRead.result.contents[0].text);
    assert.ok(parsedRes.pages.some((p) => p.slug === 'adr-world-model'));

    // 6. CLI `yunyu audit` & `yunyu wiki`
    const cliBin = path.resolve(process.cwd(), 'bin', 'yunyu.mjs');
    const cliAuditOut = execFileSync(process.execPath, [cliBin, 'audit', '--dir', repoDir, '--json'], {
      encoding: 'utf8'
    });
    const cliAudit = JSON.parse(cliAuditOut);
    assert.equal(cliAudit.passed, true);
    assert.equal(cliAudit.summary.p0, 0);

    execFileSync(process.execPath, [cliBin, 'wiki', '--dir', repoDir, '--out', wikiOutDir], { encoding: 'utf8' });
    assert.ok(fs.existsSync(path.join(wikiOutDir, 'README.md')));
    assert.ok(fs.existsSync(path.join(wikiOutDir, 'home.md')));
    assert.ok(fs.existsSync(path.join(wikiOutDir, 'architecture.md')));
  } finally {
    await server.close();
  }

  // 7. Cold Restart Recovery: verify Wiki pages replay cleanly from events.jsonl
  const server2 = new YunyuServer({ host: '127.0.0.1', port: 0, repoPath: repoDir, dataDir });
  const baseUrl2 = await server2.start();
  try {
    const pageRes = await fetch(`${baseUrl2}/api/swarms/v040-swarm/wiki/adr-world-model`);
    assert.equal(pageRes.status, 200);
    const replayedPage = await pageRes.json();
    assert.equal(replayedPage.title, 'ADR-001: 项目世界模型设计决策');
  } finally {
    await server2.close();
    fs.rmSync(repoDir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(wikiOutDir, { recursive: true, force: true });
  }
});
