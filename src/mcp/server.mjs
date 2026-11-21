import readline from 'node:readline';

const PROTOCOL_VERSION = '2024-11-05';

export const MCP_TOOLS = [
  {
    name: 'swarm_list',
    description: '列出当前云驭协同服务中的所有蜂群（Swarm）摘要信息',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'swarm_create',
    description: '创建一个新的多 Agent 协同蜂群（可指定模板与 GitLab 项目）',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '蜂群中文名称' },
        templateId: { type: 'string', description: '内置模板 ID（如 gitlab-fullstack / heterogeneous-cli）' },
        repoPath: { type: 'string', description: '本地 Git 仓库路径' }
      },
      required: ['title']
    }
  },
  {
    name: 'swarm_status',
    description: '查询指定蜂群的成员名册、状态、工作区分支、频道与文件所有权契约',
    inputSchema: {
      type: 'object',
      properties: { swarmId: { type: 'string' } },
      required: ['swarmId']
    }
  },
  {
    name: 'swarm_add',
    description: '向蜂群招募一名异构 Agent 成员并发布公开中文任务书（支持 share/branch/inherit 工作区）',
    inputSchema: {
      type: 'object',
      properties: {
        swarmId: { type: 'string' },
        name: { type: 'string', description: '成员短名（小写，如 backend / frontend / qa）' },
        role: { type: 'string', enum: ['coordinator', 'architect', 'author', 'verifier', 'release', 'human'] },
        driver: { type: 'string', enum: ['simulated', 'openai-compatible', 'cli-agent', 'webhook', 'human'] },
        model: { type: 'string' },
        workspace: { type: 'string', enum: ['inherit', 'share', 'branch'] },
        owns: { type: 'array', items: { type: 'string' } },
        mustNotTouch: { type: 'array', items: { type: 'string' } },
        channels: { type: 'array', items: { type: 'string' } },
        brief: { type: 'string', description: '中文公开任务书（写明职责范围、禁止路径与完成定义）' }
      },
      required: ['swarmId', 'name', 'brief']
    }
  },
  {
    name: 'swarm_kill',
    description: '销毁指定成员并回收其隔离 Git Worktree（未合并改动默认拦截保护）',
    inputSchema: {
      type: 'object',
      properties: {
        swarmId: { type: 'string' },
        name: { type: 'string' },
        force: { type: 'boolean' }
      },
      required: ['swarmId', 'name']
    }
  },
  {
    name: 'post_message',
    description: '向共享留言板发帖，支持 @member / @#channel / @all 门铃唤醒与 #seq 引用',
    inputSchema: {
      type: 'object',
      properties: {
        swarmId: { type: 'string' },
        author: { type: 'string' },
        text: { type: 'string' },
        channel: { type: 'string' },
        kind: { type: 'string' }
      },
      required: ['swarmId', 'author', 'text']
    }
  },
  {
    name: 'read_board',
    description: '按 since 增量拉取或按 seqs 精确读取留言板消息',
    inputSchema: {
      type: 'object',
      properties: {
        swarmId: { type: 'string' },
        since: { type: 'integer' },
        limit: { type: 'integer' },
        seqs: { type: 'array', items: { type: 'integer' } },
        channel: { type: 'string' }
      },
      required: ['swarmId']
    }
  },
  {
    name: 'wait_for_mention',
    description: '零算力等待直到留言板出现 @自己 或 @all 的新消息',
    inputSchema: {
      type: 'object',
      properties: {
        swarmId: { type: 'string' },
        member: { type: 'string' },
        since: { type: 'integer' },
        timeoutMs: { type: 'integer' }
      },
      required: ['swarmId', 'member']
    }
  },
  {
    name: 'check_ownership',
    description: '校验指定成员是否被允许写入目标文件路径（执行文件所有权契约与 QA 隔离铁律）',
    inputSchema: {
      type: 'object',
      properties: {
        swarmId: { type: 'string' },
        member: { type: 'string' },
        filePath: { type: 'string' }
      },
      required: ['swarmId', 'member', 'filePath']
    }
  },
  {
    name: 'worktree_merge',
    description: '在通过 OwnershipGuard 越权审计后，将成员的隔离 Git Worktree 分支合并回主工作区',
    inputSchema: {
      type: 'object',
      properties: {
        swarmId: { type: 'string' },
        member: { type: 'string' },
        commitMessage: { type: 'string' }
      },
      required: ['swarmId', 'member']
    }
  },
  {
    name: 'gitlab_list_issues',
    description: '列出蜂群关联 GitLab 仓库中的 Issues 列表',
    inputSchema: {
      type: 'object',
      properties: { swarmId: { type: 'string' }, state: { type: 'string' } },
      required: ['swarmId']
    }
  },
  {
    name: 'gitlab_create_mr',
    description: '在关联 GitLab 仓库创建 Merge Request 并关联当前蜂群',
    inputSchema: {
      type: 'object',
      properties: {
        swarmId: { type: 'string' },
        sourceBranch: { type: 'string' },
        targetBranch: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' }
      },
      required: ['swarmId', 'sourceBranch', 'title']
    }
  }
];

/**
 * Standard Model Context Protocol (MCP) JSON-RPC 2.0 Server for Yunyu Teamwork.
 * Allows Claude Code, Antigravity, Cursor, Codex, and Windsurf to join any Swarm natively.
 */
export class YunyuMcpServer {
  constructor({ manager }) {
    this.manager = manager;
  }

  async handleRpc(req) {
    const id = req.id ?? null;
    const method = req.method;
    const params = req.params || {};

    try {
      if (method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {}, resources: {} },
            serverInfo: { name: 'yunyu-teamwork-mcp', version: '0.1.0' }
          }
        };
      }

      if (method === 'notifications/initialized') {
        return null; // notification has no response
      }

      if (method === 'ping') {
        return { jsonrpc: '2.0', id, result: {} };
      }

      if (method === 'tools/list') {
        return { jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } };
      }

      if (method === 'resources/list') {
        const resources = this.manager.listSwarms().map((s) => ({
          uri: `yunyu://swarms/${s.id}/board`,
          name: `${s.title}（留言板）`,
          mimeType: 'application/json'
        }));
        return { jsonrpc: '2.0', id, result: { resources } };
      }

      if (method === 'resources/read') {
        const m = String(params.uri || '').match(/^yunyu:\/\/swarms\/([^/]+)\/board$/);
        if (!m) throw new Error(`未知资源 URI: ${params.uri}`);
        const swarm = this._requireSwarm(m[1]);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            contents: [
              {
                uri: params.uri,
                mimeType: 'application/json',
                text: JSON.stringify(swarm.board.read({ since: 0, limit: 200 }), null, 2)
              }
            ]
          }
        };
      }

      if (method === 'tools/call') {
        const result = await this._callTool(params.name, params.arguments || {});
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          }
        };
      }

      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` }
      };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: err.message || String(err) }
      };
    }
  }

  _requireSwarm(swarmId) {
    const swarm = this.manager.getSwarm(swarmId);
    if (!swarm) throw new Error(`未找到蜂群 "${swarmId}"`);
    return swarm;
  }

  async _callTool(name, args) {
    switch (name) {
      case 'swarm_list':
        return { swarms: this.manager.listSwarms() };
      case 'swarm_create': {
        const swarm = this.manager.createSwarm(args);
        return swarm.getStatus();
      }
      case 'swarm_status':
        return this._requireSwarm(args.swarmId).getStatus();
      case 'swarm_add': {
        const swarm = this._requireSwarm(args.swarmId);
        return swarm.addMember(args);
      }
      case 'swarm_kill': {
        const swarm = this._requireSwarm(args.swarmId);
        return swarm.killMember(args.name, { force: Boolean(args.force) });
      }
      case 'post_message': {
        const swarm = this._requireSwarm(args.swarmId);
        return swarm.postMessage(args);
      }
      case 'read_board': {
        const swarm = this._requireSwarm(args.swarmId);
        return swarm.board.read(args);
      }
      case 'wait_for_mention': {
        const swarm = this._requireSwarm(args.swarmId);
        return await swarm.waitForMention(args.member, {
          since: args.since ?? 0,
          timeoutMs: args.timeoutMs ?? 15_000
        });
      }
      case 'check_ownership': {
        const swarm = this._requireSwarm(args.swarmId);
        return swarm.ownership.checkWrite(args.member, args.filePath);
      }
      case 'worktree_merge': {
        const swarm = this._requireSwarm(args.swarmId);
        return swarm.worktrees.mergeToBase(args.member, { commitMessage: args.commitMessage });
      }
      case 'gitlab_list_issues': {
        const swarm = this._requireSwarm(args.swarmId);
        if (!swarm.gitlab?.client) throw new Error('当前蜂群未关联 GitLab 实例');
        return await swarm.gitlab.client.listIssues(swarm.gitlab.projectId, { state: args.state });
      }
      case 'gitlab_create_mr': {
        const swarm = this._requireSwarm(args.swarmId);
        if (!swarm.gitlab?.client) throw new Error('当前蜂群未关联 GitLab 实例');
        const mr = await swarm.gitlab.client.createMergeRequest(swarm.gitlab.projectId, {
          source_branch: args.sourceBranch,
          target_branch: args.targetBranch || 'main',
          title: args.title,
          description: args.description || ''
        });
        swarm.gitlab.linkedMrIid = mr.iid;
        return mr;
      }
      default:
        throw new Error(`未知 MCP 工具: ${name}`);
    }
  }

  /**
   * Serve newline-delimited JSON-RPC 2.0 over stdin/stdout (standard MCP stdio transport).
   */
  serveStdio(input = process.stdin, output = process.stdout) {
    const rl = readline.createInterface({ input, crlfDelay: Infinity });
    rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const req = JSON.parse(trimmed);
        const resp = await this.handleRpc(req);
        if (resp) {
          output.write(`${JSON.stringify(resp)}\n`);
        }
      } catch (err) {
        output.write(
          `${JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: `JSON 解析失败: ${err.message}` }
          })}\n`
        );
      }
    });
    return rl;
  }
}
