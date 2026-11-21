import readline from 'node:readline';
import { APP_VERSION } from '../core/constants.mjs';

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
        role: {
          type: 'string',
          enum: ['coordinator', 'architect', 'researcher', 'author', 'committer', 'reviewer', 'verifier', 'release', 'digital_twin', 'human']
        },
        driver: {
          type: 'string',
          enum: ['simulated', 'openai-compatible', 'cli-agent', 'research-synthesizer', 'digital-twin', 'webhook', 'human']
        },
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
  },
  {
    name: 'gitlab_comment_issue',
    description: '在关联 GitLab 仓库的指定 Issue 下发表评论',
    inputSchema: {
      type: 'object',
      properties: {
        swarmId: { type: 'string' },
        issueIid: { type: 'integer' },
        body: { type: 'string' }
      },
      required: ['swarmId', 'issueIid', 'body']
    }
  },
  {
    name: 'task_list',
    description: '列出蜂群任务与交付物看板（Kanban）中的所有任务卡',
    inputSchema: {
      type: 'object',
      properties: { swarmId: { type: 'string' } },
      required: ['swarmId']
    }
  },
  {
    name: 'task_create',
    description: '在蜂群任务看板中创建一条结构化任务卡',
    inputSchema: {
      type: 'object',
      properties: {
        swarmId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        status: { type: 'string', enum: ['backlog', 'ready', 'in_progress', 'review', 'done', 'cancelled'] },
        priority: { type: 'string', enum: ['P0', 'P1', 'P2'] },
        assignee: { type: 'string' },
        dependsOn: { type: 'array', items: { type: 'string' } },
        spec: { type: 'string' },
        acceptanceCriteria: { type: 'array', items: { type: 'string' } },
        gitlabIssueIid: { type: 'integer' }
      },
      required: ['swarmId', 'title']
    }
  },
  {
    name: 'task_update',
    description: '更新任务看板中任务的状态列、负责人或关联交付物 #seq',
    inputSchema: {
      type: 'object',
      properties: {
        swarmId: { type: 'string' },
        taskId: { type: 'string' },
        status: { type: 'string', enum: ['backlog', 'ready', 'in_progress', 'review', 'done', 'cancelled'] },
        assignee: { type: 'string' },
        deliverableSeqs: { type: 'array', items: { type: 'integer' } }
      },
      required: ['swarmId', 'taskId']
    }
  },
  {
    name: 'issue_ready',
    description: '列出所有 DAG 前置依赖已满足且无阻塞的就绪 Issue（Beads ready 语义）',
    inputSchema: {
      type: 'object',
      properties: { swarmId: { type: 'string' }, assignee: { type: 'string' } },
      required: ['swarmId']
    }
  },
  {
    name: 'issue_claim',
    description: '以 TTL 租约原子认领一个 Issue，防止多 Agent 并发冲突',
    inputSchema: {
      type: 'object',
      properties: { swarmId: { type: 'string' }, taskId: { type: 'string' }, member: { type: 'string' }, ttlMs: { type: 'integer' } },
      required: ['swarmId', 'taskId', 'member']
    }
  },
  {
    name: 'issue_accept',
    description: '在待验收阶段批准通过 Issue 并流转至已完成',
    inputSchema: {
      type: 'object',
      properties: { swarmId: { type: 'string' }, taskId: { type: 'string' }, reviewer: { type: 'string' }, summary: { type: 'string' } },
      required: ['swarmId', 'taskId']
    }
  },
  {
    name: 'budget_status',
    description: '查询蜂群与成员的 Token/轮次/费用预算消耗与治理状态',
    inputSchema: {
      type: 'object',
      properties: { swarmId: { type: 'string' } },
      required: ['swarmId']
    }
  },
  {
    name: 'knowledge_search',
    description: '检索蜂群共享知识库（调研简报、Spec、ADR、踩坑记录）',
    inputSchema: {
      type: 'object',
      properties: { swarmId: { type: 'string' }, q: { type: 'string' }, category: { type: 'string' } },
      required: ['swarmId']
    }
  },
  {
    name: 'knowledge_save',
    description: '将结构化情报调研或架构决策写入蜂群共享知识库',
    inputSchema: {
      type: 'object',
      properties: {
        swarmId: { type: 'string' },
        title: { type: 'string' },
        category: { type: 'string' },
        summary: { type: 'string' },
        content: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } }
      },
      required: ['swarmId', 'title', 'content']
    }
  },
  {
    name: 'git_diff',
    description: '获取指定成员隔离 Git Worktree 分支的统一 diff 与审计状态（适用于代码复核）',
    inputSchema: {
      type: 'object',
      properties: {
        swarmId: { type: 'string' },
        member: { type: 'string' }
      },
      required: ['swarmId', 'member']
    }
  },
  {
    name: 'git_push',
    description: '将成员的非受保护隔离工作分支安全推送到远端（默认拒绝 force 与主干直推）',
    inputSchema: {
      type: 'object',
      properties: {
        swarmId: { type: 'string' },
        member: { type: 'string' },
        remote: { type: 'string' }
      },
      required: ['swarmId', 'member']
    }
  },
  {
    name: 'world_model_overview',
    description: '获取项目的实时世界模型总览（模块域分布、高扇入核心枢纽、依赖拓扑、循环依赖与健康度评分）',
    inputSchema: {
      type: 'object',
      properties: {
        swarmId: { type: 'string' },
        refresh: { type: 'boolean', description: '是否强制重新扫描仓库代码' }
      },
      required: ['swarmId']
    }
  },
  {
    name: 'world_model_impact',
    description: '变更爆炸半径模拟：在改动文件前预测直接/传递下游模块、受影响测试、需联动成员与工程不变量警告',
    inputSchema: {
      type: 'object',
      properties: {
        swarmId: { type: 'string' },
        targets: { type: 'array', items: { type: 'string' }, description: '待修改的相对文件路径列表' }
      },
      required: ['swarmId', 'targets']
    }
  },
  {
    name: 'wiki_list',
    description: '检索或列出项目活文档 Wiki 档案页面列表',
    inputSchema: {
      type: 'object',
      properties: {
        swarmId: { type: 'string' },
        q: { type: 'string' },
        category: { type: 'string' }
      },
      required: ['swarmId']
    }
  },
  {
    name: 'wiki_read',
    description: '按 slug 读取指定项目 Wiki 页面的完整 Markdown 正文与版本修订历史',
    inputSchema: {
      type: 'object',
      properties: {
        swarmId: { type: 'string' },
        slug: { type: 'string' }
      },
      required: ['swarmId', 'slug']
    }
  },
  {
    name: 'wiki_upsert',
    description: '创建或修订项目 Wiki 页面（追加式不可变版本记录，支持自动/人工知识沉淀）',
    inputSchema: {
      type: 'object',
      properties: {
        swarmId: { type: 'string' },
        slug: { type: 'string' },
        title: { type: 'string' },
        category: { type: 'string' },
        content: { type: 'string' },
        author: { type: 'string' },
        summary: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } }
      },
      required: ['swarmId', 'slug', 'title', 'content']
    }
  },
  {
    name: 'project_audit',
    description: '运行全仓多视角自动审计（零外部依赖铁律、硬编码密钥、eval/注入风险、循环依赖、版本号一致性）',
    inputSchema: {
      type: 'object',
      properties: {
        swarmId: { type: 'string' },
        createIssues: { type: 'boolean', description: '是否将 P0/P1 审计发现自动转为待开始 Issue' }
      },
      required: ['swarmId']
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
    let id = null;
    try {
      if (!req || typeof req !== 'object') {
        return {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32600, message: 'Invalid Request: JSON-RPC payload must be an object' }
        };
      }
      id = req.id ?? null;
      const method = req.method;
      const params = req.params || {};

      if (method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {}, resources: {} },
            serverInfo: { name: 'yunyu-teamwork-mcp', version: APP_VERSION }
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
        const resources = [];
        for (const s of this.manager.listSwarms()) {
          resources.push({
            uri: `yunyu://swarms/${s.id}/board`,
            name: `${s.title}（留言板）`,
            mimeType: 'application/json'
          });
          resources.push({
            uri: `yunyu://swarms/${s.id}/wiki`,
            name: `${s.title}（项目 Wiki 档案）`,
            mimeType: 'application/json'
          });
        }
        return { jsonrpc: '2.0', id, result: { resources } };
      }

      if (method === 'resources/read') {
        const boardMatch = String(params.uri || '').match(/^yunyu:\/\/swarms\/([^/]+)\/board$/);
        if (boardMatch) {
          const swarm = this._requireSwarm(boardMatch[1]);
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
        const wikiMatch = String(params.uri || '').match(/^yunyu:\/\/swarms\/([^/]+)\/wiki$/);
        if (wikiMatch) {
          const swarm = this._requireSwarm(wikiMatch[1]);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              contents: [
                {
                  uri: params.uri,
                  mimeType: 'application/json',
                  text: JSON.stringify({ pages: swarm.wiki.listPages() }, null, 2)
                }
              ]
            }
          };
        }
        throw new Error(`未知资源 URI: ${params.uri}`);
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
        const added = swarm.addMember(args);
        return Array.isArray(added) ? added.map((m) => swarm.toPublicMember(m)) : swarm.toPublicMember(added);
      }
      case 'swarm_kill': {
        const swarm = this._requireSwarm(args.swarmId);
        return swarm.toPublicMember(swarm.killMember(args.name, { force: Boolean(args.force) }));
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
        const res = swarm.worktrees.mergeToBase(args.member, { commitMessage: args.commitMessage });
        swarm._saveMeta();
        swarm.emit('status', swarm.getStatus());
        return res;
      }
      case 'git_diff': {
        const swarm = this._requireSwarm(args.swarmId);
        return {
          member: args.member,
          status: swarm.worktrees.getStatus(args.member),
          diff: swarm.worktrees.getDiff(args.member)
        };
      }
      case 'git_push': {
        const swarm = this._requireSwarm(args.swarmId);
        return swarm.worktrees.pushBranch(args.member, { remote: args.remote || 'origin', force: false });
      }
      case 'world_model_overview': {
        const swarm = this._requireSwarm(args.swarmId);
        return args.refresh ? swarm.refreshWorldModel() : swarm.getWorldModelOverview();
      }
      case 'world_model_impact': {
        const swarm = this._requireSwarm(args.swarmId);
        return swarm.simulateChangeImpact(args.targets || []);
      }
      case 'wiki_list': {
        const swarm = this._requireSwarm(args.swarmId);
        return { pages: swarm.wiki.search({ q: args.q || '', category: args.category || 'all' }) };
      }
      case 'wiki_read': {
        const swarm = this._requireSwarm(args.swarmId);
        const page = swarm.wiki.getPage(args.slug);
        if (!page) throw new Error(`未找到 Wiki 页面 "${args.slug}"`);
        return page;
      }
      case 'wiki_upsert': {
        const swarm = this._requireSwarm(args.swarmId);
        return swarm.wiki.upsertPage(args);
      }
      case 'project_audit': {
        const swarm = this._requireSwarm(args.swarmId);
        return swarm.runProjectAudit({ createIssues: Boolean(args.createIssues) });
      }
      case 'task_list': {
        const swarm = this._requireSwarm(args.swarmId);
        return { tasks: swarm.tasks.listTasks() };
      }
      case 'task_create': {
        const swarm = this._requireSwarm(args.swarmId);
        return swarm.tasks.createTask(args);
      }
      case 'task_update': {
        const swarm = this._requireSwarm(args.swarmId);
        return swarm.tasks.updateTask(args.taskId, args);
      }
      case 'issue_ready': {
        const swarm = this._requireSwarm(args.swarmId);
        return { tasks: swarm.tasks.listReadyTasks({ assignee: args.assignee || null }) };
      }
      case 'issue_claim': {
        const swarm = this._requireSwarm(args.swarmId);
        return swarm.tasks.claimTask(args.taskId, args.member, { ttlMs: args.ttlMs || 300_000 });
      }
      case 'issue_accept': {
        const swarm = this._requireSwarm(args.swarmId);
        return swarm.tasks.acceptTask(args.taskId, { reviewer: args.reviewer || 'coordinator', summary: args.summary || '' });
      }
      case 'budget_status': {
        const swarm = this._requireSwarm(args.swarmId);
        return swarm.budget.getSummary();
      }
      case 'knowledge_search': {
        const swarm = this._requireSwarm(args.swarmId);
        return { entries: swarm.knowledge.search({ q: args.q || '', category: args.category || 'all' }) };
      }
      case 'knowledge_save': {
        const swarm = this._requireSwarm(args.swarmId);
        return swarm.knowledge.addEntry(args);
      }
      case 'gitlab_comment_issue': {
        const swarm = this._requireSwarm(args.swarmId);
        if (!swarm.gitlab?.client) throw new Error('当前蜂群未关联 GitLab 实例');
        return await swarm.gitlab.client.createIssueNote(swarm.gitlab.projectId, args.issueIid, args.body);
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
        swarm._saveMeta();
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
