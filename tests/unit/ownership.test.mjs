import assert from 'node:assert/strict';
import test from 'node:test';
import { OwnershipGuard, matchGlob } from '../../src/core/ownership.mjs';

test('matchGlob handles recursive globs, single wildcards, directory prefixes, and Windows separators', () => {
  assert.equal(matchGlob('src/core/board.mjs', 'src/**'), true);
  assert.equal(matchGlob('src\\core\\board.mjs', 'src/core/'), true);
  assert.equal(matchGlob('web/app.js', 'src/**'), false);
  assert.equal(matchGlob('dist/bundle.html', 'dist/*.html'), true);
  assert.equal(matchGlob('tests/unit/a.test.mjs', 'tests/**/*.test.mjs'), true);
});

test('OwnershipGuard enforces Author exclusivity, globalForbidden, and Verifier/QA src-isolation invariant', () => {
  const guard = new OwnershipGuard({
    globalForbidden: ['dist/**', 'build/**'],
    ownership: {
      backend: { role: 'author', owns: ['src/**'], mustNotTouch: ['web/**'] },
      frontend: { role: 'author', owns: ['web/**'], mustNotTouch: ['src/**'] },
      qa: { role: 'verifier', owns: ['tests/**'], mustNotTouch: [] }
    }
  });

  // Author allowed inside own boundary
  assert.equal(guard.checkWrite('backend', 'src/rate-limiter.mjs').allowed, true);
  // Author blocked outside own boundary
  assert.equal(guard.checkWrite('backend', 'web/app.js').allowed, false);
  // Global forbidden blocks everyone
  assert.equal(guard.checkWrite('backend', 'dist/index.html').allowed, false);

  // Hard Invariant #3: Verifier / QA is ALWAYS blocked from writing src/ and web/
  const qaSrc = guard.checkWrite('qa', 'src/rate-limiter.mjs');
  assert.equal(qaSrc.allowed, false);
  assert.match(qaSrc.reason, /严禁修改/);
  assert.equal(guard.checkWrite('qa', 'tests/rate-limiter.test.mjs').allowed, true);

  // Zero collisions on disjoint authors
  assert.equal(guard.detectCollisions().length, 0);

  // Adding overlapping author triggers collision warning
  guard.setMemberRule('backend-2', { role: 'author', owns: ['src/core/**'] });
  assert.ok(guard.detectCollisions().length >= 1);
});
