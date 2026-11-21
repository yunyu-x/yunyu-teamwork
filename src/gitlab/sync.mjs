import { GITLAB_STATUS_LABELS, MESSAGE_KINDS } from '../core/constants.mjs';

/**
 * Bidirectional Sync Service between Yunyu Teamwork Swarm Board and GitLab Issues/MRs.
 */
export class GitLabSyncService {
  constructor({ client, projectId, issueIid = null, mrIid = null, mirrorKinds = null } = {}) {
    this.client = client;
    this.projectId = projectId;
    this.issueIid = issueIid;
    this.mrIid = mrIid;
    this.mirrorKinds = new Set(
      mirrorKinds || [
        MESSAGE_KINDS.DELIVERABLE,
        MESSAGE_KINDS.DEFECT,
        MESSAGE_KINDS.HUMAN_GATE,
        MESSAGE_KINDS.DONE
      ]
    );
    this.syncLog = [];
  }

  async onBoardMessage(swarm, msg) {
    if (!this.client || !this.projectId) return null;
    if (msg.kind === MESSAGE_KINDS.GITLAB) return null; // avoid echo loops
    if (!this.mirrorKinds.has(msg.kind)) return null;

    const issueIid = msg.metadata?.gitlabIssueIid || this.issueIid || swarm.gitlab?.linkedIssueIid;
    const mrIid = msg.metadata?.gitlabMrIid || this.mrIid || swarm.gitlab?.linkedMrIid;

    const tagMap = {
      [MESSAGE_KINDS.DELIVERABLE]: '📦 阶段交付',
      [MESSAGE_KINDS.DEFECT]: '🐞 QA 缺陷工单',
      [MESSAGE_KINDS.HUMAN_GATE]: '🚦 人工审批门禁',
      [MESSAGE_KINDS.DONE]: '✅ 蜂群完工归档'
    };

    const noteBody = [
      `### [Yunyu Teamwork] ${tagMap[msg.kind] || msg.kind}（#${msg.seq} · @${msg.author}）`,
      '',
      msg.text,
      '',
      `> 蜂群：\`${swarm.title}\`（\`${swarm.id}\`） · 频道：\`#${msg.channel}\``
    ].join('\n');

    const synced = { seq: msg.seq, time: new Date().toISOString(), actions: [] };

    if (issueIid) {
      await this.client.createIssueNote(this.projectId, issueIid, noteBody);
      synced.actions.push(`issue#${issueIid}:note`);

      const nextLabel = this._resolveIssueLabel(msg);
      if (nextLabel) {
        const issue = await this.client.getIssue(this.projectId, issueIid);
        const existing = Array.isArray(issue.labels) ? issue.labels : [];
        const filtered = existing.filter((l) => !String(l).startsWith('teamwork::'));
        filtered.push(nextLabel);
        await this.client.updateIssue(this.projectId, issueIid, {
          labels: filtered.join(',')
        });
        synced.actions.push(`issue#${issueIid}:label=${nextLabel}`);
      }
    }

    if (mrIid && (msg.kind === MESSAGE_KINDS.DEFECT || msg.kind === MESSAGE_KINDS.DONE)) {
      await this.client.createMergeRequestNote(this.projectId, mrIid, noteBody);
      synced.actions.push(`mr!${mrIid}:note`);
    }

    if (synced.actions.length > 0) {
      this.syncLog.push(synced);
      if (this.syncLog.length > 100) this.syncLog.shift();
    }
    return synced;
  }

  _resolveIssueLabel(msg) {
    if (msg.kind === MESSAGE_KINDS.DONE) return GITLAB_STATUS_LABELS.done;
    if (msg.kind === MESSAGE_KINDS.DEFECT) return GITLAB_STATUS_LABELS.blocked;
    if (msg.kind === MESSAGE_KINDS.HUMAN_GATE) return GITLAB_STATUS_LABELS.review;
    if (msg.author === 'qa' || msg.mentions.includes('qa')) return GITLAB_STATUS_LABELS.qa;
    if (msg.author === 'architect') return GITLAB_STATUS_LABELS.planning;
    return GITLAB_STATUS_LABELS.developing;
  }
}
