import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChannelBridge } from '../channels/bridge.mjs';
import { DEFAULT_CONFIG } from '../core/constants.mjs';
import { TeamworkManager } from '../core/orchestrator.mjs';
import { TwinsStore } from '../core/twins-store.mjs';
import { createDefaultDriverRegistry } from '../drivers/registry.mjs';
import { YunyuMcpServer } from '../mcp/server.mjs';
import { handleApiRoute, sendJson } from './routes.mjs';
import { RateLimiter, assertSecureBinding } from './rate-limit.mjs';
import { SseHub } from './sse.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, '..', '..', 'web');
const REAL_WEB_DIR = fs.existsSync(WEB_DIR) ? fs.realpathSync(WEB_DIR) : WEB_DIR;

const SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
});

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const WHATWG_BAD_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723,
  2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
  6697, 10080
]);

/**
 * Zero-dependency HTTP + SSE + Web UI + MCP Server for Yunyu Teamwork.
 */
export class YunyuServer {
  constructor({
    host = DEFAULT_CONFIG.host,
    port = DEFAULT_CONFIG.port,
    dataDir = null,
    inMemory = false,
    repoPath = process.cwd(),
    webhookSecret = process.env.GITLAB_WEBHOOK_SECRET || '',
    apiToken = process.env.YUNYU_API_TOKEN || '',
    allowCustomCli = process.env.YUNYU_ALLOW_CUSTOM_CLI === 'true',
    rateLimit = null,
    manager = null,
    driverRegistry = null,
    channelBridge = null,
    twinsStore = null,
    pluginHub = null
  } = {}) {
    this.host = host;
    this.port = port;
    this.webhookSecret = webhookSecret;
    this.apiToken = apiToken;
    this.allowCustomCli = Boolean(allowCustomCli);
    this.rateLimiter = new RateLimiter({
      windowMs: rateLimit?.windowMs ?? (Number(process.env.YUNYU_RATE_LIMIT_WINDOW_MS) || 60_000),
      max: rateLimit?.max ?? (process.env.YUNYU_RATE_LIMIT_RPM !== undefined ? Number(process.env.YUNYU_RATE_LIMIT_RPM) : 1200)
    });
    this.stats = { requestsTotal: 0, rateLimitedTotal: 0, startedAt: Date.now() };
    this.channelBridge = channelBridge || new ChannelBridge();
    this.twinsStore = twinsStore || new TwinsStore({ dataDir, inMemory });
    this.driverRegistry = driverRegistry || createDefaultDriverRegistry({ channelBridge: this.channelBridge });
    this.manager =
      manager ||
      new TeamworkManager({
        dataDir,
        inMemory,
        driverRegistry: this.driverRegistry,
        defaultRepoPath: repoPath,
        pluginHub
      });
    this.sse = new SseHub();
    this.mcpServer = new YunyuMcpServer({ manager: this.manager, allowCustomCli: this.allowCustomCli });
    this.server = null;
    this.url = '';

    this.manager.on('event', (ev) => {
      this.sse.broadcast(ev.type, ev, ev.swarmId || null);
    });
  }

  async start() {
    assertSecureBinding(this.host, this.apiToken, process.env.YUNYU_ALLOW_INSECURE === 'true');
    const handler = async (req, res) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host || `${this.host}:${this.port}`}`);

        if (url.pathname.startsWith('/api/')) {
          this.stats.requestsTotal++;
          if (url.pathname !== '/api/health') {
            const verdict = this.rateLimiter.check(req.socket.remoteAddress);
            if (!verdict.allowed) {
              this.stats.rateLimitedTotal++;
              res.setHeader('Retry-After', String(Math.ceil(verdict.retryAfterMs / 1000)));
              sendJson(res, 429, { error: '请求过于频繁，已触发限流保护，请稍后重试' }, req);
              return;
            }
          }
          const handled = await handleApiRoute({
            req,
            res,
            url,
            manager: this.manager,
            sse: this.sse,
            mcpServer: this.mcpServer,
            channelBridge: this.channelBridge,
            twinsStore: this.twinsStore,
            webhookSecret: this.webhookSecret,
            apiToken: this.apiToken,
            allowCustomCli: this.allowCustomCli,
            stats: this.stats,
            rateLimiter: this.rateLimiter
          });
          if (!handled && !res.headersSent) {
            sendJson(res, 404, { error: `API 路由不存在: ${req.method} ${url.pathname}` }, req);
          }
          return;
        }

        this._serveStatic(req, res, url.pathname);
      } catch (err) {
        if (res.headersSent || res.writableEnded) return;
        const isClientErr = err instanceof SyntaxError || err instanceof URIError;
        const status = err.statusCode || (isClientErr ? 400 : err instanceof TypeError ? 500 : 400);
        sendJson(res, status, { error: err.message || String(err) }, req);
      }
    };

    for (let attempt = 0; attempt < 8; attempt++) {
      const srv = http.createServer(handler);
      await new Promise((resolve, reject) => {
        srv.once('error', reject);
        srv.listen(this.port, this.host, () => {
          srv.off('error', reject);
          resolve();
        });
      });
      const addr = srv.address();
      if (this.port === 0 && WHATWG_BAD_PORTS.has(addr.port)) {
        await new Promise((resolve) => srv.close(resolve));
        continue;
      }
      this.server = srv;
      this.port = addr.port;
      this.url = `http://${this.host}:${this.port}`;
      return this.url;
    }
    throw new Error('无法分配有效的 HTTP 监听端口');
  }

  _serveStatic(_req, res, pathname) {
    let decodedPath = pathname;
    try {
      decodedPath = decodeURIComponent(pathname);
    } catch {
      sendJson(res, 400, { error: '无效 URL 编码路径' }, _req);
      return;
    }
    const cleanRel = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
    const target = path.resolve(WEB_DIR, cleanRel);
    const rel = path.relative(WEB_DIR, target);

    let safeFile = null;
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel) && fs.existsSync(target) && !fs.statSync(target).isDirectory()) {
      const realTarget = fs.realpathSync(target);
      const realRel = path.relative(REAL_WEB_DIR, realTarget);
      if (realRel && !realRel.startsWith('..') && !path.isAbsolute(realRel)) {
        safeFile = realTarget;
      }
    }

    if (!safeFile) {
      const fallback = path.join(WEB_DIR, 'index.html');
      if (fs.existsSync(fallback)) {
        const html = fs.readFileSync(fallback);
        res.writeHead(200, {
          ...SECURITY_HEADERS,
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': html.length
        });
        res.end(html);
        return;
      }
      sendJson(res, 404, { error: 'Not Found' }, _req);
      return;
    }

    const ext = path.extname(safeFile).toLowerCase();
    const content = fs.readFileSync(safeFile);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Content-Length': content.length,
      'Cache-Control': 'no-cache'
    });
    res.end(content);
  }

  async close() {
    this.sse.closeAll();
    await this.manager.disposeAll();
    if (this.server) {
      const srv = this.server;
      this.server = null;
      await new Promise((resolve) => {
        srv.close(resolve);
        srv.closeAllConnections?.();
      });
    }
  }
}
