#!/bin/bash

# OpenViking 开发环境启动脚本

set -e

echo "🚀 OpenViking 开发环境启动"
echo "================================"
echo ""

# 检查依赖
echo "📦 检查依赖..."

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js 未安装，请先安装 Node.js 18+"
    exit 1
fi

# 检查 Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Python3 未安装，请先安装 Python 3.11+"
    exit 1
fi

echo "✅ 依赖检查通过"
echo ""

# 安装前端依赖
if [ ! -d "node_modules" ]; then
    echo "📦 安装前端依赖..."
    npm install
fi

# 安装后端依赖
if [ ! -d "packages/backend/venv" ]; then
    echo "📦 安装后端依赖..."
    cd packages/backend
    ./setup.sh
    cd ../..
fi

echo ""
echo "🎯 启动服务..."
echo ""

# 创建临时文件存储进程 ID
BACKEND_PID_FILE=$(mktemp)
FRONTEND_PID_FILE=$(mktemp)

# 清理函数
cleanup() {
    echo ""
    echo "🛑 停止服务..."
    if [ -f "$BACKEND_PID_FILE" ] && kill -0 $(cat "$BACKEND_PID_FILE") 2>/dev/null; then
        kill $(cat "$BACKEND_PID_FILE")
    fi
    if [ -f "$FRONTEND_PID_FILE" ] && kill -0 $(cat "$FRONTEND_PID_FILE") 2>/dev/null; then
        kill $(cat "$FRONTEND_PID_FILE")
    fi
    rm -f "$BACKEND_PID_FILE" "$FRONTEND_PID_FILE"
    echo "✅ 服务已停止"
    exit
}

# 注册清理函数
trap cleanup INT TERM

# 启动后端
echo "🔧 启动后端服务 (端口 8000)..."
cd packages/backend
source venv/bin/activate
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 &
echo $! > "$BACKEND_PID_FILE"
cd ../..

# 等待后端启动
sleep 3

# 启动前端
echo "🎨 启动前端服务 (端口 5173)..."
cd packages/frontend
npm run dev &
echo $! > "$FRONTEND_PID_FILE"
cd ..

echo ""
echo "✅ 服务启动成功！"
echo ""
echo "📍 访问地址："
echo "   - 前端: http://localhost:5173"
echo "   - 后端: http://localhost:8000"
echo "   - API 文档: http://localhost:8000/docs"
echo ""
echo "💡 按 Ctrl+C 停止所有服务"
echo ""

# 等待进程
wait
