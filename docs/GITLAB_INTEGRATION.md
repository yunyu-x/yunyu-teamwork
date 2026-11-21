# GitLab 仓库集成与多 Agent 项目管理指南

**云驭协同（Yunyu Teamwork）** 原生面向 **GitLab（公有云 `gitlab.com` 与企业自托管 CE/EE）** 进行扩展设计，实现从 **Issue 需求接入 → 多 Agent Worktree 并行编码 → 独立 QA 回归与缺陷回流 → Merge Request 合并门禁 → CI/CD Pipeline 闭环** 的全自动项目管理。

---

## 1. 准备 GitLab Access Token

在 GitLab 项目（`Settings -> Access Tokens`）或个人账户下创建令牌，推荐勾选最小必要权限：
- `api`（或细粒度 `read_api` + `write_repository` + Issue/MR 评论权限）
- 将令牌与仓库信息填入 `.env`：

```dotenv
GITLAB_BASE_URL=https://gitlab.example.com
GITLAB_TOKEN=glpat-xxxxxxxxxxxx
GITLAB_PROJECT_ID=group/your-project
GITLAB_WEBHOOK_SECRET=your-strong-shared-secret
YUNYU_REPO_PATH=/path/to/local/clone/of/your-project
```

---

## 2. 配置 GitLab Webhook 自动唤醒蜂群

在 GitLab 项目中进入 `Settings -> Webhooks`：
1. **URL**：`http://<your-yunyu-host>:4310/api/webhooks/gitlab`（如需精准绑定某蜂群，可追加 `?swarmId=<id>`）
2. **Secret token**：填入与 `.env` 中 `GITLAB_WEBHOOK_SECRET` 一致的密钥（服务端采用常量时间 `crypto.timingSafeEqual` 验签）。
3. **Trigger 勾选以下 4 类事件**：
   - `Issues events`：新建或更新带 `agent::ready` 标签的 Issue 时，自动生成中文需求卡并唤醒 `@coordinator`。
   - `Comments (Note events)`：人类工程师在 Issue 或 MR 评论区输入 `@backend 请补充重试机制` 时，直接路由到留言板并唤醒对应 Agent。
   - `Merge request events`：新 MR 开启或更新时自动唤醒 `@qa` 审查契约合规性与跑回归测试；MR 合入后自动通知 `@release`。
   - `Pipeline events`：CI 流水线失败时自动附带失败作业列表生成缺陷卡唤醒 `@qa @coordinator`；成功时通知 `@release`。

---

## 3. 双向标签状态机（Scoped Labels）

开启 `GitLabSyncService` 后，蜂群中的关键节点交付会自动镜像到关联的 GitLab Issue 评论区，并按状态机更新 Scoped Label：

| 蜂群阶段 / 事件 | 自动写入 GitLab Issue 标签 | 同步动作 |
| :--- | :--- | :--- |
| 架构师冻结 `CONTRACT.json` | `teamwork::planning` | 镜像架构摘要评论 |
| 研发作者提交隔离分支交付 | `teamwork::developing` | 镜像 Commit SHA 与改动文件列表 |
| 交接 `@qa` 执行验收 | `teamwork::qa` | 通知验收阶段启动 |
| QA 拦截并发布 `[缺陷单]` | `teamwork::blocked` | 镜像结构化缺陷单到 Issue 与 MR 评论区 |
| 触发人工门禁审批 | `teamwork::review` | 提醒人类维护者在看板或 GitLab 审批 |
| 协调者发布 `[done]` 归档 | `teamwork::done` | 写入最终总结报告并完成归档 |

---

## 4. 在 `.gitlab-ci.yml` 中联动云驭协同

仓库根目录已提供开箱即用的 [.gitlab-ci.yml](../.gitlab-ci.yml) 模板。在 CI 作业中也可以直接使用 `yunyu post` 命令将测试报告或构建体积回传至运行中的协同看板：

```yaml
qa_report:
  stage: test
  script:
    - npm test
    - node bin/yunyu.mjs post --url "$YUNYU_URL" --swarm "$YUNYU_SWARM_ID" --author gitlab --text "@release CI 测试已通过，请准备发布。"
```

---

## 5. 零网络离线体验完整 GitLab 联动

无需准备真实 GitLab 账号或任何大模型 API Key，执行以下命令即可在本机拉起 **内置 GitLab API v4 模拟服务器 + 真实 Git 沙盒仓库 + 6 角色协同交付演示**：

```bash
npm run demo
```

浏览器访问 `http://127.0.0.1:4310`，即可在 **「看板」「协作图谱（时间轴回放）」「成员名册」「GitLab 项目」「契约与工作树」** 五大视图中完整体验全链路协作。
