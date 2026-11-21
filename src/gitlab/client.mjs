/**
 * Zero-dependency GitLab REST API v4 Client (compatible with gitlab.com & self-hosted CE/EE).
 */
export class GitLabClient {
  constructor({ baseUrl = 'https://gitlab.com', token = '', timeoutMs = 15_000 } = {}) {
    this.baseUrl = String(baseUrl || 'https://gitlab.com').replace(/\/+$/, '');
    this.token = token || '';
    this.timeoutMs = timeoutMs;
  }

  _projectPath(projectId) {
    return `/api/v4/projects/${encodeURIComponent(String(projectId))}`;
  }

  async request(method, apiPath, { query = null, body = null } = {}) {
    const url = new URL(`${this.baseUrl}${apiPath}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') {
          url.searchParams.set(k, String(v));
        }
      }
    }

    const headers = {
      Accept: 'application/json',
      'User-Agent': 'Yunyu-Teamwork/0.1.0'
    };
    if (this.token) headers['PRIVATE-TOKEN'] = this.token;
    if (body !== null && body !== undefined) headers['Content-Type'] = 'application/json';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body !== null && body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });

      const text = await res.text();
      let json = null;
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = { raw: text };
        }
      }

      if (!res.ok) {
        const detail = json?.message || json?.error || text.slice(0, 200);
        throw new Error(`GitLab API ${method} ${apiPath} 失败 (HTTP ${res.status}): ${detail}`);
      }
      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  // ---- Projects ----
  getProject(projectId) {
    return this.request('GET', this._projectPath(projectId));
  }

  // ---- Issues ----
  listIssues(projectId, query = {}) {
    return this.request('GET', `${this._projectPath(projectId)}/issues`, { query });
  }

  getIssue(projectId, issueIid) {
    return this.request('GET', `${this._projectPath(projectId)}/issues/${issueIid}`);
  }

  createIssue(projectId, payload) {
    return this.request('POST', `${this._projectPath(projectId)}/issues`, { body: payload });
  }

  updateIssue(projectId, issueIid, payload) {
    return this.request('PUT', `${this._projectPath(projectId)}/issues/${issueIid}`, { body: payload });
  }

  listIssueNotes(projectId, issueIid) {
    return this.request('GET', `${this._projectPath(projectId)}/issues/${issueIid}/notes`);
  }

  createIssueNote(projectId, issueIid, body) {
    return this.request('POST', `${this._projectPath(projectId)}/issues/${issueIid}/notes`, {
      body: { body }
    });
  }

  // ---- Merge Requests ----
  listMergeRequests(projectId, query = {}) {
    return this.request('GET', `${this._projectPath(projectId)}/merge_requests`, { query });
  }

  getMergeRequest(projectId, mrIid) {
    return this.request('GET', `${this._projectPath(projectId)}/merge_requests/${mrIid}`);
  }

  createMergeRequest(projectId, payload) {
    return this.request('POST', `${this._projectPath(projectId)}/merge_requests`, { body: payload });
  }

  createMergeRequestNote(projectId, mrIid, body) {
    return this.request('POST', `${this._projectPath(projectId)}/merge_requests/${mrIid}/notes`, {
      body: { body }
    });
  }

  mergeMergeRequest(projectId, mrIid, payload = {}) {
    return this.request('PUT', `${this._projectPath(projectId)}/merge_requests/${mrIid}/merge`, {
      body: payload
    });
  }

  // ---- Pipelines & Branches ----
  listPipelines(projectId, query = {}) {
    return this.request('GET', `${this._projectPath(projectId)}/pipelines`, { query });
  }

  getPipeline(projectId, pipelineId) {
    return this.request('GET', `${this._projectPath(projectId)}/pipelines/${pipelineId}`);
  }

  listPipelineJobs(projectId, pipelineId) {
    return this.request('GET', `${this._projectPath(projectId)}/pipelines/${pipelineId}/jobs`);
  }

  listBranches(projectId) {
    return this.request('GET', `${this._projectPath(projectId)}/repository/branches`);
  }

  createBranch(projectId, { branch, ref = 'main' }) {
    return this.request('POST', `${this._projectPath(projectId)}/repository/branches`, {
      body: { branch, ref }
    });
  }
}
