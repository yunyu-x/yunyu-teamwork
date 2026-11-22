import assert from 'node:assert/strict';
import test from 'node:test';
import { YunyuServer } from '../../src/server/app.mjs';
import { RateLimiter, assertSecureBinding } from '../../src/server/rate-limit.mjs';

test('RateLimiter fixed-window per-key quota, retryAfter, disabled mode, and bucket sweep', () => {
  const limiter = new RateLimiter({ windowMs: 1000, max: 3 });
  const t0 = 1_000_000;

  assert.deepEqual(limiter.check('ip-a', t0), { allowed: true, remaining: 2, retryAfterMs: 0 });
  assert.equal(limiter.check('ip-a', t0 + 10).allowed, true);
  assert.equal(limiter.check('ip-a', t0 + 20).allowed, true);

  const denied = limiter.check('ip-a', t0 + 30);
  assert.equal(denied.allowed, false);
  assert.equal(denied.remaining, 0);
  assert.equal(denied.retryAfterMs, 970);

  // Other keys have independent buckets
  assert.equal(limiter.check('ip-b', t0 + 30).allowed, true);

  // Window rollover resets the bucket
  assert.equal(limiter.check('ip-a', t0 + 1000).allowed, true);
  assert.equal(limiter.stats().limitedTotal, 1);

  // max=0 disables limiting entirely
  const off = new RateLimiter({ max: 0 });
  assert.equal(off.enabled, false);
  for (let i = 0; i < 100; i++) assert.equal(off.check('flood', t0 + i).allowed, true);

  // Sweep expired buckets once tracking exceeds 4096 keys
  const big = new RateLimiter({ windowMs: 1000, max: 5 });
  for (let i = 0; i < 4100; i++) big.check(`key-${i}`, t0);
  assert.ok(big.stats().trackedKeys <= 4100);
  big.check('trigger-sweep', t0 + 2000);
  assert.ok(big.stats().trackedKeys < 100, 'expired buckets should be swept');
});

test('assertSecureBinding enforces token on non-loopback hosts with explicit insecure escape hatch', () => {
  // Loopback hosts never require a token
  for (const host of ['127.0.0.1', '::1', 'localhost', 'LOCALHOST']) {
    assert.doesNotThrow(() => assertSecureBinding(host, ''));
  }
  // Non-loopback without token is rejected
  assert.throws(() => assertSecureBinding('0.0.0.0', ''), /YUNYU_API_TOKEN/);
  assert.throws(() => assertSecureBinding('192.168.1.10', ''), /安全守卫/);
  // Token present or explicit insecure opt-in passes
  assert.doesNotThrow(() => assertSecureBinding('0.0.0.0', 'strong-token'));
  assert.doesNotThrow(() => assertSecureBinding('0.0.0.0', '', true));
});

test('HTTP API rate limiting returns 429 + Retry-After, exempts /api/health, and /api/metrics reports counters', async () => {
  const server = new YunyuServer({
    host: '127.0.0.1',
    port: 0,
    inMemory: true,
    repoPath: null,
    rateLimit: { windowMs: 60_000, max: 3 }
  });
  const baseUrl = await server.start();

  try {
    // /api/health is exempt from rate limiting
    for (let i = 0; i < 6; i++) {
      const res = await fetch(`${baseUrl}/api/health`);
      assert.equal(res.status, 200);
    }

    // /api/metrics works and exposes observability counters
    const metricsRes = await fetch(`${baseUrl}/api/metrics`);
    assert.equal(metricsRes.status, 200);
    const metrics = await metricsRes.json();
    assert.equal(metrics.ok, true);
    assert.ok(metrics.requestsTotal >= 7);
    assert.equal(metrics.rateLimit.max, 3);
    assert.ok(typeof metrics.memoryRssMb === 'number');
    assert.ok(typeof metrics.sseClients === 'number');

    // Quota is now 2 remaining: two allowed, third denied with 429 + Retry-After
    assert.equal((await fetch(`${baseUrl}/api/swarms`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/swarms`)).status, 200);
    const denied = await fetch(`${baseUrl}/api/swarms`);
    assert.equal(denied.status, 429);
    const retryAfter = Number(denied.headers.get('Retry-After'));
    assert.ok(retryAfter >= 1 && retryAfter <= 60);
    const body = await denied.json();
    assert.ok(body.error.includes('限流'));

    assert.ok(server.stats.rateLimitedTotal >= 1);
    assert.equal(server.rateLimiter.stats().limitedTotal, server.stats.rateLimitedTotal);
  } finally {
    await server.close();
  }
});