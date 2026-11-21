import dns from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';
import { isPrivateIpOrHost } from '../core/research.mjs';
import { HOOK_EVENTS } from '../plugins/hooks.mjs';
import { redactPluginForPublic } from '../plugins/registry.mjs';

const VALID_HOOK_EVENTS = new Set(HOOK_EVENTS);

function isPathInsideBase(baseDir, candidateDir) {
  if (!baseDir || !candidateDir) return false;
  const absBase = path.resolve(baseDir);
  const absCand = path.resolve(candidateDir);
  const rel = path.relative(absBase, absCand);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
  if (fs.existsSync(absBase) && fs.existsSync(absCand)) {
    const realBase = fs.realpathSync(absBase);
    const realCand = fs.realpathSync(absCand);
    const realRel = path.relative(realBase, realCand);
    if (realRel.startsWith('..') || path.isAbsolute(realRel)) return false;
  }
  return true;
}

async function isSafePublicGitUrl(rawUrl) {
  const s = String(rawUrl || '').trim();
  if (!s || s.startsWith('-') || /[\r\n\0]/.test(s)) return false;
  if (!/^https?:\/\//i.test(s)) return false;
  try {
    const u = new URL(s);
    if (!u.hostname || isPrivateIpOrHost(u.hostname)) return false;
    const resolved = await dns.lookup(u.hostname, { all: true });
    if (!resolved.length || resolved.some((r) => isPrivateIpOrHost(r.address))) return false;
    return true;
  } catch {
    return false;
  }
}

function hasCustomCliConfig(driver, driverConfig) {
  if (driver !== 'cli-agent' || !driverConfig || typeof driverConfig !== 'object') return false;
  return Boolean(
    driverConfig.command ||
      (Array.isArray(driverConfig.commandPrefixArgs) && driverConfig.commandPrefixArgs.length) ||
      (Array.isArray(driverConfig.args) && driverConfig.args.length) ||
      (driverConfig.env && Object.keys(driverConfig.env).length) ||
      (Array.isArray(driverConfig.extraArgs) && driverConfig.extraArgs.length)
  );
}

/**
 * Dedicated REST API router for Yunyu Teamwork v0.5.0 Plugin Ecosystem,
 * Cross-Harness Connectors (TeamAI sync), Progressive Skills/Rules,
 * Lifecycle Hooks, and External MCP Client Manager.
 */
export async function handlePluginApiRoute({
  req,
  res,
  url,
  manager,
  allowCustomCli = false,
  readJsonBody,
  sendJson
}) {
  const method = req.method;
  const pathname = url.pathname;
  const plugins = manager.plugins;
  if (!plugins) return false;

  // 1. Plugin Hub Overview (non-blocking async harness probe)
  if (method === 'GET' && pathname === '/api/plugins') {
    const overview = await plugins.getOverviewAsync({ repoPath: manager.defaultRepoPath });
    sendJson(res, 200, overview, req);
    return true;
  }

  // 2. Install Plugin (inline / git / local)
  if (method === 'POST' && pathname === '/api/plugins/install') {
    const body = await readJsonBody(req);
    const mode = String(body.mode || 'inline').trim().toLowerCase();

    if (mode === 'inline') {
      const created = plugins.createInlinePlugin({
        id: body.id,
        name: body.name,
        description: body.description,
        skills: body.skills || [],
        rules: body.rules || [],
        commands: body.commands || [],
        agents: body.agents || [],
        hooks: body.hooks || [],
        mcpServers: body.mcpServers || [],
        trusted: Boolean(body.trusted && allowCustomCli)
      });
      sendJson(res, 201, { ok: true, plugin: redactPluginForPublic(created) }, req);
      return true;
    }

    if (mode === 'git') {
      const gitUrl = String(body.url || '').trim();
      if (!gitUrl) {
        sendJson(res, 400, { error: '缺少 Git 仓库地址 url' }, req);
        return true;
      }
      if (!allowCustomCli && !(await isSafePublicGitUrl(gitUrl))) {
        sendJson(
          res,
          403,
          { error: '安全拦截：通过 HTTP 安装 Git 插件仅允许公网 https/http 地址（私网/SSH/本地路径需开启 YUNYU_ALLOW_CUSTOM_CLI=true）' },
          req
        );
        return true;
      }
      const installed = plugins.installFromGit(gitUrl, {
        id: body.id || null,
        branch: body.branch || null,
        trusted: Boolean(body.trusted && allowCustomCli)
      });
      sendJson(res, 201, { ok: true, plugin: redactPluginForPublic(installed) }, req);
      return true;
    }

    if (mode === 'local') {
      const localPath = String(body.path || '').trim();
      if (!localPath) {
        sendJson(res, 400, { error: '缺少本地插件目录 path' }, req);
        return true;
      }
      const insideRepo = isPathInsideBase(manager.defaultRepoPath, localPath);
      if (!allowCustomCli && !insideRepo) {
        sendJson(
          res,
          403,
          { error: '安全拦截：本地插件目录必须位于当前绑定仓库内（跨目录安装需设置 YUNYU_ALLOW_CUSTOM_CLI=true）' },
          req
        );
        return true;
      }
      const installed = plugins.installFromLocal(localPath, {
        id: body.id || null,
        trusted: Boolean(body.trusted && allowCustomCli)
      });
      sendJson(res, 201, { ok: true, plugin: redactPluginForPublic(installed) }, req);
      return true;
    }

    sendJson(res, 400, { error: `不支持的安装模式 mode="${mode}"，可选 inline / git / local` }, req);
    return true;
  }

  // 3. Toggle plugin enabled / trusted state (granting trust strictly gated by allowCustomCli)
  const toggleMatch = pathname.match(/^\/api\/plugins\/([^/]+)\/toggle$/);
  if (method === 'POST' && toggleMatch) {
    const id = decodeURIComponent(toggleMatch[1]);
    const body = await readJsonBody(req);
    if (body.trusted === true && !allowCustomCli) {
      sendJson(
        res,
        403,
        { error: '安全拦截：通过 HTTP 接口授予插件信任需显式开启 YUNYU_ALLOW_CUSTOM_CLI=true（或在本机使用 CLI `yunyu plugin trust <id>`）' },
        req
      );
      return true;
    }
    const updated = plugins.setPluginState(id, {
      enabled: body.enabled,
      trusted: body.trusted
    });
    sendJson(res, 200, { ok: true, plugin: redactPluginForPublic(updated) }, req);
    return true;
  }

  // 4. Sync Git-backed TeamAI plugin repository
  const syncGitMatch = pathname.match(/^\/api\/plugins\/([^/]+)\/sync$/);
  if (method === 'POST' && syncGitMatch) {
    const id = decodeURIComponent(syncGitMatch[1]);
    const synced = plugins.syncGitPlugin(id);
    sendJson(res, 200, { ok: true, plugin: redactPluginForPublic(synced) }, req);
    return true;
  }

  // 5. Cross-Harness Connectors Probe & TeamAI Sync
  if (method === 'GET' && pathname === '/api/connectors') {
    const force = url.searchParams.get('refresh') === '1';
    const connectors = await plugins.connectors.probeConnectorsAsync({
      repoPath: manager.defaultRepoPath,
      force
    });
    sendJson(res, 200, { connectors }, req);
    return true;
  }

  if (method === 'POST' && pathname === '/api/connectors/sync') {
    const body = await readJsonBody(req);
    const harnessId = String(body.harnessId || '').trim();
    if (!harnessId) {
      sendJson(res, 400, { error: '缺少目标连接器 harnessId（如 claude-code / codex-cli / cursor / gemini-cli / opencode / antigravity）' }, req);
      return true;
    }
    let swarm = null;
    if (body.swarmId) {
      swarm = manager.getSwarm(body.swarmId);
      if (!swarm) {
        sendJson(res, 404, { error: `未找到蜂群 "${body.swarmId}"` }, req);
        return true;
      }
    }
    const allowedRoots = [manager.defaultRepoPath, ...[...manager.swarms.values()].map((s) => s.repoPath)].filter(Boolean);
    const requestedDir = body.targetDir ? path.resolve(String(body.targetDir)) : swarm?.repoPath || manager.defaultRepoPath;

    if (!requestedDir) {
      sendJson(res, 400, { error: '未配置有效的目标仓库目录，无法同步连接器配置' }, req);
      return true;
    }
    const allowedDir = allowCustomCli || allowedRoots.some((root) => isPathInsideBase(root, requestedDir));
    if (!allowedDir) {
      sendJson(
        res,
        403,
        { error: '安全拦截：targetDir 必须位于受管仓库目录内（跨目录同步需设置 YUNYU_ALLOW_CUSTOM_CLI=true）' },
        req
      );
      return true;
    }

    const dryRun = body.dryRun !== false;
    const result = plugins.syncToHarness(requestedDir, harnessId, { dryRun });
    sendJson(res, 200, result, req);
    return true;
  }

  // 6. Skills, Rules, Commands & Progressive Matcher
  if (method === 'GET' && pathname === '/api/skills') {
    sendJson(
      res,
      200,
      {
        skills: plugins.registry.listSkills({ enabledOnly: true }),
        rules: plugins.registry.listRules({ enabledOnly: true }),
        commands: plugins.registry.listCommands({ enabledOnly: true }),
        agents: plugins.registry.listAgents({ enabledOnly: true })
      },
      req
    );
    return true;
  }

  if (method === 'POST' && pathname === '/api/skills/match') {
    const body = await readJsonBody(req);
    const member = { name: body.member || 'author', role: body.role || 'author' };
    const text = String(body.text || '');
    const files = Array.isArray(body.files) ? body.files.map(String) : [];
    const limit = Number(body.limit) > 0 ? Math.min(Math.trunc(Number(body.limit)), 20) : 5;
    const matched = plugins.skills.matchSkills({ text, member, files, limit });
    const rules = plugins.skills.getApplicableRules({ files, role: member.role });
    const promptBlock = plugins.skills.buildPromptContext({ text, member, files });
    sendJson(res, 200, { matched, rules, promptBlock }, req);
    return true;
  }

  const skillReadMatch = pathname.match(/^\/api\/skills\/([^/]+)$/);
  if (method === 'GET' && skillReadMatch) {
    const skillId = decodeURIComponent(skillReadMatch[1]);
    const skill = plugins.registry.getSkill(skillId, { enabledOnly: true });
    if (!skill) {
      sendJson(res, 404, { error: `未找到已启用的技能 "${skillId}"` }, req);
      return true;
    }
    sendJson(res, 200, skill, req);
    return true;
  }

  // 7. Lifecycle Hooks Governance & Live Simulator (dryRun=true by default so test simulator never spawns arbitrary OS commands)
  if (method === 'GET' && pathname === '/api/hooks') {
    sendJson(
      res,
      200,
      {
        events: HOOK_EVENTS,
        hooks: plugins.hooks.listHooks(),
        history: plugins.hooks.getHistory({ limit: 60 })
      },
      req
    );
    return true;
  }

  if (method === 'POST' && pathname === '/api/hooks/test') {
    const body = await readJsonBody(req);
    const event = String(body.event || 'PreToolUse');
    if (!VALID_HOOK_EVENTS.has(event)) {
      sendJson(res, 400, { error: `不支持的 Hook 事件 "${event}"，可选：${HOOK_EVENTS.join(', ')}` }, req);
      return true;
    }
    const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
    const dryRun = !(body.executeCommands === true && allowCustomCli);
    const result = await plugins.hooks.run(event, payload, { cwd: manager.defaultRepoPath, dryRun });
    sendJson(res, 200, result, req);
    return true;
  }

  // 8. External MCP Client Manager
  if (method === 'GET' && pathname === '/api/mcp-clients') {
    sendJson(
      res,
      200,
      {
        servers: plugins.mcpClients.listServers(),
        tools: plugins.mcpClients.getAllDiscoveredTools()
      },
      req
    );
    return true;
  }

  if (method === 'POST' && pathname === '/api/mcp-clients') {
    const body = await readJsonBody(req);
    const reqId = String(body.id || '').trim();
    if (!reqId) {
      sendJson(res, 400, { error: 'MCP Server 缺少 id' }, req);
      return true;
    }
    const existing = plugins.mcpClients.getServer(reqId);
    if (existing && existing.pluginId !== 'custom') {
      sendJson(res, 409, { error: `安全拦截：禁止覆盖插件 "${existing.pluginId}" 已声明的 MCP Server "${reqId}"` }, req);
      return true;
    }
    const srv = plugins.mcpClients.registerServer({
      id: reqId,
      pluginId: 'custom',
      transport: body.transport || (body.url ? 'http' : 'stdio'),
      url: body.url || null,
      command: body.command || null,
      args: Array.isArray(body.args) ? body.args : [],
      headers: body.headers || {},
      description: body.description || '',
      trusted: Boolean(body.trusted && allowCustomCli)
    });
    sendJson(res, 201, { ok: true, server: srv }, req);
    return true;
  }

  const mcpClientDelete = pathname.match(/^\/api\/mcp-clients\/([^/]+)$/);
  if (method === 'DELETE' && mcpClientDelete) {
    const serverId = decodeURIComponent(mcpClientDelete[1]);
    const existing = plugins.mcpClients.getServer(serverId);
    if (!existing) {
      sendJson(res, 404, { error: `未找到 MCP Server "${serverId}"` }, req);
      return true;
    }
    if (existing.pluginId !== 'custom') {
      sendJson(res, 400, { error: `插件 "${existing.pluginId}" 声明的 MCP Server 请通过停用对应插件移除` }, req);
      return true;
    }
    plugins.mcpClients.unregisterServer(serverId);
    sendJson(res, 200, { ok: true, removed: serverId }, req);
    return true;
  }

  const mcpClientAction = pathname.match(/^\/api\/mcp-clients\/([^/]+)\/(connect|disconnect|call)$/);
  if (method === 'POST' && mcpClientAction) {
    const serverId = decodeURIComponent(mcpClientAction[1]);
    const action = mcpClientAction[2];
    if (action === 'connect') {
      const server = await plugins.mcpClients.connect(serverId);
      sendJson(res, 200, { ok: server.status === 'connected', server }, req);
      return true;
    }
    if (action === 'disconnect') {
      const server = plugins.mcpClients.disconnect(serverId);
      sendJson(res, 200, { ok: true, server }, req);
      return true;
    }
    if (action === 'call') {
      const body = await readJsonBody(req);
      if (!body.toolName) {
        sendJson(res, 400, { error: '缺少 toolName 参数' }, req);
        return true;
      }
      const result = await plugins.mcpClients.callTool(serverId, String(body.toolName), body.args || {});
      sendJson(res, 200, { ok: true, result }, req);
      return true;
    }
  }

  // 9. Recruit a Plugin-declared Agent directly into a Swarm
  const spawnPluginAgent = pathname.match(/^\/api\/swarms\/([^/]+)\/plugins\/spawn-agent$/);
  if (method === 'POST' && spawnPluginAgent) {
    const swarm = manager.getSwarm(decodeURIComponent(spawnPluginAgent[1]));
    if (!swarm) {
      sendJson(res, 404, { error: `未找到蜂群 "${spawnPluginAgent[1]}"` }, req);
      return true;
    }
    const body = await readJsonBody(req);
    const agentSpec = plugins.getAgentSpec(body.agentId);
    if (!agentSpec) {
      sendJson(res, 404, { error: `未找到已启用的插件 Agent "${body.agentId}"` }, req);
      return true;
    }
    const driver = agentSpec.driver || 'simulated';
    const driverConfig = agentSpec.driverConfig && typeof agentSpec.driverConfig === 'object' ? { ...agentSpec.driverConfig } : {};
    if (!allowCustomCli && hasCustomCliConfig(driver, driverConfig)) {
      sendJson(
        res,
        403,
        { error: '安全拦截：该插件 Agent 包含自定义 CLI 命令参数，需设置 YUNYU_ALLOW_CUSTOM_CLI=true 才可招募' },
        req
      );
      return true;
    }
    let memberName = String(body.name || agentSpec.name).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (swarm.members.has(memberName)) {
      let suffix = 2;
      while (swarm.members.has(`${memberName}-${suffix}`)) suffix++;
      memberName = `${memberName}-${suffix}`;
    }
    const role = agentSpec.role || 'reviewer';
    const workspace = body.workspace || agentSpec.workspace || (role === 'author' ? 'share' : 'inherit');
    const added = swarm.addMember({
      name: memberName,
      role,
      driver,
      model: body.model || agentSpec.model || 'default',
      workspace,
      owns: agentSpec.owns || [],
      mustNotTouch: agentSpec.mustNotTouch || [],
      channels: agentSpec.channels || ['main'],
      driverConfig,
      brief: body.brief || agentSpec.brief || `来自插件 ${agentSpec.pluginId} 的专职智能体 ${agentSpec.name}`
    });
    sendJson(res, 201, { ok: true, member: swarm.toPublicMember(added), pluginAgent: agentSpec.id }, req);
    return true;
  }

  return false;
}
