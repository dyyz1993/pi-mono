# Tasks

## Phase 1: 补全 P1 测试（subtask.test.ts）

- [x] Task 1: A6 — model tier 关键字解析测试
  - [x] 创建 harness，注册多个模型（faux-1, faux-fast, faux-pro）
  - [x] 调用 runSubtask({ task, model: "fast" })
  - [x] 验证子任务使用了 fast 对应的模型
- [x] Task 2: A7 — model 无效回退测试
  - [x] 调用 runSubtask({ task, model: "nonexistent-model" })
  - [x] 验证回退到父会话模型，success: true
- [x] Task 3: A9 — maxTurns 多轮测试
  - [x] 调用 runSubtask({ task, maxTurns: 3 })
  - [x] 设置多轮 faux 响应（assistant → tool_use → assistant → tool_use → assistant）
  - [x] 验证在 maxTurns 内完成
- [x] Task 4: A12 — tools + disallowedTools 叠加测试
  - [x] 调用 runSubtask({ task, tools: ["read", "write", "edit"], disallowedTools: ["write"] })
  - [x] 验证子任务有 read 和 edit，没有 write
- [x] Task 5: A15 — cwd 覆盖测试
  - [x] 创建临时目录
  - [x] 调用 runSubtask({ task, cwd: customDir })
  - [x] 验证子任务在指定目录执行

## Phase 2: 补全 P1 测试（skill-tool.test.ts）

- [x] Task 6: B2 — inline skill 带 args 测试
  - [x] 创建 inline skill
  - [x] 模型调用 skill 工具带 args 参数
  - [x] 验证结果包含 skill XML + args 文本
- [x] Task 7: B3 — skill 名称大小写不敏感测试
  - [x] 创建 skill 名为 "Code-Review"
  - [x] 模型调用 skill 工具传 "code-review"
  - [x] 验证成功加载
- [x] Task 8: B5 — fork skill 带 args 测试
  - [x] 创建 fork skill
  - [x] 模型调用 skill 工具带 args
  - [x] 验证 args 传递到子任务
- [x] Task 9: B8 — skill 文件读取失败测试
  - [x] 创建 skill 对象指向不存在的文件路径
  - [x] 调用 skill 工具
  - [x] 验证返回错误信息

## Phase 3: P2 集成组合测试

- [x] Task 10: A4 — agent 从磁盘加载测试
  - [x] 在临时目录创建 Agent.md 文件
  - [x] 调用 runSubtask({ task, agent: "test-disk-agent" })
  - [x] 验证 agent 配置被应用
- [x] Task 11: A16 — 不继承扩展测试
  - [x] 创建带扩展的 harness
  - [x] 调用 runSubtask({ task, inheritExtensions: false })
  - [x] 验证子任务不触发扩展钩子

## Phase 4: 真实 LLM 端到端验证

- [ ] Task 12: D1 — inline skill 端到端
  - [ ] 创建真实 SKILL.md 文件
  - [ ] 启动 pi 进程，发送匹配 skill 的 prompt
  - [ ] 验证模型加载 skill 并正确执行
- [ ] Task 13: D2 — fork skill 端到端
  - [ ] 创建 context:fork 的 SKILL.md
  - [ ] 启动 pi 进程，发送匹配 skill 的 prompt
  - [ ] 验证 fork 模式执行并返回结果
- [ ] Task 14: D3 — fork + agent 端到端
  - [ ] 创建 Agent.md + context:fork 的 SKILL.md
  - [ ] 验证 fork 子任务使用指定 agent 配置

## Task Dependencies

- Phase 1 和 Phase 2 可并行
- Phase 3 依赖 Phase 1（需要 agent 从磁盘加载的基础设施）
- Phase 4 依赖 Phase 1-3 全部通过（需手动执行，需要真实 API key）
- 每个 Task 完成后运行对应测试 + `npm run check`
