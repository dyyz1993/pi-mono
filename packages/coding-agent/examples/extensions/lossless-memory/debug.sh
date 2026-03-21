#!/bin/bash
# Lossless Memory Extension Debug Script
# 用于详细调试扩展的每个组件

set -e

EXTENSION_DIR="$HOME/.pi/agent/extensions/lossless-memory"
DB_PATH="$HOME/.pi/agent/lossless-memory.db"
LOG_FILE="/tmp/lossless-memory-debug.log"

echo "========================================"
echo "Lossless Memory Extension 调试脚本"
echo "========================================"
echo ""

# 1. 检查扩展文件
echo "1. 检查扩展文件..."
echo "----------------------------------------"
if [ -d "$EXTENSION_DIR" ]; then
    echo "✓ 扩展目录存在：$EXTENSION_DIR"
    ls -la "$EXTENSION_DIR"
    echo ""
    echo "源文件:"
    ls -la "$EXTENSION_DIR/src/"
else
    echo "✗ 扩展目录不存在！"
    exit 1
fi
echo ""

# 2. 检查依赖
echo "2. 检查 npm 依赖..."
echo "----------------------------------------"
if [ -f "$EXTENSION_DIR/node_modules/better-sqlite3/package.json" ]; then
    echo "✓ better-sqlite3 已安装"
    cat "$EXTENSION_DIR/node_modules/better-sqlite3/package.json" | grep version
else
    echo "✗ better-sqlite3 未安装，正在安装..."
    cd "$EXTENSION_DIR" && npm install
fi
echo ""

# 3. 检查数据库
echo "3. 检查 SQLite 数据库..."
echo "----------------------------------------"
if [ -f "$DB_PATH" ]; then
    echo "✓ 数据库文件存在：$DB_PATH"
    echo "文件大小：$(ls -lh "$DB_PATH" | awk '{print $5}')"
    echo ""
    echo "表结构:"
    sqlite3 "$DB_PATH" ".tables"
    echo ""
    echo "节点统计:"
    sqlite3 "$DB_PATH" "SELECT COUNT(*) as node_count FROM memory_nodes;" 2>/dev/null || echo "  (无数据)"
    echo ""
    echo "FTS5 索引:"
    sqlite3 "$DB_PATH" "SELECT COUNT(*) as fts_count FROM memory_fts;" 2>/dev/null || echo "  (无数据)"
else
    echo "ℹ 数据库文件不存在（首次运行时会创建）"
fi
echo ""

# 4. TypeScript 语法检查
echo "4. TypeScript 语法检查..."
echo "----------------------------------------"
cd "$EXTENSION_DIR"
npx tsc --noEmit --skipLibCheck src/index.ts 2>&1 | head -50 || echo "TypeScript 检查完成（可能有类型警告，不影响运行）"
echo ""

# 5. 检查 pi 配置
echo "5. 检查 pi 配置..."
echo "----------------------------------------"
if [ -f "$HOME/.pi/agent/settings.json" ]; then
    echo "✓ settings.json 存在"
    echo "内容:"
    cat "$HOME/.pi/agent/settings.json" | grep -A 20 "losslessMemory" || echo "  (未找到 losslessMemory 配置)"
else
    echo "ℹ settings.json 不存在（将使用默认配置）"
fi
echo ""

# 6. 启动 pi 并测试
echo "6. 准备启动 pi 进行测试..."
echo "----------------------------------------"
echo ""
echo "测试选项:"
echo "  1) 启动 pi 交互式模式（手动测试）"
echo "  2) 使用测试消息启动（自动测试）"
echo "  3) 仅检查扩展加载"
echo ""
read -p "选择测试模式 (1/2/3): " test_mode

case $test_mode in
    1)
        echo ""
        echo "启动 pi 交互式模式..."
        echo "提示：在 pi 中输入 '/memory-stats' 查看记忆统计"
        echo "      输入 '/memory-search 关键词' 测试搜索"
        echo "按 Ctrl+C 退出"
        echo ""
        pi --verbose
        ;;
    2)
        echo ""
        echo "使用测试消息启动..."
        pi --verbose "测试 Lossless Memory 扩展" <<EOF
/memory-stats
EOF
        ;;
    3)
        echo ""
        echo "检查扩展加载..."
        pi --verbose --no-session "测试" <<EOF
EOF
        ;;
esac

echo ""
echo "========================================"
echo "调试完成"
echo "========================================"
