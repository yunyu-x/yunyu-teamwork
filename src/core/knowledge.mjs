import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { KNOWLEDGE_CATEGORIES } from './constants.mjs';

const VALID_CATEGORIES = new Set(Object.values(KNOWLEDGE_CATEGORIES));

function sanitizeHttpUrl(rawUrl) {
  if (!rawUrl) return null;
  const trimmed = String(rawUrl).trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return trimmed;
    }
  } catch {}
  return null;
}

/**
 * Append-only Shared Knowledge & Research Vault persisted in `events.jsonl`.
 * Solves the multi-agent "stateless session amnesia" problem by giving all agents
 * a durable, searchable repository of Research Briefs, Frozen Specs, ADRs, and Pitfalls.
 */
export class KnowledgeVault extends EventEmitter {
  constructor({ swarmId, storage = null }) {
    super();
    this.swarmId = swarmId;
    this.storage = storage;
    this.entries = new Map();
    this._order = [];
  }

  replayFromStorage() {
    if (!this.storage) return;
    const events = this.storage.readEvents(this.swarmId);
    for (const ev of events) {
      if (ev.type === 'knowledge_add' && ev.entry?.id) {
        this.entries.set(ev.entry.id, structuredClone(ev.entry));
        if (!this._order.includes(ev.entry.id)) this._order.push(ev.entry.id);
      }
    }
  }

  addEntry({
    id = null,
    title,
    category = KNOWLEDGE_CATEGORIES.RESEARCH,
    summary = '',
    content = '',
    sources = [],
    tags = [],
    author = 'researcher',
    linkedIssueId = null,
    linkedSeq = null
  }) {
    const cleanTitle = String(title || '').trim();
    if (!cleanTitle) throw new Error('知识库条目标题不能为空');

    const entryId = id || `kb-${crypto.randomBytes(3).toString('hex')}`;
    const entry = {
      id: entryId,
      title: cleanTitle,
      category: VALID_CATEGORIES.has(category) ? category : KNOWLEDGE_CATEGORIES.RESEARCH,
      summary: String(summary || '').trim(),
      content: String(content || '').trim(),
      sources: Array.isArray(sources)
        ? sources
            .filter((s) => s && (s.title || s.url || s.path))
            .map((s) => ({
              title: String(s.title || s.path || s.url || '').trim(),
              url: sanitizeHttpUrl(s.url),
              path: s.path || null,
              snippet: String(s.snippet || '').slice(0, 260)
            }))
        : [],
      tags: [...new Set((Array.isArray(tags) ? tags : []).map((t) => String(t).trim().toLowerCase()).filter(Boolean))],
      author: author || 'researcher',
      linkedIssueId: linkedIssueId || null,
      linkedSeq: linkedSeq ?? null,
      createdAt: new Date().toISOString()
    };

    this.entries.set(entryId, entry);
    if (!this._order.includes(entryId)) this._order.push(entryId);
    this.storage?.appendEvent(this.swarmId, { type: 'knowledge_add', entry });
    this.emit('knowledge', { op: 'add', entry: structuredClone(entry) });
    return structuredClone(entry);
  }

  getEntry(id) {
    const item = this.entries.get(id);
    return item ? structuredClone(item) : null;
  }

  listEntries() {
    return this._order
      .map((id) => this.entries.get(id))
      .filter(Boolean)
      .reverse()
      .map((e) => structuredClone(e));
  }

  search({ q = '', category = 'all', tag = '', limit = 30 } = {}) {
    let list = this.listEntries();
    if (category && category !== 'all') {
      list = list.filter((e) => e.category === category);
    }
    if (tag) {
      const cleanTag = String(tag).trim().toLowerCase();
      list = list.filter((e) => (e.tags || []).includes(cleanTag));
    }
    const query = String(q || '').trim().toLowerCase();
    if (query) {
      const tokens = query.split(/\s+/).filter(Boolean);
      list = list.filter((e) => {
        const hay = [
          e.title,
          e.summary,
          e.content,
          e.author,
          (e.tags || []).join(' '),
          (e.sources || []).map((s) => `${s.title} ${s.url || ''} ${s.snippet || ''}`).join(' ')
        ]
          .join(' ')
          .toLowerCase();
        return tokens.every((tok) => hay.includes(tok));
      });
    }
    return limit > 0 ? list.slice(0, limit) : list;
  }
}
