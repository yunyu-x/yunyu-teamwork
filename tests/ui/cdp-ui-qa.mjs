import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runShowcaseDemo } from '../../src/demo/showcase-scenario.mjs';
import { YunyuServer } from '../../src/server/app.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const SHOWCASE_DIR = path.join(ROOT, 'docs', 'showcase');
const REPORT_PATH = path.join(ROOT, 'docs', 'benchmarks', 'latest-ui-qa-report.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  const envBin = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envBin && fs.existsSync(envBin)) return envBin;
  const candidates =
    process.platform === 'win32'
      ? [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
          ]
        : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

async function launchCdp() {
  const bin = findChrome();
  if (!bin) throw new Error('未检测到本机 Chrome/Edge/Chromium，无法运行 CDP UI 审计');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yunyu-cdp-'));
  const proc = spawn(
    bin,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      'about:blank'
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  const wsUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待 Chrome DevTools URL 超时')), 15_000);
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    };
    proc.stderr.on('data', onData);
    proc.stdout.on('data', onData);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome 提前退出 (code=${code}): ${buf.slice(0, 300)}`));
    });
  });

  // Resolve first page target
  const port = new URL(wsUrl).port;
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const pageTarget = targets.find((t) => t.type === 'page') || targets[0];
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const runtimeErrors = [];

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      runtimeErrors.push(msg.params?.exceptionDetails?.text || 'Runtime exception');
    }
  });

  const cdp = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  const ev = async (expression) => {
    const res = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || 'Eval failed');
    return res.result?.value;
  };

  await cdp('Page.enable');
  await cdp('Runtime.enable');

  return {
    cdp,
    ev,
    runtimeErrors,
    async screenshot(fileName) {
      fs.mkdirSync(SHOWCASE_DIR, { recursive: true });
      const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
      const outPath = path.join(SHOWCASE_DIR, fileName);
      fs.writeFileSync(outPath, Buffer.from(data, 'base64'));
      return outPath;
    },
    async close() {
      try { ws.close(); } catch {}
      try { proc.kill('SIGTERM'); } catch {}
      await sleep(250);
      try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
    }
  };
}

async function run() {
  const t0 = Date.now();
  const server = new YunyuServer({ host: '127.0.0.1', port: 0, inMemory: true });
  const demo = await runShowcaseDemo({ manager: server.manager, keepOpen: true });
  const url = await server.start();
  const session = await launchCdp();

  const report = {
    executedAt: new Date().toISOString(),
    url,
    desktop: {},
    mobile: {},
    screenshots: [],
    runtimeErrors: []
  };

  try {
    // ---- DESKTOP 1440x900 AUDIT ----
    await session.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await session.cdp('Page.navigate', { url });
    for (let i = 0; i < 40; i++) {
      if (await session.ev('Boolean(window.__YUNYU_READY)')) break;
      await sleep(150);
    }
    await sleep(300);

    const boardCheck = await session.ev(`(() => ({
      title: document.title,
      brandName: document.querySelector('#brand-name')?.textContent,
      cardsCount: document.querySelectorAll('#board-messages .msg-card').length,
      hasTranslationToggle: Boolean(document.querySelector('[data-toggle-trans]')),
      overflowX: document.documentElement.scrollWidth > window.innerWidth
    }))()`);
    assert.equal(boardCheck.brandName, '云驭协同');
    assert.ok(boardCheck.cardsCount >= 10, `Expected >= 10 board cards, got ${boardCheck.cardsCount}`);
    assert.equal(boardCheck.hasTranslationToggle, true);
    assert.equal(boardCheck.overflowX, false, 'Desktop Board must have zero horizontal overflow');
    report.desktop.board = boardCheck;
    report.screenshots.push(path.basename(await session.screenshot('ui_board_zh.png')));

    // Verify Chinese/Original inline translation toggle works non-destructively
    await session.ev(`document.querySelector('[data-toggle-trans]').click()`);
    await sleep(150);
    const afterOrigToggle = await session.ev(`document.querySelector('[data-toggle-trans]').textContent.trim()`);
    assert.equal(afterOrigToggle, '查看中文译文');
    await session.ev(`document.querySelector('[data-toggle-trans]').click()`);
    await sleep(150);

    // Switch to Graph tab & verify SVG nodes, edges, and timeline scrubber
    await session.ev(`document.querySelector('[data-tab="graph"]').click()`);
    await sleep(350);
    const graphCheck = await session.ev(`(() => ({
      nodeCount: document.querySelectorAll('#graph-svg .g-node').length,
      edgeCount: document.querySelectorAll('#graph-svg .g-edge').length,
      stepLabel: document.querySelector('#graph-step-label')?.textContent,
      hasDetailCard: Boolean(document.querySelector('#graph-detail .msg-card'))
    }))()`);
    assert.ok(graphCheck.nodeCount >= 5, `Expected >= 5 graph nodes, got ${graphCheck.nodeCount}`);
    assert.ok(graphCheck.edgeCount >= 4, `Expected >= 4 graph edges, got ${graphCheck.edgeCount}`);
    assert.equal(graphCheck.hasDetailCard, true);
    report.desktop.graph = graphCheck;
    report.screenshots.push(path.basename(await session.screenshot('ui_graph_replay_zh.png')));

    // Step backward on timeline scrubber to verify interactive replay
    await session.ev(`document.querySelector('#graph-prev-btn').click()`);
    await sleep(250);
    const prevLabel = await session.ev(`document.querySelector('#graph-step-label')?.textContent`);
    assert.notEqual(prevLabel, graphCheck.stepLabel);

    // Switch to Members tab
    await session.ev(`document.querySelector('[data-tab="members"]').click()`);
    await sleep(250);
    const membersCount = await session.ev(`document.querySelectorAll('#members-grid .panel-card').length`);
    assert.ok(membersCount >= 6);
    report.desktop.membersCount = membersCount;

    // Switch to GitLab tab
    await session.ev(`document.querySelector('[data-tab="gitlab"]').click()`);
    await sleep(250);
    const gitlabText = await session.ev(`document.querySelector('#gitlab-view-body')?.textContent || ''`);
    assert.ok(gitlabText.includes('yunyu/order-service'));
    assert.ok(gitlabText.includes('merged'));
    report.desktop.gitlabConnected = true;
    report.screenshots.push(path.basename(await session.screenshot('ui_gitlab_panel.png')));

    // Switch to Contract & Worktrees tab & test live QA ownership rejection
    await session.ev(`document.querySelector('[data-tab="contract"]').click()`);
    await sleep(250);
    await session.ev(`(() => {
      document.querySelector('#own-member').value = 'qa';
      document.querySelector('#own-path').value = 'src/rate-limiter.mjs';
      document.querySelector('#ownership-test-form button[type="submit"]').click();
    })()`);
    await sleep(250);
    const guardOut = await session.ev(`document.querySelector('#own-test-result')?.textContent || ''`);
    assert.ok(guardOut.includes('守卫拦截'), `Expected QA write guard block, got: ${guardOut}`);
    report.desktop.ownershipGuardLiveCheck = guardOut.trim();
    report.screenshots.push(path.basename(await session.screenshot('ui_contract_worktrees.png')));

    // ---- MOBILE PORTRAIT 390x844 AUDIT ----
    await session.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await session.ev(`document.querySelector('[data-tab="board"]').click()`);
    await sleep(250);
    const mobileCheck = await session.ev(`(() => ({
      vw: window.innerWidth,
      vh: window.innerHeight,
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
      cardsVisible: document.querySelectorAll('#board-messages .msg-card').length
    }))()`);
    assert.equal(mobileCheck.overflowX, false, 'Mobile 390x844 must have zero horizontal overflow');
    assert.ok(mobileCheck.cardsVisible >= 10);
    report.mobile = mobileCheck;

    assert.equal(session.runtimeErrors.length, 0, `Runtime errors: ${JSON.stringify(session.runtimeErrors)}`);
    report.runtimeErrors = session.runtimeErrors;
    report.durationMs = Date.now() - t0;

    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
    console.log(`[cdp-ui-qa] ALL UI AUDITS PASSED in ${report.durationMs}ms! Screenshots -> ${SHOWCASE_DIR}`);
  } finally {
    await session.close();
    await demo.cleanup();
    await server.close();
  }
}

run().catch((err) => {
  console.error('[cdp-ui-qa] FAILED:', err);
  process.exit(1);
});
