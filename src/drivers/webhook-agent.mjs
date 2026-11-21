import crypto from 'node:crypto';
import { AgentDriver } from './base.mjs';

/**
 * Webhook HTTP Driver:
 * Bridges remote agents (LangGraph, CrewAI, AutoGen, Dify, n8n, custom microservices)
 * via HMAC-SHA256 signed JSON POST payloads.
 */
export class WebhookAgentDriver extends AgentDriver {
  constructor() {
    super('webhook', '远程 HTTP Webhook 智能体驱动（支持 LangGraph / Dify / n8n / 自定义微服务）');
  }

  async executeTurn({ swarm, member, triggerMessage, unreadMessages }) {
    const cfg = member.driverConfig || {};
    if (!cfg.url) {
      throw new Error(`成员 @${member.name} 的 webhook 驱动缺少 driverConfig.url`);
    }

    const payload = {
      event: 'agent.wakeup',
      swarmId: swarm.id,
      swarmTitle: swarm.title,
      member: {
        name: member.name,
        role: member.role,
        owns: member.owns,
        mustNotTouch: member.mustNotTouch,
        workspaceDir: member.workspaceDir,
        branch: member.branch
      },
      triggerMessage,
      unreadMessages
    };

    const body = JSON.stringify(payload);
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'Yunyu-Teamwork/0.4.0',
      ...(cfg.headers || {})
    };
    if (cfg.secret) {
      const sig = crypto.createHmac('sha256', cfg.secret).update(body).digest('hex');
      headers['X-Yunyu-Signature'] = `sha256=${sig}`;
    }

    const res = await fetch(cfg.url, {
      method: 'POST',
      headers,
      body
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Webhook 返回 HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = await res.json();
      if (json.async) {
        return { alreadyPosted: true };
      }
      return {
        reply: json.reply || json.text || null,
        channel: json.channel || triggerMessage.channel,
        kind: json.kind || null,
        metadata: json.metadata || {}
      };
    }

    const text = (await res.text()).trim();
    return text ? { reply: text, channel: triggerMessage.channel } : { alreadyPosted: true };
  }
}
