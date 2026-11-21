import { MEMBER_STATES } from '../core/constants.mjs';
import { CHANNEL_ADAPTERS } from './adapters.mjs';

/**
 * Bidirectional IM & Bot Communication Bridge:
 * Sends outbound notifications/cards from Digital Twins to external IMs,
 * and verifies/routes inbound IM replies back onto the Swarm MessageBoard.
 */
export class ChannelBridge {
  constructor({ timeoutMs = 10_000 } = {}) {
    this.timeoutMs = timeoutMs;
    this.deliveryLog = [];
  }

  getAdapter(channelType) {
    const adapter = CHANNEL_ADAPTERS[channelType];
    if (!adapter) {
      throw new Error(`不支持的通信渠道类型 "${channelType}"，可选：${Object.keys(CHANNEL_ADAPTERS).join(', ')}`);
    }
    return adapter;
  }

  async sendOutbound(channelConfig, payload) {
    if (!channelConfig || !channelConfig.type) {
      return { sent: false, skipped: true, reason: '未配置外部 IM 通信渠道' };
    }
    const adapter = this.getAdapter(channelConfig.type);
    const reqSpec = adapter.buildOutbound(channelConfig, payload);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(reqSpec.url, {
        method: reqSpec.method || 'POST',
        headers: reqSpec.headers,
        body: reqSpec.body,
        signal: controller.signal
      });
      const responseText = await res.text();
      const record = {
        direction: 'outbound',
        channelType: channelConfig.type,
        swarmId: payload.swarmId || null,
        member: payload.member || null,
        status: res.status,
        ok: res.ok,
        time: new Date().toISOString()
      };
      this.deliveryLog.push(record);
      if (this.deliveryLog.length > 200) this.deliveryLog.shift();

      if (!res.ok) {
        throw new Error(`IM 通道 (${channelConfig.type}) 推送失败 HTTP ${res.status}: ${responseText.slice(0, 200)}`);
      }
      return { sent: true, status: res.status, channelType: channelConfig.type, response: responseText.slice(0, 300) };
    } finally {
      clearTimeout(timer);
    }
  }

  parseInbound(channelType, headers, rawBody, channelConfig = {}) {
    const adapter = this.getAdapter(channelType);
    return adapter.parseInbound(headers, rawBody, channelConfig);
  }

  /**
   * Handle an inbound IM/Bot webhook payload targeting a specific Digital Twin (or Human) member.
   */
  async handleInboundForMember({ swarm, memberName, channelType, headers = {}, rawBody = '', channel = 'main' }) {
    const member = swarm.members.get(memberName);
    if (!member) {
      throw new Error(`蜂群 "${swarm.id}" 中未找到成员 "${memberName}"`);
    }
    const chCfg = member.driverConfig?.channel;
    if (!chCfg || !chCfg.type || chCfg.enabled === false) {
      return {
        accepted: false,
        statusCode: 403,
        reason: `成员 @${memberName} 未启用外部 IM 入站通道，已拒绝未授权消息`
      };
    }
    const requestedType = channelType || chCfg.type;
    if (requestedType !== chCfg.type) {
      return {
        accepted: false,
        statusCode: 403,
        reason: `IM 渠道类型不匹配：成员 @${memberName} 配置为 "${chCfg.type}"，拒绝来自 "${requestedType}" 的入站请求`
      };
    }
    const parsed = this.parseInbound(chCfg.type, headers, rawBody, chCfg);

    if (parsed.challengeResponse) {
      return { accepted: false, challengeResponse: parsed.challengeResponse };
    }
    if (!parsed.accepted) {
      return parsed;
    }

    const ownerTag = member.driverConfig?.ownerName || parsed.sender;
    const targetChannel =
      member.driverConfig?.lastTriggerChannel ||
      channel ||
      'main';

    const msg = swarm.postMessage({
      author: member.name,
      text: `${parsed.text}\n\n> 经由 ${channelType || chCfg.type}（归属人：${ownerTag}）远程回复`,
      channel: targetChannel,
      metadata: {
        source: 'im_inbound',
        channelType: parsed.channelType,
        imSender: parsed.sender,
        ownerName: ownerTag
      }
    });

    if (!member.killed && member.state === MEMBER_STATES.WAITING_HUMAN) {
      member.state = MEMBER_STATES.WAITING;
      swarm._saveMeta?.();
      swarm.emit('status', swarm.getStatus());
    }

    const record = {
      direction: 'inbound',
      channelType: parsed.channelType,
      swarmId: swarm.id,
      member: member.name,
      seq: msg.seq,
      sender: parsed.sender,
      time: new Date().toISOString()
    };
    this.deliveryLog.push(record);
    if (this.deliveryLog.length > 200) this.deliveryLog.shift();

    return { accepted: true, message: msg, sender: parsed.sender, channelType: parsed.channelType };
  }
}
