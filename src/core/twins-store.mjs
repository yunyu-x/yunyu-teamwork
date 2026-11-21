import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AUTONOMY_MODES, MEMBER_ROLES, WORKSPACE_MODES } from './constants.mjs';

const DEFAULT_ESCALATION_KEYWORDS = ['合并', '发布', '上线', '审批', '生产', '删除', '预算', '强推', '确认'];

/**
 * Persistent Personal Digital Twin Profile Library (`.yunyu/twins.json` or in-memory).
 * Allows users to configure personal digital twins once (persona, knowledge, IM/Bot bridge)
 * and attach them to any Swarm with one click.
 */
export class TwinsStore {
  constructor({ dataDir = null, inMemory = false } = {}) {
    this.inMemory = inMemory || !dataDir;
    this.dataDir = dataDir ? path.resolve(dataDir) : null;
    this._twins = new Map();
    if (!this.inMemory) {
      fs.mkdirSync(this.dataDir, { recursive: true });
      this._loadFromDisk();
    }
  }

  _filePath() {
    return path.join(this.dataDir, 'twins.json');
  }

  _loadFromDisk() {
    const p = this._filePath();
    if (!fs.existsSync(p)) return;
    try {
      const list = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item?.id) this._twins.set(item.id, item);
        }
      }
    } catch {}
  }

  _persist() {
    if (this.inMemory) return;
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmp = `${this._filePath()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify([...this._twins.values()], null, 2), 'utf8');
    fs.renameSync(tmp, this._filePath());
  }

  listTwins({ redactSecrets = false } = {}) {
    return [...this._twins.values()].map((t) => (redactSecrets ? this._redact(t) : structuredClone(t)));
  }

  getTwin(id, { redactSecrets = false } = {}) {
    const item = this._twins.get(id);
    if (!item) return null;
    return redactSecrets ? this._redact(item) : structuredClone(item);
  }

  saveTwin(input = {}) {
    const cleanName = String(input.name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-');
    if (!cleanName || !/^[a-z][a-z0-9_-]*$/.test(cleanName)) {
      throw new Error(`数字分身成员名 "${input.name}" 非法：须以小写字母开头，仅含数字、下划线或连字符`);
    }

    const id = String(input.id || '').trim() || `twin-${cleanName}-${crypto.randomBytes(2).toString('hex')}`;
    const existing = this._twins.get(id);
    const now = new Date().toISOString();

    const keywords = Array.isArray(input.escalationKeywords)
      ? input.escalationKeywords.map((s) => String(s).trim()).filter(Boolean)
      : typeof input.escalationKeywords === 'string' && input.escalationKeywords.trim()
        ? input.escalationKeywords.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean)
        : existing?.escalationKeywords || DEFAULT_ESCALATION_KEYWORDS;

    const record = {
      id,
      name: cleanName,
      ownerName: String(input.ownerName || input.owner || cleanName).trim(),
      persona: String(input.persona || '专业务实、表达简洁、注重工程可靠性').trim(),
      knowledge: String(input.knowledge || '').trim(),
      autonomyMode: Object.values(AUTONOMY_MODES).includes(input.autonomyMode)
        ? input.autonomyMode
        : existing?.autonomyMode || AUTONOMY_MODES.HYBRID,
      backendDriver: input.backendDriver || existing?.backendDriver || 'builtin',
      model: input.model || existing?.model || 'digital-twin-v1',
      escalationKeywords: keywords,
      mirrorAutoReplyToIm: input.mirrorAutoReplyToIm !== false,
      owns: Array.isArray(input.owns) ? input.owns : existing?.owns || ['docs/**'],
      mustNotTouch: Array.isArray(input.mustNotTouch) ? input.mustNotTouch : existing?.mustNotTouch || ['src/**'],
      channels: Array.isArray(input.channels) && input.channels.length ? input.channels : existing?.channels || ['main'],
      channel: input.channel ? { ...(existing?.channel || {}), ...input.channel } : existing?.channel || null,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };

    this._twins.set(id, record);
    this._persist();
    return structuredClone(record);
  }

  deleteTwin(id) {
    const existed = this._twins.delete(id);
    if (existed) this._persist();
    return existed;
  }

  /**
   * Convert a persisted Digital Twin profile into a Swarm `addMember()` specification.
   */
  toMemberSpec(twin, overrides = {}) {
    const profile = typeof twin === 'string' ? this.getTwin(twin) : twin;
    if (!profile) throw new Error(`未找到数字分身配置 "${twin}"`);
    const brief =
      overrides.brief ||
      `【个人数字分身】归属人：${profile.ownerName}。风格人设：${profile.persona}${profile.knowledge ? `。个人知识备注：${profile.knowledge}` : ''}。托管策略：${profile.autonomyMode}。`;

    return {
      name: overrides.name || profile.name,
      role: MEMBER_ROLES.DIGITAL_TWIN,
      driver: 'digital-twin',
      model: overrides.model || profile.model || 'digital-twin-v1',
      workspace: WORKSPACE_MODES.INHERIT,
      channels: overrides.channels || profile.channels || ['main'],
      owns: overrides.owns || profile.owns || ['docs/**'],
      mustNotTouch: overrides.mustNotTouch || profile.mustNotTouch || ['src/**'],
      brief,
      postBrief: overrides.postBrief ?? false,
      driverConfig: {
        twinId: profile.id,
        ownerName: profile.ownerName,
        persona: profile.persona,
        knowledge: profile.knowledge,
        autonomyMode: profile.autonomyMode,
        backendDriver: profile.backendDriver,
        escalationKeywords: profile.escalationKeywords,
        mirrorAutoReplyToIm: profile.mirrorAutoReplyToIm,
        channel: profile.channel ? { ...profile.channel } : null,
        ...(overrides.driverConfig || {})
      }
    };
  }

  _redact(twin) {
    const copy = structuredClone(twin);
    if (copy.channel) {
      for (const [k, v] of Object.entries(copy.channel)) {
        if (k === 'webhookUrl' && typeof v === 'string' && v) {
          try {
            const u = new URL(v);
            for (const pk of [...u.searchParams.keys()]) {
              if (/(key|token|secret|password|auth)/i.test(pk)) u.searchParams.set(pk, '***');
            }
            copy.channel[k] = u.toString();
          } catch {
            copy.channel[k] = '***';
          }
        } else if (/(key|token|secret|password|auth)/i.test(k) && v) {
          copy.channel[k] = '***';
        }
      }
    }
    return copy;
  }
}
