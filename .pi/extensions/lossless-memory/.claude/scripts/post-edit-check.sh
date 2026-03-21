#!/bin/bash

# Claude Code Post-Edit Check Script
# 在每次编辑后自动运行验证

set -e

echo "🚀 Running post-edit validation..."
echo ""

# 运行所有验证器
npm run validate:all

# 如果验证失败，阻止操作
if [ $? -ne 0 ]; then
  echo ""
  echo "❌ Validation failed! Please fix the errors before proceeding."
  exit 1
fi

echo ""
echo "✅ All validations passed!"
