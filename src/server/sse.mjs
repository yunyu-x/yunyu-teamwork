/**
 * Server-Sent Events (SSE) real-time broadcast hub for live Swarm UI and remote pull agents.
 */
export class SseHub {
  constructor() {
    this.clients = new Set();
    this._heartbeat = setInterval(() => this.ping(), 25_000);
    if (typeof this._heartbeat.unref === 'function') this._heartbeat.unref();
  }

  subscribe(res, { swarmId = null } = {}) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, swarmId, time: new Date().toISOString() })}\n\n`);

    const client = { res, swarmId };
    this.clients.add(client);
    res.on('close', () => {
      this.clients.delete(client);
    });
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
