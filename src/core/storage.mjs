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
    if (!this.inMemory) {
      fs.mkdirSync(this._swarmsRoot(), { recursive: true });
    }
  }

  _swarmsRoot() {
    return path.join(this.dataDir, 'swarms');
  }

  _swarmDir(swarmId) {
    return path.join(this._swarmsRoot(), sanitizeId(swarmId));
  }

  _metaPath(swarmId) {
    return path.join(this._swarmDir(swarmId), 'meta.json');
  }

  _eventsPath(swarmId) {
    return path.join(this._swarmDir(swarmId), 'events.jsonl');
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
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this._metaPath(swarmId)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(meta, null, 2), 'utf8');
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
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(this._eventsPath(swarmId), `${JSON.stringify(record)}\n`, 'utf8');
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
      .map((line) => JSON.parse(line));
  }
}

export function sanitizeId(id) {
  return String(id).replace(/[^a-zA-Z0-9._-]/g, '_');
}
