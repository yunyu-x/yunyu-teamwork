import assert from 'node:assert/strict';
import test from 'node:test';
import { TeamworkManager } from '../../src/core/orchestrator.mjs';
import { createDefaultDriverRegistry } from '../../src/drivers/registry.mjs';
import { YunyuMcpServer } from '../../src/mcp/server.mjs';

test('YunyuMcpServer supports standard JSON-RPC 2.0 MCP initialize, tools/list, tools/call, and resources', async () => {
  const manager = new TeamworkManager({
    inMemory: true,
    driverRegistry: createDefaultDriverRegistry()
  });
  const mcp = new YunyuMcpServer({ manager });

  try {
    const init = await mcp.handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    assert.equal(init.result.serverInfo.name, 'yunyu-teamwork-mcp');

    const tools = await mcp.handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.ok(tools.result.tools.some((t) => t.name === 'swarm_add'));
    assert.ok(tools.result.tools.some((t) => t.name === 'check_ownership'));
    assert.ok(tools.result.tools.some((t) => t.name === 'gitlab_create_mr'));

    const createdResp = await mcp.handleRpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'swarm_create', arguments: { title: 'MCP 集成测试蜂群' } }
    });
    const swarm = JSON.parse(createdResp.result.content[0].text);
    assert.ok(swarm.id);

    await mcp.handleRpc({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'swarm_add',
        arguments: {
          swarmId: swarm.id,
          name: 'qa',
          role: 'verifier',
          driver: 'human',
          owns: ['tests/**'],
          brief: '负责独立验收，严禁修改 src/'
        }
      }
    });

    const ownResp = await mcp.handleRpc({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'check_ownership',
        arguments: { swarmId: swarm.id, member: 'qa', filePath: 'src/app.mjs' }
      }
    });
    const ownResult = JSON.parse(ownResp.result.content[0].text);
    assert.equal(ownResult.allowed, false);

    const resList = await mcp.handleRpc({ jsonrpc: '2.0', id: 6, method: 'resources/list' });
    assert.equal(resList.result.resources.length, 2);
    assert.ok(resList.result.resources.some((r) => r.uri.endsWith('/board')));
    assert.ok(resList.result.resources.some((r) => r.uri.endsWith('/wiki')));

    const boardRes = resList.result.resources.find((r) => r.uri.endsWith('/board'));
    const resRead = await mcp.handleRpc({
      jsonrpc: '2.0',
      id: 7,
      method: 'resources/read',
      params: { uri: boardRes.uri }
    });
    const boardJson = JSON.parse(resRead.result.contents[0].text);
    assert.equal(boardJson.head, 1);
  } finally {
    manager.disposeAll();
  }
});
