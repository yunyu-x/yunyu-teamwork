import crypto from 'node:crypto';
import { MESSAGE_KINDS } from '../core/constants.mjs';
import { parseMessageTokens } from '../core/board.mjs';

/**
 * Constant-time verification of GitLab's `X-Gitlab-Token` webhook secret header.
 */
export function verifyGitLabWebhookToken(headers = {}, expectedSecret = '') {
  if (!expectedSecret) return true;
  const received =
    headers['x-gitlab-token'] ||
    headers['X-Gitlab-Token'] ||
    '';
  const a = Buffer.from(String(received), 'utf8');
  const b = Buffer.from(String(expectedSecret), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Translate a real GitLab Webhook payload (Issue / Note / Merge Request / Pipeline)
 * into a structured Chinese Swarm Board message and mention route.
 */
export function translateGitLabWebhook(eventHeader, payload = {}) {
  const kind = String(eventHeader || payload.object_kind || '').toLowerCase();
  const project = payload.project?.path_with_namespace || payload.project?.name || 'gitlab-project';
  const user = payload.user?.name || payload.user?.username || 'GitLab';

  if (kind.includes('issue')) {
    const attrs = payload.object_attributes || {};
    const action = attrs.action || 'open';
    const labels = (payload.labels || attrs.labels || []).map((l) => l.title || l);
    const iid = attrs.iid ?? '?';
    const title = attrs.title || '未命名议题';
    const desc = (attrs.description || '').trim().slice(0, 360);
    const labelStr = labels.length ? labels.join(', ') : '无标签';

    const targetMention = action === 'close' ? '' : '@coordinator';
    const text = [
      `${targetMention} [GitLab Issue #${iid} · ${action}] 仓库 \`${project}\`（提交人：${user}）`.trim(),
      `标题：**${title}**`,
      `标签：\`${labelStr}\``,
      desc ? `需求摘要：${desc}` : null,
      attrs.url ? `链接：${attrs.url}` : null
    ]
      .filter(Boolean)
      .join('\n');

    return {
      accepted: true,
      eventType: 'issue',
      channel: 'main',
      kind: MESSAGE_KINDS.GITLAB,
      text,
      metadata: {
        gitlabEvent: 'issue',
        gitlabProject: project,
        gitlabIssueIid: attrs.iid,
        action,
        labels
      }
    };
  }

  if (kind.includes('merge') || kind === 'merge_request') {
    const attrs = payload.object_attributes || {};
    const action = attrs.action || 'open';
    const iid = attrs.iid ?? '?';
    const title = attrs.title || '未命名合并请求';
    const src = attrs.source_branch || '?';
    const tgt = attrs.target_branch || 'main';

    let mention = '@qa';
    if (action === 'merge') mention = '@release';
    else if (action === 'close') mention = '';

    const text = [
      `${mention} [GitLab MR !${iid} · ${action}] 仓库 \`${project}\`（操作人：${user}）`.trim(),
      `标题：**${title}**`,
      `分支：\`${src}\` → \`${tgt}\`（状态：\`${attrs.state || 'opened'}\`）`,
      action === 'open' || action === 'update'
        ? '请审核改动是否遵守文件所有权契约并执行自动化回归校验。'
        : action === 'merge'
          ? '合并请求已合入目标分支，请同步更新发布记录与 Issue 状态。'
          : null,
      attrs.url ? `链接：${attrs.url}` : null
    ]
      .filter(Boolean)
      .join('\n');

    return {
      accepted: true,
      eventType: 'merge_request',
      channel: 'main',
      kind: MESSAGE_KINDS.GITLAB,
      text,
      metadata: {
        gitlabEvent: 'merge_request',
        gitlabProject: project,
        gitlabMrIid: attrs.iid,
        sourceBranch: src,
        targetBranch: tgt,
        action
      }
    };
  }

  if (kind.includes('note')) {
    const attrs = payload.object_attributes || {};
    const body = String(attrs.note || '').trim();
    const noteable = attrs.noteable_type || 'Issue';
    const targetIid = payload.issue?.iid ?? payload.merge_request?.iid ?? '?';
    const parsed = parseMessageTokens(body);
    const hasExplicitRoute = parsed.mentions.length > 0 || parsed.broadcastAll || parsed.channelMentions.length > 0;
    const prefix = hasExplicitRoute ? '' : '@coordinator ';

    const text = [
      `${prefix}[GitLab ${noteable} 评论 #${targetIid}] 评论人：${user}（仓库 \`${project}\`）`,
      `内容：${body}`,
      attrs.url ? `链接：${attrs.url}` : null
    ]
      .filter(Boolean)
      .join('\n');

    return {
      accepted: true,
      eventType: 'note',
      channel: 'main',
      kind: MESSAGE_KINDS.GITLAB,
      text,
      metadata: {
        gitlabEvent: 'note',
        gitlabProject: project,
        noteableType: noteable,
        gitlabIssueIid: payload.issue?.iid ?? null,
        gitlabMrIid: payload.merge_request?.iid ?? null
      }
    };
  }

  if (kind.includes('pipeline')) {
    const attrs = payload.object_attributes || {};
    const status = attrs.status || 'unknown';
    const pid = attrs.id ?? '?';
    const ref = attrs.ref || 'main';
    const failedJobs = (payload.builds || [])
      .filter((b) => b.status === 'failed')
      .map((b) => `${b.stage}/${b.name}`);

    let mention = '';
    if (status === 'failed') mention = '@qa @coordinator';
    else if (status === 'success') mention = '@release';

    const text = [
      `${mention} [GitLab CI 流水线 #${pid} · ${status.toUpperCase()}] 分支 \`${ref}\`（仓库 \`${project}\`）`.trim(),
      failedJobs.length ? `失败作业：\`${failedJobs.join(', ')}\`` : `流水线执行结果：\`${status}\``,
      attrs.duration ? `耗时：${attrs.duration}s` : null
    ]
      .filter(Boolean)
      .join('\n');

    return {
      accepted: true,
      eventType: 'pipeline',
      channel: 'main',
      kind: status === 'failed' ? MESSAGE_KINDS.DEFECT : MESSAGE_KINDS.GITLAB,
      text,
      metadata: {
        gitlabEvent: 'pipeline',
        gitlabProject: project,
        pipelineId: pid,
        pipelineStatus: status,
        ref,
        failedJobs
      }
    };
  }

  return {
    accepted: false,
    eventType: kind || 'unknown',
    reason: `暂未处理的 GitLab Webhook 事件类型：${eventHeader || payload.object_kind || 'unknown'}`
  };
}
