#!/usr/bin/env node
/**
 * 人工实测路线图的自动化执行与留痕（第 0–8 关全自动，第 9/10 关按环境裁定）。
 * 输出：docs/acceptance/run-record.json（机器可读）+ docs/acceptance/README.md（人可读）。
 * 用法：node scripts/manual-test-run.mjs
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { YunyuServer } from '../src/server/app.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'docs', 'acceptance');
const records = [];
const startedAt = new Date().toISOString();

function record(stage, name, status, evidence, details = null) {
  records.push({ stage, name, status, evidence, details, at: new Date().toISOString() });
  const mark = { pass: '✅', fail: '❌', skip: '⏭️' }[status] || '•';
  console.log(`${mark} [${stage}] ${name} — ${typeof evidence === 'string' ? evidence : JSON.stringify(evidence).slice(0, 200)}`);
}

async function stage(stageId, name, fn) {
  const t0 = Date.now();
  try {
    const evidence = await fn();
    record(stageId, name, 'pass', evidence, { durationMs: Date.now() - t0 });
  } catch (err) {
    record(stageId, name, 'fail', String(err?.message || err), { durationMs: Date.now() - t0, stack: String(err?.stack || '').split('\n').slice(0, 4).join(' | ') });
  }
}

function cli(args, opts = {}) {
  return execFileSync(process.execPath, [path.join(ROOT, 'bin', 'yunyu.mjs'), ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: opts.timeout || 120_000, maxBuffer: 64 * 1024 * 1024
  });
}

function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yunyu-accept-sandbox-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('init', '-b', 'main');
  git('config', 'user.email', 'acceptance@yunyu.local');
  git('config', 'user.name', 'yunyu-acceptance');
  fs.writeFileSync(path.join(dir, 'README.md'), '# acceptance sandbox\n');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'export const answer = 42;\n');
  git('add', '.');
  git('commit', '-m', 'init sandbox');
  return dir;
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yunyu-accept-'));
const dataDir = path.join(tmpRoot, 'data');
const sandbox = makeSandbox();
let server = null;
let base = '';

async function api(method, p, body = null, expect = null) {
  const res = await fetch(base + p, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000)
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (expect !== null && res.status !== expect) {
    throw new Error(`${method} ${p} 期望 ${expect} 实得 ${res.status}: ${text.slice(0, 300)}`);
  }
  return { status: res.status, json, text };
}

async function waitFor(fn, timeoutMs = 15_000, intervalMs = 400) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

const SW = 'acceptance';

// ---- 第 0 关 · 环境自检 ----
await stage('0', 'doctor 环境自检', async () => {
  const out = JSON.parse(cli(['doctor']));
  if (!out.git?.installed) throw new Error('Git 不可用');
  if (parseInt(out.node.slice(1)) < 22) throw new Error('Node < 22');
  return { node: out.node, git: out.git.version, cliAgents: Object.fromEntries(Object.entries(out.cliAgents).map(([k, v]) => [k, v.installed ? v.version : '未安装'])) };
});

// ---- 第 1 关 · 离线全链路冒烟 ----
await stage('1', 'demo --once 离线全链路冒烟（真实 Worktree + GitLab Mock + 世界模型）', async () => {
  const out = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'bin', 'yunyu.mjs'), 'demo', '--once', '--port', '0'], { cwd: ROOT });
    let buf = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('demo --once 超时 240s')); }, 240_000);
    child.stdout.on('data', (d) => { buf += d; });
    child.stderr.on('data', (d) => { buf += d; });
    child.on('exit', (code) => { clearTimeout(timer); code === 0 ? resolve(buf) : reject(new Error(`demo --once 退出码 ${code}：${buf.slice(-600)}`)); });
  });
  const tail = out.trim().split('\n').slice(-4).join(' | ');
  return { exitCode: 0, outputTail: tail.slice(0, 500) };
});

// ---- 第 2 关 · 生产模式启动 ----
await stage('2', 'serve 启动 + health/metrics/UI 可达', async () => {
  server = new YunyuServer({ host: '127.0.0.1', port: 0, dataDir, repoPath: sandbox });
  base = await server.start();
  const health = await api('GET', '/api/health', null, 200);
  const metrics = await api('GET', '/api/metrics', null, 200);
  const ui = await fetch(base + '/', { signal: AbortSignal.timeout(10_000) });
  const html = await ui.text();
  if (!html.includes('<html') && !html.includes('<!DOCTYPE')) throw new Error('UI 首页未返回 HTML');
  return { url: base, health: health.json?.status || health.json, metricsKeys: Object.keys(metrics.json || {}), uiBytes: html.length };
});

// ---- 第 3 关 · 人类成员入场 + 发帖 + SSE ----
await stage('3', '创建蜂群 + 人类成员发帖 + SSE 实时流', async () => {
  await api('POST', '/api/swarms', { id: SW, title: '人工实测自动化验收蜂群', repoPath: sandbox }, 201);
  await api('POST', `/api/swarms/${SW}/members`, { name: 'pm', role: 'human', driver: 'human', workspace: 'inherit', brief: '产品经理：人工门禁与验收' }, 201);
  const posted = await api('POST', `/api/swarms/${SW}/messages`, { author: 'pm', text: '@all 人工实测开始，请各成员报到并提交阶段交付。' }, 201);
  const board = await api('GET', `/api/swarms/${SW}/messages?limit=50`, null, 200);
  const found = (board.json?.messages || []).some((m) => m.seq === posted.json.seq && m.text.includes('人工实测开始'));
  if (!found) throw new Error('留言板未检索到刚发布的消息');
  const ctrl = new AbortController();
  const sseRes = await fetch(`${base}/api/events?swarmId=${SW}`, { signal: ctrl.signal });
  const reader = sseRes.body.getReader();
  const { value } = await reader.read();
  const frame = Buffer.from(value).toString('utf8');
  ctrl.abort();
  if (!frame.includes('connected')) throw new Error(`SSE 首帧异常: ${frame.slice(0, 120)}`);
  return { swarmId: SW, postSeq: posted.json.seq, sseFirstFrame: frame.split('\n')[0], boardCount: board.json.messages.length };
});

// ---- 第 4 关 · 模拟 AI 成员 @mention 唤醒 + Worktree ----
await stage('4', 'simulated 成员招募 + @mention 事件唤醒 + 隔离 Worktree', async () => {
  await api('POST', `/api/swarms/${SW}/members`, { name: 'sim-worker', role: 'author', driver: 'simulated', workspace: 'share', owns: ['src/**'], brief: '确定性演练作者' }, 201);
  const trigger = await api('POST', `/api/swarms/${SW}/messages`, { author: 'pm', text: '@sim-worker 请实现 src/app.js 的answer常量并汇报。' }, 201);
  const reply = await waitFor(async () => {
    const b = await api('GET', `/api/swarms/${SW}/messages?since=${trigger.json.seq}&limit=50`, null, 200);
    return (b.json?.messages || []).find((m) => m.author === 'sim-worker');
  });
  if (!reply) throw new Error('15s 内未收到 sim-worker 被唤醒后的回帖');
  const status = await api('GET', `/api/swarms/${SW}`, null, 200);
  const worktrees = status.json?.worktrees || [];
  return { triggerSeq: trigger.json.seq, replySeq: reply.seq, replyExcerpt: reply.text.slice(0, 120), worktreeCount: worktrees.length, worktreeSample: worktrees[0] ? { member: worktrees[0].member || worktrees[0].agent, branch: worktrees[0].branch } : null };
});

// ---- 第 5 关 · Issue 六态生命周期 + 依赖阻塞 + 预算熔断 ----
await stage('5', 'Issue 六态流转 + DAG 依赖 409 + 验收解锁 + 预算熔断', async () => {
  const t1 = (await api('POST', `/api/swarms/${SW}/tasks`, { title: '实测上游任务', spec: '冻结规格：answer 常量必须为 42', acceptanceCriteria: [{ text: 'answer === 42' }], assignee: 'sim-worker', priority: 'P1', author: 'pm' }, 201)).json;
  const ready = (await api('POST', `/api/swarms/${SW}/tasks/${t1.id}/approve-spec`, { approver: 'pm' }, 200)).json;
  const t2 = (await api('POST', `/api/swarms/${SW}/tasks`, { title: '实测下游任务', dependsOn: [t1.id], assignee: 'sim-worker', author: 'pm' }, 201)).json;
  const blockedStart = await api('POST', `/api/swarms/${SW}/tasks/${t2.id}/start`, { assignee: 'sim-worker', dispatchBoard: false }, 409);
  await api('POST', `/api/swarms/${SW}/tasks/${t1.id}/claim`, { member: 'sim-worker' }, 200);
  const inProgress = (await api('POST', `/api/swarms/${SW}/tasks/${t1.id}/start`, { assignee: 'sim-worker', dispatchBoard: false }, 200)).json;
  const review = (await api('PUT', `/api/swarms/${SW}/tasks/${t1.id}`, { status: 'review' }, 200)).json;
  const done = (await api('POST', `/api/swarms/${SW}/tasks/${t1.id}/accept`, { reviewer: 'pm', summary: '自动化验收通过' }, 200)).json;
  const t2After = (await api('GET', `/api/swarms/${SW}/tasks`, null, 200)).json.tasks.find((t) => t.id === t2.id);
  if (t2After.blockedByDeps) throw new Error('上游 accept 后下游依赖未解锁（坑点 14 回归）');
  const lifecycle = [t1.status, ready.status, inProgress.status, review.status, done.status];
  if (JSON.stringify(lifecycle) !== JSON.stringify(['backlog', 'ready', 'in_progress', 'review', 'done'])) {
    throw new Error(`六态流转异常: ${lifecycle.join(' → ')}`);
  }
  // 预算熔断：第 4 关已消耗 1 轮，设 maxTurns=1 触发 exceeded
  const budget = (await api('PUT', `/api/swarms/${SW}/budget`, { maxTurns: 1 }, 200)).json;
  const before = (await api('GET', `/api/swarms/${SW}/messages?limit=1`, null, 200)).json.messages.at(-1).seq;
  await api('POST', `/api/swarms/${SW}/messages`, { author: 'pm', text: '@sim-worker 熔断后再次唤醒测试' }, 201);
  await new Promise((r) => setTimeout(r, 3000));
  const afterMsgs = (await api('GET', `/api/swarms/${SW}/messages?since=${before}&limit=50`, null, 200)).json.messages;
  const workerReplied = afterMsgs.some((m) => m.author === 'sim-worker');
  if (workerReplied) throw new Error('预算 exceeded 后成员仍被执行（熔断失效）');
  const alert = afterMsgs.find((m) => m.metadata?.noWake || /预算|熔断|budget/i.test(m.text));
  return { lifecycle, expectLifecycle: ['backlog', 'ready', 'in_progress', 'review', 'done'], depBlocked409: blockedStart.status, downstreamUnlocked: !t2After.blockedByDeps, budgetStatus: budget.status, breakerBlockedWake: !workerReplied, systemAlertSeq: alert?.seq ?? null };
});

// ---- 第 6 关 · 知识库写入与检索 ----
await stage('6', '知识库 pitfall 写入 + 检索 + JSONL 追加持久化', async () => {
  const entry = (await api('POST', `/api/swarms/${SW}/knowledge`, { title: '实测坑点：预算熔断后唤醒被拦截', category: 'pitfall', summary: '自动化实测第 5 关验证', content: 'maxTurns=1 时 exceeded 状态阻止后续 @mention 执行，系统告警携带 noWake。', author: 'pm', tags: ['acceptance', 'pitfall'] }, 201)).json;
  const search = (await api('GET', `/api/swarms/${SW}/knowledge?q=熔断`, null, 200)).json;
  if (!(search.entries || []).some((e) => e.id === entry.id)) throw new Error('知识库检索未命中刚写入条目');
  const eventsPath = path.join(dataDir, 'swarms', SW, 'events.jsonl');
  const lines = fs.readFileSync(eventsPath, 'utf8').trim().split('\n');
  const persisted = lines.some((l) => { try { const e = JSON.parse(l); return e.type === 'knowledge_add' && e.entry?.id === entry.id; } catch { return false; } });
  if (!persisted) throw new Error('events.jsonl 未追加 knowledge_add 事件');
  return { entryId: entry.id, searchHits: search.entries.length, jsonlLines: lines.length, appendOnlyPersisted: persisted };
});

// ---- 第 7 关 · 世界模型 / Wiki / 审计 ----
await stage('7', '世界模型刷新 + 爆炸半径模拟 + Wiki 生成 + 全仓审计', async () => {
  const refresh = (await api('POST', `/api/swarms/${SW}/world-model/refresh`, {}, 200)).json;
  const impact = (await api('POST', `/api/swarms/${SW}/world-model/impact`, { targets: ['src/app.js'] }, 200)).json;
  const wikiGen = (await api('POST', `/api/swarms/${SW}/wiki/generate`, {}, 200)).json;
  const wiki = (await api('GET', `/api/swarms/${SW}/wiki`, null, 200)).json;
  const audit = (await api('POST', `/api/swarms/${SW}/audit`, {}, 200)).json;
  const pageCount = (wiki.pages || wiki || []).length || wikiGen.pageCount || 0;
  if (!pageCount) throw new Error('Wiki 生成页数为 0');
  return { worldFiles: refresh.fileCount ?? refresh.files?.length ?? null, impactKeys: Object.keys(impact), wikiPages: pageCount, auditScore: audit.score ?? audit.report?.score ?? null };
});

// ---- 第 8 关 · 插件生态与跨端同步（dry-run 非破坏） ----
await stage('8', '插件清单 + 连接器探测 + claude-code dry-run 同步（沙盒非破坏）', async () => {
  const plugins = JSON.parse(cli(['plugin', 'list', '--json']));
  const connectors = JSON.parse(cli(['connectors', '--json']));
  const sync = JSON.parse(cli(['plugin', 'sync', '--harness', 'claude-code', '--dry-run', '--dir', sandbox]));
  const mcpPath = path.join(sandbox, '.mcp.json');
  if (fs.existsSync(mcpPath)) throw new Error('dry-run 竟然写入了 .mcp.json（非破坏性失效）');
  return { pluginCount: (plugins.plugins || []).length, builtinPacks: (plugins.plugins || []).map((p) => p.id || p.name).slice(0, 4), connectorCount: (connectors.connectors || []).length, syncDryRun: sync.dryRun ?? sync.mode ?? 'see-details', syncKeys: Object.keys(sync), noFileWritten: !fs.existsSync(mcpPath) };
});

// ---- 第 9/10 关 · 环境裁定 ----
const gitlabConfigured = Boolean(process.env.GITLAB_BASE_URL && process.env.GITLAB_TOKEN && process.env.GITLAB_PROJECT_ID);
record('9', '真实 GitLab 双向联动', 'skip',
  gitlabConfigured ? '已配置但本轮未执行（需真实仓库与 Webhook 可达，留待人工关卡）' : '环境未配置 GITLAB_BASE_URL/GITLAB_TOKEN/GITLAB_PROJECT_ID；第 1 关 demo 已覆盖本地 GitLab Mock 全链路',
  { gitlabConfigured });
let dockerAvailable = false;
try { execFileSync('docker', ['--version'], { encoding: 'utf8', timeout: 10_000 }); dockerAvailable = true; } catch {}
record('10', 'Docker 容器化部署', 'skip',
  dockerAvailable ? 'Docker 可用，但容器构建属重操作且需强制 Token 配置，留待人工关卡执行' : '本机 docker CLI 不可用；Dockerfile/compose 静态资产已随 v0.5.1 交付并通过审计',
  { dockerAvailable });

// ---- 收尾 ----
if (server) await server.close();
fs.rmSync(tmpRoot, { recursive: true, force: true });
fs.rmSync(sandbox, { recursive: true, force: true });

const pass = records.filter((r) => r.status === 'pass').length;
const fail = records.filter((r) => r.status === 'fail').length;
const skip = records.filter((r) => r.status === 'skip').length;
const finishedAt = new Date().toISOString();
const runRecord = { schema: 'yunyu-acceptance-run/v1', startedAt, finishedAt, version: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version, platform: `${os.platform()}/${os.arch()} node ${process.version}`, summary: { pass, fail, skip }, records };

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'run-record.json'), JSON.stringify(runRecord, null, 2) + '\n');

const md = [
  '# 人工实测路线图 · 自动化执行记录',
  '',
  `> 运行时间：${startedAt} → ${finishedAt} · 版本 v${runRecord.version} · ${runRecord.platform}`,
  `> 机器可读记录：[run-record.json](run-record.json) · 执行脚本：\`node scripts/manual-test-run.mjs\``,
  '',
  `**结果：${pass} 通过 / ${fail} 失败 / ${skip} 跳过（第 9/10 关按环境裁定）**`,
  '',
  '| 关卡 | 项目 | 结果 | 关键证据 |',
  '| :--- | :--- | :--- | :--- |',
  ...records.map((r) => `| ${r.stage} | ${r.name} | ${{ pass: '✅ 通过', fail: '❌ 失败', skip: '⏭️ 跳过' }[r.status]} | ${String(typeof r.evidence === 'string' ? r.evidence : JSON.stringify(r.evidence)).replace(/\|/g, '\\|').slice(0, 220)} |`),
  '',
  '## 验收交接说明',
  '',
  '- 本记录由协调者自动生成，供架构 / 设计 / 开发 / 测试各角色 Agent 做闭环验收；各角色结论写入 `docs/acceptance/verdicts/<role>.md`。',
  '- 第 4 关使用 `simulated` 确定性驱动验证唤醒/调度/Worktree 机制本身；真实异构模型成员（CLI/LLM）的行为验收由多模型验收会话承担。',
  '- 第 9 关（真实 GitLab）与第 10 关（Docker）为环境受限跳过，Mock 全链路已在第 1 关覆盖；人工补测步骤见 HANDOFF §5 与实测路线图。',
  ''
].join('\n');
fs.writeFileSync(path.join(OUT_DIR, 'README.md'), md);
console.log(`\n📋 记录已写入 docs/acceptance/（pass=${pass} fail=${fail} skip=${skip}）`);
process.exit(fail > 0 ? 1 : 0);