import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import { APP_VERSION } from '../core/constants.mjs';
import { isPrivateIpOrHost } from '../core/research.mjs';

const SENSITIVE_ENV_RE = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|COOKIE|AUTH|PRIVATE|CREDENTIAL|BEARER|DATABASE_URL|POSTGRES|REDIS|PROXY|SSH_AUTH_SOCK|AWS_SESSION)/i;
const BLOCKED_EXTRA_ENV = new Set(['NODE_OPTIONS', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH']);
const FORBIDDEN_HTTP_HEADERS = new Set(['host', 'content-length', 'transfer-encoding', 'connection', 'cookie', 'content-type']);
const WIN_SHELL_META_RE = /[&|<>^%!\r\n"`]/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const MAX_HTTP_BODY_BYTES = 2 * 1024 * 1024;
const MAX_STDIO_LINE_BYTES = 2 * 1024 * 1024;

function isLoopbackIp(ip) {
  const clean = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (clean === '::1' || clean === '::ffff:127.0.0.1') return true;
  return clean.startsWith('127.');
}

function killProcessTree(child) {
  if (!child || !child.pid) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {}
    }
    const hard = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {}
      }
    }, 1000);
    if (typeof hard.unref === 'function') hard.unref();
  }
}

function buildSafeServerEnv(extraEnv = {}) {
  const clean = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === 'NODE_TEST_CONTEXT') continue;
    if (SENSITIVE_ENV_RE.test(k)) continue;
    clean[k] = v;
  }
  for (const [k, v] of Object.entries(extraEnv || {})) {
    if (typeof v === 'string' && !BLOCKED_EXTRA_ENV.has(k.toUpperCase())) clean[k] = v;
  }
  return clean;
}

function sanitizeHttpHeaders(rawHeaders = {}) {
  const safe = {};
  for (const [k, v] of Object.entries(rawHeaders || {})) {
    const key = String(k || '').trim();
    const val = String(v ?? '');
    if (!key || FORBIDDEN_HTTP_HEADERS.has(key.toLowerCase())) continue;
    if (/[\r\n\0]/.test(key) || /[\r\n\0]/.test(val)) continue;
    safe[key] = val;
  }
  return safe;
}

async function readLimitedText(res, maxBytes = MAX_HTTP_BODY_BYTES) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const txt = await res.text();
    if (Buffer.byteLength(txt, 'utf8') > maxBytes) {
      throw new Error(`MCP HTTP 响应体超出 ${maxBytes} 字节上限`);
    }
    return txt;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {}
      throw new Error(`MCP HTTP 响应体超出 ${maxBytes} 字节上限`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function normalizeSchema(rawSchema) {
  if (!rawSchema || typeof rawSchema !== 'object' || Array.isArray(rawSchema)) {
    return { type: 'object', properties: {} };
  }
  return {
    ...rawSchema,
    type: rawSchema.type || 'object',
    properties: rawSchema.properties && typeof rawSchema.properties === 'object' ? rawSchema.properties : {}
  };
}

function buildNamespacedToolName(serverId, toolName) {
  const s = String(serverId).replace(/[^a-zA-Z0-9_]/g, '_');
  const t = String(toolName).replace(/[^a-zA-Z0-9_-]/g, '_');
  const base = `mcp__${s}__${t}`;
  if (base.length <= 64 && !/[-.]/.test(serverId)) return base;
  const hash = crypto.createHash('sha1').update(`${serverId}\0${toolName}`).digest('hex').slice(0, 6);
  return `${base.slice(0, 57)}_${hash}`;
}

function redactServerForPublic(srv) {
  const maskedHeaders = {};
  for (const [k, v] of Object.entries(srv.headers || {})) {
    maskedHeaders[k] = SENSITIVE_ENV_RE.test(k) ? '***' : v;
  }
  return {
    id: srv.id,
    pluginId: srv.pluginId,
    transport: srv.transport,
    description: srv.description || '',
    command: srv.command || null,
    args: Array.isArray(srv.args) ? [...srv.args] : [],
    url: srv.url || null,
    headers: maskedHeaders,
    envKeys: Object.keys(srv.env || {}),
    trusted: Boolean(srv.trusted),
    enabled: srv.enabled !== false,
    status: srv.status || 'disconnected',
    lastError: srv.lastError || null,
    serverInfo: srv.serverInfo || null,
    tools: (srv.tools || []).map((t) => ({ name: t.name, description: t.description || '', inputSchema: normalizeSchema(t.inputSchema) })),
    resources: (srv.resources || []).map((r) => ({ uri: r.uri, name: r.name || r.uri }))
  };
}

/**
 * Zero-dependency External MCP Client Manager (stdio + HTTP JSON-RPC 2.0):
 * Connects to plugin-declared or custom MCP servers with SSRF/DNS/redirect guards,
 * per-server failure isolation, trust gating, env secret isolation, and dynamic tool bridging.
 */
export class McpClientManager {
  constructor({ allowStdio = false, allowPrivateHttp = false, allowLoopbackHttp = true, timeoutMs = 12_000 } = {}) {
    this.allowStdio = Boolean(allowStdio);
    this.allowPrivateHttp = Boolean(allowPrivateHttp);
    this.allowLoopbackHttp = Boolean(allowLoopbackHttp);
    this.timeoutMs = timeoutMs;
    this.servers = new Map();
    this._nextRpcId = 1;
  }

  clearPluginServers(pluginId) {
    for (const [id, srv] of this.servers.entries()) {
      if (srv.pluginId === pluginId) {
        this._teardownRuntime(srv);
        this.servers.delete(id);
      }
    }
  }

  unregisterServer(id) {
    const srv = this.servers.get(id);
    if (!srv) return false;
    this._teardownRuntime(srv);
    this.servers.delete(id);
    return true;
  }

  registerServer(spec) {
    const id = String(spec?.id || '').trim();
    if (!id) throw new Error('MCP Server 缺少 id');
    const existing = this.servers.get(id);
    if (existing) this._teardownRuntime(existing);

    const transport = spec.transport || (spec.url ? 'http' : 'stdio');
    if (transport === 'http') {
      if (!spec.url) throw new Error('HTTP MCP Server 缺少 url');
      let parsed;
      try {
        parsed = new URL(String(spec.url));
      } catch {
        throw new Error(`非法 MCP HTTP URL: "${spec.url}"`);
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error(`MCP HTTP 仅允许 http/https 协议: ${parsed.protocol}`);
      }
    }

    const fingerprint = JSON.stringify({
      pluginId: spec.pluginId || 'custom',
      transport,
      command: spec.command || null,
      args: Array.isArray(spec.args) ? spec.args.map(String) : [],
      url: spec.url || null,
      headers: spec.headers || {},
      env: spec.env || {},
      trusted: Boolean(spec.trusted),
      enabled: spec.enabled !== false
    });

    const record = {
      id,
      pluginId: spec.pluginId || 'custom',
      transport,
      description: spec.description || '',
      command: spec.command || null,
      args: Array.isArray(spec.args) ? spec.args.map(String) : [],
      cwd: spec.cwd || null,
      url: spec.url || null,
      headers: spec.headers && typeof spec.headers === 'object' ? { ...spec.headers } : {},
      env: spec.env && typeof spec.env === 'object' ? { ...spec.env } : {},
      trusted: Boolean(spec.trusted),
      enabled: spec.enabled !== false,
      status: 'disconnected',
      lastError: null,
      serverInfo: null,
      tools: [],
      resources: [],
      _fingerprint: fingerprint,
      _proc: null,
      _stdoutBuf: '',
      _stderrTail: '',
      _attemptSeq: 0,
      _connectPromise: null,
      _pending: new Map()
    };
    this.servers.set(id, record);
    return redactServerForPublic(record);
  }

  getServerFingerprint(id) {
    return this.servers.get(id)?._fingerprint || null;
  }

  getServer(id) {
    const srv = this.servers.get(id);
    return srv ? redactServerForPublic(srv) : null;
  }

  listServers() {
    return [...this.servers.values()].map(redactServerForPublic);
  }

  getAllDiscoveredTools() {
    const out = [];
    const seenNames = new Set();
    for (const srv of this.servers.values()) {
      if (!srv.enabled || srv.status !== 'connected') continue;
      for (const tool of srv.tools || []) {
        let namespacedName = buildNamespacedToolName(srv.id, tool.name);
        if (seenNames.has(namespacedName)) {
          const hash = crypto.createHash('sha1').update(`${srv.id}:${tool.name}:${seenNames.size}`).digest('hex').slice(0, 6);
          namespacedName = `${namespacedName.slice(0, 57)}_${hash}`;
        }
        seenNames.add(namespacedName);
        out.push({
          namespacedName,
          serverId: srv.id,
          toolName: tool.name,
          description: tool.description || '',
          inputSchema: normalizeSchema(tool.inputSchema)
        });
      }
    }
    return out;
  }

  _teardownRuntime(srv, { clearMetadata = false } = {}) {
    if (!srv) return;
    if (srv._pending) {
      for (const p of srv._pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error(`MCP Server "${srv.id}" 已断开连接`));
      }
      srv._pending.clear();
    }
    if (srv._proc) {
      const proc = srv._proc;
      srv._proc = null;
      killProcessTree(proc);
    }
    srv._stdoutBuf = '';
    if (clearMetadata) {
      srv.tools = [];
      srv.resources = [];
      srv.serverInfo = null;
    }
    srv.status = 'disconnected';
  }

  async _validateHttpUrl(rawUrl) {
    const parsed = new URL(String(rawUrl));
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`MCP HTTP 仅允许 http/https 协议: ${parsed.protocol}`);
    }
    if (this.allowPrivateHttp) return parsed;

    const host = parsed.hostname.toLowerCase();
    const isExplicitLoopback = LOOPBACK_HOSTS.has(host) || isLoopbackIp(host);
    if (isExplicitLoopback && this.allowLoopbackHttp) {
      return parsed;
    }
    if (isPrivateIpOrHost(host)) {
      throw new Error(`安全拦截：禁止连接私有/元数据地址 MCP HTTP 服务 ${parsed.hostname}`);
    }

    let resolved = [];
    try {
      resolved = await dns.lookup(host, { all: true });
    } catch (err) {
      throw new Error(`MCP HTTP 主机 DNS 解析失败 (${host}): ${err.message}`);
    }
    for (const rec of resolved) {
      if (isLoopbackIp(rec.address) && this.allowLoopbackHttp) continue;
      if (isPrivateIpOrHost(rec.address)) {
        throw new Error(`安全拦截：MCP HTTP 主机 ${host} 解析到受限内网地址 ${rec.address}`);
      }
    }
    return parsed;
  }

  async _sendRpc(srv, method, params = {}, { isNotification = false } = {}) {
    if (srv.transport === 'http') {
      const parsed = await this._validateHttpUrl(srv.url);
      const id = isNotification ? undefined : this._nextRpcId++;
      const payload = isNotification
        ? { jsonrpc: '2.0', method, params }
        : { jsonrpc: '2.0', id, method, params };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(parsed.toString(), {
          method: 'POST',
          redirect: 'manual',
          headers: {
            ...sanitizeHttpHeaders(srv.headers),
            'Content-Type': 'application/json',
            'User-Agent': `Yunyu-Teamwork-MCP-Client/${APP_VERSION}`
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        if (res.status >= 300 && res.status < 400) {
          await res.body?.cancel?.().catch(() => {});
          throw new Error(`安全拦截：MCP HTTP 禁止自动跟随重定向 (HTTP ${res.status})`);
        }
        if (!res.ok) {
          await res.body?.cancel?.().catch(() => {});
          throw new Error(`MCP HTTP ${res.status}`);
        }
        if (isNotification) {
          await res.body?.cancel?.().catch(() => {});
          return null;
        }
        const text = await readLimitedText(res, MAX_HTTP_BODY_BYTES);
        const json = JSON.parse(text);
        if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
        return json.result;
      } finally {
        clearTimeout(timer);
      }
    }

    // stdio transport
    if (!srv._proc || srv._proc.killed || srv._proc.exitCode !== null || srv._proc.signalCode !== null) {
      throw new Error(`MCP stdio 进程 "${srv.id}" 未运行或已退出`);
    }
    if (isNotification) {
      try {
        srv._proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
      } catch {}
      return null;
    }
    const id = this._nextRpcId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        srv._pending.delete(id);
        reject(new Error(`MCP stdio 请求 "${method}" 超时 (${this.timeoutMs}ms)`));
      }, this.timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
      srv._pending.set(id, { resolve, reject, timer });
      try {
        srv._proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      } catch (err) {
        clearTimeout(timer);
        srv._pending.delete(id);
        reject(err);
      }
    });
  }

  async connect(id) {
    const srv = this.servers.get(id);
    if (!srv) {
      const err = new Error(`未找到 MCP Server "${id}"`);
      err.statusCode = 404;
      throw err;
    }
    if (srv._connectPromise) return srv._connectPromise;

    const myAttempt = ++srv._attemptSeq;
    const run = (async () => {
      this._teardownRuntime(srv, { clearMetadata: true });
      srv.lastError = null;
      srv._stderrTail = '';
      srv.status = 'connecting';

      try {
        if (srv.transport === 'stdio') {
          if (!this.allowStdio || !srv.trusted) {
            throw new Error(
              !srv.trusted
                ? '安全拦截：未授信插件的 stdio MCP Server 禁止自动启动（请先授予信任）'
                : '安全拦截：未启用 stdio MCP Client（请设置 YUNYU_ALLOW_MCP_STDIO=true）'
            );
          }
          if (!srv.command) throw new Error('stdio MCP Server 缺少 command');
          const lowerBin = srv.command.toLowerCase();
          const isDirectExe = lowerBin.endsWith('.exe') || lowerBin === process.execPath.toLowerCase();
          const useWinCmdShell = process.platform === 'win32' && !isDirectExe && /\.(cmd|bat)$/.test(lowerBin);

          if (useWinCmdShell && (WIN_SHELL_META_RE.test(srv.command) || srv.args.some((a) => WIN_SHELL_META_RE.test(a)))) {
            throw new Error('安全拦截：Windows .cmd/.bat MCP 命令或参数包含非法 Shell 元字符');
          }

          const proc = spawn(srv.command, srv.args, {
            cwd: srv.cwd || process.cwd(),
            env: buildSafeServerEnv(srv.env),
            shell: useWinCmdShell,
            detached: process.platform !== 'win32',
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe']
          });
          srv._proc = proc;
          proc.stdin.on('error', () => {});
          proc.stderr.on('data', (d) => {
            const s = d.toString('utf8');
            srv._stderrTail = `${srv._stderrTail}${s}`.slice(-2048);
          });

          proc.stdout.on('data', (chunk) => {
            if (srv._proc !== proc) return;
            srv._stdoutBuf += chunk.toString('utf8');
            if (srv._stdoutBuf.length > MAX_STDIO_LINE_BYTES) {
              srv._stdoutBuf = '';
              srv.lastError = 'MCP stdio 单行消息超出 2MB 上限';
              this._teardownRuntime(srv);
              return;
            }
            const lines = srv._stdoutBuf.split(/\r?\n/);
            srv._stdoutBuf = lines.pop() || '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              try {
                const msg = JSON.parse(trimmed);
                if (msg.id !== undefined && srv._pending.has(msg.id)) {
                  const p = srv._pending.get(msg.id);
                  srv._pending.delete(msg.id);
                  clearTimeout(p.timer);
                  if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
                  else p.resolve(msg.result);
                }
              } catch {}
            }
          });

          proc.on('exit', (code) => {
            if (srv._proc === proc) {
              srv._proc = null;
              srv.status = 'disconnected';
              const detail = srv._stderrTail.trim() ? ` (${srv._stderrTail.trim().slice(0, 200)})` : '';
              for (const p of srv._pending.values()) {
                clearTimeout(p.timer);
                p.reject(new Error(`MCP Server "${srv.id}" 进程已退出 (code=${code})${detail}`));
              }
              srv._pending.clear();
            }
          });

          // Persistent error listener prevents uncaught EventEmitter crashes post-spawn
          let settledSpawn = false;
          await new Promise((resolve, reject) => {
            proc.on('error', (err) => {
              if (!settledSpawn) {
                settledSpawn = true;
                reject(err);
              } else if (srv._proc === proc) {
                srv.lastError = err.message || String(err);
                this._teardownRuntime(srv);
              }
            });
            proc.once('spawn', () => {
              if (!settledSpawn) {
                settledSpawn = true;
                resolve();
              }
            });
          });
        } else if (srv.transport === 'http') {
          if (!srv.url) throw new Error('http MCP Server 缺少 url');
        } else {
          throw new Error(`不支持的 MCP transport: ${srv.transport}`);
        }

        const initRes = await this._sendRpc(srv, 'initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'yunyu-teamwork', version: APP_VERSION }
        });
        if (srv._attemptSeq !== myAttempt) return redactServerForPublic(srv);

        srv.serverInfo = initRes?.serverInfo || null;
        await this._sendRpc(srv, 'notifications/initialized', {}, { isNotification: true }).catch(() => {});

        const caps = initRes?.capabilities || {};
        if (caps.tools !== false && (caps.tools !== undefined || Object.keys(caps).length === 0)) {
          const toolsRes = await this._sendRpc(srv, 'tools/list', {}).catch(() => ({ tools: [] }));
          srv.tools = Array.isArray(toolsRes?.tools) ? toolsRes.tools : [];
        } else {
          srv.tools = [];
        }
        if (caps.resources) {
          const resList = await this._sendRpc(srv, 'resources/list', {}).catch(() => ({ resources: [] }));
          srv.resources = Array.isArray(resList?.resources) ? resList.resources : [];
        } else {
          srv.resources = [];
        }
        srv.status = 'connected';
        return redactServerForPublic(srv);
      } catch (err) {
        if (srv._attemptSeq === myAttempt) {
          this._teardownRuntime(srv, { clearMetadata: true });
          srv.status = 'error';
          srv.lastError = err.message || String(err);
        }
        return redactServerForPublic(srv);
      } finally {
        if (srv._attemptSeq === myAttempt) {
          srv._connectPromise = null;
        }
      }
    })();

    srv._connectPromise = run;
    return run;
  }

  disconnect(id) {
    const srv = this.servers.get(id);
    if (!srv) {
      const err = new Error(`未找到 MCP Server "${id}"`);
      err.statusCode = 404;
      throw err;
    }
    srv._attemptSeq += 1;
    srv._connectPromise = null;
    this._teardownRuntime(srv, { clearMetadata: true });
    return redactServerForPublic(srv);
  }

  async callTool(serverId, toolName, args = {}) {
    const srv = this.servers.get(serverId);
    if (!srv) {
      const err = new Error(`未找到 MCP Server "${serverId}"`);
      err.statusCode = 404;
      throw err;
    }
    if (srv.status !== 'connected') {
      const conn = await this.connect(serverId);
      if (conn.status !== 'connected') {
        const err = new Error(`连接 MCP Server "${serverId}" 失败: ${conn.lastError}`);
        err.statusCode = 502;
        throw err;
      }
    }
    return await this._sendRpc(srv, 'tools/call', { name: toolName, arguments: args || {} });
  }

  async disposeAll() {
    for (const srv of this.servers.values()) {
      srv._attemptSeq += 1;
      srv._connectPromise = null;
      this._teardownRuntime(srv, { clearMetadata: true });
    }
  }
}
