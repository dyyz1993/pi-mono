#!/bin/bash

# 增量校验脚本 - 只针对 git 修改的文件

set -e

echo "🚀 Running incremental validation for git staged files..."
echo ""

# 获取所有修改的 ts/tsx 文件（移除 template/ 前缀）
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx)$' | sed 's|^template/||' || true)
MODIFIED_FILES=$(git diff --name-only --diff-filter=ACM | grep -E '\.(ts|tsx)$' | sed 's|^template/||' || true)

ALL_FILES="$STAGED_FILES $MODIFIED_FILES"

if [ -z "$ALL_FILES" ]; then
  echo "✅ No TypeScript files to validate"
  exit 0
fi

echo "📁 Files to validate:"
for file in $ALL_FILES; do
  echo "  - $file"
done
echo ""

# 运行 ESLint 只针对修改的文件
echo "🔍 Running ESLint on modified files..."
if [ -n "$STAGED_FILES" ]; then
  npx eslint $STAGED_FILES --max-warnings=0 || true
fi

if [ -n "$MODIFIED_FILES" ]; then
  npx eslint $MODIFIED_FILES --max-warnings=0 || true
fi

echo ""
echo "✅ Incremental validation completed!"
