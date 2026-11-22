const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost', '0:0:0:0:0:0:0:1']);

/**
 * 零依赖固定窗口限流器：按来源 IP 保护 REST API，超限返回 429。
 * 窗口计数有界（过期键惰性清扫 + 容量上限），不引入任何外部依赖。
 */
export class RateLimiter {
  constructor({ windowMs = 60_000, max = 1200 } = {}) {
    this.windowMs = Math.max(1000, Number(windowMs) || 60_000);
    this.max = Math.max(0, Number(max) || 0);
    this.buckets = new Map();
    this.limitedTotal = 0;
  }

  get enabled() {
    return this.max > 0;
  }

  check(key, now = Date.now()) {
    if (!this.enabled) return { allowed: true, remaining: Infinity, retryAfterMs: 0 };
    const bucketKey = String(key || 'unknown');
    let bucket = this.buckets.get(bucketKey);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(bucketKey, bucket);
    }
    if (bucket.count >= this.max) {
      this.limitedTotal++;
      return { allowed: false, remaining: 0, retryAfterMs: Math.max(1, bucket.resetAt - now) };
    }
    bucket.count++;
    if (this.buckets.size > 4096) this._sweep(now);
    return { allowed: true, remaining: this.max - bucket.count, retryAfterMs: 0 };
  }

  _sweep(now) {
    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.resetAt) this.buckets.delete(key);
    }
  }

  stats() {
    return { windowMs: this.windowMs, max: this.max, trackedKeys: this.buckets.size, limitedTotal: this.limitedTotal };
  }
}

/**
 * 非回环绑定必须携带 API Token，否则拒绝启动（逃生门 YUNYU_ALLOW_INSECURE=true）。
 * 纯函数，便于单元测试在不实际监听端口的前提下覆盖安全守卫。
 */
export function assertSecureBinding(host, apiToken, allowInsecure = false) {
  const normalized = String(host || '').trim().toLowerCase();
  if (LOOPBACK_HOSTS.has(normalized)) return;
  if (apiToken) return;
  if (allowInsecure) return;
  throw new Error(
    `安全守卫：监听地址 "${host}" 非回环地址但未设置 YUNYU_API_TOKEN。` +
      '请设置 Bearer Token 环境变量，或显式启用 YUNYU_ALLOW_INSECURE=true 承担明文开放风险（仅限可信内网演练）。'
  );
}