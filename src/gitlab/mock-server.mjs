import http from 'node:http';

const WHATWG_BAD_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723,
  2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
  6697, 10080
]);

/**
 * Lightweight Local GitLab REST API v4 Simulator:
 * Enables offline end-to-end demos, air-gapped onboarding, and 100% deterministic CI tests
 * without requiring internet access or live GitLab tokens.
 */
export class GitLabMockServer {
  constructor({ projectPath = 'yunyu/order-service', webhookTargetUrl = null, webhookSecret = '' } = {}) {
    this.projectPath = projectPath;
    this.webhookTargetUrl = webhookTargetUrl;
    this.webhookSecret = webhookSecret;
    this.server = null;
    this.port = 0;
    this.baseUrl = '';

    this.state = {
      project: {
        id: 101,
        name: projectPath.split('/').pop(),
        path_with_namespace: projectPath,
        default_branch: 'main',
        web_url: `http://127.0.0.1/gitlab/${projectPath}`,
        description: '云驭协同（Yunyu Teamwork）GitLab 示例演练仓库'
      },
      nextIssueIid: 2,
      nextMrIid: 1,
      nextNoteId: 100,
      nextPipelineId: 501,
      issues: [
        {
          id: 1001,
          iid: 1,
          project_id: 101,
          title: '实现订单限流中间件与实时监控面板（含单元与集成测试）',
          description:
            '背景：大促期间订单创建接口需要基于令牌桶算法进行限流保护，并输出前端监控面板指标。\n验收标准：\n1. src/rate-limiter.mjs 实现令牌桶限流器；\n2. src/dashboard-widget.mjs 提供中文状态卡片；\n3. tests/rate-limiter.test.mjs 全部通过且 QA 无越权修改。',
          state: 'opened',
          labels: ['feature', 'agent::ready', 'teamwork::planning'],
          author: { username: 'pm-lin', name: '林产品' },
          web_url: `http://127.0.0.1/gitlab/${projectPath}/-/issues/1`,
          created_at: new Date().toISOString(),
          notes: []
        }
      ],
      mergeRequests: [],
      pipelines: [
        {
          id: 500,
          iid: 1,
          ref: 'main',
          status: 'success',
          duration: 18,
          web_url: `http://127.0.0.1/gitlab/${projectPath}/-/pipelines/500`,
          created_at: new Date().toISOString(),
          jobs: [
            { id: 1, stage: 'lint', name: 'syntax-check', status: 'success' },
            { id: 2, stage: 'test', name: 'unit-tests', status: 'success' }
          ]
        }
      ],
      branches: [{ name: 'main', default: true, protected: true }]
    };
  }

  async start(port = 0, host = '127.0.0.1') {
    for (let attempt = 0; attempt < 8; attempt++) {
      const srv = http.createServer((req, res) => this._handle(req, res));
      await new Promise((resolve) => srv.listen(port, host, resolve));
      const addr = srv.address();
      if (port === 0 && WHATWG_BAD_PORTS.has(addr.port)) {
        await new Promise((resolve) => srv.close(resolve));
        continue;
      }
      this.server = srv;
      this.port = addr.port;
      this.baseUrl = `http://${host}:${this.port}`;
      this.state.project.web_url = `${this.baseUrl}/${this.projectPath}`;
      return this.baseUrl;
    }
    throw new Error('无法分配有效的本地监听端口');
  }

  async close() {
    if (!this.server) return;
    await new Promise((resolve) => this.server.close(resolve));
    this.server = null;
  }

  async _readJson(req) {
    let raw = '';
    for await (const chunk of req) raw += chunk.toString('utf8');
    return raw ? JSON.parse(raw) : {};
  }

  _send(res, status, data) {
    const body = JSON.stringify(data);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body)
    });
    res.end(body);
  }

  async dispatchWebhook(eventName, payload) {
    if (!this.webhookTargetUrl) return null;
    const headers = {
      'Content-Type': 'application/json',
      'X-Gitlab-Event': eventName
    };
    if (this.webhookSecret) headers['X-Gitlab-Token'] = this.webhookSecret;
    const res = await fetch(this.webhookTargetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    return { status: res.status, body: await res.text() };
  }

  async _handle(req, res) {
    try {
      const url = new URL(req.url, this.baseUrl);
      const p = url.pathname;
      const m = req.method;

      // Match /api/v4/projects/:projectId...
      const match = p.match(/^\/api\/v4\/projects\/([^/]+)(.*)$/);
      if (!match) {
        return this._send(res, 404, { error: 'Not Found', path: p });
      }
      const rest = match[2] || '';

      if (m === 'GET' && (rest === '' || rest === '/')) {
        return this._send(res, 200, this.state.project);
      }

      // Issues
      if (m === 'GET' && rest === '/issues') {
        return this._send(res, 200, this.state.issues);
      }
      if (m === 'POST' && rest === '/issues') {
        const body = await this._readJson(req);
        const iid = this.state.nextIssueIid++;
        const issue = {
          id: 1000 + iid,
          iid,
          project_id: this.state.project.id,
          title: body.title || `Issue #${iid}`,
          description: body.description || '',
          state: 'opened',
          labels: body.labels ? String(body.labels).split(',').filter(Boolean) : ['agent::ready'],
          author: { username: 'human', name: '项目管理员' },
          web_url: `${this.baseUrl}/${this.projectPath}/-/issues/${iid}`,
          created_at: new Date().toISOString(),
          notes: []
        };
        this.state.issues.unshift(issue);
        return this._send(res, 201, issue);
      }

      const issueMatch = rest.match(/^\/issues\/(\d+)$/);
      if (issueMatch) {
        const iid = Number(issueMatch[1]);
        const issue = this.state.issues.find((i) => i.iid === iid);
        if (!issue) return this._send(res, 404, { message: 'Issue not found' });
        if (m === 'GET') return this._send(res, 200, issue);
        if (m === 'PUT') {
          const body = await this._readJson(req);
          if (body.title !== undefined) issue.title = body.title;
          if (body.description !== undefined) issue.description = body.description;
          if (body.state_event === 'close') issue.state = 'closed';
          if (body.state_event === 'reopen') issue.state = 'opened';
          if (body.labels !== undefined) {
            issue.labels = Array.isArray(body.labels)
              ? body.labels
              : String(body.labels).split(',').map((s) => s.trim()).filter(Boolean);
          }
          return this._send(res, 200, issue);
        }
      }

      const issueNotesMatch = rest.match(/^\/issues\/(\d+)\/notes$/);
      if (issueNotesMatch) {
        const iid = Number(issueNotesMatch[1]);
        const issue = this.state.issues.find((i) => i.iid === iid);
        if (!issue) return this._send(res, 404, { message: 'Issue not found' });
        if (m === 'GET') return this._send(res, 200, issue.notes);
        if (m === 'POST') {
          const body = await this._readJson(req);
          const note = {
            id: this.state.nextNoteId++,
            body: body.body || '',
            author: { username: 'yunyu-bot', name: '云驭协同机器人' },
            created_at: new Date().toISOString()
          };
          issue.notes.push(note);
          return this._send(res, 201, note);
        }
      }

      // Merge Requests
      if (m === 'GET' && rest === '/merge_requests') {
        return this._send(res, 200, this.state.mergeRequests);
      }
      if (m === 'POST' && rest === '/merge_requests') {
        const body = await this._readJson(req);
        const iid = this.state.nextMrIid++;
        const mr = {
          id: 2000 + iid,
          iid,
          project_id: this.state.project.id,
          title: body.title || `MR !${iid}`,
          description: body.description || '',
          source_branch: body.source_branch || 'feature',
          target_branch: body.target_branch || 'main',
          state: 'opened',
          web_url: `${this.baseUrl}/${this.projectPath}/-/merge_requests/${iid}`,
          created_at: new Date().toISOString(),
          notes: []
        };
        this.state.mergeRequests.unshift(mr);
        return this._send(res, 201, mr);
      }

      const mrMatch = rest.match(/^\/merge_requests\/(\d+)$/);
      if (mrMatch) {
        const iid = Number(mrMatch[1]);
        const mr = this.state.mergeRequests.find((x) => x.iid === iid);
        if (!mr) return this._send(res, 404, { message: 'MR not found' });
        if (m === 'GET') return this._send(res, 200, mr);
      }

      const mrNotesMatch = rest.match(/^\/merge_requests\/(\d+)\/notes$/);
      if (mrNotesMatch) {
        const iid = Number(mrNotesMatch[1]);
        const mr = this.state.mergeRequests.find((x) => x.iid === iid);
        if (!mr) return this._send(res, 404, { message: 'MR not found' });
        if (m === 'GET') return this._send(res, 200, mr.notes);
        if (m === 'POST') {
          const body = await this._readJson(req);
          const note = {
            id: this.state.nextNoteId++,
            body: body.body || '',
            author: { username: 'yunyu-bot', name: '云驭协同机器人' },
            created_at: new Date().toISOString()
          };
          mr.notes.push(note);
          return this._send(res, 201, note);
        }
      }

      const mrMergeMatch = rest.match(/^\/merge_requests\/(\d+)\/merge$/);
      if (m === 'PUT' && mrMergeMatch) {
        const iid = Number(mrMergeMatch[1]);
        const mr = this.state.mergeRequests.find((x) => x.iid === iid);
        if (!mr) return this._send(res, 404, { message: 'MR not found' });
        mr.state = 'merged';
        mr.merged_at = new Date().toISOString();
        const pid = this.state.nextPipelineId++;
        this.state.pipelines.unshift({
          id: pid,
          iid: this.state.pipelines.length + 1,
          ref: mr.target_branch,
          status: 'success',
          duration: 14,
          web_url: `${this.baseUrl}/${this.projectPath}/-/pipelines/${pid}`,
          created_at: new Date().toISOString(),
          jobs: [
            { id: pid * 10 + 1, stage: 'lint', name: 'syntax-check', status: 'success' },
            { id: pid * 10 + 2, stage: 'test', name: 'integration-tests', status: 'success' },
            { id: pid * 10 + 3, stage: 'verify', name: 'ownership-audit', status: 'success' }
          ]
        });
        return this._send(res, 200, mr);
      }

      // Pipelines & Branches
      if (m === 'GET' && rest === '/pipelines') {
        return this._send(res, 200, this.state.pipelines);
      }
      const pipeMatch = rest.match(/^\/pipelines\/(\d+)$/);
      if (m === 'GET' && pipeMatch) {
        const pipe = this.state.pipelines.find((x) => x.id === Number(pipeMatch[1]));
        return pipe ? this._send(res, 200, pipe) : this._send(res, 404, { message: 'Pipeline not found' });
      }
      const pipeJobsMatch = rest.match(/^\/pipelines\/(\d+)\/jobs$/);
      if (m === 'GET' && pipeJobsMatch) {
        const pipe = this.state.pipelines.find((x) => x.id === Number(pipeJobsMatch[1]));
        return pipe ? this._send(res, 200, pipe.jobs || []) : this._send(res, 404, { message: 'Pipeline not found' });
      }
      if (m === 'GET' && rest === '/repository/branches') {
        return this._send(res, 200, this.state.branches);
      }
      if (m === 'POST' && rest === '/repository/branches') {
        const body = await this._readJson(req);
        const br = { name: body.branch, default: false, protected: false };
        this.state.branches.push(br);
        return this._send(res, 201, br);
      }

      return this._send(res, 404, { error: 'Unsupported GitLab Mock endpoint', method: m, rest });
    } catch (err) {
      this._send(res, 500, { error: err.message });
    }
  }
}
