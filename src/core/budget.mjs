/**
 * Paperclip-inspired Budget & Cost Governance Engine:
 * Enforces swarm-level and per-member token, turn, and USD cost ceilings with
 * soft warning alerts (default 80%) and hard circuit-breaker stops (100%).
 */
export class BudgetGovernor {
  constructor({
    maxTokens = 0, // 0 = unlimited
    maxTurns = 0, // 0 = unlimited
    maxCostUsd = 0, // 0 = unlimited
    costPer1kTokensUsd = 0.005,
    warnRatio = 0.8,
    memberLimits = {}
  } = {}) {
    this.maxTokens = Number(maxTokens) || 0;
    this.maxTurns = Number(maxTurns) || 0;
    this.maxCostUsd = Number(maxCostUsd) || 0;
    this.costPer1kTokensUsd = Number(costPer1kTokensUsd) >= 0 ? Number(costPer1kTokensUsd) : 0.005;
    this.warnRatio = Number(warnRatio) > 0 && Number(warnRatio) < 1 ? Number(warnRatio) : 0.8;
    this.memberLimits = new Map();
    for (const [name, lim] of Object.entries(memberLimits || {})) {
      this.setMemberLimit(name, lim);
    }

    this.tokensUsed = 0;
    this.turnsUsed = 0;
    this.memberUsage = new Map(); // memberName -> { tokens, turns }
    this.alerts = [];
    this._warnedKeys = new Set();
  }

  configure(patch = {}) {
    if (patch.maxTokens !== undefined) this.maxTokens = Math.max(0, Number(patch.maxTokens) || 0);
    if (patch.maxTurns !== undefined) this.maxTurns = Math.max(0, Number(patch.maxTurns) || 0);
    if (patch.maxCostUsd !== undefined) this.maxCostUsd = Math.max(0, Number(patch.maxCostUsd) || 0);
    if (patch.costPer1kTokensUsd !== undefined) {
      this.costPer1kTokensUsd = Math.max(0, Number(patch.costPer1kTokensUsd) || 0);
    }
    if (patch.warnRatio !== undefined) {
      const r = Number(patch.warnRatio);
      if (r > 0 && r < 1) this.warnRatio = r;
    }
    if (patch.memberLimits && typeof patch.memberLimits === 'object') {
      for (const [k, v] of Object.entries(patch.memberLimits)) {
        this.setMemberLimit(k, v);
      }
    }
    // Reset warning flags when limits are expanded
    this._warnedKeys.clear();
    return this.getSummary();
  }

  setMemberLimit(memberName, { maxTokens = 0, maxTurns = 0 } = {}) {
    this.memberLimits.set(memberName, {
      maxTokens: Math.max(0, Number(maxTokens) || 0),
      maxTurns: Math.max(0, Number(maxTurns) || 0)
    });
  }

  load(saved) {
    if (!saved || typeof saved !== 'object') return;
    this.configure(saved);
    this.tokensUsed = Number(saved.tokensUsed) || 0;
    this.turnsUsed = Number(saved.turnsUsed) || 0;
    if (saved.memberUsage && typeof saved.memberUsage === 'object') {
      for (const [k, v] of Object.entries(saved.memberUsage)) {
        this.memberUsage.set(k, {
          tokens: Number(v.tokens) || 0,
          turns: Number(v.turns) || 0
        });
      }
    }
    if (Array.isArray(saved.alerts)) {
      this.alerts = saved.alerts.slice(-50);
    }
    if (Array.isArray(saved.warnedKeys)) {
      this._warnedKeys = new Set(saved.warnedKeys);
    }
  }

  getEstimatedCostUsd(tokens = this.tokensUsed) {
    return Number(((tokens / 1000) * this.costPer1kTokensUsd).toFixed(4));
  }

  checkAllow(memberName) {
    if (this.maxTokens > 0 && this.tokensUsed >= this.maxTokens) {
      return {
        allowed: false,
        scope: 'swarm',
        reason: `蜂群已达到 Token 预算上限（${this.tokensUsed} / ${this.maxTokens}），请调整预算上限后继续`
      };
    }
    if (this.maxTurns > 0 && this.turnsUsed >= this.maxTurns) {
      return {
        allowed: false,
        scope: 'swarm',
        reason: `蜂群已达到执行轮次预算上限（${this.turnsUsed} / ${this.maxTurns}），已自动熔断防失控`
      };
    }
    const cost = this.getEstimatedCostUsd();
    if (this.maxCostUsd > 0 && cost >= this.maxCostUsd) {
      return {
        allowed: false,
        scope: 'swarm',
        reason: `蜂群已达到费用预算上限（$${cost} / $${this.maxCostUsd}）`
      };
    }

    const mLim = this.memberLimits.get(memberName);
    const mUse = this.memberUsage.get(memberName) || { tokens: 0, turns: 0 };
    if (mLim) {
      if (mLim.maxTokens > 0 && mUse.tokens >= mLim.maxTokens) {
        return {
          allowed: false,
          scope: 'member',
          reason: `成员 @${memberName} 已达到个人 Token 预算上限（${mUse.tokens} / ${mLim.maxTokens}）`
        };
      }
      if (mLim.maxTurns > 0 && mUse.turns >= mLim.maxTurns) {
        return {
          allowed: false,
          scope: 'member',
          reason: `成员 @${memberName} 已达到个人轮次预算上限（${mUse.turns} / ${mLim.maxTurns}）`
        };
      }
    }

    return { allowed: true, reason: '预算充足' };
  }

  recordUsage(memberName, { tokens = 0, turns = 1 } = {}) {
    const addTokens = Math.max(0, Number(tokens) || 0);
    const addTurns = Math.max(0, Number(turns) || 0);
    this.tokensUsed += addTokens;
    this.turnsUsed += addTurns;

    const cur = this.memberUsage.get(memberName) || { tokens: 0, turns: 0 };
    cur.tokens += addTokens;
    cur.turns += addTurns;
    this.memberUsage.set(memberName, cur);

    const warnings = [];

    if (this.maxTokens > 0 && this.tokensUsed >= this.maxTokens * this.warnRatio && this.tokensUsed < this.maxTokens) {
      if (!this._warnedKeys.has('swarm:tokens')) {
        this._warnedKeys.add('swarm:tokens');
        warnings.push(
          `⚠️ 蜂群 Token 预算已消耗 ${Math.round((this.tokensUsed / this.maxTokens) * 100)}%（${this.tokensUsed} / ${this.maxTokens}）`
        );
      }
    }
    if (this.maxTurns > 0 && this.turnsUsed >= this.maxTurns * this.warnRatio && this.turnsUsed < this.maxTurns) {
      if (!this._warnedKeys.has('swarm:turns')) {
        this._warnedKeys.add('swarm:turns');
        warnings.push(
          `⚠️ 蜂群执行轮次预算已消耗 ${Math.round((this.turnsUsed / this.maxTurns) * 100)}%（${this.turnsUsed} / ${this.maxTurns}）`
        );
      }
    }
    const costUsd = this.getEstimatedCostUsd();
    if (this.maxCostUsd > 0 && costUsd >= this.maxCostUsd * this.warnRatio && costUsd < this.maxCostUsd) {
      if (!this._warnedKeys.has('swarm:cost')) {
        this._warnedKeys.add('swarm:cost');
        warnings.push(
          `⚠️ 蜂群费用预算已消耗 ${Math.round((costUsd / this.maxCostUsd) * 100)}%（$${costUsd} / $${this.maxCostUsd}）`
        );
      }
    }

    const warningTriggered = warnings.length > 0;
    const warningMessage = warningTriggered ? warnings.join('；') : null;
    for (const msg of warnings) {
      this.alerts.push({ level: 'warning', member: memberName, message: msg, time: new Date().toISOString() });
      if (this.alerts.length > 50) this.alerts.shift();
    }

    return { warningTriggered, warningMessage, summary: this.getSummary() };
  }

  getSummary() {
    const costUsd = this.getEstimatedCostUsd();
    const ratios = [];
    if (this.maxTokens > 0) ratios.push(this.tokensUsed / this.maxTokens);
    if (this.maxTurns > 0) ratios.push(this.turnsUsed / this.maxTurns);
    if (this.maxCostUsd > 0) ratios.push(costUsd / this.maxCostUsd);
    const peakRatio = ratios.length ? Math.max(...ratios) : 0;

    let status = 'ok';
    if (peakRatio >= 1) status = 'exceeded';
    else if (peakRatio >= this.warnRatio) status = 'warning';

    return {
      status,
      peakRatio: Number(peakRatio.toFixed(3)),
      maxTokens: this.maxTokens,
      tokensUsed: this.tokensUsed,
      maxTurns: this.maxTurns,
      turnsUsed: this.turnsUsed,
      maxCostUsd: this.maxCostUsd,
      costPer1kTokensUsd: this.costPer1kTokensUsd,
      estimatedCostUsd: costUsd,
      warnRatio: this.warnRatio,
      memberLimits: Object.fromEntries(this.memberLimits.entries()),
      memberUsage: Object.fromEntries(this.memberUsage.entries()),
      alerts: this.alerts.slice(-20)
    };
  }

  toJSON() {
    return {
      ...this.getSummary(),
      warnedKeys: [...this._warnedKeys]
    };
  }
}
