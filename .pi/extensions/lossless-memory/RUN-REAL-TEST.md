# Lossless Memory - 真实 pi 环境验证指南

## 🎯 验证目标

在真实 pi 对话中验证 DAG 上下文管理功能

## 📋 测试步骤

### 步骤 1: 启动 pi 加载扩展

```bash
cd /Users/xuyingzhou/Project/temporary/pi-mono

# 方式 1: 直接加载扩展文件
pi --extension .pi/extensions/lossless-memory/src/index.ts

# 方式 2: 启动后自动加载（推荐）
# 扩展已在 .pi/extensions/lossless-memory/ 目录，pi 会自动发现
pi
```

### 步骤 2: 验证扩展加载

启动后应该看到：
```
[LosslessMemory] 初始化完成
Lossless Memory 已加载
```

### 步骤 3: 进行多轮对话测试

输入以下消息进行测试（至少 10 轮）：

```
我们来测试上下文管理功能
这是第 2 条消息，关于 API 设计
继续讨论，这是第 3 条消息
...（继续到第 10 条）
```

### 步骤 4: 查看实时跟踪

在对话过程中输入：
```
/context-trace
```

应该看到类似输出：
```
上下文跟踪 (5 轮):

第 1 轮：1 条消息，12 tokens (0.0%)
第 2 轮：3 条消息，17 tokens (0.0%)
第 3 轮：5 条消息，22 tokens (0.0%)
第 4 轮：7 条消息，29 tokens (0.0%)
第 5 轮：9 条消息，89 tokens (0.0%)
```

### 步骤 5: 查看上下文大小

```
/context-size
```

应该看到：
```
上下文使用情况:

总条目数：10
  用户消息：5
  助手消息：5
  工具结果：0
  自定义条目：0

Token 使用:
  当前：89
  窗口：196,608
  使用率：0.05%
  [░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]
```

### 步骤 6: 触发压缩（需要大量对话）

要进行真正的压缩测试，需要：
- 约 **150,000 tokens** 才能触发 80% 阈值
- 或修改阈值进行测试

**降低阈值测试**（可选）：
```bash
# 编辑 index.ts，将阈值从 0.8 改为 0.0001
vim .pi/extensions/lossless-memory/src/index.ts

# 找到第 322 行，修改：
const threshold = 0.0001; // 0.01% 用于测试

# 然后重新加载 pi
/reload
```

### 步骤 7: 验证数据库

对话结束后，检查数据库：
```bash
# 查看数据库文件
ls -lh ~/.pi/agent/lossless-memory.db

# 查看表结构
sqlite3 ~/.pi/agent/lossless-memory.db ".tables"

# 查看节点统计
sqlite3 ~/.pi/agent/lossless-memory.db \
  "SELECT level, COUNT(*) as count, SUM(token_count) as tokens FROM memory_nodes GROUP BY level;"
```

### 步骤 8: 查看 Trace 日志

```bash
# 查看实时跟踪记录
cat /tmp/lossless-context-trace.jsonl | jq

# 或持续监控
tail -f /tmp/lossless-context-trace.jsonl
```

## 📊 验证清单

### 基础验证
- [ ] 扩展成功加载
- [ ] 看到 `[LosslessMemory]` 日志
- [ ] `/context-trace` 命令可用
- [ ] `/context-size` 命令可用
- [ ] Trace 文件生成

### 功能验证
- [ ] 多轮对话上下文累积
- [ ] Token 数持续增长
- [ ] 消息数每轮 +2（用户 + 助手）
- [ ] 数据库文件创建

### 高级验证（需要大量对话）
- [ ] 压缩触发（>80% 使用率）
- [ ] DAG 节点生成
- [ ] 上下文修改（消息数减少）
- [ ] 摘要质量评估

## 🔍 故障排查

### 问题 1: 看不到扩展日志
```bash
# 检查扩展是否加载
pi --extension .pi/extensions/lossless-memory/src/index.ts -p "测试"

# 查看详细日志
pi --verbose
```

### 问题 2: Trace 文件不存在
```bash
# 检查文件权限
ls -la /tmp/lossless-context-trace.jsonl

# 手动创建
touch /tmp/lossless-context-trace.jsonl
chmod 644 /tmp/lossless-context-trace.jsonl
```

### 问题 3: 数据库初始化失败
```bash
# 删除旧数据库重试
rm -rf ~/.pi/agent/lossless-memory.db*

# 重新启动 pi
pi --extension .pi/extensions/lossless-memory/src/index.ts
```

## 📈 预期结果

### 正常情况
```
✅ 扩展加载成功
✅ 每轮对话看到 [LosslessMemory] Turn X: Y msgs, Z tokens
✅ /context-trace 显示增长趋势
✅ Trace 文件持续写入
✅ 数据库文件逐渐增大
```

### 压缩触发后
```
✅ 看到 [LosslessMemory] 触发上下文修改！
✅ 看到 [LosslessMemory] 修改前：X 条，修改后：Y 条
✅ 消息数突然减少（如 100→20）
✅ Token 使用率下降
```

## 📝 记录模板

测试时记录以下数据：

```markdown
## 测试记录

**时间**: 2026-03-21
**会话文件**: ~/.pi/agent/sessions/xxx.jsonl

### 对话轮次
- 总轮数：__
- 总消息数：__
- 最终 Token: __

### Trace 数据
第 1 轮：__条，__tokens
第 5 轮：__条，__tokens
第 10 轮：__条，__tokens

### 压缩触发
- 触发轮次：__
- 触发前：__条，__tokens
- 触发后：__条，__tokens
- 节省：__%

### 问题记录
- [ ] 无
- [ ] 有：____
```

## 🎯 下一步

测试完成后：
1. 分享测试结果
2. 报告任何问题
3. 提出优化建议
4. 考虑添加到 pi 官方扩展

祝测试顺利！🚀
