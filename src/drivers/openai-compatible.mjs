import { AgentDriver, createGuardedWorkspaceTools, invokeToolWithHooks } from './base.mjs';

const OPENAI_TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取当前工作区内的文件内容',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: '列出当前工作区目录内容',
      parameters: {
        type: 'object',
        properties: { dir: { type: 'string' } }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '在自己拥有所有权的路径内创建或覆盖文件（受 OwnershipGuard 校验）',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: '对拥有所有权的文件进行精确片段替换',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          target: { type: 'string' },
          replacement: { type: 'string' }
        },
        required: ['path', 'target', 'replacement']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: '在当前工作区执行测试或构建命令',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_status',
      description: '查看当前或指定成员 Git 工作区分支与变更文件列表',
      parameters: {
        type: 'object',
        properties: { targetMember: { type: 'string' } }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_diff',
      description: '查看当前或指定成员分支相对基线的统一 git diff（适用于复核与提交）',
      parameters: {
        type: 'object',
        properties: { targetMember: { type: 'string' }, base: { type: 'string' } }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_log',
      description: '查看当前或指定成员工作区最近提交记录',
      parameters: {
        type: 'object',
        properties: { targetMember: { type: 'string' }, limit: { type: 'integer' } }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_commit',
      description: '将当前隔离 worktree 中的合规改动提交为本地 commit',
      parameters: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_push',
      description: '将当前成员的非受保护隔离工作分支推送至远端（默认禁止 force 与主干直推）',
      parameters: {
        type: 'object',
        properties: { remote: { type: 'string' } }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_review_branch',
      description: '聚合指定作者分支的 diff、提交日志与 OwnershipGuard 越权审计报告，供复核官审查',
      parameters: {
        type: 'object',
        properties: { targetMember: { type: 'string' } },
        required: ['targetMember']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_verification',
      description: '执行测试/语法检查验证命令并返回结构化通过结果',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_board',
      description: '读取蜂群留言板最新消息',
      parameters: {
        type: 'object',
        properties: { since: { type: 'integer' }, limit: { type: 'integer' } }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'research_workspace',
      description: '在当前代码仓库中按关键词检索相关文档与源码片段',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, maxMatches: { type: 'integer' } },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'research_web',
      description: '抓取并提取外部 HTTP/HTTPS 网页标题、章节与正文用于信息搜集整合',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'knowledge_search',
      description: '检索项目共享知识库（调研简报、冻结 Spec、ADR、踩坑记录）',
      parameters: {
        type: 'object',
        properties: { q: { type: 'string' }, category: { type: 'string' }, tag: { type: 'string' } }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'knowledge_save',
      description: '将结构化调研报告或架构决策写入项目共享知识库',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          category: { type: 'string' },
          summary: { type: 'string' },
          content: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } }
        },
        required: ['title', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'issue_ready',
      description: '查询 DAG 前置依赖已全部完成且当前可认领的就绪 Issue 队列（Beads ready 语义）',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'issue_claim',
      description: '以 TTL 租约原子认领一个就绪 Issue，防止与其他并行 Agent 重复开工',
      parameters: {
        type: 'object',
        properties: { taskId: { type: 'string' }, ttlMs: { type: 'integer' } },
        required: ['taskId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'world_model_overview',
      description: '读取项目实时世界模型（模块域拓扑、高扇入核心文件、依赖边、循环依赖与健康度）',
      parameters: {
        type: 'object',
        properties: { refresh: { type: 'boolean' } }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'world_model_impact',
      description: '变更爆炸半径预测：在编辑源码前模拟改动目标文件对下游模块、测试与协作成员的影响',
      parameters: {
        type: 'object',
        properties: { targets: { type: 'array', items: { type: 'string' } } },
        required: ['targets']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'wiki_list',
      description: '搜索或列出项目活文档 Wiki 页面目录',
      parameters: {
        type: 'object',
        properties: { q: { type: 'string' }, category: { type: 'string' } }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'wiki_read',
      description: '按 slug 读取项目 Wiki 页面的完整内容与修订历史',
      parameters: {
        type: 'object',
        properties: { slug: { type: 'string' } },
        required: ['slug']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'wiki_upsert',
      description: '新建或更新项目 Wiki 档案页面（支持架构设计、模块约定、踩坑与决策沉淀）',
      parameters: {
        type: 'object',
        properties: {
          slug: { type: 'string' },
          title: { type: 'string' },
          category: { type: 'string' },
          content: { type: 'string' },
          summary: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } }
        },
        required: ['slug', 'title', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'project_audit',
      description: '执行全仓工程不变量与安全审计（检查零外部依赖、硬编码密钥、危险调用、循环依赖）',
      parameters: {
        type: 'object',
        properties: { createIssues: { type: 'boolean' } }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'skill_list',
      description: '列出当前已启用的插件技能目录（仅摘要元数据，按需加载正文）',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'skill_match',
      description: '根据任务关键词按渐进式披露算法匹配最相关技能',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' }, limit: { type: 'integer' } },
        required: ['text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'skill_read',
      description: '按 skillId 读取指定技能（SKILL.md）的完整工程规程与示例',
      parameters: {
        type: 'object',
        properties: { skillId: { type: 'string' } },
        required: ['skillId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'mcp_connector_list',
      description: '列出已连接的外部 MCP 连接器服务器及其动态发现的工具列表',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'mcp_connector_call',
      description: '调用指定已连接外部 MCP 服务器的工具',
      parameters: {
        type: 'object',
        properties: {
          serverId: { type: 'string' },
          toolName: { type: 'string' },
          args: { type: 'object' }
        },
        required: ['serverId', 'toolName']
      }
    }
  }
];

/**
 * OpenAI-Compatible LLM Driver:
 * Works seamlessly with OpenAI, DeepSeek, Qwen/DashScope, Zhipu GLM, Moonshot, OpenRouter, vLLM, and Ollama.
 */
export class OpenAICompatibleDriver extends AgentDriver {
  constructor(defaults = {}) {
    super('openai-compatible', '通用 OpenAI 协议兼容大模型驱动（支持 DeepSeek / 通义千问 / OpenAI / OpenRouter / Ollama）');
    this.defaults = defaults;
  }

  async executeTurn(ctx) {
    const { swarm, member, triggerMessage, unreadMessages } = ctx;
    const cfg = { ...this.defaults, ...(member.driverConfig || {}) };
    const baseUrl = (cfg.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const apiKey = cfg.apiKey || process.env.OPENAI_API_KEY || '';
    const model = member.model && member.model !== 'default' ? member.model : cfg.model || process.env.OPENAI_DEFAULT_MODEL || 'gpt-4o';
    const maxRounds = cfg.maxToolRounds || 6;

    if (!apiKey && !baseUrl.includes('localhost') && !baseUrl.includes('127.0.0.1')) {
      throw new Error(
        `未检测到 API Key（OPENAI_API_KEY 或 driverConfig.apiKey），无法调用 ${baseUrl}。本地 Ollama 请将 baseUrl 设为 http://127.0.0.1:11434/v1`
      );
    }

    const tools = createGuardedWorkspaceTools({ ...ctx, skipSyncHooks: true });
    const worldBriefing = swarm.worldModel?.snapshot ? `\n\n${swarm.worldModel.getAgentBriefing(member.name)}` : '';
    const pluginPrompt = swarm.plugins?.skills
      ? swarm.plugins.skills.buildPromptContext({ text: triggerMessage.text, member })
      : '';
    const skillsBriefing = pluginPrompt ? `\n\n${pluginPrompt}` : '';
    const hookBriefing = ctx.pluginHookContext ? `\n\n【生命周期 Hook 注入上下文】\n${ctx.pluginHookContext}` : '';

    const isReadOnlyRole = ['verifier', 'reviewer', 'researcher', 'qa'].includes(String(member.role || '').toLowerCase());
    const baseSchemas = isReadOnlyRole
      ? OPENAI_TOOL_SCHEMAS.filter((s) => s.function.name !== 'mcp_connector_call' && s.function.name !== 'run_command')
      : OPENAI_TOOL_SCHEMAS;
    const seenToolNames = new Set(baseSchemas.map((s) => s.function.name));
    const dynamicMcpSchemas = isReadOnlyRole
      ? []
      : (swarm.plugins?.mcpClients?.getAllDiscoveredTools() || [])
          .filter((t) => !seenToolNames.has(t.namespacedName))
          .map((t) => {
            seenToolNames.add(t.namespacedName);
            return {
              type: 'function',
              function: {
                name: t.namespacedName,
                description: `[外部 MCP:${t.serverId}] ${t.description || t.toolName}`,
                parameters: t.inputSchema || { type: 'object', properties: {} }
              }
            };
          });
    const activeSchemas = [...baseSchemas, ...dynamicMcpSchemas];

    const systemPrompt = [
      `你是云驭协同（Yunyu Teamwork）蜂群成员 @${member.name}，角色：${member.role}。`,
      `蜂群主题：${swarm.title}。`,
      `你的任务书：${member.brief || '响应 @ 提及并高质量完成分工。'}`,
      `你的独占可写路径：${member.owns.length ? member.owns.join(', ') : '（按契约执行）'}。`,
      `严禁触碰路径：${member.mustNotTouch.length ? member.mustNotTouch.join(', ') : '无'}。`,
      '协作铁律：',
      '1. 全程必须使用清晰简洁的简体中文汇报（代码标识符、路径、命令与报错原文保留英文）。',
      '2. 交接时只 @ 下一环节责任人（如 @qa 或 @coordinator），引用历史消息使用 #seq 编号。',
      '3. 若文件所有权守卫拒绝写入，严禁绕过，请在回复中说明并 @ 对应作者处理。',
      '4. 修改核心模块前优先调用 world_model_impact 评估爆炸半径，关键决策沉淀至 wiki_upsert；需要详细规程时按需调用 skill_read。'
    ].join('\n') + worldBriefing + skillsBriefing + hookBriefing;

    const historyText = (unreadMessages.length ? unreadMessages : [triggerMessage])
      .map((m) => `#${m.seq} [${m.channel}] ${m.author}: ${m.text}`)
      .join('\n\n');

    const messages = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `你因消息 #${triggerMessage.seq} 被唤醒。未读留言如下：\n\n${historyText}\n\n请按职责执行必要工具操作，然后给出中文结论与下一环节 @ 交接。`
      }
    ];

    let totalTokens = 0;

    for (let round = 0; round < maxRounds; round++) {
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const controller = new AbortController();
      const reqTimer = setTimeout(() => controller.abort(), cfg.timeoutMs || 90_000);
      let res;
      try {
        res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            model,
            messages,
            tools: cfg.enableTools === false ? undefined : activeSchemas,
            temperature: cfg.temperature ?? 0.2
          })
        });
      } finally {
        clearTimeout(reqTimer);
      }

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`LLM 接口返回 HTTP ${res.status}: ${errBody.slice(0, 300)}`);
      }

      const data = await res.json();
      totalTokens += data.usage?.total_tokens || 0;
      const choice = data.choices?.[0]?.message;
      if (!choice) throw new Error('LLM 响应缺少 choices[0].message');

      messages.push(choice);

      if (!Array.isArray(choice.tool_calls) || choice.tool_calls.length === 0) {
        // Post-turn OwnershipGuard verification against any files modified in the workspace
        if (ctx.worktrees && ctx.ownership) {
          const changed = ctx.worktrees.listChangedFiles(member.name);
          if (changed.length > 0) {
            const audit = ctx.ownership.auditChangedFiles(member.name, changed);
            if (!audit.passed) {
              const msg = audit.violations.map((v) => `${v.path}（${v.reason}）`).join('；');
              throw new Error(`LLM Agent 越权修改文件被拦截：${msg}`);
            }
          }
        }
        return {
          reply: (choice.content || '').trim() || `@coordinator 已完成 #${triggerMessage.seq} 处理。`,
          channel: triggerMessage.channel,
          tokensUsed: totalTokens
        };
      }

      for (const tc of choice.tool_calls) {
        const fnName = tc.function?.name;
        let output;
        try {
          const parsedArgs = JSON.parse(tc.function?.arguments || '{}');
          output = await invokeToolWithHooks(tools, fnName, parsedArgs, { swarm, member });
        } catch (err) {
          output = { error: err.message || String(err) };
        }
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(output)
        });
      }
    }

    return {
      reply: `@coordinator 达到单轮最大工具调用步数 (${maxRounds})，请检视当前工作区状态并决定后续步骤。`,
      channel: triggerMessage.channel,
      tokensUsed: totalTokens
    };
  }
}
