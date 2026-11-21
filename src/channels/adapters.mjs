import crypto from 'node:crypto';
import { APP_VERSION } from '../core/constants.mjs';

const REPLAY_WINDOW_SEC = 300;

function isFreshTimestampSec(tsSec) {
  const n = Number(tsSec);
  if (!Number.isFinite(n)) return false;
  return Math.abs(Math.floor(Date.now() / 1000) - n) <= REPLAY_WINDOW_SEC;
}

function isFreshTimestampMs(tsMs) {
  const n = Number(tsMs);
  if (!Number.isFinite(n)) return false;
  return Math.abs(Date.now() - n) <= REPLAY_WINDOW_SEC * 1000;
}

function safeEq(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ba.length !== bb.length || ba.length === 0) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function getHeader(headers = {}, key) {
  const target = key.toLowerCase();
  for (const [k, v] of Object.entries(headers || {})) {
    if (k.toLowerCase() === target) return String(v ?? '');
  }
  return '';
}

function parseJsonSafe(raw) {
  if (typeof raw === 'object' && raw !== null) return raw;
  try {
    return JSON.parse(String(raw || '{}'));
  } catch {
    return {};
  }
}

/**
 * Zero-dependency Communication Channel Adapters for Personal Digital Twins:
 * Feishu/Lark, WeCom, DingTalk, Telegram, Slack/Discord, and Generic Webhook (OneBot/QQ/Matrix/Email/Custom IM).
 */
export const CHANNEL_ADAPTERS = Object.freeze({
  feishu: {
    id: 'feishu',
    name: '飞书 / Lark 机器人',
    description: '支持飞书群自定义机器人 Webhook（HMAC-SHA256 签名）与飞书事件订阅入站回调。',
    fields: [
      { key: 'webhookUrl', label: '飞书机器人 Webhook URL', placeholder: 'https://open.feishu.cn/open-apis/bot/v2/hook/...' },
      { key: 'secret', label: '签名密钥 (可选)', type: 'password', placeholder: '飞书安全设置中的签名校验密钥' },
      { key: 'inboundToken', label: '事件订阅 Verification Token (可选)', type: 'password', placeholder: '用于入站回调校验' }
    ],
    buildOutbound(config, payload) {
      if (!config?.webhookUrl) throw new Error('飞书通道缺少 webhookUrl');
      const timestamp = String(Math.floor(Date.now() / 1000));
      const title = payload.title || `云驭协同 · @${payload.member || 'digital-twin'}`;
      const body = {
        msg_type: 'post',
        content: {
          post: {
            zh_cn: {
              title,
              content: [
                [{ tag: 'text', text: payload.text || '' }],
                ...(payload.hint ? [[{ tag: 'text', text: `\n${payload.hint}` }]] : [])
              ]
            }
          }
        }
      };
      if (config.secret) {
        const stringToSign = `${timestamp}\n${config.secret}`;
        body.timestamp = timestamp;
        body.sign = crypto.createHmac('sha256', stringToSign).update('').digest('base64');
      }
      return {
        url: config.webhookUrl,
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body)
      };
    },
    parseInbound(headers, rawBody, config = {}) {
      const data = parseJsonSafe(rawBody);
      if (data.type === 'url_verification' && data.challenge) {
        if (config.inboundToken && !safeEq(data.token, config.inboundToken)) {
          return { accepted: false, statusCode: 401, reason: '飞书 Verification Token 校验失败' };
        }
        return { accepted: false, challengeResponse: { challenge: data.challenge } };
      }
      const token = data.header?.token || data.token || getHeader(headers, 'x-feishu-token');
      if (config.inboundToken && !safeEq(token, config.inboundToken)) {
        return { accepted: false, statusCode: 401, reason: '飞书入站 Token 校验失败' };
      }
      let text = '';
      if (data.event?.message?.content) {
        const contentObj = parseJsonSafe(data.event.message.content);
        text = contentObj.text || String(data.event.message.content);
      } else {
        text = data.text || data.content || '';
      }
      text = String(text).trim();
      if (!text) return { accepted: false, reason: '飞书回调缺少文本消息内容' };
      const sender =
        data.event?.sender?.sender_id?.open_id ||
        data.event?.sender?.sender_id?.user_id ||
        data.sender ||
        'feishu-user';
      return { accepted: true, sender, text, channelType: 'feishu', raw: data };
    }
  },

  wecom: {
    id: 'wecom',
    name: '企业微信机器人',
    description: '支持企业微信群机器人 Markdown/文本推送与企业自建应用/桥接回调接入。',
    fields: [
      { key: 'webhookUrl', label: '企业微信机器人 Webhook URL', placeholder: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...' },
      { key: 'inboundToken', label: '入站校验 Token (可选)', type: 'password', placeholder: 'X-Yunyu-Token / body.token' }
    ],
    buildOutbound(config, payload) {
      if (!config?.webhookUrl) throw new Error('企业微信通道缺少 webhookUrl');
      const title = payload.title || `云驭协同 · @${payload.member || 'digital-twin'}`;
      const md = [`### ${title}`, payload.text || '', payload.hint ? `> ${payload.hint}` : null]
        .filter(Boolean)
        .join('\n\n');
      return {
        url: config.webhookUrl,
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          msgtype: 'markdown',
          markdown: { content: md }
        })
      };
    },
    parseInbound(headers, rawBody, config = {}) {
      const data = parseJsonSafe(rawBody);
      const token = getHeader(headers, 'x-yunyu-token') || data.token || '';
      if (config.inboundToken && !safeEq(token, config.inboundToken)) {
        return { accepted: false, statusCode: 401, reason: '企业微信入站 Token 校验失败' };
      }
      const text = String(data.text?.content || data.text || data.Content || data.content || '').trim();
      if (!text) return { accepted: false, reason: '企业微信回调缺少文本内容' };
      const sender = data.sender || data.FromUserName || data.from || 'wecom-user';
      return { accepted: true, sender, text, channelType: 'wecom', raw: data };
    }
  },

  dingtalk: {
    id: 'dingtalk',
    name: '钉钉机器人',
    description: '支持钉钉群机器人自动 HMAC-SHA256 加签 Markdown 推送与 Outgoing Webhook 回调。',
    fields: [
      { key: 'webhookUrl', label: '钉钉机器人 Webhook URL', placeholder: 'https://oapi.dingtalk.com/robot/send?access_token=...' },
      { key: 'secret', label: '加签密钥 SEC... (可选)', type: 'password', placeholder: 'SEC...' },
      { key: 'inboundToken', label: 'Outgoing 回调 Token (可选)', type: 'password', placeholder: '钉钉机器人回调 token' }
    ],
    buildOutbound(config, payload) {
      if (!config?.webhookUrl) throw new Error('钉钉通道缺少 webhookUrl');
      const u = new URL(config.webhookUrl);
      if (config.secret) {
        const timestamp = String(Date.now());
        const stringToSign = `${timestamp}\n${config.secret}`;
        const sign = crypto.createHmac('sha256', config.secret).update(stringToSign).digest('base64');
        u.searchParams.set('timestamp', timestamp);
        u.searchParams.set('sign', sign);
      }
      const title = payload.title || `云驭协同 · @${payload.member || 'digital-twin'}`;
      const md = [`### ${title}`, payload.text || '', payload.hint ? `> ${payload.hint}` : null]
        .filter(Boolean)
        .join('\n\n');
      return {
        url: u.toString(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          msgtype: 'markdown',
          markdown: { title, text: md }
        })
      };
    },
    parseInbound(headers, rawBody, config = {}) {
      const data = parseJsonSafe(rawBody);
      const token = getHeader(headers, 'token') || getHeader(headers, 'x-dingtalk-token') || data.token || '';
      if (config.inboundToken && !safeEq(token, config.inboundToken)) {
        return { accepted: false, statusCode: 401, reason: '钉钉入站 Token 校验失败' };
      }
      if (config.secret) {
        const ts = getHeader(headers, 'timestamp');
        const sign = getHeader(headers, 'sign');
        if (!ts || !sign) {
          return { accepted: false, statusCode: 401, reason: '钉钉 Outgoing 请求缺少 timestamp 或 sign 签名头' };
        }
        if (!isFreshTimestampMs(ts)) {
          return { accepted: false, statusCode: 401, reason: '钉钉请求时间戳已过期（防重放拦截）' };
        }
        const expected = crypto.createHmac('sha256', config.secret).update(`${ts}\n${config.secret}`).digest('base64');
        if (!safeEq(sign, expected)) {
          return { accepted: false, statusCode: 401, reason: '钉钉 Outgoing 签名校验失败' };
        }
      }
      const text = String(data.text?.content || data.text || data.content || '').trim();
      if (!text) return { accepted: false, reason: '钉钉回调缺少文本内容' };
      const sender = data.senderNick || data.senderId || data.sender || 'dingtalk-user';
      return { accepted: true, sender, text, channelType: 'dingtalk', raw: data };
    }
  },

  telegram: {
    id: 'telegram',
    name: 'Telegram Bot',
    description: '直接对接 Telegram Bot API sendMessage 与 Telegram Webhook Secret Token 回调。',
    fields: [
      { key: 'botToken', label: 'Bot Token', type: 'password', placeholder: '123456:ABC-DEF...' },
      { key: 'chatId', label: 'Chat ID', placeholder: '个人或群组 Chat ID' },
      { key: 'apiBaseUrl', label: 'API Base URL (可选代理)', placeholder: 'https://api.telegram.org' },
      { key: 'inboundToken', label: 'Webhook Secret Token (可选)', type: 'password', placeholder: 'X-Telegram-Bot-Api-Secret-Token' }
    ],
    buildOutbound(config, payload) {
      const base = (config?.apiBaseUrl || 'https://api.telegram.org').replace(/\/+$/, '');
      const url = config?.webhookUrl || (config?.botToken ? `${base}/bot${config.botToken}/sendMessage` : '');
      if (!url) throw new Error('Telegram 通道缺少 botToken 或 webhookUrl');
      if (!config?.chatId && !config?.webhookUrl) throw new Error('Telegram 通道缺少 chatId');
      const title = payload.title || `云驭协同 · @${payload.member || 'digital-twin'}`;
      const text = [title, payload.text || '', payload.hint || ''].filter(Boolean).join('\n\n');
      return {
        url,
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          chat_id: config.chatId,
          text
        })
      };
    },
    parseInbound(headers, rawBody, config = {}) {
      const secretHdr = getHeader(headers, 'x-telegram-bot-api-secret-token');
      if (config.inboundToken && !safeEq(secretHdr, config.inboundToken)) {
        return { accepted: false, statusCode: 401, reason: 'Telegram Secret Token 校验失败' };
      }
      const data = parseJsonSafe(rawBody);
      const msg = data.message || data.edited_message || data.channel_post || {};
      const text = String(msg.text || data.text || '').trim();
      if (!text) return { accepted: false, reason: 'Telegram 回调缺少文本内容' };
      const sender = msg.from?.username || msg.from?.first_name || data.sender || 'telegram-user';
      return { accepted: true, sender, text, channelType: 'telegram', raw: data };
    }
  },

  slack: {
    id: 'slack',
    name: 'Slack / Discord Webhook',
    description: '支持 Slack Incoming Webhook / Discord 兼容推送及 Slack Events API HMAC-SHA256 验签。',
    fields: [
      { key: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://hooks.slack.com/services/...' },
      { key: 'secret', label: 'Slack Signing Secret (可选)', type: 'password', placeholder: '用于 X-Slack-Signature 验签' }
    ],
    buildOutbound(config, payload) {
      if (!config?.webhookUrl) throw new Error('Slack/Discord 通道缺少 webhookUrl');
      const title = payload.title || `Yunyu Teamwork · @${payload.member || 'digital-twin'}`;
      const text = [`*${title}*`, payload.text || '', payload.hint ? `_${payload.hint}_` : null]
        .filter(Boolean)
        .join('\n\n');
      return {
        url: config.webhookUrl,
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ text, content: text })
      };
    },
    parseInbound(headers, rawBody, config = {}) {
      const rawStr = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody || {});
      if (config.secret) {
        const ts = getHeader(headers, 'x-slack-request-timestamp');
        const sig = getHeader(headers, 'x-slack-signature');
        if (!ts || !sig || !isFreshTimestampSec(ts)) {
          return { accepted: false, statusCode: 401, reason: 'Slack 签名头缺失或时间戳已过期' };
        }
        const expected = `v0=${crypto.createHmac('sha256', config.secret).update(`v0:${ts}:${rawStr}`).digest('hex')}`;
        if (!safeEq(sig, expected)) {
          return { accepted: false, statusCode: 401, reason: 'Slack X-Slack-Signature 验签失败' };
        }
      }
      const data = parseJsonSafe(rawStr);
      if (data.type === 'url_verification' && data.challenge) {
        return { accepted: false, challengeResponse: { challenge: data.challenge } };
      }
      if (data.event?.bot_id) {
        return { accepted: false, reason: '忽略 Slack 机器人自身回声消息' };
      }
      const text = String(data.event?.text || data.text || data.content || '').trim();
      if (!text) return { accepted: false, reason: 'Slack 回调缺少文本内容' };
      const sender = data.event?.user || data.user_name || data.sender || 'slack-user';
      return { accepted: true, sender, text, channelType: 'slack', raw: data };
    }
  },

  'generic-webhook': {
    id: 'generic-webhook',
    name: '通用 IM / 机器人 / HTTP Bridge（QQ OneBot / Matrix / 自建 IM）',
    description: '标准 HMAC-SHA256 签名 JSON 双向通道，可零成本接入任何企业内网 IM、QQ 机器人或自动化工作流。',
    fields: [
      { key: 'webhookUrl', label: '出站回调 URL', placeholder: 'http://127.0.0.1:8080/im-hook' },
      { key: 'secret', label: 'HMAC-SHA256 签名密钥 (可选)', type: 'password', placeholder: '用于 X-Yunyu-Signature 双向验签' },
      { key: 'inboundToken', label: '或 Bearer/Token 校验值 (可选)', type: 'password', placeholder: 'X-Yunyu-Token' }
    ],
    buildOutbound(config, payload) {
      if (!config?.webhookUrl) throw new Error('通用 Webhook 通道缺少 webhookUrl');
      const bodyObj = {
        event: 'digital_twin.outbound',
        time: new Date().toISOString(),
        ...payload
      };
      const body = JSON.stringify(bodyObj);
      const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'User-Agent': `Yunyu-Teamwork/${APP_VERSION}`,
        ...(config.headers || {})
      };
      if (config.secret) {
        const sig = crypto.createHmac('sha256', config.secret).update(body).digest('hex');
        headers['X-Yunyu-Signature'] = `sha256=${sig}`;
      }
      return { url: config.webhookUrl, method: 'POST', headers, body };
    },
    parseInbound(headers, rawBody, config = {}) {
      const rawStr = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody || {});
      if (config.secret) {
        const sig = getHeader(headers, 'x-yunyu-signature');
        const expected = `sha256=${crypto.createHmac('sha256', config.secret).update(rawStr).digest('hex')}`;
        if (!safeEq(sig, expected)) {
          return { accepted: false, statusCode: 401, reason: '通用 IM Webhook X-Yunyu-Signature 验签失败' };
        }
      } else if (config.inboundToken) {
        const tok = getHeader(headers, 'x-yunyu-token') || getHeader(headers, 'authorization').replace(/^Bearer\s+/i, '');
        if (!safeEq(tok, config.inboundToken)) {
          return { accepted: false, statusCode: 401, reason: '通用 IM Webhook Token 校验失败' };
        }
      }
      const data = parseJsonSafe(rawStr);
      const text = String(data.text || data.message || data.raw_message || data.content || '').trim();
      if (!text) return { accepted: false, reason: '入站消息缺少 text/message 内容' };
      const sender = data.sender || data.user || data.user_id || 'im-user';
      return { accepted: true, sender: String(sender), text, channelType: 'generic-webhook', raw: data };
    }
  }
});

export function listChannelTypes() {
  return Object.values(CHANNEL_ADAPTERS).map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description,
    fields: a.fields
  }));
}
