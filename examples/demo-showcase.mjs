import { runShowcaseDemo } from '../src/demo/showcase-scenario.mjs';
import { YunyuServer } from '../src/server/app.mjs';

const server = new YunyuServer({ host: '127.0.0.1', port: 4310, inMemory: true });
const demo = await runShowcaseDemo({ manager: server.manager, keepOpen: true });
const url = await server.start();

console.log(`云驭协同演示看板已启动：${url}`);
console.log(`本地模拟 GitLab 服务：  ${demo.gitlabMock.baseUrl}`);
console.log(`真实 Git 演示仓库：     ${demo.repoDir}`);
