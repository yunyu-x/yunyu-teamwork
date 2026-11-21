import fs from 'node:fs';
import path from 'node:path';

/**
 * Append-only JSONL persistent storage for Swarm boards, metadata, and audit logs.
 * Supports both filesystem persistence and in-memory mode for tests.
 */
export class SwarmStorage {
  constructor({ dataDir = null, inMemory = false } = {}) {
    this.inMemory = inMemory || !dataDir;
    this.dataDir = dataDir ? path.resolve(dataDir) : null;
    this._memMeta = new Map();
    this._memEvents = new Map();
    this._memLogs = new Map();
    if (!this.inMemory) {
      fs.mkdirSync(this._swarmsRoot(), { recursive: true, mode: 0o700 });
    }
  }

  _swarmsRoot() {
    return path.join(this.dataDir, 'swarms');
  }

  _swarmDir(swarmId) {
    const safe = sanitizeId(swarmId);
    const root = path.resolve(this._swarmsRoot());
    const dir = path.resolve(root, safe);
    const rel = path.relative(root, dir);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`非法蜂群 ID "${swarmId}"`);
    }
    return dir;
  }

  _metaPath(swarmId) {
    return path.join(this._swarmDir(swarmId), 'meta.json');
  }

  _eventsPath(swarmId) {
    return path.join(this._swarmDir(swarmId), 'events.jsonl');
  }

  _logsPath(swarmId) {
    return path.join(this._swarmDir(swarmId), 'agent-logs.jsonl');
  }

  listSwarmIds() {
    if (this.inMemory) {
      return [...this._memMeta.keys()];
    }
    const root = this._swarmsRoot();
    if (!fs.existsSync(root)) return [];
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, 'meta.json')))
      .map((d) => d.name)
      .sort();
  }

  saveMeta(swarmId, meta) {
    if (this.inMemory) {
      this._memMeta.set(swarmId, structuredClone(meta));
      return;
    }
    const dir = this._swarmDir(swarmId);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${this._metaPath(swarmId)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(meta, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, this._metaPath(swarmId));
  }

  loadMeta(swarmId) {
    if (this.inMemory) {
      const m = this._memMeta.get(swarmId);
      return m ? structuredClone(m) : null;
    }
    const p = this._metaPath(swarmId);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  }

  appendEvent(swarmId, event) {
    const record = {
      ...event,
      recordedAt: event.recordedAt || new Date().toISOString()
    };
    if (this.inMemory) {
      if (!this._memEvents.has(swarmId)) this._memEvents.set(swarmId, []);
      this._memEvents.get(swarmId).push(structuredClone(record));
      return record;
    }
    const dir = this._swarmDir(swarmId);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.appendFileSync(this._eventsPath(swarmId), `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
    return record;
  }

  readEvents(swarmId) {
    if (this.inMemory) {
      return (this._memEvents.get(swarmId) || []).map((e) => structuredClone(e));
    }
    const p = this._eventsPath(swarmId);
    if (!fs.existsSync(p)) return [];
    const raw = fs.readFileSync(p, 'utf8').trim();
    if (!raw) return [];
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  appendAgentLog(swarmId, entry) {
    const record = {
      ...entry,
      time: entry.time || new Date().toISOString()
    };
    if (this.inMemory) {
      if (!this._memLogs.has(swarmId)) this._memLogs.set(swarmId, []);
      const list = this._memLogs.get(swarmId);
      list.push(structuredClone(record));
      if (list.length > 500) list.shift();
      return record;
    }
    const dir = this._swarmDir(swarmId);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(this._logsPath(swarmId), `${JSON.stringify(record)}\n`, 'utf8');
    return record;
  }

  readAgentLogs(swarmId, { member = null, limit = 150 } = {}) {
    let entries;
    if (this.inMemory) {
      entries = (this._memLogs.get(swarmId) || []).map((e) => structuredClone(e));
    } else {
      const p = this._logsPath(swarmId);
      if (!fs.existsSync(p)) return [];
      const raw = fs.readFileSync(p, 'utf8').trim();
      if (!raw) return [];
      entries = raw
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    }
    if (member) entries = entries.filter((e) => e.member === member);
    if (limit > 0) entries = entries.slice(-limit);
    return entries;
  }
}

export function sanitizeId(id) {
  const cleaned = String(id || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/^[-_]+/, '');
  if (!cleaned) {
    throw new Error(`非法标识符 "${id}"：不允许空值或路径穿越字符`);
  }
  return cleaned.slice(0, 80);
}
