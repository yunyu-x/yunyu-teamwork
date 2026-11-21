import { AgentDriver, createGuardedWorkspaceTools } from './base.mjs';

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
      name: 'read_board',
      description: '读取蜂群留言板最新消息',
      parameters: {
        type: 'object',
        properties: { since: { type: 'integer' }, limit: { type: 'integer' } }
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

    const tools = createGuardedWorkspaceTools(ctx);
    const systemPrompt = [
      `你是云驭协同（Yunyu Teamwork）蜂群成员 @${member.name}，角色：${member.role}。`,
      `蜂群主题：${swarm.title}。`,
      `你的任务书：${member.brief || '响应 @ 提及并高质量完成分工。'}`,
      `你的独占可写路径：${member.owns.length ? member.owns.join(', ') : '（按契约执行）'}。`,
      `严禁触碰路径：${member.mustNotTouch.length ? member.mustNotTouch.join(', ') : '无'}。`,
      '协作铁律：',
      '1. 全程必须使用清晰简洁的简体中文汇报（代码标识符、路径、命令与报错原文保留英文）。',
      '2. 交接时只 @ 下一环节责任人（如 @qa 或 @coordinator），引用历史消息使用 #seq 编号。',
      '3. 若文件所有权守卫拒绝写入，严禁绕过，请在回复中说明并 @ 对应作者处理。'
    ].join('\n');

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

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages,
          tools: cfg.enableTools === false ? undefined : OPENAI_TOOL_SCHEMAS,
          temperature: cfg.temperature ?? 0.2
        })
      });

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
        return {
          reply: (choice.content || '').trim() || `@coordinator 已完成 #${triggerMessage.seq} 处理。`,
          channel: triggerMessage.channel,
          tokensUsed: totalTokens
        };
      }

      for (const tc of choice.tool_calls) {
        const fnName = tc.function?.name;
        const fn = tools[fnName];
        let output;
        try {
          const parsedArgs = JSON.parse(tc.function?.arguments || '{}');
          output = fn ? await fn(parsedArgs) : { error: `未知工具: ${fnName}` };
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
