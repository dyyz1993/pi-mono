#!/bin/bash
# Safe Kill Extension - Demo Script

echo "======================================"
echo "Safe Kill Extension Demo"
echo "======================================"
echo ""

echo "📋 被阻止的危险命令示例："
echo "--------------------------------------"
echo '❌ pkill -f "vite"'
echo '❌ pkill -f vite'
echo '❌ killall vite'
echo '❌ pkill -f "npm run.*dev"'
echo ""

echo "✅ 正确的做法："
echo "--------------------------------------"
echo "1. 先查找进程 ID："
echo "   ps aux | grep vite"
echo "   lsof -i :5173"
echo "   pgrep -f vite"
echo ""
echo "2. 确认进程信息："
echo "   ps -p <PID> -o pid,ppid,user,%cpu,%mem,command"
echo ""
echo "3. 杀死特定进程："
echo "   kill <PID>"
echo "   kill -9 <PID>  # 强制杀死（谨慎使用）"
echo ""
echo "4. 验证进程已停止："
echo "   ps -p <PID>"
echo ""

echo "🛠️  使用 safe_kill 工具："
echo "--------------------------------------"
echo "让 LLM 调用 safe_kill 工具："
echo "  safe_kill(pattern=\"vite\", signal=\"TERM\", byPort=false)"
echo ""
echo "工具会列出所有匹配的进程，让你选择要杀死的 PID。"
echo ""

echo "🚀 测试扩展："
echo "--------------------------------------"
echo "运行以下命令启动 pi 并加载扩展："
echo "  cd /Users/xuyingzhou/Project/temporary/pi-mono"
echo "  pi -e .pi/extensions/safe-kill"
echo ""
echo "然后尝试："
echo "  请用 bash 杀死 vite 进程：pkill -f \"vite\""
echo ""
echo "扩展会阻止这个命令并提供详细说明。"
echo ""

echo "======================================"
