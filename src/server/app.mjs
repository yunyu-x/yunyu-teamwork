import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG } from '../core/constants.mjs';
import { TeamworkManager } from '../core/orchestrator.mjs';
import { createDefaultDriverRegistry } from '../drivers/registry.mjs';
import { YunyuMcpServer } from '../mcp/server.mjs';
import { handleApiRoute, sendJson } from './routes.mjs';
import { SseHub } from './sse.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, '..', '..', 'web');

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
    manager = null,
    driverRegistry = null
  } = {}) {
    this.host = host;
    this.port = port;
    this.webhookSecret = webhookSecret;
    this.driverRegistry = driverRegistry || createDefaultDriverRegistry();
    this.manager =
      manager ||
      new TeamworkManager({
        dataDir,
        inMemory,
        driverRegistry: this.driverRegistry,
        defaultRepoPath: repoPath
      });
    this.sse = new SseHub();
    this.mcpServer = new YunyuMcpServer({ manager: this.manager });
    this.server = null;
    this.url = '';

    this.manager.on('event', (ev) => {
      this.sse.broadcast(ev.type, ev, ev.swarmId || null);
    });
  }

  async start() {
    const handler = async (req, res) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host || `${this.host}:${this.port}`}`);

        if (url.pathname.startsWith('/api/')) {
          const handled = await handleApiRoute({
            req,
            res,
            url,
            manager: this.manager,
            sse: this.sse,
            mcpServer: this.mcpServer,
            webhookSecret: this.webhookSecret
          });
          if (!handled) {
            sendJson(res, 404, { error: `API 路由不存在: ${req.method} ${url.pathname}` });
          }
          return;
        }

        this._serveStatic(req, res, url.pathname);
      } catch (err) {
        const status = err.statusCode || 400;
        sendJson(res, status, { error: err.message || String(err) });
      }
    };

    for (let attempt = 0; attempt < 8; attempt++) {
      const srv = http.createServer(handler);
      await new Promise((resolve) => srv.listen(this.port, this.host, resolve));
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
    const cleanRel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const target = path.resolve(WEB_DIR, cleanRel);
    if (!target.startsWith(WEB_DIR) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      const fallback = path.join(WEB_DIR, 'index.html');
      if (fs.existsSync(fallback)) {
        const html = fs.readFileSync(fallback);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': html.length });
        res.end(html);
        return;
      }
      sendJson(res, 404, { error: 'Not Found' });
      return;
    }

    const ext = path.extname(target).toLowerCase();
    const content = fs.readFileSync(target);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Content-Length': content.length,
      'Cache-Control': 'no-cache'
    });
    res.end(content);
  }

  async close() {
    this.sse.closeAll();
    this.manager.disposeAll();
    if (this.server) {
      await new Promise((resolve) => this.server.close(resolve));
      this.server = null;
    }
  }
}
