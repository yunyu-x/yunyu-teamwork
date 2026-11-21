import { t } from '../i18n.js';
import { $, api, escapeHtml, formatRichText, formatTime, showToast, state } from '../lib/state.js';

export async function loadIssueNotes(iid) {
  if (!state.currentSwarmId) return;
  const data = await api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/gitlab/issues/${encodeURIComponent(iid)}/notes`);
  state.issueNotesMap.set(iid, data.notes || []);
}

export function renderGitLab({ refreshCurrentSwarm }) {
  const el = $('#gitlab-view-body');
  if (!el) return;
  if (!state.gitlab || !state.gitlab.connected) {
    el.innerHTML = `<div class="panel-card"><p>${escapeHtml(t(state.lang, 'gitlabDisconnected'))}</p></div>`;
    return;
  }

  const { project, issues = [], mergeRequests = [], pipelines = [], syncLog = [] } = state.gitlab;
  el.innerHTML = `
    <div class="section-stack">
      <div class="panel-card">
        <h3>
          <span>🦊 GitLab 仓库：<code>${escapeHtml(project?.path_with_namespace || state.gitlab.projectId)}</code></span>
          <span class="badge gitlab">${escapeHtml(state.gitlab.baseUrl)}</span>
        </h3>
        <form id="gitlab-issue-form" class="inline-form">
          <input id="gl-issue-title" type="text" placeholder="输入新 GitLab Issue 标题（提交后将自动唤醒 @coordinator 拆解研发）" style="flex:1 1 280px" required />
          <input id="gl-issue-desc" type="text" placeholder="验收标准 / 需求描述（可选）" style="flex:1 1 240px" />
          <button type="submit" class="btn primary">${escapeHtml(t(state.lang, 'gitlabNewIssue'))}</button>
        </form>
      </div>

      <div class="two-col">
        <div class="panel-card">
          <h3><span>${escapeHtml(t(state.lang, 'gitlabIssues'))}</span><span class="badge">${issues.length}</span></h3>
          ${
            issues
              .map((iss) => {
                const iid = escapeHtml(iss.iid);
                const isOpen = state.openIssueNotes.has(iss.iid);
                const loadedNotes = state.issueNotesMap.has(iss.iid) ? state.issueNotesMap.get(iss.iid) : iss.notes || [];
                return `
            <div class="item-box" data-issue-card="${iid}">
              <div class="item-box-title">#${iid} ${escapeHtml(iss.title)}</div>
              <div style="font-size:12px;color:var(--text-muted);">${escapeHtml((iss.description || '').slice(0, 140))}</div>
              <div class="label-list" style="align-items:center;justify-content:space-between;">
                <div style="display:flex;flex-wrap:wrap;gap:5px;">
                  <span class="badge ${iss.state === 'opened' ? 'deliverable' : ''}">${escapeHtml(iss.state)}</span>
                  ${(iss.labels || []).map((lb) => `<span class="badge">${escapeHtml(lb)}</span>`).join('')}
                  <span class="badge">💬 ${loadedNotes.length} 条评论</span>
                </div>
                <button type="button" class="btn small" data-toggle-issue-notes="${iid}">
                  ${isOpen ? '收起评论' : escapeHtml(t(state.lang, 'gitlabNotesToggle'))}
                </button>
              </div>
              ${
                isOpen
                  ? `<div class="notes-drawer" id="issue-notes-drawer-${iid}">
                      <div class="notes-scroll">
                      ${
                        loadedNotes.length
                          ? loadedNotes
                              .map(
                                (n) => `
                            <div class="note-item">
                              <div class="note-item-head">
                                <span>@${escapeHtml(n.author?.username || n.author?.name || 'gitlab')}</span>
                                <span>${formatTime(n.created_at)}</span>
                              </div>
                              <div style="white-space:pre-wrap;word-break:break-word;">${formatRichText(n.body || '')}</div>
                            </div>`
                              )
                              .join('')
                          : `<div style="font-size:12px;color:var(--text-dim);margin-bottom:8px;">暂无评论，立即发表第一条评论</div>`
                      }
                      </div>
                      <form class="inline-form" data-issue-note-form="${iid}" style="margin-top:6px;">
                        <input type="text" name="noteBody" placeholder="直接回复 GitLab Issue #${iid} 评论..." style="flex:1 1 200px" required />
                        <label class="graph-toggle" style="font-size:11.5px;">
                          <input type="checkbox" name="postToBoard" checked />
                          <span>${escapeHtml(t(state.lang, 'gitlabNotesMirror'))}</span>
                        </label>
                        <button type="submit" class="btn small primary">${escapeHtml(t(state.lang, 'gitlabNotesSubmit'))}</button>
                      </form>
                    </div>`
                  : ''
              }
            </div>`;
              })
              .join('') || '<div class="empty-state">暂无 Issues</div>'
          }
        </div>

        <div class="panel-card">
          <h3><span>${escapeHtml(t(state.lang, 'gitlabMrs'))}</span><span class="badge">${mergeRequests.length}</span></h3>
          ${
            mergeRequests
              .map(
                (mr) => `
            <div class="item-box">
              <div class="item-box-title">!${escapeHtml(mr.iid)} ${escapeHtml(mr.title)}</div>
              <div style="font-size:12px;font-family:var(--mono);color:var(--text-muted);">${escapeHtml(mr.source_branch)} → ${escapeHtml(mr.target_branch)}</div>
              <div class="label-list" style="align-items:center;justify-content:space-between;">
                <span class="badge ${mr.state === 'merged' ? 'done' : 'gitlab'}">${escapeHtml(mr.state)}</span>
                ${
                  mr.state === 'opened'
                    ? `<button type="button" class="btn small primary" data-merge-mr="${escapeHtml(mr.iid)}">批准并合并 MR</button>`
                    : ''
                }
              </div>
            </div>`
              )
              .join('') || '<div class="empty-state">暂无 Merge Requests</div>'
          }
        </div>
      </div>

      <div class="two-col">
        <div class="panel-card">
          <h3><span>${escapeHtml(t(state.lang, 'gitlabPipelines'))}</span><span class="badge">${pipelines.length}</span></h3>
          ${pipelines
            .map(
              (p) => `
            <div class="item-box">
              <div class="item-box-title">Pipeline #${escapeHtml(p.id)} · 分支 <code>${escapeHtml(p.ref)}</code></div>
              <div class="label-list">
                <span class="badge ${p.status === 'success' ? 'done' : 'defect'}">${escapeHtml(p.status)}</span>
                <span class="badge">${escapeHtml(p.duration || 0)}s</span>
                ${(p.jobs || []).map((j) => `<span class="badge">${escapeHtml(j.stage)}/${escapeHtml(j.name)}</span>`).join('')}
              </div>
            </div>`
            )
            .join('')}
        </div>

        <div class="panel-card">
          <h3><span>${escapeHtml(t(state.lang, 'gitlabSyncLog'))}</span><span class="badge">${syncLog.length}</span></h3>
          ${
            syncLog
              .slice()
              .reverse()
              .slice(0, 8)
              .map(
                (s) => `
            <div class="item-box">
              <div style="font-family:var(--mono);font-size:12px;">#${escapeHtml(s.seq)} · ${formatTime(s.time)}</div>
              <div class="label-list">${(s.actions || []).map((a) => `<span class="badge deliverable">${escapeHtml(a)}</span>`).join('')}</div>
            </div>`
              )
              .join('') || '<div class="empty-state">等待看板阶段交付自动镜像至 GitLab...</div>'
          }
        </div>
      </div>
    </div>`;

  const issueForm = $('#gitlab-issue-form');
  if (issueForm) {
    issueForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        const title = $('#gl-issue-title').value.trim();
        const description = $('#gl-issue-desc').value.trim();
        if (!title) return;
        await api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/gitlab/issues`, {
          method: 'POST',
          body: JSON.stringify({ title, description, triggerSwarm: true })
        });
        await refreshCurrentSwarm();
      } catch (err) {
        showToast(err.message);
      }
    });
  }

  document.querySelectorAll('[data-issue-note-form]').forEach((form) => {
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        const iid = Number(form.dataset.issueNoteForm);
        const bodyInp = form.querySelector('[name="noteBody"]');
        const mirrorInp = form.querySelector('[name="postToBoard"]');
        const noteText = bodyInp.value.trim();
        if (!noteText) return;
        await api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/gitlab/issues/${encodeURIComponent(iid)}/notes`, {
          method: 'POST',
          body: JSON.stringify({
            body: noteText,
            author: 'coordinator',
            postToBoard: Boolean(mirrorInp?.checked)
          })
        });
        bodyInp.value = '';
        await loadIssueNotes(iid);
        await refreshCurrentSwarm();
      } catch (err) {
        showToast(err.message);
      }
    });
  });
}
