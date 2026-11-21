import crypto from 'node:crypto';
import { listChannelTypes } from '../channels/index.mjs';
import { APP_VERSION, KNOWLEDGE_CATEGORIES, MESSAGE_KINDS, TASK_STATUSES } from '../core/constants.mjs';
import { validateGitLabTokenEnvName } from '../core/orchestrator.mjs';
import { ResearchEngine, extractKeywords, extractUrls } from '../core/research.mjs';
import { listAgentPresets, listTemplates } from '../core/templates.mjs';
import { GitLabClient, GitLabSyncService, translateGitLabWebhook, verifyGitLabWebhookToken } from '../gitlab/index.mjs';
import { handlePluginApiRoute } from './plugin-routes.mjs';

function parseFiniteInt(val, fallback) {
  if (val === null || val === undefined || val === '') return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function resolveAllowedCorsOrigin(req) {
  const origin = req?.headers?.origin;
  if (!origin) return null;
  const explicit = process.env.YUNYU_CORS_ORIGIN;
  if (explicit && explicit.split(',').map((s) => s.trim()).includes(origin)) {
    return origin;
  }
  try {
    const u = new URL(origin);
    if (
      (u.protocol === 'http:' || u.protocol === 'https:') &&
      ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname.toLowerCase())
    ) {
      return origin;
    }
  } catch {}
  return null;
}

function isAuthorizedApiRequest(req, pathname, apiToken) {
  if (!apiToken) return true;
  // Webhook inbound endpoints verify their own HMAC/token signatures
  if (
    pathname === '/api/webhooks/gitlab' ||
    pathname.startsWith('/api/im/inbound/') ||
    /\/(?:webhooks\/gitlab|channels\/inbound\/)/.test(pathname)
  ) {
    return true;
  }
  const auth = String(req.headers?.authorization || '');
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const queryTok = new URL(req.url, 'http://127.0.0.1').searchParams.get('token') || '';
  const provided = bearer || queryTok;
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(String(apiToken));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function readRawBody(req, maxBytes = 2 * 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const err = new Error('请求体超出 2MB 限制');
      err.statusCode = 413;
      req.destroy();
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function readJsonBody(req, maxBytes = 2 * 1024 * 1024, { allowNonObject = false } = {}) {
  const raw = (await readRawBody(req, maxBytes)).trim();
  if (!raw) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const e = new Error(`JSON 请求体格式错误: ${err.message}`);
    e.statusCode = 400;
    throw e;
  }
  if (!allowNonObject && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) {
    const e = new Error('JSON 请求体必须为对象');
    e.statusCode = 400;
    throw e;
  }
  return parsed;
}

export function sendJson(res, status, data, req = null) {
  const body = JSON.stringify(data);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer'
  };
  const corsOrigin = resolveAllowedCorsOrigin(req);
  if (corsOrigin) {
    headers['Access-Control-Allow-Origin'] = corsOrigin;
    headers.Vary = 'Origin';
  }
  res.writeHead(status, headers);
  res.end(body);
}

/**
 * Dispatch HTTP REST API requests for Yunyu Teamwork.
 */
export async function handleApiRoute({
  req,
  res,
  url,
  manager,
  sse,
  mcpServer,
  channelBridge = null,
  twinsStore = null,
  webhookSecret = '',
  apiToken = '',
  allowCustomCli = false
}) {
  const method = req.method;
  const pathname = url.pathname;

  if (method === 'OPTIONS') {
    const corsOrigin = resolveAllowedCorsOrigin(req);
    const headers = {
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, Authorization, X-Gitlab-Event, X-Gitlab-Token, X-Yunyu-Signature, X-Yunyu-Token, X-Slack-Signature, X-Slack-Request-Timestamp, X-Telegram-Bot-Api-Secret-Token'
    };
    if (corsOrigin) {
      headers['Access-Control-Allow-Origin'] = corsOrigin;
      headers.Vary = 'Origin';
    }
    res.writeHead(204, headers);
    res.end();
    return true;
  }

  if (!isAuthorizedApiRequest(req, pathname, apiToken)) {
    sendJson(res, 401, { error: '未授权：请提供有效的 Authorization: Bearer <YUNYU_API_TOKEN>' }, req);
    return true;
  }

  // Health & Metadata
  if (method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      name: 'yunyu-teamwork',
      version: APP_VERSION,
      node: process.version,
      uptimeSec: Math.round(process.uptime()),
      swarmCount: manager.listSwarms().length,
      drivers: manager.driverRegistry ? manager.driverRegistry.list() : [],
      templates: listTemplates(),
      agentPresets: listAgentPresets(),
      channelTypes: listChannelTypes(),
      pluginCount: manager.plugins ? manager.plugins.registry.listPlugins().filter((p) => p.enabled).length : 0,
      connectorCount: manager.plugins ? manager.plugins.connectors.listConnectors().length : 0
    }, req);
    return true;
  }

  // v0.5.0 Plugin Ecosystem, Connectors, Skills, Hooks & External MCP Clients
  if (
    pathname === '/api/plugins' ||
    pathname.startsWith('/api/plugins/') ||
    pathname === '/api/connectors' ||
    pathname.startsWith('/api/connectors/') ||
    pathname === '/api/skills' ||
    pathname.startsWith('/api/skills/') ||
    pathname === '/api/hooks' ||
    pathname.startsWith('/api/hooks/') ||
    pathname === '/api/mcp-clients' ||
    pathname.startsWith('/api/mcp-clients/') ||
    /^\/api\/swarms\/[^/]+\/plugins\//.test(pathname)
  ) {
    const handledPlugin = await handlePluginApiRoute({
      req,
      res,
      url,
      manager,
      allowCustomCli,
      readJsonBody,
      sendJson
    });
    if (handledPlugin) return true;
  }

  // Supported IM / Bot communication channel metadata
  if (method === 'GET' && pathname === '/api/channels/types') {
    sendJson(res, 200, { channelTypes: listChannelTypes() });
    return true;
  }

  // Agent role presets
  if (method === 'GET' && pathname === '/api/presets') {
    sendJson(res, 200, { presets: listAgentPresets(), templates: listTemplates() });
    return true;
  }

  // Personal Digital Twin Library CRUD
  if (method === 'GET' && pathname === '/api/twins') {
    sendJson(res, 200, { twins: twinsStore ? twinsStore.listTwins({ redactSecrets: true }) : [] });
    return true;
  }

  if (method === 'POST' && pathname === '/api/twins') {
    if (!twinsStore) {
      sendJson(res, 500, { error: 'TwinsStore 未初始化' });
      return true;
    }
    const body = await readJsonBody(req);
    const saved = twinsStore.saveTwin(body);
    sendJson(res, 201, twinsStore.getTwin(saved.id, { redactSecrets: true }));
    return true;
  }

  const twinDeleteMatch = pathname.match(/^\/api\/twins\/([^/]+)$/);
  if (method === 'DELETE' && twinDeleteMatch) {
    if (!twinsStore) {
      sendJson(res, 500, { error: 'TwinsStore 未初始化' });
      return true;
    }
    const id = decodeURIComponent(twinDeleteMatch[1]);
    const deleted = twinsStore.deleteTwin(id);
    sendJson(res, deleted ? 200 : 404, deleted ? { ok: true, id } : { error: `未找到数字分身 "${id}"` });
    return true;
  }

  // Global or per-swarm SSE stream
  if (method === 'GET' && pathname === '/api/events') {
    const swarmId = url.searchParams.get('swarmId') || null;
    sse.subscribe(res, { swarmId, corsOrigin: resolveAllowedCorsOrigin(req) });
    return true;
  }

  // MCP over HTTP JSON-RPC 2.0
  if (method === 'POST' && pathname === '/api/mcp') {
    let rpcReq;
    try {
      rpcReq = await readJsonBody(req, 2 * 1024 * 1024, { allowNonObject: false });
    } catch (err) {
      sendJson(res, 200, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: err.message || 'Parse error' }
      }, req);
      return true;
    }
    const rpcResp = await mcpServer.handleRpc(rpcReq);
    sendJson(res, 200, rpcResp || { jsonrpc: '2.0', result: null }, req);
    return true;
  }

  // Swarms collection
  if (method === 'GET' && pathname === '/api/swarms') {
    sendJson(res, 200, { swarms: manager.listSwarms() }, req);
    return true;
  }

  if (method === 'POST' && pathname === '/api/swarms') {
    const body = await readJsonBody(req);
    let gitlab = null;
    if (body.gitlab?.baseUrl && body.gitlab?.projectId) {
      const tokenEnv = validateGitLabTokenEnvName(body.gitlab.tokenEnv || 'GITLAB_TOKEN');
      const client = new GitLabClient({
        baseUrl: body.gitlab.baseUrl,
        token: body.gitlab.token || process.env[tokenEnv] || ''
      });
      const sync = new GitLabSyncService({
        client,
        projectId: body.gitlab.projectId,
        issueIid: body.gitlab.linkedIssueIid || null,
        mrIid: body.gitlab.linkedMrIid || null,
        mirrorKinds: body.gitlab.mirrorKinds || null
      });
      gitlab = {
        client,
        sync,
        projectId: body.gitlab.projectId,
        baseUrl: client.baseUrl,
        linkedIssueIid: body.gitlab.linkedIssueIid || null,
        linkedMrIid: body.gitlab.linkedMrIid || null,
        tokenEnv,
        persistToken: Boolean(body.gitlab.persistToken)
      };
    }
    const swarm = manager.createSwarm({
      id: body.id || null,
      title: body.title,
      repoPath: body.repoPath || manager.defaultRepoPath,
      templateId: body.templateId || null,
      contract: body.contract || null,
      gitlab,
      budget: body.budget || null,
      language: body.language || 'zh-CN'
    });
    sendJson(res, 201, swarm.getStatus());
    return true;
  }

  // Global GitLab Webhook endpoint (routes to ?swarmId=... or first GitLab-linked swarm)
  if (method === 'POST' && pathname === '/api/webhooks/gitlab') {
    return await handleGitLabWebhookRequest({
      req,
      res,
      manager,
      swarmId: url.searchParams.get('swarmId') || null,
      webhookSecret
    });
  }

  // Global IM Inbound shorthand: /api/im/inbound/:channelType/:swarmId/:memberName
  const globalImMatch = pathname.match(/^\/api\/im\/inbound\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (method === 'POST' && globalImMatch) {
    const channelType = decodeURIComponent(globalImMatch[1]);
    const targetSwarmId = decodeURIComponent(globalImMatch[2]);
    const memberName = decodeURIComponent(globalImMatch[3]);
    const targetSwarm = manager.getSwarm(targetSwarmId);
    if (!targetSwarm) {
      sendJson(res, 404, { error: `未找到蜂群 "${targetSwarmId}"` });
      return true;
    }
    return await handleChannelInbound({ req, res, swarm: targetSwarm, memberName, channelType, channelBridge });
  }

  // Match /api/swarms/:id...
  const swarmMatch = pathname.match(/^\/api\/swarms\/([^/]+)(.*)$/);
  if (!swarmMatch) return false;

  const swarmId = decodeURIComponent(swarmMatch[1]);
  const rest = swarmMatch[2] || '';
  const swarm = manager.getSwarm(swarmId);
  if (!swarm) {
    sendJson(res, 404, { error: `未找到蜂群 "${swarmId}"` });
    return true;
  }

  if (method === 'GET' && (rest === '' || rest === '/')) {
    sendJson(res, 200, swarm.getStatus());
    return true;
  }

  // Messages
  if (method === 'GET' && rest === '/messages') {
    const since = parseFiniteInt(url.searchParams.get('since'), null);
    const limit = Math.max(1, Math.min(500, parseFiniteInt(url.searchParams.get('limit'), 100)));
    const channel = url.searchParams.get('channel') || null;
    const kind = url.searchParams.get('kind') || null;
    const search = url.searchParams.get('search') || null;
    const seqsParam = url.searchParams.get('seqs');
    const seqs = seqsParam ? seqsParam.split(',').map(Number).filter(Boolean) : null;
    sendJson(res, 200, swarm.board.read({ since, limit, seqs, channel, kind, search }));
    return true;
  }

  if (method === 'POST' && rest === '/messages') {
    const body = await readJsonBody(req);
    const msg = swarm.postMessage({
      author: body.author || 'human',
      text: body.text,
      channel: body.channel || 'main',
      kind: body.kind || null,
      metadata: body.metadata || {},
      translations: body.translations || null
    });
    sendJson(res, 201, msg);
    return true;
  }

  const transMatch = rest.match(/^\/messages\/(\d+)\/translate$/);
  if (method === 'POST' && transMatch) {
    const seq = Number(transMatch[1]);
    const body = await readJsonBody(req);
    const updated = swarm.board.annotateTranslation(seq, body.lang || 'zh-CN', body.text);
    sendJson(res, 200, updated);
    return true;
  }

  // Qoder-style Issues / Kanban Tasks & Beads-style DAG Ready / Claim / Lifecycle
  if (method === 'GET' && rest === '/tasks/ready') {
    const assignee = url.searchParams.get('assignee') || null;
    const excludeFor = url.searchParams.get('forMember') || null;
    sendJson(res, 200, { tasks: swarm.tasks.listReadyTasks({ assignee, excludeClaimedByOthersFor: excludeFor }) });
    return true;
  }

  if (method === 'GET' && rest === '/tasks') {
    const hasFilters =
      url.searchParams.has('scope') ||
      url.searchParams.has('status') ||
      url.searchParams.has('search') ||
      url.searchParams.has('priority') ||
      url.searchParams.has('assignee') ||
      url.searchParams.has('readyOnly') ||
      url.searchParams.has('sortBy');
    const tasks = hasFilters
      ? swarm.tasks.queryTasks({
          scope: url.searchParams.get('scope') || 'all',
          me: url.searchParams.get('me') || 'coordinator',
          status: url.searchParams.get('status') || 'all',
          search: url.searchParams.get('search') || '',
          priority: url.searchParams.get('priority') || 'all',
          assignee: url.searchParams.get('assignee') || 'all',
          readyOnly: url.searchParams.get('readyOnly') === 'true',
          sortBy: url.searchParams.get('sortBy') || 'priority'
        })
      : swarm.tasks.listTasks();
    sendJson(res, 200, { tasks });
    return true;
  }

  if (method === 'POST' && rest === '/tasks') {
    const body = await readJsonBody(req);
    const task = swarm.tasks.createTask(body);
    if (body.notifyAssignee && task.assignee) {
      swarm.postMessage({
        author: body.author || 'coordinator',
        text: `@${task.assignee} [新建 Issue ${task.issueKey} · ${task.priority}] **${task.title}**${task.description ? `\n${task.description}` : ''}`,
        channel: body.channel || 'main',
        metadata: { taskId: task.id, issueKey: task.issueKey }
      });
    }
    sendJson(res, 201, task);
    return true;
  }

  const taskApproveSpecMatch = rest.match(/^\/tasks\/([^/]+)\/approve-spec$/);
  if (method === 'POST' && taskApproveSpecMatch) {
    const taskId = decodeURIComponent(taskApproveSpecMatch[1]);
    const body = await readJsonBody(req);
    const updated = swarm.tasks.approveSpec(taskId, body);
    if (body.postToBoard) {
      swarm.postMessage({
        author: body.approver || 'coordinator',
        text: `📋 Issue **${updated.issueKey}**「${updated.title}」Spec 已批准冻结，流转至 \`待开始 (ready)\`。`,
        channel: body.channel || 'main',
        kind: MESSAGE_KINDS.SYSTEM,
        metadata: { taskId: updated.id, issueKey: updated.issueKey, noWake: true }
      });
    }
    sendJson(res, 200, updated);
    return true;
  }

  const taskClaimMatch = rest.match(/^\/tasks\/([^/]+)\/claim$/);
  if (method === 'POST' && taskClaimMatch) {
    const taskId = decodeURIComponent(taskClaimMatch[1]);
    const body = await readJsonBody(req);
    const updated = swarm.tasks.claimTask(taskId, body.member || 'coordinator', { ttlMs: body.ttlMs || 300_000 });
    sendJson(res, 200, updated);
    return true;
  }

  const taskReleaseMatch = rest.match(/^\/tasks\/([^/]+)\/release$/);
  if (method === 'POST' && taskReleaseMatch) {
    const taskId = decodeURIComponent(taskReleaseMatch[1]);
    const body = await readJsonBody(req);
    const updated = swarm.tasks.releaseTask(taskId, body.member || null);
    sendJson(res, 200, updated);
    return true;
  }

  const taskStartMatch = rest.match(/^\/tasks\/([^/]+)\/start$/);
  if (method === 'POST' && taskStartMatch) {
    const taskId = decodeURIComponent(taskStartMatch[1]);
    const body = await readJsonBody(req);
    const existing = swarm.tasks.getTask(taskId);
    if (!existing) {
      sendJson(res, 404, { error: `未找到任务 "${taskId}"` });
      return true;
    }
    if (existing.blockedByDeps && !body.force) {
      sendJson(res, 409, { error: `该 Issue 存在未完成的前置依赖 (${existing.unresolvedDeps.join(', ')})，暂不可开始` });
      return true;
    }
    const targetAssignee = body.assignee || existing.assignee;
    if (targetAssignee) {
      swarm.tasks.claimTask(taskId, targetAssignee, { ttlMs: body.ttlMs || 600_000 });
    }
    const updated = swarm.tasks.updateTask(taskId, {
      status: TASK_STATUSES.IN_PROGRESS,
      assignee: targetAssignee || existing.assignee,
      blocked: false,
      blockedReason: null
    });
    if (body.dispatchBoard !== false && targetAssignee) {
      const acLines = (updated.acceptanceCriteria || []).map((c, i) => `${i + 1}. ${c.text}`).join('\n');
      swarm.postMessage({
        author: body.author || 'coordinator',
        text: [
          `@${targetAssignee} 🚀 启动 Issue **${updated.issueKey}**「${updated.title}」`,
          updated.spec ? `**冻结 Spec**：\n${updated.spec}` : updated.description ? `**任务描述**：${updated.description}` : null,
          acLines ? `**验收标准**：\n${acLines}` : null
        ]
          .filter(Boolean)
          .join('\n\n'),
        channel: body.channel || 'main',
        kind: MESSAGE_KINDS.BRIEF,
        metadata: { taskId: updated.id, issueKey: updated.issueKey }
      });
    }
    sendJson(res, 200, updated);
    return true;
  }

  const taskAcceptMatch = rest.match(/^\/tasks\/([^/]+)\/accept$/);
  if (method === 'POST' && taskAcceptMatch) {
    const taskId = decodeURIComponent(taskAcceptMatch[1]);
    const body = await readJsonBody(req);
    const cur = swarm.tasks.getTask(taskId);
    if (!cur) {
      sendJson(res, 404, { error: `未找到任务 "${taskId}"` });
      return true;
    }
    let mergeResult = null;
    if (body.mergeWorktree && cur.assignee) {
      mergeResult = swarm.worktrees.mergeToBase(cur.assignee, {
        commitMessage: `feat(${cur.issueKey}): accept and merge ${cur.title}`
      });
      swarm._saveMeta();
    }
    const updated = swarm.tasks.acceptTask(taskId, {
      reviewer: body.reviewer || 'coordinator',
      summary: body.summary || ''
    });
    if (body.postToBoard !== false) {
      swarm.postMessage({
        author: body.reviewer || 'coordinator',
        text: `✅ Issue **${updated.issueKey}**「${updated.title}」验收通过并流转至 \`已完成\`${body.summary ? `：${body.summary}` : ''}${mergeResult?.sha ? `（已合并 Commit \`${mergeResult.sha}\`）` : ''}。`,
        channel: body.channel || 'main',
        kind: MESSAGE_KINDS.DELIVERABLE,
        metadata: { taskId: updated.id, issueKey: updated.issueKey, accepted: true, noWake: true }
      });
    }
    sendJson(res, 200, { ...updated, mergeResult });
    return true;
  }

  const taskRejectMatch = rest.match(/^\/tasks\/([^/]+)\/reject$/);
  if (method === 'POST' && taskRejectMatch) {
    const taskId = decodeURIComponent(taskRejectMatch[1]);
    const body = await readJsonBody(req);
    const updated = swarm.tasks.rejectTask(taskId, {
      reviewer: body.reviewer || 'reviewer',
      reason: body.reason || '未通过验收标准，请返工修复'
    });
    if (body.postToBoard !== false) {
      const mention = updated.assignee ? `@${updated.assignee} ` : '';
      swarm.postMessage({
        author: body.reviewer || 'reviewer',
        text: `${mention}[打回返工 · ${updated.issueKey}] Issue「${updated.title}」未通过验收：\n- 打回原因：${body.reason || '未通过验收标准，请返工修复'}\n请修复并自测后重新提交验收。`,
        channel: body.channel || 'main',
        kind: MESSAGE_KINDS.DEFECT,
        metadata: { taskId: updated.id, issueKey: updated.issueKey, rejected: true }
      });
    }
    sendJson(res, 200, updated);
    return true;
  }

  const taskCritMatch = rest.match(/^\/tasks\/([^/]+)\/criteria\/([^/]+)$/);
  if (method === 'POST' && taskCritMatch) {
    const taskId = decodeURIComponent(taskCritMatch[1]);
    const criterionId = decodeURIComponent(taskCritMatch[2]);
    const body = await readJsonBody(req);
    const updated = swarm.tasks.toggleCriterion(taskId, criterionId, body.checked ?? null);
    sendJson(res, 200, updated);
    return true;
  }

  const taskUpdateMatch = rest.match(/^\/tasks\/([^/]+)$/);
  if (method === 'PUT' && taskUpdateMatch) {
    const taskId = decodeURIComponent(taskUpdateMatch[1]);
    const body = await readJsonBody(req);
    const updated = swarm.tasks.updateTask(taskId, body);
    if (body.notifyAssignee && updated.assignee) {
      swarm.postMessage({
        author: body.author || 'coordinator',
        text: `@${updated.assignee} Issue ${updated.issueKey}「${updated.title}」已流转至 \`${updated.status}\`，请跟进处理。`,
        channel: body.channel || 'main',
        metadata: { taskId: updated.id, issueKey: updated.issueKey }
      });
    }
    sendJson(res, 200, updated);
    return true;
  }

  // Budget & Cost Governance
  if (method === 'GET' && rest === '/budget') {
    sendJson(res, 200, swarm.budget.getSummary());
    return true;
  }

  if (method === 'PUT' && rest === '/budget') {
    const body = await readJsonBody(req);
    const summary = swarm.budget.configure(body);
    swarm._saveMeta();
    swarm.emit('status', swarm.getStatus());
    sendJson(res, 200, summary);
    return true;
  }

  // Shared Knowledge Vault & One-Click Multi-Source Research Collector
  if (method === 'GET' && rest === '/knowledge') {
    const q = url.searchParams.get('q') || '';
    const category = url.searchParams.get('category') || 'all';
    const tag = url.searchParams.get('tag') || '';
    const limit = Math.max(1, Math.min(200, parseFiniteInt(url.searchParams.get('limit'), 40)));
    sendJson(res, 200, { entries: swarm.knowledge.search({ q, category, tag, limit }) }, req);
    return true;
  }

  if (method === 'POST' && rest === '/knowledge') {
    const body = await readJsonBody(req);
    const entry = swarm.knowledge.addEntry(body);
    if (body.linkedIssueId && swarm.tasks.getTask(body.linkedIssueId)) {
      swarm.tasks.updateTask(body.linkedIssueId, { linkedKnowledgeIds: [entry.id] });
    }
    sendJson(res, 201, entry, req);
    return true;
  }

  if (method === 'POST' && rest === '/research') {
    const body = await readJsonBody(req);
    const topic = String(body.topic || body.query || '').trim();
    if (!topic) {
      sendJson(res, 400, { error: '请输入调研主题 topic' }, req);
      return true;
    }
    const urls = [
      ...new Set([
        ...(Array.isArray(body.urls) ? body.urls : typeof body.urls === 'string' ? extractUrls(body.urls) : []),
        ...extractUrls(topic)
      ])
    ].slice(0, 6);
    const keywords = extractKeywords(topic);
    const workspaceHits = ResearchEngine.searchWorkspace(swarm.repoPath, keywords, { maxMatches: 10 });
    const allowPrivate = process.env.YUNYU_ALLOW_PRIVATE_RESEARCH === 'true' && Boolean(body.allowPrivateUrls);
    const webSources = await Promise.all(
      urls.map((u) => ResearchEngine.fetchWebSource(u, { allowPrivate }))
    );
    const swarmContext = ResearchEngine.collectSwarmContext(swarm, keywords);
    const report = ResearchEngine.synthesizeReport({ topic, workspaceHits, webSources, swarmContext });

    const entry = swarm.knowledge.addEntry({
      title: report.title,
      category: KNOWLEDGE_CATEGORIES.RESEARCH,
      summary: report.summary,
      content: report.markdown,
      sources: report.sources,
      tags: [...keywords.slice(0, 5), 'research'],
      author: body.author || 'researcher',
      linkedIssueId: body.linkedIssueId || null
    });

    if (body.linkedIssueId && swarm.tasks.getTask(body.linkedIssueId)) {
      swarm.tasks.updateTask(body.linkedIssueId, { linkedKnowledgeIds: [entry.id] });
    }

    let boardMessage = null;
    if (body.postToBoard !== false) {
      boardMessage = swarm.postMessage({
        author: body.author || 'researcher',
        text: `${report.markdown}\n\n> 📚 已归档至共享知识库 \`${entry.id}\``,
        channel: body.channel || 'main',
        kind: MESSAGE_KINDS.DELIVERABLE,
        metadata: { knowledgeId: entry.id, taskId: body.linkedIssueId || null, noWake: true }
      });
    }
    sendJson(res, 201, { entry, boardMessage });
    return true;
  }

  // Real-time CLI / Agent Logs
  if (method === 'GET' && rest === '/logs') {
    const member = url.searchParams.get('member') || null;
    const limit = Math.max(1, Math.min(500, parseFiniteInt(url.searchParams.get('limit'), 120)));
    sendJson(res, 200, { logs: swarm.getAgentLogs({ member, limit }) }, req);
    return true;
  }

  // Graph & Timeline Replay
  if (method === 'GET' && rest === '/graph') {
    const upToSeq = parseFiniteInt(url.searchParams.get('upToSeq'), null);
    const expandAll = url.searchParams.get('expandAll') === 'true';
    const graph = swarm.board.buildGraph({
      upToSeq,
      memberList: swarm.listMembers(),
      expandAll
    });
    sendJson(res, 200, graph, req);
    return true;
  }

  // Members
  if (method === 'POST' && rest === '/members') {
    const body = await readJsonBody(req);
    if (body.driver === 'cli-agent' && !allowCustomCli && body.driverConfig) {
      const { command, commandPrefixArgs, args, env, extraArgs } = body.driverConfig;
      if (command || commandPrefixArgs || args || env || extraArgs) {
        sendJson(res, 403, {
          error: '安全门禁拦截：默认禁止通过 HTTP API 注入自定义 CLI command/args/env，请选用内置 preset（claude-code / codex-cli / gemini-cli）或在服务端启用 YUNYU_ALLOW_CUSTOM_CLI=true'
        }, req);
        return true;
      }
    }
    const created = swarm.addMember(body);
    if (body.saveAsTwin && twinsStore && body.role === 'digital_twin') {
      const cfg = body.driverConfig || {};
      twinsStore.saveTwin({
        name: body.name,
        ownerName: cfg.ownerName || body.name,
        persona: cfg.persona,
        knowledge: cfg.knowledge,
        autonomyMode: cfg.autonomyMode,
        backendDriver: cfg.backendDriver,
        model: body.model,
        escalationKeywords: cfg.escalationKeywords,
        owns: body.owns,
        mustNotTouch: body.mustNotTouch,
        channels: body.channels,
        channel: cfg.channel || null
      });
    }
    const pub = Array.isArray(created) ? created.map((m) => swarm.toPublicMember(m)) : swarm.toPublicMember(created);
    sendJson(res, 201, pub, req);
    return true;
  }

  // Attach saved Personal Digital Twin profile to swarm
  const attachTwinMatch = rest.match(/^\/twins\/([^/]+)\/attach$/);
  if (method === 'POST' && attachTwinMatch) {
    if (!twinsStore) {
      sendJson(res, 500, { error: 'TwinsStore 未初始化' }, req);
      return true;
    }
    const twinId = decodeURIComponent(attachTwinMatch[1]);
    const body = await readJsonBody(req);
    const spec = twinsStore.toMemberSpec(twinId, body);
    const created = swarm.addMember(spec);
    sendJson(res, 201, swarm.toPublicMember(created), req);
    return true;
  }

  const memberModelMatch = rest.match(/^\/members\/([^/]+)\/model$/);
  if (method === 'POST' && memberModelMatch) {
    const name = decodeURIComponent(memberModelMatch[1]);
    const body = await readJsonBody(req);
    const updated = swarm.switchModel(name, body.model, { reason: body.reason });
    sendJson(res, 200, swarm.toPublicMember(updated), req);
    return true;
  }

  const memberResetSessionMatch = rest.match(/^\/members\/([^/]+)\/session\/reset$/);
  if (method === 'POST' && memberResetSessionMatch) {
    const name = decodeURIComponent(memberResetSessionMatch[1]);
    const updated = swarm.resetMemberSession(name);
    sendJson(res, 200, { ok: true, member: updated.name, sessionId: updated.sessionId }, req);
    return true;
  }

  const memberChannelTestMatch = rest.match(/^\/members\/([^/]+)\/channel\/test$/);
  if (method === 'POST' && memberChannelTestMatch) {
    const name = decodeURIComponent(memberChannelTestMatch[1]);
    const member = swarm.members.get(name);
    if (!member) {
      sendJson(res, 404, { error: `未找到成员 "${name}"` }, req);
      return true;
    }
    if (!channelBridge) {
      sendJson(res, 500, { error: 'ChannelBridge 未初始化' }, req);
      return true;
    }
    const body = await readJsonBody(req);
    const chCfg = member.driverConfig?.channel;
    if (!chCfg || !chCfg.type) {
      sendJson(res, 400, { error: `成员 @${name} 尚未配置外部 IM 通道` }, req);
      return true;
    }
    const resPush = await channelBridge.sendOutbound(chCfg, {
      title: `🔔 [${swarm.title}] 数字分身 @${name} 连通性测试`,
      text: body.text || `这是一条来自云驭协同（Yunyu Teamwork）的 IM 通道测试消息（归属人：${member.driverConfig?.ownerName || name}）。`,
      swarmId: swarm.id,
      member: name,
      mode: 'test'
    });
    sendJson(res, 200, resPush, req);
    return true;
  }

  // Per-swarm IM / Bot Inbound Webhook: /api/swarms/:id/channels/inbound/:channelType/:memberName
  const inboundChannelMatch = rest.match(/^\/channels\/inbound\/([^/]+)\/([^/]+)$/);
  if (method === 'POST' && inboundChannelMatch) {
    const channelType = decodeURIComponent(inboundChannelMatch[1]);
    const memberName = decodeURIComponent(inboundChannelMatch[2]);
    return await handleChannelInbound({ req, res, swarm, memberName, channelType, channelBridge });
  }

  const memberDeleteMatch = rest.match(/^\/members\/([^/]+)$/);
  if (method === 'DELETE' && memberDeleteMatch) {
    const name = decodeURIComponent(memberDeleteMatch[1]);
    const force = url.searchParams.get('force') === 'true';
    const killed = swarm.killMember(name, { force });
    sendJson(res, 200, swarm.toPublicMember(killed), req);
    return true;
  }

  // Channels
  if (method === 'POST' && rest === '/channels') {
    const body = await readJsonBody(req);
    const ch = swarm.board.createChannel(body);
    sendJson(res, 201, ch);
    return true;
  }

  // Project World Model: live structural topology & blast-radius impact simulation
  if (method === 'GET' && rest === '/world-model') {
    sendJson(res, 200, swarm.getWorldModelOverview());
    return true;
  }

  if (method === 'POST' && rest === '/world-model/refresh') {
    sendJson(res, 200, swarm.refreshWorldModel());
    return true;
  }

  if (method === 'POST' && rest === '/world-model/impact') {
    const body = await readJsonBody(req);
    const targets = Array.isArray(body.targets)
      ? body.targets
      : typeof body.target === 'string'
        ? [body.target]
        : typeof body.targets === 'string'
          ? body.targets.split(/[,\s]+/).filter(Boolean)
          : [];
    if (targets.length === 0) {
      sendJson(res, 400, { error: '请至少指定一个目标文件路径 (targets)' });
      return true;
    }
    const impact = swarm.simulateChangeImpact(targets);
    sendJson(res, 200, impact);
    return true;
  }

  // Living Project Wiki Archive (append-only versioned docs)
  if (method === 'GET' && rest === '/wiki') {
    const q = url.searchParams.get('q') || '';
    const category = url.searchParams.get('category') || 'all';
    const tag = url.searchParams.get('tag') || '';
    const pages = swarm.wiki.search({ q, category, tag, limit: 100 });
    sendJson(res, 200, { pages });
    return true;
  }

  if (method === 'POST' && rest === '/wiki/generate') {
    const body = await readJsonBody(req);
    const result = swarm.generateWiki({
      projectName: body.projectName || null,
      author: body.author || 'world-model'
    });
    sendJson(res, 200, result);
    return true;
  }

  if (method === 'POST' && rest === '/wiki') {
    const body = await readJsonBody(req);
    const page = swarm.wiki.upsertPage({
      slug: body.slug,
      title: body.title,
      category: body.category || 'custom',
      content: body.content || '',
      author: body.author || 'human',
      summary: body.summary || '更新 Wiki 档案',
      tags: Array.isArray(body.tags)
        ? body.tags
        : String(body.tags || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
    });
    sendJson(res, 201, page);
    return true;
  }

  const wikiSlugMatch = rest.match(/^\/wiki\/([^/]+)$/);
  if (method === 'GET' && wikiSlugMatch) {
    const slug = decodeURIComponent(wikiSlugMatch[1]);
    const page = swarm.wiki.getPage(slug);
    if (!page) {
      sendJson(res, 404, { error: `未找到 Wiki 页面 "${slug}"` });
      return true;
    }
    sendJson(res, 200, page);
    return true;
  }

  // Automated Multi-Perspective Project Audit
  if (method === 'POST' && rest === '/audit') {
    const body = await readJsonBody(req);
    const report = swarm.runProjectAudit({
      createIssues: Boolean(body.createIssues),
      author: body.author || 'auditor'
    });
    sendJson(res, 200, report);
    return true;
  }

  // Ownership check
  if (method === 'POST' && rest === '/ownership/check') {
    const body = await readJsonBody(req);
    sendJson(res, 200, swarm.ownership.checkWrite(body.member, body.filePath));
    return true;
  }

  // Worktree merge & diff
  const mergeMatch = rest.match(/^\/worktrees\/([^/]+)\/merge$/);
  if (method === 'POST' && mergeMatch) {
    const name = decodeURIComponent(mergeMatch[1]);
    const body = await readJsonBody(req);
    if (swarm.plugins?.hooks) {
      const preMerge = await swarm.plugins.hooks.run(
        'PreMerge',
        { swarmId: swarm.id, member: name, text: body.commitMessage || '' },
        { cwd: swarm.repoPath }
      );
      if (!preMerge.allowed) {
        sendJson(res, 403, { error: `PreMerge Hook 拦截合并: ${preMerge.reason}` }, req);
        return true;
      }
    }
    const resMerge = swarm.worktrees.mergeToBase(name, { commitMessage: body.commitMessage });
    swarm._saveMeta();
    swarm.emit('status', swarm.getStatus());
    sendJson(res, 200, resMerge, req);
    return true;
  }

  const diffMatch = rest.match(/^\/worktrees\/([^/]+)\/diff$/);
  if (method === 'GET' && diffMatch) {
    const name = decodeURIComponent(diffMatch[1]);
    sendJson(res, 200, {
      member: name,
      status: swarm.worktrees.getStatus(name),
      diff: swarm.worktrees.getDiff(name),
      commits: swarm.worktrees.getLog(name, { limit: 10 })
    });
    return true;
  }

  // Per-swarm GitLab Webhook
  if (method === 'POST' && rest === '/webhooks/gitlab') {
    return await handleGitLabWebhookRequest({ req, res, manager, swarmId, webhookSecret });
  }

  // Reconnect / update GitLab connection at runtime
  if (method === 'POST' && rest === '/gitlab/reconnect') {
    const body = await readJsonBody(req);
    swarm.connectGitLab({
      baseUrl: body.baseUrl,
      projectId: body.projectId,
      token: body.token || '',
      tokenEnv: body.tokenEnv || 'GITLAB_TOKEN',
      linkedIssueIid: body.linkedIssueIid ?? null,
      linkedMrIid: body.linkedMrIid ?? null,
      mirrorKinds: body.mirrorKinds || null,
      persistToken: Boolean(body.persistToken)
    });
    sendJson(res, 200, { ok: true, gitlab: swarm.getStatus().gitlab });
    return true;
  }

  // GitLab Project Overview & Operations
  if (method === 'GET' && rest === '/gitlab/overview') {
    if (!swarm.gitlab?.client || !swarm.gitlab?.projectId) {
      sendJson(res, 200, { connected: false });
      return true;
    }
    const { client, projectId, sync } = swarm.gitlab;
    const [project, issues, mergeRequests, pipelines, branches] = await Promise.all([
      client.getProject(projectId),
      client.listIssues(projectId),
      client.listMergeRequests(projectId),
      client.listPipelines(projectId),
      client.listBranches(projectId)
    ]);
    sendJson(res, 200, {
      connected: true,
      rehydrated: Boolean(swarm.gitlab.rehydrated),
      projectId,
      baseUrl: client.baseUrl,
      project,
      issues,
      mergeRequests,
      pipelines,
      branches,
      syncLog: sync?.syncLog || []
    });
    return true;
  }

  if (method === 'POST' && rest === '/gitlab/issues') {
    if (!swarm.gitlab?.client || !swarm.gitlab?.projectId) {
      sendJson(res, 400, { error: '当前蜂群未连接 GitLab 实例' });
      return true;
    }
    const body = await readJsonBody(req);
    const issue = await swarm.gitlab.client.createIssue(swarm.gitlab.projectId, {
      title: body.title,
      description: body.description || '',
      labels: body.labels || 'agent::ready,teamwork::planning'
    });
    swarm.gitlab.linkedIssueIid = issue.iid;
    swarm._saveMeta();
    if (body.triggerSwarm !== false) {
      const translated = translateGitLabWebhook('Issue Hook', {
        object_kind: 'issue',
        project: { path_with_namespace: swarm.gitlab.projectId },
        user: { name: body.author || '项目经理' },
        object_attributes: {
          iid: issue.iid,
          title: issue.title,
          description: issue.description,
          action: 'open',
          url: issue.web_url
        },
        labels: issue.labels
      });
      swarm.postMessage({
        author: 'gitlab',
        text: translated.text,
        channel: translated.channel,
        kind: translated.kind,
        metadata: translated.metadata
      });
    }
    sendJson(res, 201, issue);
    return true;
  }

  // GitLab Issue Notes Preview & Direct Reply
  const issueNotesMatch = rest.match(/^\/gitlab\/issues\/(\d+)\/notes$/);
  if (issueNotesMatch) {
    if (!swarm.gitlab?.client || !swarm.gitlab?.projectId) {
      sendJson(res, 400, { error: '当前蜂群未连接 GitLab 实例' });
      return true;
    }
    const iid = Number(issueNotesMatch[1]);
    if (method === 'GET') {
      const notes = await swarm.gitlab.client.listIssueNotes(swarm.gitlab.projectId, iid);
      sendJson(res, 200, { issueIid: iid, notes: Array.isArray(notes) ? notes : [] });
      return true;
    }
    if (method === 'POST') {
      const body = await readJsonBody(req);
      const noteText = String(body.body || '').trim();
      if (!noteText) {
        sendJson(res, 400, { error: '评论内容不能为空' });
        return true;
      }
      const created = await swarm.gitlab.client.createIssueNote(swarm.gitlab.projectId, iid, noteText);
      if (body.postToBoard) {
        const authorName = body.author || 'human';
        swarm.postMessage({
          author: 'gitlab',
          text: `[GitLab Issue #${iid} 评论 · ${authorName}]\n${noteText}`,
          channel: body.channel || 'main',
          kind: 'gitlab',
          metadata: { gitlabEvent: 'note', gitlabIssueIid: iid, noteId: created.id }
        });
      }
      sendJson(res, 201, created);
      return true;
    }
  }

  // GitLab MR Notes Preview & Direct Reply
  const mrNotesMatch = rest.match(/^\/gitlab\/mrs\/(\d+)\/notes$/);
  if (mrNotesMatch) {
    if (!swarm.gitlab?.client || !swarm.gitlab?.projectId) {
      sendJson(res, 400, { error: '当前蜂群未连接 GitLab 实例' });
      return true;
    }
    const iid = Number(mrNotesMatch[1]);
    if (method === 'GET') {
      const notes = await swarm.gitlab.client.request(
        'GET',
        `/api/v4/projects/${encodeURIComponent(String(swarm.gitlab.projectId))}/merge_requests/${iid}/notes`
      );
      sendJson(res, 200, { mrIid: iid, notes: Array.isArray(notes) ? notes : [] });
      return true;
    }
    if (method === 'POST') {
      const body = await readJsonBody(req);
      const noteText = String(body.body || '').trim();
      if (!noteText) {
        sendJson(res, 400, { error: '评论内容不能为空' });
        return true;
      }
      const created = await swarm.gitlab.client.createMergeRequestNote(swarm.gitlab.projectId, iid, noteText);
      sendJson(res, 201, created);
      return true;
    }
  }

  if (method === 'POST' && rest === '/gitlab/mrs') {
    if (!swarm.gitlab?.client || !swarm.gitlab?.projectId) {
      sendJson(res, 400, { error: '当前蜂群未连接 GitLab 实例' });
      return true;
    }
    const body = await readJsonBody(req);
    const mr = await swarm.gitlab.client.createMergeRequest(swarm.gitlab.projectId, {
      source_branch: body.sourceBranch,
      target_branch: body.targetBranch || 'main',
      title: body.title,
      description: body.description || ''
    });
    swarm.gitlab.linkedMrIid = mr.iid;
    swarm._saveMeta();
    sendJson(res, 201, mr);
    return true;
  }

  const mrMergeMatch = rest.match(/^\/gitlab\/mrs\/(\d+)\/merge$/);
  if (method === 'POST' && mrMergeMatch) {
    if (!swarm.gitlab?.client || !swarm.gitlab?.projectId) {
      sendJson(res, 400, { error: '当前蜂群未连接 GitLab 实例' });
      return true;
    }
    const iid = Number(mrMergeMatch[1]);
    const merged = await swarm.gitlab.client.mergeMergeRequest(swarm.gitlab.projectId, iid);
    swarm.postMessage({
      author: 'gitlab',
      text: `@release [GitLab MR !${iid} 已合入] 分支 \`${merged.source_branch}\` → \`${merged.target_branch}\` 已通过合并门禁并触发主分支 CI 流水线。`,
      channel: 'main',
      kind: 'gitlab',
      metadata: { gitlabEvent: 'merge_request', gitlabMrIid: iid, action: 'merge' }
    });
    sendJson(res, 200, merged);
    return true;
  }

  return false;
}

async function handleChannelInbound({ req, res, swarm, memberName, channelType, channelBridge }) {
  if (!channelBridge) {
    sendJson(res, 500, { error: 'ChannelBridge 未初始化' });
    return true;
  }
  const rawBody = await readRawBody(req);
  const result = await channelBridge.handleInboundForMember({
    swarm,
    memberName,
    channelType,
    headers: req.headers,
    rawBody
  });
  if (result.challengeResponse) {
    sendJson(res, 200, result.challengeResponse);
    return true;
  }
  if (!result.accepted) {
    sendJson(res, result.statusCode || 202, result);
    return true;
  }
  sendJson(res, 200, result);
  return true;
}

async function handleGitLabWebhookRequest({ req, res, manager, swarmId, webhookSecret }) {
  if (!verifyGitLabWebhookToken(req.headers, webhookSecret)) {
    sendJson(res, 401, { error: 'GitLab Webhook X-Gitlab-Token 验签失败' });
    return true;
  }
  const eventHeader = req.headers['x-gitlab-event'] || '';
  const payload = await readJsonBody(req);
  const translated = translateGitLabWebhook(eventHeader, payload);
  if (!translated.accepted) {
    sendJson(res, 202, { ignored: true, reason: translated.reason });
    return true;
  }

  let targetSwarm = swarmId ? manager.getSwarm(swarmId) : null;
  if (!targetSwarm) {
    const projectPath = payload.project?.path_with_namespace;
    if (projectPath) {
      for (const s of manager.swarms.values()) {
        if (s.gitlab?.projectId === projectPath) {
          targetSwarm = s;
          break;
        }
      }
    } else {
      targetSwarm = [...manager.swarms.values()][0] || null;
    }
  }

  if (!targetSwarm) {
    sendJson(res, 404, { error: '尚无活跃蜂群可接收该 GitLab Webhook 事件' });
    return true;
  }

  const msg = targetSwarm.postMessage({
    author: 'gitlab',
    text: translated.text,
    channel: translated.channel,
    kind: translated.kind,
    metadata: translated.metadata
  });

  sendJson(res, 200, { ok: true, swarmId: targetSwarm.id, seq: msg.seq, eventType: translated.eventType });
  return true;
}
