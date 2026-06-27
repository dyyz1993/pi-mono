# Checklist

## 字段验证（SubtaskOptions）

- [x] `task` 字段：必填，空字符串、正常值、长文本
- [x] `agent` 字段：不存在时仍成功、存在时应用配置
- [x] `agentConfig` 字段：直接传入配置覆盖 systemPrompt
- [x] `model` 字段：有效 ID、tier 关键字、无效值回退
- [x] `maxTurns` 字段：1 轮、多轮、无限制
- [x] `tools` 字段：白名单限制，只包含指定工具
- [x] `disallowedTools` 字段：黑名单移除指定工具
- [x] `tools` + `disallowedTools` 叠加：白名单中移除黑名单项
- [x] `cwd` 字段：覆盖父会话工作目录
- [x] `inheritTools` 字段：默认 true，false 时不继承（已实现 + 测试）
- [x] `inheritHistory` 字段：默认 false 不继承，true 时复制父会话历史（两个方向都测了）
- [x] `inheritExtensions` 字段：默认 true 继承，false 时扩展不触发

## 字段验证（Skill）

- [x] `context: inline`（默认）：内容注入主会话 XML 格式
- [x] `context: fork`：runSubtask 隔离执行，返回纯文本
- [x] skill `name` 大小写不敏感匹配
- [x] skill `args` 参数传递（inline 和 fork 两种模式）
- [x] skill 不存在时返回错误 + 可用列表
- [x] skill 文件读取失败时返回错误信息

## 组合验证

- [x] fork skill + agentConfig（C1 — harness 测试）
- [x] fork skill + model 覆盖（C2 — harness 测试）
- [x] fork skill + tools 限制（C3 — harness 测试）
- [x] fork skill + hooks 触发（C4 — harness 测试）
- [x] fork skill + 继承历史（C5 — harness 测试）
- [x] fork skill + Agent.md 磁盘文件（C6 — harness 测试）

## Harness 测试完整性

- [x] subtask.test.ts 测试数 >= 15（实际 19 个）
- [x] skill-tool.test.ts 测试数 >= 12（实际 18 个）
- [x] 所有测试通过（`vitest --run`）— 37/37 passed
- [x] `npm run check` 通过

## 真实 LLM 端到端

- [x] inline skill 端到端通过（D1 — 输出包含 INLINE_SKILL_OK）
- [x] fork skill 端到端通过（D2 — 输出包含 FORK_SKILL_OK）
- [x] fork + agent 端到端通过（D3 — 使用 test-reviewer agent 完成审查）
