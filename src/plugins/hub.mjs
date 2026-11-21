import { EventEmitter } from 'node:events';
import path from 'node:path';
import { ConnectorHub } from './connectors.mjs';
import { HookEngine } from './hooks.mjs';
import { McpClientManager } from './mcp-client.mjs';
import { PluginRegistry } from './registry.mjs';
import { SkillsRuntime } from './skills-runtime.mjs';

/**
 * Unified Agent Plugin & Ecosystem Control Plane (TeamAI + Agent Plugins Standard):
 * Coordinates PluginRegistry, Progressive-Disclosure Skills/Rules/Commands Runtime,
 * Deterministic Lifecycle HookEngine, External MCP Client Manager, and Cross-Harness ConnectorHub.
 */
export class PluginHub extends EventEmitter {
  constructor({
    dataDir = null,
    inMemory = false,
    repoPath = null,
    pluginRoots = null,
    allowExecHooks = process.env.YUNYU_ALLOW_EXEC_HOOKS === 'true',
    allowMcpStdio = process.env.YUNYU_ALLOW_MCP_STDIO === 'true',
    allowPrivateMcpHttp = process.env.YUNYU_ALLOW_PRIVATE_MCP_HTTP === 'true'
  } = {}) {
    super();
    this.repoPath = repoPath;
    this.registry = new PluginRegistry({ dataDir, inMemory, repoPath, pluginRoots });
    this.skills = new SkillsRuntime({ registry: this.registry });
    const auditLogPath = !inMemory && dataDir ? path.join(path.resolve(dataDir), 'hooks-audit.jsonl') : null;
    this.hooks = new HookEngine({ allowExecHooks, auditLogPath });
    this.mcpClients = new McpClientManager({
      allowStdio: allowMcpStdio,
      allowPrivateHttp: allowPrivateMcpHttp,
      allowLoopbackHttp: true
    });
    this.connectors = new ConnectorHub();

    this.hooks.on('hook_run', (rec) => this.emit('hook_run', rec));
    this.syncRuntimeFromRegistry();
  }

  /**
   * Synchronize active hooks and MCP server definitions from enabled plugins into runtime engines.
   */
  syncRuntimeFromRegistry() {
    this.hooks.clearNonCustomHooks();
    const activeIds = new Set();

    for (const plugin of this.registry.listPlugins()) {
      if (!plugin.enabled) continue;
      for (const hook of plugin.hooks || []) {
        try {
          this.hooks.registerHook({ ...hook, pluginId: plugin.id, trusted: plugin.trusted });
        } catch {}
      }
      for (const srv of plugin.mcpServers || []) {
        if (srv.enabled === false) continue;
        activeIds.add(srv.id);
        const nextFp = JSON.stringify({
          pluginId: plugin.id,
          transport: srv.transport || (srv.url ? 'http' : 'stdio'),
          command: srv.command || null,
          args: Array.isArray(srv.args) ? srv.args.map(String) : [],
          url: srv.url || null,
          headers: srv.headers || {},
          env: srv.env || {},
          trusted: Boolean(plugin.trusted),
          enabled: true
        });
        const existingFp = this.mcpClients.getServerFingerprint(srv.id);
        if (existingFp !== nextFp) {
          try {
            this.mcpClients.registerServer({ ...srv, pluginId: plugin.id, trusted: plugin.trusted });
          } catch {}
        }
      }
    }

    // Disconnect & remove only the specific stale non-custom MCP servers (never wipe sibling servers!)
    for (const existing of this.mcpClients.listServers()) {
      if (!activeIds.has(existing.id) && existing.pluginId !== 'custom') {
        this.mcpClients.unregisterServer(existing.id);
      }
    }
  }

  installFromLocal(dirPath, opts = {}) {
    const p = this.registry.installFromLocal(dirPath, opts);
    this.syncRuntimeFromRegistry();
    this.emit('plugins_changed', { op: 'install', pluginId: p.id });
    return p;
  }

  installFromGit(gitUrl, opts = {}) {
    const p = this.registry.installFromGit(gitUrl, opts);
    this.syncRuntimeFromRegistry();
    this.emit('plugins_changed', { op: 'install_git', pluginId: p.id });
    return p;
  }

  syncGitPlugin(pluginId) {
    const p = this.registry.syncGitPlugin(pluginId);
    this.syncRuntimeFromRegistry();
    this.emit('plugins_changed', { op: 'sync_git', pluginId: p.id });
    return p;
  }

  createInlinePlugin(spec) {
    const p = this.registry.createInlinePlugin(spec);
    this.syncRuntimeFromRegistry();
    this.emit('plugins_changed', { op: 'create_inline', pluginId: p.id });
    return p;
  }

  setPluginState(id, patch) {
    const p = this.registry.setPluginState(id, patch);
    this.syncRuntimeFromRegistry();
    this.emit('plugins_changed', { op: 'toggle', pluginId: p.id });
    return p;
  }

  syncToHarness(targetDir, harnessId, { dryRun = false } = {}) {
    return this.connectors.syncToHarness(
      targetDir,
      harnessId,
      {
        skills: this.registry.listSkills({ enabledOnly: true }),
        rules: this.registry.listRules({ enabledOnly: true }),
        commands: this.registry.listCommands({ enabledOnly: true }),
        hooks: this.hooks.listHooks(),
        mcpServers: this.registry.listMcpServers({ enabledOnly: true })
      },
      { dryRun }
    );
  }

  getAgentSpec(agentRef) {
    const clean = String(agentRef || '').trim().toLowerCase();
    return (
      this.registry.listAgents({ enabledOnly: true }).find(
        (a) => a.id.toLowerCase() === clean || a.name.toLowerCase() === clean
      ) || null
    );
  }

  _buildOverviewPayload(connectors) {
    const plugins = this.registry.listPlugins();
    return {
      plugins: plugins.map((p) => ({
        id: p.id,
        name: p.name,
        version: p.version,
        description: p.description,
        author: p.author,
        format: p.format,
        sourceType: p.sourceType,
        sourceUri: p.sourceUri,
        gitSha: p.gitSha,
        enabled: p.enabled,
        trusted: p.trusted,
        counts: {
          skills: p.skills.length,
          rules: p.rules.length,
          commands: p.commands.length,
          agents: p.agents.length,
          hooks: p.hooks.length,
          mcpServers: p.mcpServers.length
        }
      })),
      skills: this.registry.listSkills({ enabledOnly: true }),
      rules: this.registry.listRules({ enabledOnly: true }),
      commands: this.registry.listCommands({ enabledOnly: true }),
      agents: this.registry.listAgents({ enabledOnly: true }),
      hooks: this.hooks.listHooks(),
      hookHistory: this.hooks.getHistory({ limit: 40 }),
      mcpServers: this.mcpClients.listServers(),
      connectors
    };
  }

  getOverview({ repoPath = this.repoPath, includeConnectors = true } = {}) {
    const connectors = includeConnectors ? this.connectors.probeConnectors({ repoPath }) : [];
    return this._buildOverviewPayload(connectors);
  }

  async getOverviewAsync({ repoPath = this.repoPath } = {}) {
    const connectors = await this.connectors.probeConnectorsAsync({ repoPath });
    return this._buildOverviewPayload(connectors);
  }

  async dispose() {
    await this.mcpClients.disposeAll();
    this.registry.disposeTemp();
  }
}
