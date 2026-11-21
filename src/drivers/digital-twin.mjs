import { ChannelBridge } from '../channels/bridge.mjs';
import { AUTONOMY_MODES, MESSAGE_KINDS } from '../core/constants.mjs';
import { AgentDriver } from './base.mjs';

const DEFAULT_ESCALATION_KEYWORDS = ['合并', '发布', '上线', '审批', '生产', '删除', '预算', '强推', '确认'];

/**
 * Personal Digital Twin Driver:
 * Represents a human owner inside the swarm with customizable persona, personal knowledge,
 * autonomy mode (`hybrid` | `auto_reply` | `relay_human`), optional LLM/CLI reasoning backend,
 * and bidirectional IM/Bot communication via ChannelBridge.
 */
export class DigitalTwinDriver extends AgentDriver {
  constructor({ channelBridge = null, registry = null } = {}) {
    super('digital-twin', '个人数字分身驱动（支持人设/知识定制、混合托管审批与飞书/企微/钉钉/Telegram/Slack/Webhook 双向 IM 接入）');
    this.channelBridge = channelBridge || new ChannelBridge();
    this.registry = registry;
  }

  attachRegistry(registry) {
    this.registry = registry;
  }

  async executeTurn(ctx) {
    const { swarm, member, triggerMessage, unreadMessages } = ctx;
    const cfg = member.driverConfig || {};
    const ownerName = cfg.ownerName || member.name;
    const persona = cfg.persona || '专业务实、回复简洁';
    const knowledge = cfg.knowledge || '';
    const autonomyMode = cfg.autonomyMode || AUTONOMY_MODES.HYBRID;
    const keywords = Array.isArray(cfg.escalationKeywords) && cfg.escalationKeywords.length
      ? cfg.escalationKeywords
      : DEFAULT_ESCALATION_KEYWORDS;
    const channelCfg = cfg.channel && cfg.channel.type && cfg.channel.enabled !== false ? cfg.channel : null;

    // Remember trigger channel for inbound IM reply routing
    member.driverConfig = { ...cfg, lastTriggerChannel: triggerMessage.channel || 'main' };

    const matchedKeyword = keywords.find((kw) => kw && triggerMessage.text.includes(kw)) || null;
    const shouldEscalate =
      autonomyMode === AUTONOMY_MODES.RELAY_HUMAN ||
      (autonomyMode === AUTONOMY_MODES.HYBRID && Boolean(matchedKeyword));

    if (shouldEscalate) {
      const reason =
        autonomyMode === AUTONOMY_MODES.RELAY_HUMAN
          ? '当前分身处于「纯 IM 人工托管」模式'
          : `触发高风险审批关键词「${matchedKeyword}」`;

      let imDelivered = false;
      if (channelCfg) {
        try {
          await this.channelBridge.sendOutbound(channelCfg, {
            title: `🚦 [${swarm.title}] 需要 ${ownerName} 人工确认`,
            text: [
              `蜂群成员 @${triggerMessage.author} 在 #${triggerMessage.seq} 提及了你的数字分身 @${member.name}：`,
              triggerMessage.text,
              `升级原因：${reason}`
            ].join('\n\n'),
            hint: '请直接在本 IM 频道回复你的决策，系统将自动以你的数字分身身份回帖至蜂群留言板。',
            swarmId: swarm.id,
            member: member.name,
            ownerName,
            triggerSeq: triggerMessage.seq,
            mode: 'escalation'
          });
          imDelivered = true;
        } catch (err) {
          swarm.emitAgentLog?.({
            member: member.name,
            stream: 'stderr',
            eventType: 'im_error',
            text: `IM 推送失败：${err.message}`
          });
        }
      }

      swarm.postMessage({
        author: member.name,
        text: `🚦 【数字分身请示 · 归属人：${ownerName}】已收到 @${triggerMessage.author} 的消息 #${triggerMessage.seq}（${reason}）。${
          imDelivered
            ? `已实时推送至绑定通道 \`${channelCfg.type}\`，等待 ${ownerName} 本人回复确认。`
            : `请在 Web 看板或通过绑定的 IM 通道回复决策。`
        }`,
        channel: triggerMessage.channel || 'main',
        kind: MESSAGE_KINDS.HUMAN_GATE,
        metadata: {
          noWake: true,
          awaitingHuman: true,
          twinOwner: ownerName,
          escalationReason: reason,
          imDelivered,
          channelType: channelCfg?.type || null
        }
      });

      return { alreadyPosted: true, awaitingHuman: true, reason };
    }

    // Autonomous reply path (`auto_reply` or routine `hybrid`)
    let replyText = null;
    let tokensUsed = 0;

    const backendId = cfg.backendDriver;
    if (backendId && backendId !== 'builtin' && backendId !== 'digital-twin' && this.registry) {
      const backendDriver = this.registry.get(backendId);
      if (backendDriver) {
        const enrichedMember = {
          ...member,
          brief: [
            `你是「${ownerName}」的个人数字分身（@${member.name}）。`,
            `性格与表达风格：${persona}`,
            knowledge ? `个人知识与原则：${knowledge}` : '',
            member.brief || ''
          ]
            .filter(Boolean)
            .join('\n'),
          driverConfig: { ...(cfg.backendConfig || {}), ...(cfg.preset ? { preset: cfg.preset } : {}) }
        };
        try {
          const delegated = await backendDriver.executeTurn({
            ...ctx,
            member: enrichedMember
          });
          if (delegated?.reply) {
            replyText = delegated.reply;
            tokensUsed = delegated.tokensUsed || 0;
          }
        } catch (err) {
          swarm.emitAgentLog?.({
            member: member.name,
            stream: 'stderr',
            eventType: 'twin_fallback',
            text: `底层引擎 ${backendId} 调用失败，自动降级为内置数字分身回复：${err.message}`
          });
        }
      }
    }

    if (!replyText) {
      const snippet = triggerMessage.text.replace(/\s+/g, ' ').slice(0, 100);
      const replyTarget = triggerMessage.author && triggerMessage.author !== member.name ? `@${triggerMessage.author} ` : '';
      replyText = [
        `${replyTarget}【${ownerName} 的数字分身 · 自动代答】已阅 #${triggerMessage.seq}（“${snippet}”）。`,
        `- 依据本人原则（${persona}）${knowledge ? `及备忘（${knowledge.slice(0, 120)}）` : ''}：常规事项可按既定契约继续推进。`,
        channelCfg && cfg.mirrorAutoReplyToIm !== false
          ? `- 同步状态：本次代答摘要已抄送至 \`${channelCfg.type}\`，如需 ${ownerName} 本人介入审批请在消息中包含关键词（如“审批/合并/发布”）。`
          : '- 如涉及高风险审批或最终拍板，请明确注明“审批/发布”以唤醒本人。'
      ].join('\n');
    }

    if (channelCfg && cfg.mirrorAutoReplyToIm !== false) {
      try {
        await this.channelBridge.sendOutbound(channelCfg, {
          title: `🤖 [${swarm.title}] ${ownerName} 的数字分身已代答 #${triggerMessage.seq}`,
          text: `触发消息（@${triggerMessage.author}）：${triggerMessage.text.slice(0, 200)}\n\n分身回复：\n${replyText.slice(0, 400)}`,
          hint: '如需覆盖或补充意见，直接回复本条消息即可同步回蜂群留言板。',
          swarmId: swarm.id,
          member: member.name,
          ownerName,
          triggerSeq: triggerMessage.seq,
          mode: 'mirror'
        });
      } catch (err) {
        swarm.emitAgentLog?.({
          member: member.name,
          stream: 'stderr',
          eventType: 'im_error',
          text: `IM 抄送失败：${err.message}`
        });
      }
    }

    return {
      reply: replyText,
      channel: triggerMessage.channel || 'main',
      tokensUsed,
      metadata: {
        driver: 'digital-twin',
        twinOwner: ownerName,
        autonomyMode,
        channelType: channelCfg?.type || null
      }
    };
  }
}
