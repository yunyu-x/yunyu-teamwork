#!/usr/bin/env node
import path from 'node:path';
import { TeamworkManager } from '../src/core/orchestrator.mjs';
import { createDefaultDriverRegistry } from '../src/drivers/registry.mjs';
import { YunyuMcpServer } from '../src/mcp/server.mjs';

const dataDir = path.resolve(process.env.YUNYU_DATA_DIR || path.join(process.cwd(), '.yunyu'));
const repoPath = path.resolve(process.env.YUNYU_REPO_PATH || process.cwd());

const manager = new TeamworkManager({
  dataDir,
  defaultRepoPath: repoPath,
  driverRegistry: createDefaultDriverRegistry()
});

const mcp = new YunyuMcpServer({
  manager,
  allowCustomCli: process.env.YUNYU_ALLOW_CUSTOM_CLI === 'true'
});
const rl = mcp.serveStdio(process.stdin, process.stdout);
rl.on('close', () => {
  Promise.resolve(manager.disposeAll()).catch(() => {});
});
