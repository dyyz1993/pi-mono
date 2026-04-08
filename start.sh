#!/bin/bash

# OpenViking Quick Start Script

echo "🚀 Starting OpenViking Knowledge Base..."

# Check if ports are already in use
if lsof -ti:8001 > /dev/null 2>&1; then
    echo "✅ Backend already running on port 8001"
else
    echo "📦 Starting backend..."
    cd packages/backend
    python start.py &
    cd ../..
    sleep 2
fi

if lsof -ti:5173 > /dev/null 2>&1; then
    echo "✅ Frontend already running on port 5173"
else
    echo "🎨 Starting frontend..."
    cd packages/frontend
    npm run dev &
    cd ../..
    sleep 2
fi

echo ""
echo "✨ OpenViking is ready!"
echo ""
echo "📱 Frontend: http://localhost:5173"
echo "🔌 Backend API: http://localhost:8001"
echo "📚 API Docs: http://localhost:8001/docs"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Wait for Ctrl+C
trap 'kill $(jobs -p) 2>/dev/null' EXIT
wait
