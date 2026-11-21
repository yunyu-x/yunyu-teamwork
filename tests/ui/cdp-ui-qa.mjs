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

    // Verify Qoder-style 6-column Issue Kanban view + Inline '+' + Issue Detail Slide-Over Drawer
    await session.ev(`document.querySelector('[data-tab="kanban"]').click()`);
    await sleep(300);
    const kanbanBefore = await session.ev(`(() => ({
      cols: document.querySelectorAll('.kanban-col').length,
      colAddBtns: document.querySelectorAll('[data-col-quick-add]').length,
      hasScopeTabs: Boolean(document.querySelector('[data-issue-scope="all"]') && document.querySelector('[data-issue-scope="mine"]')),
      cards: document.querySelectorAll('.kanban-card').length,
      overflowX: document.documentElement.scrollWidth > window.innerWidth
    }))()`);
    assert.equal(kanbanBefore.cols, 6);
    assert.equal(kanbanBefore.colAddBtns, 6);
    assert.equal(kanbanBefore.hasScopeTabs, true);
    assert.ok(kanbanBefore.cards >= 3, `Expected >= 3 Issue cards, got ${kanbanBefore.cards}`);
    assert.equal(kanbanBefore.overflowX, false, 'Desktop Issue Kanban must have zero horizontal overflow');

    // Create a new Issue via inline '+' on 待规划 column
    await session.ev(`(() => {
      document.querySelector('[data-col-quick-add="backlog"]').click();
      document.querySelector('#kb-title').value = '补充限流器压测基准报告';
      document.querySelector('#kb-priority').value = 'P0';
      document.querySelector('#kanban-create-form button[type="submit"]').click();
    })()`);
    for (let i = 0; i < 20; i++) {
      const cnt = await session.ev(`document.querySelectorAll('.kanban-card').length`);
      if (cnt >= kanbanBefore.cards + 1) break;
      await sleep(120);
    }
    const kanbanAfterCreate = await session.ev(`document.querySelectorAll('.kanban-card').length`);
    assert.equal(kanbanAfterCreate, kanbanBefore.cards + 1);
    report.desktop.kanban = { cols: kanbanBefore.cols, cards: kanbanAfterCreate };
    report.screenshots.push(path.basename(await session.screenshot('ui_kanban_zh.png')));

    // Open Issue Detail Slide-Over Drawer for a review/planning Issue & verify Spec + Checklist + Live Diff
    await session.ev(`(() => {
      const reviewCard = document.querySelector('.kanban-col[data-col="review"] .kanban-card') || document.querySelector('.kanban-card');
      reviewCard.click();
    })()`);
    await sleep(400);
    const drawerCheck = await session.ev(`(() => ({
      isOpen: document.querySelector('#issue-drawer')?.classList.contains('open') || false,
      hasSpec: Boolean(document.querySelector('#drawer-spec-input')),
      hasCriteria: document.querySelectorAll('[data-toggle-criterion]').length >= 1,
      hasDiffBox: Boolean(document.querySelector('.diff-box')),
      hasAcceptBtn: Boolean(document.querySelector('[data-drawer-action="accept"]'))
    }))()`);
    assert.equal(drawerCheck.isOpen, true);
    assert.equal(drawerCheck.hasSpec, true);
    assert.equal(drawerCheck.hasCriteria, true);
    assert.equal(drawerCheck.hasDiffBox, true);
    assert.equal(drawerCheck.hasAcceptBtn, true);
    report.desktop.issueDrawer = drawerCheck;
    report.screenshots.push(path.basename(await session.screenshot('ui_issue_drawer_zh.png')));
    await session.ev(`document.querySelector('#btn-close-drawer').click()`);
    await sleep(150);

    // Verify Shared Research & Knowledge Vault tab + one-click Research Collection
    await session.ev(`document.querySelector('[data-tab="knowledge"]').click()`);
    await sleep(300);
    const kbBefore = await session.ev(`document.querySelectorAll('#knowledge-view-body article.panel-card').length`);
    assert.ok(kbBefore >= 1, 'Expected seeded Research Brief in Knowledge Vault');
    await session.ev(`(() => {
      document.querySelector('#res-topic').value = 'TokenBucketLimiter 限流契约调研';
      document.querySelector('#research-collect-form button[type="submit"]').click();
    })()`);
    for (let i = 0; i < 25; i++) {
      const n = await session.ev(`document.querySelectorAll('#knowledge-view-body article.panel-card').length`);
      if (n >= kbBefore + 1) break;
      await sleep(150);
    }
    const kbAfter = await session.ev(`document.querySelectorAll('#knowledge-view-body article.panel-card').length`);
    assert.ok(kbAfter >= kbBefore + 1, `Expected new synthesized research card, got ${kbAfter}`);
    const kbOverflowX = await session.ev(`document.documentElement.scrollWidth > window.innerWidth`);
    assert.equal(kbOverflowX, false, 'Desktop Knowledge Vault must have zero horizontal overflow');
    report.desktop.knowledge = { entries: kbAfter };
    report.screenshots.push(path.basename(await session.screenshot('ui_knowledge_zh.png')));

    // Verify Project World Model & Living Wiki Archive tab (Topology SVG + Impact Simulator + Audit + Wiki Editor)
    await session.ev(`document.querySelector('[data-tab="world"]').click()`);
    for (let i = 0; i < 25; i++) {
      const ready = await session.ev(
        `document.querySelectorAll('.wiki-nav-item').length >= 4 && Boolean(document.querySelector('.world-svg'))`
      );
      if (ready) break;
      await sleep(150);
    }
    const worldBefore = await session.ev(`(() => ({
      kpiCount: document.querySelectorAll('.world-kpi').length,
      hasSvg: Boolean(document.querySelector('.world-svg')),
      wikiCount: document.querySelectorAll('.wiki-nav-item').length,
      overflowX: document.documentElement.scrollWidth > window.innerWidth
    }))()`);
    assert.equal(worldBefore.kpiCount, 4);
    assert.equal(worldBefore.hasSvg, true);
    assert.ok(worldBefore.wikiCount >= 4, `Expected >= 4 auto-generated wiki pages, got ${worldBefore.wikiCount}`);
    assert.equal(worldBefore.overflowX, false, 'Desktop World & Wiki tab must have zero horizontal overflow');

    // Run Change Blast-Radius Impact Simulator & Live Audit
    await session.ev(`(() => {
      const hub = document.querySelector('[data-pick-impact-file]');
      if (hub) hub.click();
      else document.querySelector('#btn-run-impact').click();
    })()`);
    for (let i = 0; i < 20; i++) {
      if (await session.ev(`Boolean(document.querySelector('.impact-result'))`)) break;
      await sleep(120);
    }
    assert.equal(await session.ev(`Boolean(document.querySelector('.impact-result'))`), true);

    await session.ev(`document.querySelector('#btn-run-audit').click()`);
    for (let i = 0; i < 20; i++) {
      if (await session.ev(`Boolean(document.querySelector('.audit-summary-row'))`)) break;
      await sleep(120);
    }
    assert.equal(await session.ev(`Boolean(document.querySelector('.audit-summary-row'))`), true);

    // Create a custom Wiki page via inline editor
    await session.ev(`document.querySelector('#btn-wiki-new').click()`);
    await sleep(150);
    await session.ev(`(() => {
      document.querySelector('#wiki-edit-slug').value = 'release-checklist';
      document.querySelector('#wiki-edit-title').value = '发布前核对清单';
      document.querySelector('#wiki-edit-summary').value = '新增发版检查项';
      document.querySelector('#wiki-edit-content').value = '# 发布前核对清单\\n- 通过全量单测与无头 Chrome UI 验收\\n- 零外部依赖审计绿灯';
      document.querySelector('#form-wiki-edit button[type="submit"]').click();
    })()`);
    for (let i = 0; i < 20; i++) {
      const n = await session.ev(`document.querySelectorAll('.wiki-nav-item').length`);
      if (n >= worldBefore.wikiCount + 1) break;
      await sleep(120);
    }
    const wikiAfterCreate = await session.ev(`document.querySelectorAll('.wiki-nav-item').length`);
    assert.equal(wikiAfterCreate, worldBefore.wikiCount + 1);
    report.desktop.worldWiki = {
      wikiPages: wikiAfterCreate,
      impactSimulated: true,
      auditExecuted: true
    };
    report.screenshots.push(path.basename(await session.screenshot('ui_world_wiki_zh.png')));

    // Verify v0.5.0 Agent Plugins, Connectors, MCP Clients, Skills & Hooks tab
    await session.ev(`document.querySelector('[data-tab="plugins"]').click()`);
    for (let i = 0; i < 25; i++) {
      const ready = await session.ev(
        `document.querySelectorAll('.plugin-conn-card').length >= 8 && document.querySelectorAll('.plugin-item-card').length >= 2`
      );
      if (ready) break;
      await sleep(150);
    }
    const pluginsBefore = await session.ev(`(() => ({
      connectors: document.querySelectorAll('.plugin-conn-card').length,
      plugins: document.querySelectorAll('.plugin-item-card').length,
      skills: document.querySelectorAll('.plugin-skill-btn').length,
      overflowX: document.documentElement.scrollWidth > window.innerWidth
    }))()`);
    assert.ok(pluginsBefore.connectors >= 8, `Expected >= 8 connectors, got ${pluginsBefore.connectors}`);
    assert.ok(pluginsBefore.plugins >= 2, `Expected >= 2 built-in plugins, got ${pluginsBefore.plugins}`);
    assert.ok(pluginsBefore.skills >= 3, `Expected >= 3 built-in skills, got ${pluginsBefore.skills}`);
    assert.equal(pluginsBefore.overflowX, false, 'Desktop Plugins tab must have zero horizontal overflow');

    // Run Connector Dry-Run Sync preview
    await session.ev(`document.querySelector('#btn-connector-dry-run').click()`);
    for (let i = 0; i < 20; i++) {
      if (await session.ev(`Boolean(document.querySelector('#connector-sync-result'))`)) break;
      await sleep(120);
    }
    assert.equal(await session.ev(`Boolean(document.querySelector('#connector-sync-result'))`), true);

    // Run Progressive Skill Matcher
    await session.ev(`document.querySelector('#btn-skill-match').click()`);
    for (let i = 0; i < 20; i++) {
      if (await session.ev(`Boolean(document.querySelector('#skill-match-result'))`)) break;
      await sleep(120);
    }
    assert.equal(await session.ev(`Boolean(document.querySelector('#skill-match-result'))`), true);

    // Run Hook Simulator (default rm -rf /tmp/demo -> DENY)
    await session.ev(`document.querySelector('#btn-hook-test').click()`);
    for (let i = 0; i < 20; i++) {
      if (await session.ev(`Boolean(document.querySelector('#hook-test-result'))`)) break;
      await sleep(120);
    }
    const hookResultText = await session.ev(`document.querySelector('#hook-test-result')?.textContent || ''`);
    assert.ok(hookResultText.includes('DENY'), `Expected Hook Simulator DENY result, got: ${hookResultText}`);

    // Create a custom inline plugin via Web UI
    await session.ev(`(() => {
      document.querySelector('#pi-id').value = 'ui-custom-pack';
      document.querySelector('#pi-name').value = '前端自定义校验插件';
      document.querySelector('#pi-skill').value = 'ui-a11y-check';
      document.querySelector('#btn-plugin-install').click();
    })()`);
    for (let i = 0; i < 20; i++) {
      const cnt = await session.ev(`document.querySelectorAll('.plugin-item-card').length`);
      if (cnt >= pluginsBefore.plugins + 1) break;
      await sleep(120);
    }
    const pluginsAfterCreate = await session.ev(`document.querySelectorAll('.plugin-item-card').length`);
    assert.equal(pluginsAfterCreate, pluginsBefore.plugins + 1);

    // Click a Skill item to verify inline SKILL.md viewer opens & closes cleanly
    await session.ev(`document.querySelector('[data-view-skill]').click()`);
    for (let i = 0; i < 20; i++) {
      if (await session.ev(`Boolean(document.querySelector('#skill-detail-box'))`)) break;
      await sleep(120);
    }
    assert.equal(await session.ev(`Boolean(document.querySelector('#skill-detail-box'))`), true);
    await session.ev(`document.querySelector('[data-close-skill-view]').click()`);
    await sleep(100);
    assert.equal(await session.ev(`Boolean(document.querySelector('#skill-detail-box'))`), false);

    // Verify EN i18n toggle on Plugins view (zero overflow, localized headers)
    await session.ev(`document.querySelector('#lang-toggle').click()`);
    await sleep(150);
    const pluginsEnText = await session.ev(`document.querySelector('#plugins-view-body')?.textContent || ''`);
    assert.ok(pluginsEnText.includes('Cross-Harness Connector Radar'));
    assert.ok(pluginsEnText.includes('DENY (Blocked)'));
    await session.ev(`document.querySelector('#lang-toggle').click()`);
    await sleep(150);

    report.desktop.plugins = {
      connectors: pluginsBefore.connectors,
      plugins: pluginsAfterCreate,
      dryRunSynced: true,
      skillMatched: true,
      skillViewerVerified: true,
      enI18nVerified: true,
      hookDenied: true
    };
    report.screenshots.push(path.basename(await session.screenshot('ui_plugins_zh.png')));

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

    // Switch to Members tab & recruit a Personal Digital Twin with IM channel via one-click preset
    await session.ev(`document.querySelector('[data-tab="members"]').click()`);
    await sleep(250);
    const membersCountBefore = await session.ev(`document.querySelectorAll('#members-grid .panel-card').length`);
    assert.ok(membersCountBefore >= 6);

    await session.ev(`document.querySelector('#btn-add-member').click()`);
    await sleep(200);
    await session.ev(`(() => {
      document.querySelector('[data-apply-preset="personal-twin"]').click();
      document.querySelector('#m-name').value = 'lin-twin';
      document.querySelector('#twin-owner').value = '林总';
      document.querySelector('#twin-im-type').value = 'feishu';
      document.querySelector('#twin-im-type').dispatchEvent(new Event('change'));
    })()`);
    await sleep(200);
    const twinModalCheck = await session.ev(`(() => ({
      twinWrapVisible: !document.querySelector('#twin-fields-wrap').classList.contains('hidden'),
      inboundUrl: document.querySelector('#twin-inbound-url')?.textContent || '',
      hasWebhookInput: Boolean(document.querySelector('[data-im-field="webhookUrl"]'))
    }))()`);
    assert.equal(twinModalCheck.twinWrapVisible, true);
    assert.ok(twinModalCheck.inboundUrl.includes('/channels/inbound/feishu/lin-twin'));
    assert.equal(twinModalCheck.hasWebhookInput, true);

    await session.ev(`document.querySelector('#form-add-member button[type="submit"]').click()`);
    for (let i = 0; i < 30; i++) {
      const cnt = await session.ev(`document.querySelectorAll('#members-grid .panel-card').length`);
      if (cnt >= membersCountBefore + 1) break;
      await sleep(150);
    }
    const membersCount = await session.ev(`document.querySelectorAll('#members-grid .panel-card').length`);
    assert.equal(membersCount, membersCountBefore + 1);
    for (let i = 0; i < 20; i++) {
      const ok = await session.ev(`document.querySelector('#saved-twins-bar')?.textContent?.includes('lin-twin') || false`);
      if (ok) break;
      await sleep(100);
    }
    const hasSavedTwinsBar = await session.ev(`document.querySelector('#saved-twins-bar')?.textContent?.includes('lin-twin') || false`);
    assert.equal(hasSavedTwinsBar, true, 'Expected newly created twin persisted in Saved Twins bar');
    report.desktop.membersCount = membersCount;
    report.desktop.digitalTwinRecruited = true;

    // Switch to GitLab tab & test Issue Comments Preview + Inline Reply
    await session.ev(`document.querySelector('[data-tab="gitlab"]').click()`);
    await sleep(250);
    const gitlabText = await session.ev(`document.querySelector('#gitlab-view-body')?.textContent || ''`);
    assert.ok(gitlabText.includes('yunyu/order-service'));
    assert.ok(gitlabText.includes('merged'));

    // Expand Issue #1 comments and post an inline reply
    await session.ev(`document.querySelector('[data-toggle-issue-notes="1"]').click()`);
    for (let i = 0; i < 20; i++) {
      const n = await session.ev(`document.querySelectorAll('#issue-notes-drawer-1 .note-item').length`);
      if (n >= 1) break;
      await sleep(150);
    }
    const notesBefore = await session.ev(`document.querySelectorAll('#issue-notes-drawer-1 .note-item').length`);
    assert.ok(notesBefore >= 1, `Expected synced comments on Issue #1, got ${notesBefore}`);
    await session.ev(`(() => {
      const form = document.querySelector('[data-issue-note-form="1"]');
      form.querySelector('[name="noteBody"]').value = '验收意见：前端卡片与限流器指标清晰，同意归档。';
      form.querySelector('button[type="submit"]').click();
    })()`);
    for (let i = 0; i < 25; i++) {
      const txt = await session.ev(`document.querySelector('#issue-notes-drawer-1')?.textContent || ''`);
      if (txt.includes('前端卡片与限流器指标清晰')) break;
      await sleep(150);
    }
    const notesAfterText = await session.ev(`document.querySelector('#issue-notes-drawer-1')?.textContent || ''`);
    assert.ok(notesAfterText.includes('前端卡片与限流器指标清晰'));
    report.desktop.gitlabConnected = true;
    report.desktop.gitlabIssueNotesVerified = true;
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

    // Also audit Kanban & Knowledge tabs on Mobile 390x844 for zero horizontal overflow
    await session.ev(`document.querySelector('[data-tab="kanban"]').click()`);
    await sleep(250);
    const mobileKanbanOverflow = await session.ev(`document.documentElement.scrollWidth > window.innerWidth`);
    assert.equal(mobileKanbanOverflow, false, 'Mobile 390x844 Kanban must have zero horizontal overflow');
    await session.ev(`document.querySelector('[data-tab="knowledge"]').click()`);
    await sleep(250);
    const mobileKnowledgeOverflow = await session.ev(`document.documentElement.scrollWidth > window.innerWidth`);
    assert.equal(mobileKnowledgeOverflow, false, 'Mobile 390x844 Knowledge Vault must have zero horizontal overflow');
    await session.ev(`document.querySelector('[data-tab="world"]').click()`);
    await sleep(250);
    const mobileWorldOverflow = await session.ev(`document.documentElement.scrollWidth > window.innerWidth`);
    assert.equal(mobileWorldOverflow, false, 'Mobile 390x844 World & Wiki must have zero horizontal overflow');
    await session.ev(`document.querySelector('[data-tab="plugins"]').click()`);
    await sleep(250);
    const mobilePluginsOverflow = await session.ev(`document.documentElement.scrollWidth > window.innerWidth`);
    assert.equal(mobilePluginsOverflow, false, 'Mobile 390x844 Plugins tab must have zero horizontal overflow');
    mobileCheck.kanbanOverflowX = mobileKanbanOverflow;
    mobileCheck.knowledgeOverflowX = mobileKnowledgeOverflow;
    mobileCheck.worldOverflowX = mobileWorldOverflow;
    mobileCheck.pluginsOverflowX = mobilePluginsOverflow;
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
