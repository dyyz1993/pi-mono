# OpenViking FAQ

## 什么是 OpenViking？

OpenViking 是一个开源的记忆管理系统，用于存储和检索 AI Agent 的长期记忆。

## 核心概念

### 1. 记忆存储
- 支持用户级记忆（viking://user/memories）
- 支持 Agent 级记忆（viking://agent/memories）
- 自动摘要和层级化组织

### 2. 记忆检索
- 混合检索策略（语义搜索 + 关键词匹配）
- 自动过滤和排序
- 支持相似度阈值控制

### 3. 插件集成
- OpenClaw 插件系统支持
- 自动 recall 和 capture
- Context Engine 集成

## 常见问题

**Q: 如何启动本地 OpenViking 服务？**
A: 使用 `python -m openviking.server.bootstrap --config <config-path>` 命令。

**Q: 记忆是如何组织的？**
A: 采用三层 DAG 结构：L0（原文）、L1（摘要）、L2（叶子节点）。

**Q: 如何处理重复记忆？**
A: 系统会自动进行去重，基于 URI 相似度和内容哈希。
