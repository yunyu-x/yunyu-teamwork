/**
 * Server-Sent Events (SSE) real-time broadcast hub for live Swarm UI and remote pull agents.
 */
export class SseHub {
  constructor({ maxClients = 200 } = {}) {
    this.clients = new Set();
    this.maxClients = maxClients;
    this._heartbeat = setInterval(() => this.ping(), 25_000);
    if (typeof this._heartbeat.unref === 'function') this._heartbeat.unref();
  }

  subscribe(res, { swarmId = null, corsOrigin = null } = {}) {
    if (this.clients.size >= this.maxClients) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'SSE 实时连接数已达上限，请稍后重试' }));
      return null;
    }
    const headers = {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff'
    };
    if (corsOrigin) {
      headers['Access-Control-Allow-Origin'] = corsOrigin;
      headers.Vary = 'Origin';
    }
    res.writeHead(200, headers);
    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, swarmId, time: new Date().toISOString() })}\n\n`);

    const client = { res, swarmId };
    this.clients.add(client);
    const cleanup = () => this.clients.delete(client);
    res.on('close', cleanup);
    res.on('error', cleanup);
    return client;
  }

  broadcast(eventName, data, swarmId = null) {
    const chunk = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      if (client.swarmId && swarmId && client.swarmId !== swarmId) continue;
      try {
        client.res.write(chunk);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  ping() {
    for (const client of this.clients) {
      try {
        client.res.write(': ping\n\n');
      } catch {
        this.clients.delete(client);
      }
    }
  }

  closeAll() {
    clearInterval(this._heartbeat);
    for (const client of this.clients) {
      try {
        client.res.end();
      } catch {}
    }
    this.clients.clear();
  }
}
