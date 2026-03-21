#!/bin/bash
# Lossless Memory - AI Agent 自动化测试

set -e

echo "╔══════════════════════════════════════════════════════╗"
echo "║  Lossless Memory - AI Agent 自动化测试               ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# 配置
SESSION_NAME="test-$(date +%s)"
TEST_MESSAGES=(
  "你好，我们来测试 Lossless Memory 的 DAG 功能"
  "我想了解如何进行上下文管理"
  "DAG 分层结构是怎么工作的？"
  "L1、L2、L0 分别代表什么？"
  "能详细解释一下摘要生成的过程吗？"
  "如何保证上下文不丢失？"
  "压缩阈值是多少？"
  "搜索功能怎么使用？"
  "向量搜索支持吗？"
  "如何查看历史消息？"
)

echo "📋 测试配置:"
echo "  会话名：$SESSION_NAME"
echo "  消息数：${#TEST_MESSAGES[@]} 条"
echo ""

# Step 1: 记录测试前数据
echo "📊 Step 1: 记录测试前数据..."
echo "────────────────────────────────────────────────────────"

BEFORE_NODES=$(sqlite3 ~/.pi/agent/lossless-memory.db "SELECT COUNT(*) FROM memory_nodes;" 2>/dev/null || echo "0")
BEFORE_SESSIONS=$(sqlite3 ~/.pi/agent/lossless-memory.db "SELECT COUNT(*) FROM session_index;" 2>/dev/null || echo "0")

echo "  节点数：$BEFORE_NODES"
echo "  会话数：$BEFORE_SESSIONS"
echo ""

# Step 2: 使用 tmux 启动 pi 并自动对话
echo "🤖 Step 2: 启动 AI Agent 对话..."
echo "────────────────────────────────────────────────────────"

# 创建 tmux 会话
tmux new-session -d -s pi-test -x 120 -y 40

# 启动 pi (带插件)
echo "  启动 pi (带插件)..."
tmux send-keys -t pi-test "pi --extension ~/.pi/agent/extensions/lossless-memory/src/index.ts" Enter

# 等待启动
echo "  等待 pi 启动 (5 秒)..."
sleep 5

# 发送测试消息
echo ""
echo "  发送测试消息:"
for i in "${!TEST_MESSAGES[@]}"; do
  msg="${TEST_MESSAGES[$i]}"
  echo "    [$((i+1))/${#TEST_MESSAGES[@]}] $msg"
  tmux send-keys -t pi-test "$msg" Enter
  sleep 3  # 等待 AI 回复
done

# 等待所有消息处理完成
echo ""
echo "  等待消息处理完成 (5 秒)..."
sleep 5

# 捕获输出
echo ""
echo "  捕获对话输出..."
tmux capture-pane -t pi-test -p -S -200 > /tmp/pi-test-output.txt

# 清理 tmux
tmux kill-session -t pi-test 2>/dev/null || true

echo "  ✅ 对话完成"
echo ""

# Step 3: 记录测试后数据
echo "📊 Step 3: 记录测试后数据..."
echo "────────────────────────────────────────────────────────"

AFTER_NODES=$(sqlite3 ~/.pi/agent/lossless-memory.db "SELECT COUNT(*) FROM memory_nodes;" 2>/dev/null || echo "0")
AFTER_SESSIONS=$(sqlite3 ~/.pi/agent/lossless-memory.db "SELECT COUNT(*) FROM session_index;" 2>/dev/null || echo "0")

echo "  节点数：$AFTER_NODES (之前：$BEFORE_NODES)"
echo "  会话数：$AFTER_SESSIONS (之前：$BEFORE_SESSIONS)"
echo ""

# Step 4: 测试 API
echo "🧪 Step 4: 测试 API..."
echo "────────────────────────────────────────────────────────"

echo ""
echo "  测试统计 API:"
STATS=$(curl -s "http://localhost:5173/api/lossless/stats")
if echo "$STATS" | grep -q "totalNodes"; then
  echo "  ✅ 统计 API 正常"
  echo "  节点数：$(echo "$STATS" | grep -o '"totalNodes":[0-9]*' | cut -d: -f2)"
else
  echo "  ❌ 统计 API 失败"
fi

echo ""
echo "  测试项目 API:"
PROJECTS=$(curl -s "http://localhost:5173/api/lossless/projects")
if echo "$PROJECTS" | grep -q "path"; then
  echo "  ✅ 项目 API 正常"
  echo "  项目数：$(echo "$PROJECTS" | grep -o '"path"' | wc -l | tr -d ' ')"
else
  echo "  ❌ 项目 API 失败"
fi

echo ""
echo "  测试节点 API:"
NODES=$(curl -s "http://localhost:5173/api/lossless/nodes")
if echo "$NODES" | grep -q "data"; then
  echo "  ✅ 节点 API 正常"
  NODE_COUNT=$(echo "$NODES" | grep -o '"level"' | wc -l | tr -d ' ')
  echo "  返回节点数：$NODE_COUNT"
else
  echo "  ⚠️  节点 API 无数据 (正常，需要压缩触发)"
fi

echo ""

# Step 5: 生成测试报告
echo "╔══════════════════════════════════════════════════════╗"
echo "║  测试报告                                            ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

echo "📊 数据变化:"
echo "  ┌──────────────┬──────────┬──────────┬──────────┐"
echo "  │ 类型         │ 测试前   │ 测试后   │ 变化     │"
echo "  ├──────────────┼──────────┼──────────┼──────────┤"
printf "  │ %-12s │ %-8s │ %-8s │ %+8s │\n" "会话" "$BEFORE_SESSIONS" "$AFTER_SESSIONS" "$((AFTER_SESSIONS - BEFORE_SESSIONS))"
printf "  │ %-12s │ %-8s │ %-8s │ %+8s │\n" "节点" "$BEFORE_NODES" "$AFTER_NODES" "$((AFTER_NODES - BEFORE_NODES))"
echo "  └──────────────┴──────────┴──────────┴──────────┘"
echo ""

echo "✅ 测试完成!"
echo ""
echo "📁 测试输出:"
echo "  对话日志：/tmp/pi-test-output.txt"
echo "  Dashboard: http://localhost:5173"
echo ""

echo "🎯 验证步骤:"
echo "  1. 打开 http://localhost:5173 查看 Dashboard"
echo "  2. 查看项目列表是否有新数据"
echo "  3. 查看统计信息是否更新"
echo ""
