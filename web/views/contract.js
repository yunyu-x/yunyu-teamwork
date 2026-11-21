import { t } from '../i18n.js';
import { $, api, escapeHtml, showToast, state } from '../lib/state.js';

export function renderContract({ refreshCurrentSwarm }) {
  const ownership = state.swarm?.ownership || { rules: [], globalForbidden: [], collisions: [], auditLog: [] };
  const worktrees = state.swarm?.worktrees || [];
  const budget = state.swarm?.budget || {
    status: 'ok',
    maxTokens: 0,
    tokensUsed: 0,
    maxTurns: 0,
    turnsUsed: 0,
    estimatedCostUsd: 0,
    maxCostUsd: 0,
    peakRatio: 0
  };
  const pct = Math.min(100, Math.round((budget.peakRatio || 0) * 100));
  const members = (state.swarm?.members || []).filter((m) => !m.killed);

  $('#contract-view-body').innerHTML = `
    <div class="section-stack">
      <div class="panel-card">
        <h3>
          <span>💰 ${escapeHtml(t(state.lang, 'budgetTitle'))}</span>
          <span class="badge ${budget.status === 'exceeded' ? 'defect' : budget.status === 'warning' ? 'gitlab' : 'done'}">
            ${budget.status === 'exceeded' ? '🛑 已熔断' : budget.status === 'warning' ? '⚠️ 预警中' : '✓ 预算健康'}（${pct}%）
          </span>
        </h3>
        <div class="budget-track"><div class="budget-fill ${escapeHtml(budget.status)}" style="width:${pct}%"></div></div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;font-family:var(--mono);font-size:12px;color:var(--text-muted);margin-bottom:10px;">
          <span>Tokens: ${escapeHtml(budget.tokensUsed)} / ${escapeHtml(budget.maxTokens || '∞')}</span>
          <span>Turns: ${escapeHtml(budget.turnsUsed)} / ${escapeHtml(budget.maxTurns || '∞')}</span>
          <span>Est. Cost: $${escapeHtml(budget.estimatedCostUsd)} / ${budget.maxCostUsd ? `$${escapeHtml(budget.maxCostUsd)}` : '∞'}</span>
        </div>
        <form id="budget-config-form" class="inline-form">
          <input id="bg-max-tokens" type="number" min="0" value="${escapeHtml(budget.maxTokens || 0)}" placeholder="Token 上限 (0=不限)" style="width:160px" />
          <input id="bg-max-turns" type="number" min="0" value="${escapeHtml(budget.maxTurns || 0)}" placeholder="轮次上限 (0=不限)" style="width:150px" />
          <input id="bg-max-cost" type="number" min="0" step="0.1" value="${escapeHtml(budget.maxCostUsd || 0)}" placeholder="费用上限 USD" style="width:150px" />
          <button type="submit" class="btn small primary">更新预算上限</button>
        </form>
      </div>

      <div class="panel-card">
        <h3>
          <span>${escapeHtml(t(state.lang, 'contractMatrix'))}</span>
          <span class="badge ${ownership.collisions.length ? 'defect' : 'done'}">
            ${ownership.collisions.length ? `⚠️ ${ownership.collisions.length} 处冲突` : `✓ ${t(state.lang, 'noCollisions')}`}
          </span>
        </h3>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">
          全局禁改路径：<code>${escapeHtml(ownership.globalForbidden.join(', ') || '无')}</code>
        </div>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>成员</th><th>角色</th><th>独占可写路径 (owns)</th><th>严禁触碰路径 (mustNotTouch)</th></tr></thead>
            <tbody>
              ${ownership.rules
                .map(
                  (r) => `<tr>
                    <td><code>@${escapeHtml(r.agent)}</code></td>
                    <td>${escapeHtml(r.role)}</td>
                    <td><code>${escapeHtml(r.owns.join(', ') || '—')}</code></td>
                    <td><code>${escapeHtml(r.mustNotTouch.join(', ') || '—')}</code></td>
                  </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="two-col">
        <div class="panel-card">
          <h3><span>${escapeHtml(t(state.lang, 'contractTester'))}</span></h3>
          <form id="ownership-test-form" class="inline-form">
            <select id="own-member">
              ${members.map((m) => `<option value="${escapeHtml(m.name)}">@${escapeHtml(m.name)} (${escapeHtml(m.role)})</option>`).join('')}
            </select>
            <input id="own-path" type="text" value="src/rate-limiter.mjs" placeholder="输入相对文件路径，如 src/index.mjs" style="flex:1 1 180px" />
            <button type="submit" class="btn primary">校验写权限</button>
          </form>
          <div id="own-test-result" style="margin-top:10px;font-size:12.5px;color:var(--text-muted);">
            提示：尝试用 <code>@qa</code> 或 <code>@reviewer</code> 测试写入 <code>src/rate-limiter.mjs</code>，将立即触发只读隔离铁律拦截。
          </div>
        </div>

        <div class="panel-card">
          <h3><span>${escapeHtml(t(state.lang, 'contractWorktrees'))}</span><span class="badge">${worktrees.length}</span></h3>
          ${worktrees
            .map(
              (w) => `
            <div class="item-box">
              <div class="item-box-title">@${escapeHtml(w.agent)} · <code>${escapeHtml(w.mode)}</code> ${w.branch ? `(${escapeHtml(w.branch)})` : ''} ${w.rehydrated ? '<span class="badge deliverable">已恢复</span>' : ''}</div>
              <div style="font-size:11.5px;font-family:var(--mono);color:var(--text-muted);">
                HEAD: ${escapeHtml(w.headSha || '—')} · 已合并: ${w.merged ? '是' : '否'} · 变更文件: ${w.changedFiles?.length || 0}
              </div>
            </div>`
            )
            .join('')}
        </div>
      </div>

      <div class="panel-card">
        <h3><span>${escapeHtml(t(state.lang, 'contractAuditLog'))}</span><span class="badge">${ownership.auditLog.length}</span></h3>
        ${
          ownership.auditLog
            .slice()
            .reverse()
            .slice(0, 10)
            .map(
              (a) => `
          <div class="item-box">
            <div style="display:flex;justify-content:space-between;gap:8px;font-family:var(--mono);font-size:12px;">
              <span>@${escapeHtml(a.agent)} · 检查 ${escapeHtml(a.filesChecked)} 个文件</span>
              <span class="badge ${a.passed ? 'done' : 'defect'}">${a.passed ? 'PASS' : 'BLOCKED'}</span>
            </div>
          </div>`
            )
            .join('') || '<div class="empty-state">暂无提交/合并审计记录</div>'
        }
      </div>
    </div>`;

  const form = $('#ownership-test-form');
  if (form) {
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        const member = $('#own-member').value;
        const filePath = $('#own-path').value.trim();
        const res = await api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/ownership/check`, {
          method: 'POST',
          body: JSON.stringify({ member, filePath })
        });
        $('#own-test-result').innerHTML = `<span class="badge ${res.allowed ? 'done' : 'defect'}">${res.allowed ? '✓ 允许写入' : '✕ 守卫拦截'}</span> ${escapeHtml(res.reason)}`;
      } catch (err) {
        showToast(err.message);
      }
    });
  }

  const budgetForm = $('#budget-config-form');
  if (budgetForm) {
    budgetForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        await api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/budget`, {
          method: 'PUT',
          body: JSON.stringify({
            maxTokens: Number($('#bg-max-tokens').value) || 0,
            maxTurns: Number($('#bg-max-turns').value) || 0,
            maxCostUsd: Number($('#bg-max-cost').value) || 0
          })
        });
        await refreshCurrentSwarm();
      } catch (err) {
        showToast(err.message);
      }
    });
  }
}
