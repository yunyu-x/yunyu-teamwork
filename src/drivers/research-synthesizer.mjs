import { KNOWLEDGE_CATEGORIES, MESSAGE_KINDS } from '../core/constants.mjs';
import { ResearchEngine, extractKeywords, extractUrls } from '../core/research.mjs';
import { AgentDriver } from './base.mjs';

/**
 * Information Collector & Synthesizer Agent Driver:
 * Automatically gathers multi-source intelligence (local workspace, HTTP web pages,
 * Swarm Board messages, existing Issues, Knowledge Vault), optionally enriches synthesis
 * via an LLM/CLI backend, persists structured briefs to KnowledgeVault, and posts citations to the Board.
 */
export class ResearchSynthesizerDriver extends AgentDriver {
  constructor({ registry = null } = {}) {
    super(
      'research-synthesizer',
      '信息搜集与整合智能体驱动（跨源检索仓库/网页/留言板、去重整合引用简报并沉淀至共享知识库）'
    );
    this.registry = registry;
  }

  attachRegistry(registry) {
    this.registry = registry;
  }

  async executeTurn(ctx) {
    const { swarm, member, triggerMessage } = ctx;
    const cfg = member.driverConfig || {};
    const rawText = String(triggerMessage.text || '');
    const topic =
      rawText
        .replace(/@[a-z][a-z0-9_-]*/gi, '')
        .replace(/https?:\/\/[^\s]+/g, '')
        .trim()
        .slice(0, 100) || '项目技术方案与竞品调研';

    const urls = [...new Set([...extractUrls(rawText), ...(Array.isArray(cfg.urls) ? cfg.urls : [])])].slice(0, 6);
    const keywords = extractKeywords(`${topic} ${cfg.extraKeywords || ''}`);

    swarm.emitAgentLog?.({
      member: member.name,
      stream: 'system',
      eventType: 'init',
      text: `启动信息搜集与整合：关键词=[${keywords.join(', ')}]，外部 URL=${urls.length} 个`
    });

    const repoDir = member.workspaceDir || swarm.repoPath;
    const workspaceHits = ResearchEngine.searchWorkspace(repoDir, keywords, { maxMatches: 10 });
    const webSources = await Promise.all(
      urls.map((u) =>
        ResearchEngine.fetchWebSource(u, {
          timeoutMs: cfg.fetchTimeoutMs || 10_000,
          allowPrivate: Boolean(cfg.allowPrivateUrls)
        })
      )
    );
    const swarmContext = ResearchEngine.collectSwarmContext(swarm, keywords);

    const synthesized = ResearchEngine.synthesizeReport({
      topic,
      workspaceHits,
      webSources,
      swarmContext
    });

    let finalReport = synthesized.markdown;
    let tokensUsed = 0;

    // Optional LLM enrichment if user configured a backendDriver
    if (cfg.backendDriver && cfg.backendDriver !== 'builtin' && this.registry) {
      const backend = this.registry.get(cfg.backendDriver);
      if (backend) {
        try {
          const enriched = await backend.executeTurn({
            ...ctx,
            member: {
              ...member,
              brief: `${member.brief || ''}\n请基于以下采集的多源原始证据，提炼深度中文技术调研与短板补全建议：\n\n${synthesized.markdown}`,
              driverConfig: cfg.backendConfig || {}
            }
          });
          if (enriched?.reply) {
            finalReport = enriched.reply;
            tokensUsed = enriched.tokensUsed || 0;
          }
        } catch (err) {
          swarm.emitAgentLog?.({
            member: member.name,
            stream: 'stderr',
            eventType: 'research_fallback',
            text: `深度综合引擎调用失败，已使用零依赖结构化简报引擎输出：${err.message}`
          });
        }
      }
    }

    // Resolve associated Issue ID (explicit metadata.taskId or ISS-N token in prompt)
    let linkedIssueId = triggerMessage.metadata?.taskId || null;
    if (!linkedIssueId) {
      const issMatch = rawText.match(/\b(ISS-\d+)\b/i);
      if (issMatch) {
        const found = swarm.tasks?.getTask(issMatch[1].toUpperCase());
        if (found) linkedIssueId = found.id;
      }
    }

    let kbEntry = null;
    if (swarm.knowledge) {
      kbEntry = swarm.knowledge.addEntry({
        title: synthesized.title,
        category: KNOWLEDGE_CATEGORIES.RESEARCH,
        summary: synthesized.summary,
        content: finalReport,
        sources: synthesized.sources,
        tags: [...keywords.slice(0, 5), 'research'],
        author: member.name,
        linkedIssueId,
        linkedSeq: triggerMessage.seq
      });

      if (linkedIssueId && swarm.tasks?.getTask(linkedIssueId)) {
        swarm.tasks.updateTask(linkedIssueId, {
          linkedKnowledgeIds: [kbEntry.id]
        });
      }
    }

    swarm.emitAgentLog?.({
      member: member.name,
      stream: 'stdout',
      eventType: 'result',
      text: `调研整合完成：来源 ${synthesized.sources.length} 份，已入库 ${kbEntry?.id || '-'}`
    });

    const handoffTarget = triggerMessage.author && triggerMessage.author !== member.name ? `@${triggerMessage.author}` : '@coordinator';
    const reply = `${handoffTarget} ${finalReport}\n\n> 📚 已归档至共享知识库 \`${kbEntry?.id || 'knowledge'}\`${linkedIssueId ? `，并关联至任务 \`${linkedIssueId}\`` : ''}。`;

    return {
      reply,
      channel: triggerMessage.channel || 'main',
      kind: MESSAGE_KINDS.DELIVERABLE,
      tokensUsed,
      metadata: {
        driver: 'research-synthesizer',
        knowledgeId: kbEntry?.id || null,
        taskId: linkedIssueId,
        sourceCount: synthesized.sources.length
      }
    };
  }
}
