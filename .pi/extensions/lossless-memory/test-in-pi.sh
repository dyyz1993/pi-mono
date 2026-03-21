#!/bin/bash
# Lossless Memory - 快速 pi 测试脚本

echo "╔══════════════════════════════════════════════════════╗"
echo "║   Lossless Memory - pi 真实环境测试                  ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

cd /Users/xuyingzhou/Project/temporary/pi-mono

echo "📦 清理旧数据..."
rm -f ~/.pi/agent/lossless-memory.db* 2>/dev/null
rm -f /tmp/lossless-context-trace.jsonl 2>/dev/null
echo "✅ 清理完成"
echo ""

echo "🚀 启动 pi..."
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "测试步骤:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. 等待 pi 启动，看到 'Lossless Memory 已加载'"
echo ""
echo "2. 输入测试消息（至少 10 轮）:"
echo "   我们来测试上下文管理"
echo "   这是第 2 条消息"
echo "   继续，第 3 条"
echo "   ..."
echo ""
echo "3. 查看实时跟踪:"
echo "   /context-trace"
echo ""
echo "4. 查看上下文大小:"
echo "   /context-size"
echo ""
echo "5. 测试搜索工具:"
echo "   请使用 pi_memory_stats 查看记忆状态"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "启动 pi 中..."
echo ""

pi --extension .pi/extensions/lossless-memory/src/index.ts
