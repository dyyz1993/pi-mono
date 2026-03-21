#!/bin/bash

# Claude Code Pre-Tool-Use Check Script
# 在执行 Bash 命令前检查是否包含禁止的操作

set -e

# 读取工具输入（从 stdin）
TOOL_INPUT=$(cat)

# 检查是否是 Bash 工具
TOOL_NAME=$(echo "$TOOL_INPUT" | jq -r '.tool_name // empty')

if [ "$TOOL_NAME" != "Bash" ]; then
  # 不是 Bash 工具，直接通过
  exit 0
fi

# 提取命令
COMMAND=$(echo "$TOOL_INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$COMMAND" ]; then
  # 没有命令，直接通过
  exit 0
fi

# 检查是否包含 --no-verify 或 -n
if echo "$COMMAND" | grep -qE 'git\s+commit.*(--no-verify|-n)'; then
  echo ""
  echo "❌ 检测到禁止的命令！"
  echo ""
  echo "🚫 禁止使用 'git commit --no-verify' 或 'git commit -n'"
  echo ""
  echo "原因："
  echo "  • Pre-commit hooks 确保代码质量（格式检查、测试运行）"
  echo "  • 跳过 hooks 会将低质量代码提交到仓库"
  echo "  • 影响团队协作和代码审查"
  echo ""
  echo "正确做法："
  echo "  ✅ git commit -m \"your message\""
  echo ""
  echo "如果 hooks 失败："
  echo "  1. 运行测试失败 → 修复测试后再提交"
  echo "  2. 格式检查失败 → 运行 npm run format 修复"
  echo "  3. 验证器失败 → 修复验证问题"
  echo ""
  echo "📖 详细说明: .claude/rules/git-workflow.md"
  echo ""
  exit 1
fi

# 检查其他禁止的 git 操作
# 先检查是否包含 --force-with-lease（允许）
if echo "$COMMAND" | grep -qE 'git\s+push.*--force-with-lease'; then
  # --force-with-lease 是安全的，允许通过
  :
elif echo "$COMMAND" | grep -qE 'git\s+push.*--force'; then
  echo ""
  echo "❌ 检测到禁止的命令！"
  echo ""
  echo "🚫 禁止使用 'git push --force'"
  echo ""
  echo "原因："
  echo "  • 强制推送会覆盖远程仓库的历史"
  echo "  • 可能导致其他开发者的工作丢失"
  echo "  • 破坏团队协作"
  echo ""
  echo "替代方案："
  echo "  ✅ git push --force-with-lease (更安全的强制推送)"
  echo "  ✅ 先 pull 再 push"
  echo ""
  exit 1
fi

# 检查是否直接修改 .husky 目录
if echo "$COMMAND" | grep -qE '(rm|mv|chmod|chown).*\.husky'; then
  echo ""
  echo "⚠️  警告：正在修改 .husky 目录"
  echo ""
  echo "这可能会影响 Git hooks 的正常运行。"
  echo "请确保你知道自己在做什么。"
  echo ""
fi

# 所有检查通过
exit 0
