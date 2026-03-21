#!/bin/bash

# 测试 pre-tool-use-check.sh 脚本

set -e

SCRIPT_PATH=".claude/scripts/pre-tool-use-check.sh"

echo "🧪 测试 pre-tool-use-check.sh 脚本"
echo "=================================================="
echo ""

# 测试 1: 正常的 git commit 命令（应该通过）
echo "📋 测试 1: 正常的 git commit 命令"
echo "--------------------------------------------------"
echo '{"tool_name": "Bash", "tool_input": {"command": "git commit -m \"test message\""}}' | bash "$SCRIPT_PATH"
if [ $? -eq 0 ]; then
  echo "✅ 测试通过：正常命令被允许"
else
  echo "❌ 测试失败：正常命令被拒绝"
  exit 1
fi
echo ""

# 测试 2: git commit --no-verify 命令（应该被拒绝）
echo "📋 测试 2: git commit --no-verify 命令"
echo "--------------------------------------------------"
if echo '{"tool_name": "Bash", "tool_input": {"command": "git commit --no-verify -m \"test\""}}' | bash "$SCRIPT_PATH" 2>&1; then
  echo "❌ 测试失败：--no-verify 命令被允许"
  exit 1
else
  echo "✅ 测试通过：--no-verify 命令被拒绝"
fi
echo ""

# 测试 3: git push --force 命令（应该被拒绝）
echo "📋 测试 3: git push --force 命令"
echo "--------------------------------------------------"
if echo '{"tool_name": "Bash", "tool_input": {"command": "git push --force origin main"}}' | bash "$SCRIPT_PATH" 2>&1; then
  echo "❌ 测试失败：--force 命令被允许"
  exit 1
else
  echo "✅ 测试通过：--force 命令被拒绝"
fi
echo ""

# 测试 4: 非 Bash 工具（应该通过）
echo "📋 测试 4: 非 Bash 工具"
echo "--------------------------------------------------"
echo '{"tool_name": "Write", "tool_input": {"file_path": "/tmp/test.txt"}}' | bash "$SCRIPT_PATH"
if [ $? -eq 0 ]; then
  echo "✅ 测试通过：非 Bash 工具被允许"
else
  echo "❌ 测试失败：非 Bash 工具被拒绝"
  exit 1
fi
echo ""

# 测试 5: git push --force-with-lease（应该通过）
echo "📋 测试 5: git push --force-with-lease 命令"
echo "--------------------------------------------------"
echo '{"tool_name": "Bash", "tool_input": {"command": "git push --force-with-lease origin main"}}' | bash "$SCRIPT_PATH"
if [ $? -eq 0 ]; then
  echo "✅ 测试通过：--force-with-lease 命令被允许"
else
  echo "❌ 测试失败：--force-with-lease 命令被拒绝"
  exit 1
fi
echo ""

echo "=================================================="
echo "✅ 所有测试通过！"
echo "=================================================="
