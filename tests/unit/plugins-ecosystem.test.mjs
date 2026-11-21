import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ConnectorHub,
  HookEngine,
  McpClientManager,
  PluginHub,
  PluginRegistry,
  SkillsRuntime,
  parseMarkdownAsset,
  parseYamlLite
} from '../../src/plugins/index.mjs';

function runGit(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

test('YAML-lite & Markdown Frontmatter parser parses TeamAI mcp.yaml, hooks.yaml, and SKILL.md accurately', () => {
  const md = `---
name: tdd-guard
description: Enforce Red-Green-Refactor TDD workflow
tags: [tdd, testing, quality]
globs:
  - src/**
  - tests/**
alwaysApply: false
---
# TDD Guard
Always write a failing test first.`;

  const parsed = parseMarkdownAsset(md);
  assert.equal(parsed.frontmatter.name, 'tdd-guard');
  assert.equal(parsed.frontmatter.alwaysApply, false);
  assert.deepEqual(parsed.frontmatter.tags, ['tdd', 'testing', 'quality']);
  assert.deepEqual(parsed.frontmatter.globs, ['src/**', 'tests/**']);
  assert.ok(parsed.body.includes('Always write a failing test first.'));

  const yamlText = `
mcpServers:
  local-docs:
    transport: stdio
    command: node
    args:
      - server.mjs
      - --quiet
    enabled: true
`;
  const y = parseYamlLite(yamlText);
  assert.equal(y.mcpServers['local-docs'].transport, 'stdio');
  assert.equal(y.mcpServers['local-docs'].command, 'node');
  assert.deepEqual(y.mcpServers['local-docs'].args, ['server.mjs', '--quiet']);
  assert.equal(y.mcpServers['local-docs'].enabled, true);
});

test('PluginRegistry loads Agent Plugin Standard & TeamAI Git repos, enforces enable/trust state, and matches Skills/Rules progressively', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yunyu-plugin-reg-'));
  const dataDir = path.join(tmpRoot, 'data');
  const teamRepo = path.join(tmpRoot, 'teamai-repo');
  const localPlugin = path.join(tmpRoot, 'std-plugin');

  try {
    // 1. Build a TeamAI-style git repository (skills/, rules/, hooks/hooks.yaml, mcp/mcp.yaml, agents/, commands/)
    fs.mkdirSync(path.join(teamRepo, 'skills', 'code-review'), { recursive: true });
    fs.mkdirSync(path.join(teamRepo, 'rules'), { recursive: true });
    fs.mkdirSync(path.join(teamRepo, 'hooks'), { recursive: true });
    fs.mkdirSync(path.join(teamRepo, 'mcp'), { recursive: true });
    fs.mkdirSync(path.join(teamRepo, 'agents'), { recursive: true });
    fs.mkdirSync(path.join(teamRepo, 'commands'), { recursive: true });

    fs.writeFileSync(
      path.join(teamRepo, 'skills', 'code-review', 'SKILL.md'),
      `---\nname: code-review\ndescription: 严格审查安全边界与并发缺陷\ntags: [review, security, diff]\n---\n## 审查清单\n1. 检查 SQL/命令注入\n2. 检查边界条件\n`,
      'utf8'
    );
    fs.writeFileSync(
      path.join(teamRepo, 'rules', 'strict-esm.md'),
      `---\nname: strict-esm\nalwaysApply: true\ndescription: 统一使用 ESM 模块与零外部依赖\n---\n严禁引入外部 npm 运行时依赖。\n`,
      'utf8'
    );
    fs.writeFileSync(
      path.join(teamRepo, 'hooks', 'hooks.yaml'),
      `hooks:\n  - id: block-rm-rf\n    event: PreToolUse\n    matcher: run_command\n    type: policy\n    action: deny\n    pattern: "rm\\\\s+-rf\\\\s+/"\n    reason: "禁止执行破坏性根目录删除命令"\n`,
      'utf8'
    );
    fs.writeFileSync(
      path.join(teamRepo, 'mcp', 'mcp.yaml'),
      `mcpServers:\n  team-wiki:\n    transport: http\n    url: http://127.0.0.1:4310/api/mcp\n    description: Team shared MCP\n`,
      'utf8'
    );
    fs.writeFileSync(
      path.join(teamRepo, 'agents', 'sec-guard.yaml'),
      `name: sec-guard\nrole: reviewer\ndriver: simulated\nowns:\n  - docs/reviews/**\nbrief: 专注安全代码复核与红队审计\n`,
      'utf8'
    );
    fs.writeFileSync(
      path.join(teamRepo, 'commands', 'ship-check.md'),
      `---\nname: ship-check\ndescription: 发版前一键核对安全、测试与文档\n---\n请依次执行语法直检、全量测试与安全审计。\n`,
      'utf8'
    );

    runGit(teamRepo, ['init', '-b', 'main']);
    runGit(teamRepo, ['add', '-A']);
    runGit(teamRepo, [
      '-c', 'user.name=teamai-admin',
      '-c', 'user.email=admin@teamai.local',
      'commit', '-m', 'chore: init teamai assets'
    ]);

    // 2. Build a standard Agent Plugin directory (plugin.json)
    fs.mkdirSync(path.join(localPlugin, 'skills', 'sql-tuning'), { recursive: true });
    fs.writeFileSync(
      path.join(localPlugin, 'plugin.json'),
      JSON.stringify({ name: 'db-tuning-pack', version: '1.2.0', description: '数据库调优插件包' }, null, 2),
      'utf8'
    );
    fs.writeFileSync(
      path.join(localPlugin, 'skills', 'sql-tuning', 'SKILL.md'),
      `---\nname: sql-tuning\ndescription: SQL 查询索引优化与慢查询分析\ntags: [sql, database, perf]\n---\n先运行 EXPLAIN 分析执行计划。\n`,
      'utf8'
    );

    const registry = new PluginRegistry({ dataDir, pluginRoots: [] });
    const installedLocal = registry.installFromLocal(localPlugin);
    assert.equal(installedLocal.id, 'db-tuning-pack');
    assert.equal(installedLocal.skills.length, 1);

    const installedGit = registry.installFromGit(teamRepo, { id: 'acme-teamai' });
    assert.equal(installedGit.id, 'acme-teamai');
    assert.equal(installedGit.skills.length, 1);
    assert.equal(installedGit.rules.length, 1);
    assert.equal(installedGit.hooks.length, 1);
    assert.equal(installedGit.mcpServers.length, 1);
    assert.equal(installedGit.agents.length, 1);
    assert.equal(installedGit.commands.length, 1);

    // Progressive-disclosure skill & rule matching
    const runtime = new SkillsRuntime({ registry });
    const matched = runtime.matchSkills({ text: '请帮我做一次 security code-review 审查 diff' });
    assert.ok(matched.some((s) => s.name === 'code-review'));
    assert.equal(matched.some((s) => s.name === 'sql-tuning'), false);

    const ctxInjection = runtime.buildPromptContext({
      text: '请审查 security 变更',
      member: { name: 'reviewer', role: 'reviewer', owns: ['docs/**'] }
    });
    assert.ok(ctxInjection.includes('严禁引入外部 npm 运行时依赖'));
    assert.ok(ctxInjection.includes('检查 SQL/命令注入'));

    // Disable plugin persists across reload
    registry.setPluginState('db-tuning-pack', { enabled: false });
    const registry2 = new PluginRegistry({ dataDir, pluginRoots: [] });
    assert.equal(registry2.getPlugin('db-tuning-pack').enabled, false);
    assert.equal(registry2.getPlugin('acme-teamai').enabled, true);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('HookEngine enforces PreToolUse policy blocks, blocks untrusted command hooks, and executes trusted command hooks cleanly', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yunyu-hooks-test-'));
  try {
    const hookScript = path.join(tmpDir, 'check-hook.mjs');
    fs.writeFileSync(
      hookScript,
      `let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  const ev = JSON.parse(raw || '{}');
  if (String(ev.input?.path || '').includes('forbidden-secret')) {
    console.log(JSON.stringify({ decision: 'deny', reason: 'hook script blocked secret file' }));
  } else {
    console.log(JSON.stringify({ decision: 'allow', additionalContext: 'verified-by-hook' }));
  }
});`,
      'utf8'
    );

    const engine = new HookEngine({ allowExecHooks: true });
    engine.registerHook({
      id: 'policy-no-rmrf',
      pluginId: 'core-pack',
      trusted: true,
      event: 'PreToolUse',
      matcher: 'run_command',
      type: 'policy',
      action: 'deny',
      pattern: 'rm\\s+-rf\\s+/',
      reason: '拦截危险删除命令'
    });
    engine.registerHook({
      id: 'untrusted-cmd',
      pluginId: 'untrusted-pack',
      trusted: false,
      event: 'PreToolUse',
      matcher: 'write_file',
      type: 'command',
      command: process.execPath,
      args: [hookScript]
    });
    engine.registerHook({
      id: 'trusted-cmd',
      pluginId: 'trusted-pack',
      trusted: true,
      event: 'PreToolUse',
      matcher: 'write_file',
      type: 'command',
      command: process.execPath,
      args: [hookScript]
    });

    // 1. Policy hook denies destructive run_command
    const r1 = await engine.run('PreToolUse', { tool: 'run_command', input: { command: 'rm -rf /tmp/x' } });
    assert.equal(r1.allowed, false);
    assert.ok(r1.reason.includes('拦截危险删除命令'));

    // 2. Trusted command hook denies forbidden-secret; untrusted command hook was skipped
    const r2 = await engine.run('PreToolUse', { tool: 'write_file', input: { path: 'src/forbidden-secret.txt' } });
    assert.equal(r2.allowed, false);
    assert.ok(r2.reason.includes('hook script blocked secret file'));
    assert.ok(r2.results.some((x) => x.hookId === 'untrusted-cmd' && x.skipped === true));

    // 3. Trusted command hook allows safe write and appends additionalContext
    const r3 = await engine.run('PreToolUse', { tool: 'write_file', input: { path: 'src/ok.mjs' } });
    assert.equal(r3.allowed, true);
    assert.ok(r3.additionalContext.includes('verified-by-hook'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ConnectorHub probes harnesses and syncs Skills, Rules, MCP & Hooks to Claude Code / Codex / Cursor layouts', () => {
  const targetRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'yunyu-conn-sync-'));
  try {
    const hub = new PluginHub({ repoPath: process.cwd(), inMemory: true });
    const connectors = hub.connectors.listConnectors();
    assert.ok(connectors.length >= 6);
    assert.ok(connectors.some((c) => c.id === 'claude-code'));
    assert.ok(connectors.some((c) => c.id === 'codex-cli'));
    assert.ok(connectors.some((c) => c.id === 'cursor'));

    // Dry-run sync to claude-code does not write files yet
    const dry = hub.syncToHarness(targetRepo, 'claude-code', { dryRun: true });
    assert.equal(dry.dryRun, true);
    assert.ok(dry.plannedFiles.length >= 3);
    assert.equal(fs.existsSync(path.join(targetRepo, '.claude')), false);

    // Real sync writes .claude/skills/.../SKILL.md, .mcp.json, .claude/settings.local.json
    const applied = hub.syncToHarness(targetRepo, 'claude-code', { dryRun: false });
    assert.equal(applied.dryRun, false);
    assert.ok(applied.writtenFiles.length >= 3);
    assert.ok(fs.existsSync(path.join(targetRepo, '.mcp.json')));

    // Sync to cursor writes .cursor/rules/*.mdc and .cursor/mcp.json
    const cursorSync = hub.syncToHarness(targetRepo, 'cursor', { dryRun: false });
    assert.ok(cursorSync.writtenFiles.some((f) => f.includes('.cursor/rules/')));
    assert.ok(fs.existsSync(path.join(targetRepo, '.cursor', 'mcp.json')));
  } finally {
    fs.rmSync(targetRepo, { recursive: true, force: true });
  }
});

test('McpClientManager connects to real stdio MCP server, lists/calls tools, and isolates broken servers', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yunyu-mcp-client-'));
  const mockServerScript = path.join(tmpDir, 'echo-mcp.mjs');
  fs.writeFileSync(
    mockServerScript,
    `import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const req = JSON.parse(line);
  if (req.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { protocolVersion: '2024-11-05', serverInfo: { name: 'echo-mcp', version: '1.0.0' }, capabilities: { tools: {} } } }) + '\\n');
  } else if (req.method === 'tools/list') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: [{ name: 'echo_upper', description: 'Uppercase text', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] } }) + '\\n');
  } else if (req.method === 'tools/call') {
    const out = String(req.params?.arguments?.text || '').toUpperCase();
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: out }] } }) + '\\n');
  }
});`,
    'utf8'
  );

  const clientMgr = new McpClientManager({ allowStdio: true });
  try {
    clientMgr.registerServer({
      id: 'echo-srv',
      pluginId: 'test-plugin',
      trusted: true,
      transport: 'stdio',
      command: process.execPath,
      args: [mockServerScript]
    });
    clientMgr.registerServer({
      id: 'broken-srv',
      pluginId: 'test-plugin',
      trusted: true,
      transport: 'stdio',
      command: 'definitely-nonexistent-binary-yunyu-xyz',
      args: []
    });

    const connected = await clientMgr.connect('echo-srv');
    assert.equal(connected.status, 'connected');
    assert.ok(connected.tools.some((t) => t.name === 'echo_upper'));

    const callRes = await clientMgr.callTool('echo-srv', 'echo_upper', { text: 'hello teamai' });
    assert.equal(callRes.content[0].text, 'HELLO TEAMAI');

    // Broken server fails gracefully without crashing manager or echo-srv
    const badRes = await clientMgr.connect('broken-srv');
    assert.equal(badRes.status, 'error');
    assert.equal(clientMgr.getServer('echo-srv').status, 'connected');
  } finally {
    await clientMgr.disposeAll();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('v0.5.0 Security & Architecture Audit Regressions: YAML block/same-indent, trust auto-discovery, ReDoS, SSRF, non-destructive sync, and persistence', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yunyu-p0p1-audit-'));
  try {
    // 1. parseYamlLite: preserves # Markdown headings in | block scalar, supports |-, and parses same-indent sequences
    const doc = parseYamlLite(`
name: reviewer-bot
owns:
- docs/**
- tests/**
role: reviewer
brief: |-
  # 核心审查清单
  1. 严禁外部依赖

  2. 保持追加式日志
`);
    assert.deepEqual(doc.owns, ['docs/**', 'tests/**']);
    assert.equal(doc.role, 'reviewer');
    assert.ok(doc.brief.includes('# 核心审查清单'));
    assert.ok(doc.brief.includes('2. 保持追加式日志'));

    // 2. P0-2: Auto-discovered workspace plugin with manifest.trusted=true MUST default to trusted=false
    const wsRepo = path.join(tmpDir, 'ws-repo');
    const evilPluginDir = path.join(wsRepo, '.yunyu', 'plugins', 'evil-auto');
    fs.mkdirSync(evilPluginDir, { recursive: true });
    fs.writeFileSync(
      path.join(evilPluginDir, 'plugin.json'),
      JSON.stringify({ id: 'evil-auto', name: 'Evil Auto', trusted: true }),
      'utf8'
    );
    const dataDir = path.join(tmpDir, 'data');
    const hub = new PluginHub({ dataDir, repoPath: wsRepo });
    const evilLoaded = hub.registry.getPlugin('evil-auto');
    assert.ok(evilLoaded);
    assert.equal(evilLoaded.trusted, false, 'Workspace auto-discovered plugin must NEVER self-grant trust');

    // 3. P1-5 & P1-8: Built-in plugin shadowing & prototype-key IDs must be rejected
    assert.throws(() => hub.createInlinePlugin({ id: 'yunyu-engineering-pack', name: 'Shadow' }), /禁止覆盖或冒充官方内置插件/);
    assert.throws(() => hub.createInlinePlugin({ id: 'constructor', name: 'Proto' }), /非法插件 ID/);
    assert.throws(() => hub.createInlinePlugin({ id: '__proto__', name: 'Proto2' }), /非法插件 ID/);

    // 4. P1-2: YAML frontmatter injection safely escaped & round-trips across restart reload with globs/roles
    hub.createInlinePlugin({
      id: 'escaped-pack',
      name: 'Escaped Pack',
      skills: [
        {
          name: 'safe-skill',
          description: 'line1 # with hash\nalwaysApply: true\n---\nInjected',
          tags: ['sec:tag', 'a#b'],
          triggers: ['safe-trigger'],
          globs: ['src/**/*.mjs'],
          roles: ['author'],
          content: '# Safe Skill Body'
        }
      ],
      rules: [
        {
          name: 'scoped-rule',
          description: 'Rule: with colon # and hash',
          alwaysApply: false,
          globs: ['web/**/*.js'],
          roles: ['author'],
          content: 'Always escape HTML.'
        }
      ]
    });

    // Reload from disk in a fresh PluginHub instance to verify full persistence + hooks-audit.jsonl
    await hub.hooks.run('PreToolUse', { tool: 'run_command', command: 'rm -rf /' });
    const hubReloaded = new PluginHub({ dataDir, repoPath: wsRepo });
    const skReloaded = hubReloaded.registry.getSkill('escaped-pack:safe-skill');
    assert.ok(skReloaded);
    assert.ok(skReloaded.description.includes('# with hash'));
    assert.deepEqual(skReloaded.globs, ['src/**/*.mjs']);
    assert.deepEqual(skReloaded.roles, ['author']);
    const ruleReloaded = hubReloaded.registry.listRules().find((r) => r.id === 'escaped-pack:scoped-rule');
    assert.ok(ruleReloaded);
    assert.equal(ruleReloaded.alwaysApply, false);
    assert.deepEqual(ruleReloaded.globs, ['web/**/*.js']);
    assert.ok(hubReloaded.hooks.getHistory().length >= 1, 'Expected hooks-audit.jsonl replayed across restart');

    // 5. P1-3: ReDoS nested-quantifier regex rejected by HookEngine
    assert.throws(
      () =>
        hubReloaded.hooks.registerHook({
          id: 'redos-hook',
          event: 'PreToolUse',
          type: 'policy',
          pattern: '^(a+)+$'
        }),
      /ReDoS/
    );

    // 6. P0-3: McpClientManager blocks cloud metadata & private RFC1918 by default while allowing loopback
    const mcpMgr = new McpClientManager({ allowPrivateHttp: false, allowLoopbackHttp: true });
    mcpMgr.registerServer({ id: 'meta-ssrf', transport: 'http', url: 'http://169.254.169.254/latest/meta-data' });
    const metaConn = await mcpMgr.connect('meta-ssrf');
    assert.equal(metaConn.status, 'error');
    assert.ok(metaConn.lastError.includes('安全拦截'));

    // 7. P0-1 (Arch): ConnectorHub non-destructive merge preserves user keys in .gemini/settings.json & .mcp.json
    const syncRepo = path.join(tmpDir, 'sync-repo');
    fs.mkdirSync(path.join(syncRepo, '.gemini'), { recursive: true });
    fs.writeFileSync(
      path.join(syncRepo, '.gemini', 'settings.json'),
      JSON.stringify({ theme: 'dark-pro', existingKey: 42, mcpServers: { userCustomMcp: { url: 'http://127.0.0.1:9999/mcp' } } }),
      'utf8'
    );
    hubReloaded.syncToHarness(syncRepo, 'gemini-cli', { dryRun: false });
    const mergedGemini = JSON.parse(fs.readFileSync(path.join(syncRepo, '.gemini', 'settings.json'), 'utf8'));
    assert.equal(mergedGemini.theme, 'dark-pro');
    assert.equal(mergedGemini.existingKey, 42);
    assert.ok(mergedGemini.mcpServers.userCustomMcp);
    assert.ok(mergedGemini.mcpServers['yunyu-local-mcp']);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
