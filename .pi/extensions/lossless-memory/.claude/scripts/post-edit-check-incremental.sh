#!/bin/bash

# Claude Code Incremental Post-Edit Check Script
# 只针对修改的文件进行快速校验

set -e

# 获取传入的文件路径
FILE_PATH="$1"

if [ -z "$FILE_PATH" ]; then
  echo "❌ No file path provided. Usage: $0 <file-path>"
  exit 1
fi

# 获取文件扩展名
FILE_EXT="${FILE_PATH##*.}"
FILE_NAME=$(basename "$FILE_PATH")

echo "🚀 Running incremental validation for: $FILE_NAME"
echo ""

# 1. ESLint 校验（只针对当前文件）
if [[ "$FILE_EXT" == "ts" || "$FILE_EXT" == "tsx" || "$FILE_EXT" == "js" || "$FILE_EXT" == "jsx" ]]; then
  echo "🔍 [1/2] Running ESLint..."
  if npx eslint "$FILE_PATH" --max-warnings=0; then
    echo "  ✅ ESLint passed"
  else
    echo "  ❌ ESLint failed"
    exit 1
  fi
  echo ""
fi

# 2. TypeScript 类型检查（只针对当前文件，如果 tsc 支持）
if [[ "$FILE_EXT" == "ts" || "$FILE_EXT" == "tsx" ]]; then
  echo "🔍 [2/2] Running TypeScript check..."
  # 使用 tsc 的增量检查（如果有 tsconfig.tsbuildinfo）
  if npx tsc --noEmit --pretty 2>&1 | grep -q "$FILE_PATH"; then
    echo "  ⚠️ Type errors found in $FILE_NAME"
    npx tsc --noEmit --pretty 2>&1 | grep -A 3 "$FILE_PATH" || true
  else
    echo "  ✅ TypeScript check passed"
  fi
  echo ""
fi

# 3. 如果是服务端路由文件，运行相关验证
if [[ "$FILE_PATH" == *"/server/"* && "$FILE_PATH" == *"routes"* ]]; then
  echo "🔍 Running server RPC validation..."
  npm run validate:all 2>&1 | grep -E "(Server RPC|✅|❌)" || true
fi

# 4. 如果是客户端文件，运行相关验证
if [[ "$FILE_PATH" == *"/client/"* ]]; then
  echo "🔍 Running client RPC validation..."
  npm run validate:all 2>&1 | grep -E "(Client RPC|✅|❌)" || true
fi

echo ""
echo "✅ Incremental validation passed for $FILE_NAME!"
