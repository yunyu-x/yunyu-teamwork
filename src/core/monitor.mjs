import { MEMBER_ROLES, MEMBER_STATES, MESSAGE_KINDS } from './constants.mjs';

/**
 * Anti-Stall Watchdog (Monitor):
 * Periodically inspects whether all non-monitor workers have gone quiet while the
 * swarm is not yet marked `[done]`, identifies the blocking sequence number, and
 * wakes the single responsible member or `@coordinator [stall]`.
 */
export class StallMonitor {
  constructor({
    swarm,
    intervalMs = 15_000,
    stallThresholdMs = 30_000
  }) {
    this.swarm = swarm;
    this.intervalMs = intervalMs;
    this.stallThresholdMs = stallThresholdMs;
    this.timer = null;
    this.lastActivityAt = Date.now();
    this.lastAlertSeq = -1;
    this.alertCount = 0;
  }

  start() {
    if (this.timer) return;
    this.lastActivityAt = Date.now();
    this.timer = setInterval(() => this.checkNow(), this.intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  recordActivity() {
    this.lastActivityAt = Date.now();
  }

  /**
   * Evaluate swarm state immediately. Returns an alert message if a stall was broken, else null.
   */
  checkNow(now = Date.now()) {
    if (this.swarm.board.done) {
      this.stop();
      return null;
    }

    const activeWorkers = this.swarm
      .listMembers()
      .filter((m) => m.role !== MEMBER_ROLES.MONITOR && m.state !== MEMBER_STATES.KILLED);

    if (activeWorkers.length === 0) return null;

    const anyWorking = activeWorkers.some((m) => m.state === MEMBER_STATES.WORKING);
    if (anyWorking) {
      this.lastActivityAt = now;
      return null;
    }

    const idleMs = now - this.lastActivityAt;
    if (idleMs < this.stallThresholdMs) return null;

    const head = this.swarm.board.head;
    if (head === this.lastAlertSeq) return null;

    this.lastAlertSeq = head;
    this.alertCount++;

    const errored = activeWorkers.filter((m) => m.state === MEMBER_STATES.ERROR);
    const waitingHuman = activeWorkers.filter((m) => m.state === MEMBER_STATES.WAITING_HUMAN);
    const lastMsg = this.swarm.board.getMessage(head);

    let text;
    if (waitingHuman.length > 0) {
      const names = waitingHuman.map((m) => `@${m.name}`).join(' ');
      text = `${names} [人工门禁提醒] 蜂群已在 #${head} 等待人工确认超过 ${Math.round(idleMs / 1000)} 秒，请在看板回复或点击批准以继续推进。`;
    } else if (errored.length > 0) {
      const errNames = errored.map((m) => `${m.name}(${m.lastError || '异常'})`).join('、');
      text = `@coordinator [stall] 检测到蜂群停滞（已静默 ${Math.round(idleMs / 1000)}s，最新消息 #${head}）：成员 ${errNames} 处于异常态，请切换模型或重新派单恢复流程。`;
    } else if (lastMsg && lastMsg.mentions.length === 0 && !lastMsg.broadcastAll) {
      text = `@coordinator [stall] 检测到蜂群全员休眠（已静默 ${Math.round(idleMs / 1000)}s）：#${head}（作者 ${lastMsg.author}）未 @ 任何后续责任人，请审阅 #${head} 并指派下一阶段负责人或发布 [done] 归档。`;
    } else {
      text = `@coordinator [stall] 检测到全员进入 waiting 状态但尚未发布 [done]（已静默 ${Math.round(idleMs / 1000)}s，最新消息 #${head}），请协调下一步任务交接。`;
    }

    this.lastActivityAt = now;
    const alertMsg = this.swarm.postMessage({
      author: 'monitor',
      text,
      channel: 'main',
      kind: MESSAGE_KINDS.SYSTEM,
      metadata: { stallAlert: true, stalledAtSeq: head, idleMs }
    });
    this.lastAlertSeq = alertMsg.seq;
    return alertMsg;
  }
}
