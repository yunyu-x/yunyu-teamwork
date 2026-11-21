import { listTemplates } from '../core/templates.mjs';
import { GitLabClient, GitLabSyncService, translateGitLabWebhook, verifyGitLabWebhookToken } from '../gitlab/index.mjs';

export async function readJsonBody(req, maxBytes = 2 * 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('请求体超出 2MB 限制');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

export function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

/**
 * Dispatch HTTP REST API requests for Yunyu Teamwork.
 */
export async function handleApiRoute({ req, res, url, manager, sse, mcpServer, webhookSecret = '' }) {
  const method = req.method;
  const pathname = url.pathname;

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Gitlab-Event, X-Gitlab-Token'
    });
    res.end();
    return true;
  }

  // Health & Metadata
  if (method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      name: 'yunyu-teamwork',
      version: '0.1.0',
      node: process.version,
      uptimeSec: Math.round(process.uptime()),
      swarmCount: manager.listSwarms().length,
      drivers: manager.driverRegistry ? manager.driverRegistry.list() : [],
      templates: listTemplates()
    });
    return true;
  }

  // Global or per-swarm SSE stream
  if (method === 'GET' && pathname === '/api/events') {
    const swarmId = url.searchParams.get('swarmId') || null;
    sse.subscribe(res, { swarmId });
    return true;
  }

  // MCP over HTTP JSON-RPC 2.0
  if (method === 'POST' && pathname === '/api/mcp') {
    const rpcReq = await readJsonBody(req);
    const rpcResp = await mcpServer.handleRpc(rpcReq);
    sendJson(res, 200, rpcResp || { jsonrpc: '2.0', result: null });
    return true;
  }

  // Swarms collection
  if (method === 'GET' && pathname === '/api/swarms') {
    sendJson(res, 200, { swarms: manager.listSwarms() });
    return true;
  }

  if (method === 'POST' && pathname === '/api/swarms') {
    const body = await readJsonBody(req);
    let gitlab = null;
    if (body.gitlab?.baseUrl && body.gitlab?.projectId) {
      const client = new GitLabClient({
        baseUrl: body.gitlab.baseUrl,
        token: body.gitlab.token || process.env.GITLAB_TOKEN || ''
      });
      const sync = new GitLabSyncService({
        client,
        projectId: body.gitlab.projectId,
        issueIid: body.gitlab.linkedIssueIid || null,
        mrIid: body.gitlab.linkedMrIid || null
      });
      gitlab = {
        client,
        sync,
        projectId: body.gitlab.projectId,
        linkedIssueIid: body.gitlab.linkedIssueIid || null,
        linkedMrIid: body.gitlab.linkedMrIid || null
      };
    }
    const swarm = manager.createSwarm({
      id: body.id || null,
      title: body.title,
      repoPath: body.repoPath || manager.defaultRepoPath,
      templateId: body.templateId || null,
      contract: body.contract || null,
      gitlab,
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
    const since = url.searchParams.has('since') ? Number(url.searchParams.get('since')) : null;
    const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 100;
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

  // Graph & Timeline Replay
  if (method === 'GET' && rest === '/graph') {
    const upToSeq = url.searchParams.has('upToSeq') ? Number(url.searchParams.get('upToSeq')) : null;
    const expandAll = url.searchParams.get('expandAll') === 'true';
    const graph = swarm.board.buildGraph({
      upToSeq,
      memberList: swarm.listMembers(),
      expandAll
    });
    sendJson(res, 200, graph);
    return true;
  }

  // Members
  if (method === 'POST' && rest === '/members') {
    const body = await readJsonBody(req);
    const created = swarm.addMember(body);
    sendJson(res, 201, created);
    return true;
  }

  const memberModelMatch = rest.match(/^\/members\/([^/]+)\/model$/);
  if (method === 'POST' && memberModelMatch) {
    const name = decodeURIComponent(memberModelMatch[1]);
    const body = await readJsonBody(req);
    const updated = swarm.switchModel(name, body.model, { reason: body.reason });
    sendJson(res, 200, updated);
    return true;
  }

  const memberDeleteMatch = rest.match(/^\/members\/([^/]+)$/);
  if (method === 'DELETE' && memberDeleteMatch) {
    const name = decodeURIComponent(memberDeleteMatch[1]);
    const force = url.searchParams.get('force') === 'true';
    const killed = swarm.killMember(name, { force });
    sendJson(res, 200, killed);
    return true;
  }

  // Channels
  if (method === 'POST' && rest === '/channels') {
    const body = await readJsonBody(req);
    const ch = swarm.board.createChannel(body);
    sendJson(res, 201, ch);
    return true;
  }

  // Ownership check
  if (method === 'POST' && rest === '/ownership/check') {
    const body = await readJsonBody(req);
    sendJson(res, 200, swarm.ownership.checkWrite(body.member, body.filePath));
    return true;
  }

  // Worktree merge
  const mergeMatch = rest.match(/^\/worktrees\/([^/]+)\/merge$/);
  if (method === 'POST' && mergeMatch) {
    const name = decodeURIComponent(mergeMatch[1]);
    const body = await readJsonBody(req);
    const resMerge = swarm.worktrees.mergeToBase(name, { commitMessage: body.commitMessage });
    sendJson(res, 200, resMerge);
    return true;
  }

  // Per-swarm GitLab Webhook
  if (method === 'POST' && rest === '/webhooks/gitlab') {
    return await handleGitLabWebhookRequest({ req, res, manager, swarmId, webhookSecret });
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
    for (const s of manager.swarms.values()) {
      if (projectPath && s.gitlab?.projectId === projectPath) {
        targetSwarm = s;
        break;
      }
    }
    if (!targetSwarm) targetSwarm = [...manager.swarms.values()][0] || null;
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
