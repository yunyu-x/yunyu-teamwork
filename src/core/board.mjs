import { EventEmitter } from 'node:events';
import { DEFAULT_CONFIG, MESSAGE_KINDS } from './constants.mjs';

const MENTION_MEMBER_RE = /(?:^|[\s(（【\[,:;，：；])@([a-z][a-z0-9_-]*)/g;
const MENTION_CHANNEL_RE = /(?:^|[\s(（【\[,:;，：；])@#([a-z][a-z0-9_-]*)/g;
const SEQ_REF_RE = /(?:^|[\s(（【\[,:;，：；])#(\d+)\b/g;

/**
 * Parse @member, @#channel, @all mentions and #seq citations from board post text.
 */
export function parseMessageTokens(text) {
  const src = String(text || '');
  const memberMentions = new Set();
  const channelMentions = new Set();
  const refs = new Set();
  let broadcastAll = false;

  for (const m of src.matchAll(MENTION_CHANNEL_RE)) {
    const ch = m[1];
    if (ch && ch !== 'main') channelMentions.add(ch);
  }

  for (const m of src.matchAll(MENTION_MEMBER_RE)) {
    const name = m[1];
    if (!name) continue;
    if (name === 'all') {
      broadcastAll = true;
    } else {
      memberMentions.add(name);
    }
  }

  for (const m of src.matchAll(SEQ_REF_RE)) {
    const num = Number(m[1]);
    if (Number.isInteger(num) && num > 0) refs.add(num);
  }

  return {
    mentions: [...memberMentions],
    channelMentions: [...channelMentions],
    broadcastAll,
    refs: [...refs].sort((a, b) => a - b)
  };
}

/**
 * Append-only Shared Message Board supporting channels, @mention routing,
 * #seq cross-references, non-destructive translations, and graph snapshots.
 */
export class MessageBoard extends EventEmitter {
  constructor({ swarmId, storage = null, defaultLang = 'zh-CN' }) {
    super();
    this.swarmId = swarmId;
    this.storage = storage;
    this.defaultLang = defaultLang;
    this.messages = [];
    this.channels = new Map();
    this.subscriptions = new Map(); // memberName -> Set<channel>
    this.head = 0;
    this.done = false;
    this.doneSummary = null;

    for (const ch of DEFAULT_CONFIG.defaultChannels) {
      this.channels.set(ch.name, { ...ch, createdAt: new Date().toISOString() });
    }
  }

  /**
   * Rehydrate board state from append-only storage events.
   */
  replayFromStorage() {
    if (!this.storage) return;
    const events = this.storage.readEvents(this.swarmId);
    for (const ev of events) {
      if (ev.type === 'channel_create') {
        this.channels.set(ev.channel.name, { ...ev.channel });
      } else if (ev.type === 'channel_archive') {
        const ch = this.channels.get(ev.channelName);
        if (ch) ch.archived = true;
      } else if (ev.type === 'channel_sub') {
        this._ensureSubs(ev.member).add(ev.channelName);
      } else if (ev.type === 'channel_unsub') {
        this._ensureSubs(ev.member).delete(ev.channelName);
      } else if (ev.type === 'message') {
        this.messages.push(ev.message);
        this.head = Math.max(this.head, ev.message.seq);
        if (ev.message.kind === MESSAGE_KINDS.DONE) {
          this.done = true;
          this.doneSummary = ev.message.text;
        }
      } else if (ev.type === 'message_translation') {
        const msg = this.messages.find((m) => m.seq === ev.seq);
        if (msg) {
          msg.translations = msg.translations || {};
          msg.translations[ev.lang] = ev.text;
        }
      }
    }
  }

  _ensureSubs(member) {
    if (!this.subscriptions.has(member)) {
      this.subscriptions.set(member, new Set(['main']));
    }
    return this.subscriptions.get(member);
  }

  createChannel({ name, topic = '', creator = 'coordinator' }) {
    const clean = String(name || '').trim().toLowerCase().replace(/^#/, '');
    if (!/^[a-z][a-z0-9_-]*$/.test(clean)) {
      throw new Error(`非法频道名 "${name}"：仅支持小写字母开头，含数字、下划线或连字符`);
    }
    if (this.channels.has(clean)) {
      return this.channels.get(clean);
    }
    const channel = {
      name: clean,
      topic: topic || `工作区频道 #${clean}`,
      creator,
      archived: false,
      createdAt: new Date().toISOString()
    };
    this.channels.set(clean, channel);
    this.storage?.appendEvent(this.swarmId, { type: 'channel_create', channel });
    this.emit('channel', { op: 'create', channel });
    return channel;
  }

  archiveChannel(name) {
    const clean = String(name || '').trim().toLowerCase().replace(/^#/, '');
    if (clean === 'main') throw new Error('不允许归档主频道 main');
    const ch = this.channels.get(clean);
    if (!ch) throw new Error(`频道 #${clean} 不存在`);
    ch.archived = true;
    this.storage?.appendEvent(this.swarmId, { type: 'channel_archive', channelName: clean });
    this.emit('channel', { op: 'archive', channel: ch });
    return ch;
  }

  subscribe(member, channelName) {
    const clean = String(channelName || 'main').trim().toLowerCase().replace(/^#/, '');
    if (!this.channels.has(clean)) {
      this.createChannel({ name: clean, creator: 'system' });
    }
    const set = this._ensureSubs(member);
    if (!set.has(clean)) {
      set.add(clean);
      this.storage?.appendEvent(this.swarmId, { type: 'channel_sub', member, channelName: clean });
    }
    return [...set];
  }

  unsubscribe(member, channelName) {
    const clean = String(channelName || '').trim().toLowerCase().replace(/^#/, '');
    if (clean === 'main') return [...this._ensureSubs(member)];
    const set = this._ensureSubs(member);
    if (set.delete(clean)) {
      this.storage?.appendEvent(this.swarmId, { type: 'channel_unsub', member, channelName: clean });
    }
    return [...set];
  }

  getMemberChannels(member) {
    return [...this._ensureSubs(member)];
  }

  listChannels() {
    const counts = new Map();
    for (const set of this.subscriptions.values()) {
      for (const ch of set) counts.set(ch, (counts.get(ch) || 0) + 1);
    }
    return [...this.channels.values()].map((c) => ({
      ...c,
      subscribers: counts.get(c.name) || 0
    }));
  }

  /**
   * Post an immutable message to the board.
   */
  post({
    author,
    text,
    channel = 'main',
    kind = null,
    metadata = {},
    translations = null
  }) {
    const cleanChannel = String(channel || 'main').trim().toLowerCase().replace(/^#/, '');
    const chObj = this.channels.get(cleanChannel);
    if (!chObj) {
      throw new Error(`频道 #${cleanChannel} 不存在`);
    }
    if (chObj.archived) {
      throw new Error(`频道 #${cleanChannel} 已归档，禁止继续发帖`);
    }
    const body = String(text || '').trim();
    if (!body) {
      throw new Error('消息内容不能为空');
    }

    const parsed = parseMessageTokens(body);
    const isDonePost = body.startsWith('[done]') && !parsed.broadcastAll && parsed.mentions.length === 0;
    const resolvedKind =
      kind ||
      (isDonePost
        ? MESSAGE_KINDS.DONE
        : body.includes('[缺陷单]') || body.includes('[DEFECT]') || body.includes('P0')
          ? MESSAGE_KINDS.DEFECT
          : MESSAGE_KINDS.POST);

    const seq = this.head + 1;
    const message = {
      seq,
      swarmId: this.swarmId,
      channel: cleanChannel,
      author,
      kind: resolvedKind,
      text: body,
      mentions: parsed.mentions,
      channelMentions: parsed.channelMentions,
      broadcastAll: parsed.broadcastAll,
      refs: parsed.refs,
      metadata: { ...metadata },
      translations: translations ? { ...translations } : {},
      time: new Date().toISOString()
    };

    this.head = seq;
    this.messages.push(message);
    if (isDonePost) {
      this.done = true;
      this.doneSummary = body.replace(/^\[done\]\s*/i, '');
    }

    this.storage?.appendEvent(this.swarmId, { type: 'message', message });
    this.emit('message', message);
    return message;
  }

  /**
   * Non-destructively attach a localized display translation to an existing immutable message.
   */
  annotateTranslation(seq, lang, translatedText) {
    const msg = this.messages.find((m) => m.seq === Number(seq));
    if (!msg) throw new Error(`未找到序号 #${seq} 的消息`);
    msg.translations = msg.translations || {};
    msg.translations[lang] = String(translatedText || '').trim();
    this.storage?.appendEvent(this.swarmId, {
      type: 'message_translation',
      seq: msg.seq,
      lang,
      text: msg.translations[lang]
    });
    this.emit('translation', { seq: msg.seq, lang, text: msg.translations[lang], message: msg });
    return msg;
  }

  getMessage(seq) {
    return this.messages.find((m) => m.seq === Number(seq)) || null;
  }

  read({
    since = null,
    limit = 50,
    seqs = null,
    channel = null,
    member = null,
    kind = null,
    search = null
  } = {}) {
    if (Array.isArray(seqs) && seqs.length > 0) {
      const wanted = new Set(seqs.map(Number));
      return {
        messages: this.messages.filter((m) => wanted.has(m.seq)),
        head: this.head
      };
    }

    let list = this.messages;

    if (channel && channel !== '*') {
      const clean = String(channel).toLowerCase().replace(/^#/, '');
      list = list.filter((m) => m.channel === clean);
    } else if (member && channel !== '*') {
      const allowed = this._ensureSubs(member);
      list = list.filter(
        (m) =>
          allowed.has(m.channel) ||
          m.broadcastAll ||
          m.mentions.includes(member) ||
          m.mentions.some((mn) => member.startsWith(`${mn}-`))
      );
    }

    if (kind && kind !== 'all') {
      list = list.filter((m) => m.kind === kind);
    }

    if (search) {
      const q = String(search).toLowerCase();
      list = list.filter(
        (m) =>
          m.text.toLowerCase().includes(q) ||
          m.author.toLowerCase().includes(q) ||
          String(m.seq) === q.replace(/^#/, '') ||
          Object.values(m.translations || {}).some((t) => t.toLowerCase().includes(q))
      );
    }

    if (since !== null && since !== undefined) {
      const s = Number(since);
      list = list.filter((m) => m.seq > s);
      if (limit > 0) list = list.slice(0, limit);
    } else if (limit > 0) {
      list = list.slice(-limit);
    }

    return {
      messages: list,
      head: this.head
    };
  }

  /**
   * Build directed collaboration graph data up to a given sequence number for Graph + Timeline Replay UI.
   */
  buildGraph({ upToSeq = null, memberList = [], expandAll = false } = {}) {
    const maxSeq = upToSeq === null ? this.head : Math.min(Number(upToSeq), this.head);
    const slice = this.messages.filter((m) => m.seq <= maxSeq);
    const knownNames = new Set(memberList.map((m) => m.name));
    const activeNodes = new Set();
    const edgeMap = new Map();
    let broadcastCount = 0;

    for (const msg of slice) {
      activeNodes.add(msg.author);
      knownNames.add(msg.author);

      if (msg.broadcastAll) {
        broadcastCount++;
        if (expandAll) {
          for (const target of knownNames) {
            if (target === msg.author || target === 'monitor') continue;
            const key = `${msg.author}-->${target}::all`;
            const cur = edgeMap.get(key) || {
              from: msg.author,
              to: target,
              count: 0,
              viaAll: true,
              lastSeq: msg.seq
            };
            cur.count++;
            cur.lastSeq = msg.seq;
            edgeMap.set(key, cur);
          }
        }
      }

      const targets = new Set(msg.mentions);
      for (const chMention of msg.channelMentions || []) {
        for (const [mName, chSet] of this.subscriptions.entries()) {
          if (chSet.has(chMention) && mName !== msg.author) targets.add(mName);
        }
      }

      for (const rawTarget of targets) {
        const matched = [...knownNames].filter(
          (n) => n === rawTarget || n.startsWith(`${rawTarget}-`)
        );
        const resolved = matched.length > 0 ? matched : [rawTarget];
        for (const target of resolved) {
          if (target === msg.author) continue;
          activeNodes.add(target);
          knownNames.add(target);
          const key = `${msg.author}-->${target}::direct`;
          const cur = edgeMap.get(key) || {
            from: msg.author,
            to: target,
            count: 0,
            viaAll: false,
            lastSeq: msg.seq
          };
          cur.count++;
          cur.lastSeq = msg.seq;
          edgeMap.set(key, cur);
        }
      }
    }

    const memberIndex = new Map(memberList.map((m) => [m.name, m]));
    const nodes = [...knownNames].map((name) => {
      const info = memberIndex.get(name);
      return {
        id: name,
        role: info?.role || (name === 'coordinator' ? 'coordinator' : 'author'),
        state: info?.state || 'waiting',
        driver: info?.driver || 'external',
        activeInSlice: activeNodes.has(name),
        postCount: slice.filter((m) => m.author === name).length
      };
    });

    const currentMessage = slice.length > 0 ? slice[slice.length - 1] : null;
    return {
      head: this.head,
      upToSeq: maxSeq,
      totalMessages: this.messages.length,
      broadcastCount,
      nodes,
      edges: [...edgeMap.values()],
      currentMessage
    };
  }
}
