import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createGuardedWorkspaceTools } from '../../src/drivers/base.mjs';
import { YunyuServer } from '../../src/server/app.mjs';

test('v0.5.0 Full-Stack Plugin Ecosystem: REST API, TeamAI Harness Sync, HTTP MCP Client <-> Server, Hooks & Slash Commands', async () => {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yunyu-v050-e2e-'));
  const dataDir = path.join(repoDir, '.yunyu-data');
  fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'src', 'app.mjs'), 'export const ok = true;\n', 'utf8');

  const server = new YunyuServer({
    host: '127.0.0.1',
    port: 0,
    repoPath: repoDir,
    dataDir
  });

  try {
    const baseUrl = await server.start();
    const swarm = server.manager.createSwarm({
      id: 'plugin-e2e',
      title: '插件生态端到端验证蜂群',
      repoPath: repoDir
    });
    const author = swarm.addMember({
      name: 'backend',
      role: 'author',
      driver: 'simulated',
      owns: ['src/**'],
      brief: '负责后端模块研发'
    });

    // 1. GET /api/plugins returns built-in yunyu-engineering-pack + teamai-sync-pack
    const overviewRes = await fetch(`${baseUrl}/api/plugins`);
    assert.equal(overviewRes.status, 200);
    const overview = await overviewRes.json();
    assert.ok(overview.plugins.length >= 2);
    assert.ok(overview.plugins.some((p) => p.id === 'yunyu-engineering-pack'));
    assert.ok(overview.plugins.some((p) => p.id === 'teamai-sync-pack'));
    assert.ok(overview.skills.length >= 3);
    assert.ok(overview.hooks.length >= 4);
    assert.ok(overview.connectors.length >= 8);

    // 2. Security gates: out-of-repo local plugin install & out-of-repo connector sync MUST be rejected (403)
    const outsideDir = path.dirname(repoDir);
    const badLocalRes = await fetch(`${baseUrl}/api/plugins/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'local', path: outsideDir })
    });
    assert.equal(badLocalRes.status, 403);

    const badGitUrlRes = await fetch(`${baseUrl}/api/plugins/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'git', url: 'file:///etc/passwd' })
    });
    assert.equal(badGitUrlRes.status, 403);

    const badSyncRes = await fetch(`${baseUrl}/api/connectors/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ harnessId: 'claude-code', dryRun: false, targetDir: outsideDir })
    });
    assert.equal(badSyncRes.status, 403);

    // 3. Create inline custom plugin with Skill + PreTurn policy hook
    const createRes = await fetch(`${baseUrl}/api/plugins/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'inline',
        id: 'api-contract-pack',
        name: 'API 契约守护插件',
        skills: [
          {
            name: 'openapi-lint',
            description: 'OpenAPI 契约一致性检查',
            triggers: ['openapi', 'swagger', '契约'],
            content: '# OpenAPI Lint\n所有接口变更必须保持向后兼容。'
          }
        ],
        hooks: [
          {
            id: 'block-prod-drop',
            event: 'PreTurn',
            matcher: '*',
            type: 'policy',
            action: 'deny',
            pattern: 'DROP\\s+DATABASE\\s+PROD',
            reason: '严禁向 Agent 下达删库指令'
          }
        ]
      })
    });
    assert.equal(createRes.status, 201);

    // 4. Progressive Skill Matcher & Skill Reader API
    const matchRes = await fetch(`${baseUrl}/api/skills/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '请帮我检查 openapi 契约并跑 TDD 单元测试', role: 'author' })
    });
    const matchData = await matchRes.json();
    assert.ok(matchData.matched.some((m) => m.id === 'api-contract-pack:openapi-lint'));
    assert.ok(matchData.promptBlock.includes('openapi-lint'));

    const skillReadRes = await fetch(`${baseUrl}/api/skills/${encodeURIComponent('yunyu-engineering-pack:tdd-guard')}`);
    assert.equal(skillReadRes.status, 200);
    const skillDetail = await skillReadRes.json();
    assert.ok(skillDetail.content.includes('TDD'));

    // 5. Hook Simulator denies destructive rm -rf / AND real guarded tools enforce PreToolUse policy hook!
    const hookSimRes = await fetch(`${baseUrl}/api/hooks/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'PreToolUse',
        payload: { tool: 'run_command', command: 'rm -rf /tmp/x', input: { command: 'rm -rf /tmp/x' } }
      })
    });
    const hookSim = await hookSimRes.json();
    assert.equal(hookSim.allowed, false);
    assert.ok(hookSim.reason.includes('破坏性'));

    const tools = createGuardedWorkspaceTools({
      swarm,
      member: author,
      ownership: swarm.ownership,
      worktrees: swarm.worktrees,
      gitlab: swarm.gitlab
    });
    const blockedCmd = tools.run_command({ command: 'rm -rf /' });
    assert.equal(blockedCmd.ok, false);
    assert.equal(blockedCmd.blockedByHook, true);

    const fakeKey = ['sk', '-1234567890abcdefghijklmnop'].join('');
    const blockedSecretWrite = tools.write_file({ path: 'src/leak.mjs', content: `export const k = "${fakeKey}";` });
    assert.equal(blockedSecretWrite.ok, false);
    assert.equal(blockedSecretWrite.blockedByHook, true);

    // 6. PreTurn hook blocks dangerous turn trigger automatically
    swarm.postMessage({ author: 'coordinator', text: '@backend 请立即执行 DROP DATABASE PROD' });
    await swarm.waitIdle();
    const boardAfterBlock = swarm.board.read({ since: 0, limit: 50 }).messages;
    assert.ok(boardAfterBlock.some((m) => m.metadata?.hookBlocked === true));

    // 7. Slash command expansion on Board (`/preflight`)
    swarm.postMessage({ author: 'human', text: '/preflight v0.5.0' });
    const boardAfterCmd = swarm.board.read({ since: 0, limit: 50 }).messages;
    assert.ok(boardAfterCmd.some((m) => m.metadata?.commandExpanded === true && m.text.includes('preflight')));

    // 8. Spawn plugin-declared specialist agent into swarm
    const spawnRes = await fetch(`${baseUrl}/api/swarms/${swarm.id}/plugins/spawn-agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: 'yunyu-engineering-pack:sec-auditor' })
    });
    assert.equal(spawnRes.status, 201);
    const spawnData = await spawnRes.json();
    assert.equal(spawnData.member.role, 'reviewer');
    assert.ok(swarm.members.has(spawnData.member.name));

    // 9. Cross-Harness Connector Sync inside repo (dry-run + real apply for claude-code)
    const drySyncRes = await fetch(`${baseUrl}/api/connectors/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ harnessId: 'claude-code', dryRun: true, swarmId: swarm.id })
    });
    const drySync = await drySyncRes.json();
    assert.equal(drySync.dryRun, true);
    assert.ok(drySync.plannedFiles.includes('.mcp.json'));
    assert.equal(fs.existsSync(path.join(repoDir, '.mcp.json')), false);

    const realSyncRes = await fetch(`${baseUrl}/api/connectors/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ harnessId: 'claude-code', dryRun: false, swarmId: swarm.id })
    });
    const realSync = await realSyncRes.json();
    assert.equal(realSync.dryRun, false);
    assert.ok(fs.existsSync(path.join(repoDir, '.mcp.json')));

    // 10. Live External HTTP MCP Client connecting to Yunyu's OWN `/api/mcp` server (36 tools + 3 resources)!
    const regMcpRes = await fetch(`${baseUrl}/api/mcp-clients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'self-yunyu-mcp',
        transport: 'http',
        url: `${baseUrl}/api/mcp`,
        description: 'Loopback MCP verification'
      })
    });
    assert.equal(regMcpRes.status, 201);

    const connMcpRes = await fetch(`${baseUrl}/api/mcp-clients/self-yunyu-mcp/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const connMcp = await connMcpRes.json();
    assert.equal(connMcp.ok, true);
    assert.equal(connMcp.server.status, 'connected');
    assert.equal(connMcp.server.tools.length, 37);
    assert.ok(connMcp.server.resources.some((r) => r.uri === 'yunyu://plugins/catalog'));

    const callMcpRes = await fetch(`${baseUrl}/api/mcp-clients/self-yunyu-mcp/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolName: 'hook_test',
        args: { event: 'PreToolUse', payload: { tool: 'run_command', command: 'rm -rf /' } }
      })
    });
    const callMcp = await callMcpRes.json();
    assert.equal(callMcp.ok, true);
    const parsedMcpToolOut = JSON.parse(callMcp.result.content[0].text);
    assert.equal(parsedMcpToolOut.allowed, false);

    // 11. Security & Lifecycle Regressions:
    // - P0-1: POST /api/plugins/:id/toggle with trusted:true MUST be rejected (403) when !allowCustomCli
    const trustEscalateRes = await fetch(`${baseUrl}/api/plugins/api-contract-pack/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trusted: true })
    });
    assert.equal(trustEscalateRes.status, 403);

    // - Disabling yunyu-engineering-pack stops guard-destructive-shell; re-enabling restores it
    const disablePackRes = await fetch(`${baseUrl}/api/plugins/yunyu-engineering-pack/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false })
    });
    assert.equal(disablePackRes.status, 200);
    const simWhileDisabled = await (
      await fetch(`${baseUrl}/api/hooks/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'PreToolUse', payload: { tool: 'run_command', command: 'rm -rf /tmp/x' } })
      })
    ).json();
    assert.equal(simWhileDisabled.allowed, true);
    await fetch(`${baseUrl}/api/plugins/yunyu-engineering-pack/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true })
    });

    // - P0-5: MCP swarm_add with custom cli-agent driverConfig.command MUST be rejected when !allowCustomCli
    const mcpCustomCliRes = await fetch(`${baseUrl}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 99,
        method: 'tools/call',
        params: {
          name: 'swarm_add',
          arguments: {
            swarmId: swarm.id,
            name: 'evilcli',
            role: 'author',
            driver: 'cli-agent',
            brief: 'run',
            driverConfig: { command: 'node', args: ['-e', 'process.exit(0)'] }
          }
        }
      })
    });
    const mcpCustomCliJson = await mcpCustomCliRes.json();
    assert.ok(mcpCustomCliJson.error?.message.includes('安全拦截'));

    // - P1-4: Read-only role (even case-variant "Reviewer") cannot write package.json or call mcp_connector_call
    const revMember = swarm.addMember({ name: 'case-rev', role: 'Reviewer', driver: 'simulated', brief: '只读复核' });
    assert.equal(revMember.role, 'reviewer');
    const revTools = createGuardedWorkspaceTools({
      swarm,
      member: revMember,
      ownership: swarm.ownership,
      worktrees: swarm.worktrees,
      gitlab: swarm.gitlab
    });
    const revWritePkg = revTools.write_file({ path: 'package.json', content: '{}' });
    assert.ok(revWritePkg.error?.includes('拒绝写入'));
    const revMcpCall = await revTools.mcp_connector_call({ serverId: 'self-yunyu-mcp', toolName: 'swarm_list', args: {} });
    assert.equal(revMcpCall.ok, false);
    assert.ok(revMcpCall.error.includes('只读角色'));

    // - QA P0-4 / Arch P0-3: OpenAICompatibleDriver bridges connected MCP tools (`mcp__self_yunyu_mcp__*`) and fires PreToolUse ONCE
    let capturedSchemas = [];
    let llmRound = 0;
    const mockOpenAi = http.createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      const payload = JSON.parse(body);
      capturedSchemas = payload.tools || [];
      llmRound += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (llmRound === 1) {
        const mcpTool = capturedSchemas.find((t) => t.function.name.startsWith('mcp__') && t.function.name.includes('swarm_list'));
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: '',
                  tool_calls: [
                    {
                      id: 'call_mcp_1',
                      type: 'function',
                      function: { name: mcpTool.function.name, arguments: '{}' }
                    }
                  ]
                }
              }
            ],
            usage: { total_tokens: 42 }
          })
        );
      } else {
        res.end(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: '@coordinator 已通过外部 MCP 工具完成查询。' } }],
            usage: { total_tokens: 28 }
          })
        );
      }
    });
    await new Promise((r) => mockOpenAi.listen(0, '127.0.0.1', r));
    const mockLlmUrl = `http://127.0.0.1:${mockOpenAi.address().port}/v1`;
    try {
      let preToolCount = 0;
      const onHook = (rec) => {
        if (rec.event === 'PreToolUse') preToolCount += 1;
      };
      server.manager.plugins.hooks.on('hook_run', onHook);
      server.manager.plugins.hooks.registerHook({
        id: 'trace-mcp-tool',
        pluginId: 'custom',
        event: 'PreToolUse',
        matcher: 'mcp__*',
        type: 'policy',
        action: 'inject_context',
        additionalContext: 'mcp-traced'
      });
      swarm.addMember({
        name: 'llm-dev',
        role: 'author',
        driver: 'openai-compatible',
        owns: ['src/**'],
        driverConfig: { baseUrl: mockLlmUrl, apiKey: 'local-test', model: 'mock-gpt' },
        brief: '请调用外部 MCP 工具查询蜂群列表'
      });
      await swarm.waitIdle();
      server.manager.plugins.hooks.off('hook_run', onHook);
      assert.ok(capturedSchemas.some((t) => t.function.name.startsWith('mcp__') && t.function.name.includes('swarm_list')));
      assert.equal(preToolCount, 1, 'Expected PreToolUse to fire exactly once per tool call (no double evaluation)');
    } finally {
      await new Promise((r) => mockOpenAi.close(r));
    }

    // 12. CLI commands (`yunyu plugin list --json`, `yunyu connectors --json`, `yunyu plugin sync --harness cursor --dry-run`)
    const cliPlugins = JSON.parse(
      execFileSync(process.execPath, ['bin/yunyu.mjs', 'plugin', 'list', '--json', '--dir', repoDir, '--data', dataDir], {
        encoding: 'utf8'
      })
    );
    assert.ok(cliPlugins.plugins.length >= 3);
    const cliConns = JSON.parse(
      execFileSync(process.execPath, ['bin/yunyu.mjs', 'connectors', '--json', '--dir', repoDir, '--data', dataDir], {
        encoding: 'utf8'
      })
    );
    assert.ok(cliConns.connectors.some((c) => c.id === 'claude-code' && c.detectedConfigs.includes('.mcp.json')));
    const cliSyncDry = JSON.parse(
      execFileSync(
        process.execPath,
        ['bin/yunyu.mjs', 'plugin', 'sync', '--harness', 'cursor', '--dry-run', '--dir', repoDir, '--data', dataDir],
        { encoding: 'utf8' }
      )
    );
    assert.equal(cliSyncDry.dryRun, true);
    assert.ok(cliSyncDry.plannedFiles.some((f) => f.includes('.cursor/rules/')));
  } finally {
    await server.close();
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});
