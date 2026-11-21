---
name: team-onboarding
description: 新人或新 Agent 加入仓库时的世界模型导览与活文档同步技能
tags: [onboarding, world-model, wiki, teamai, architecture]
triggers: [导览, 上手, 架构, world-model, wiki, onboarding]
---
# 团队快速上手与世界模型导览技能

1. 先调用 `world_model_overview` 掌握项目模块域拓扑与高扇入核心文件（Hubs）。
2. 调用 `wiki_list` 与 `wiki_read(slug="home")` / `wiki_read(slug="architecture")` 阅读最新活文档。
3. 修改任何高扇入文件前，必须先执行 `world_model_impact(targets=[...])` 评估爆炸半径并通知受影响的协作成员。
