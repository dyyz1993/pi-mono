#!/bin/bash

# OpenViking API 演示脚本
# 演示所有主要 API 端点的使用

BASE_URL="http://localhost:8000"

echo "OpenViking API 演示"
echo "=================="
echo ""

echo "1. 系统状态"
echo "-----------"
curl -s "$BASE_URL/api/status" | jq '.'
echo ""
echo ""

echo "2. Neo4j 图谱状态"
echo "-----------------"
curl -s "$BASE_URL/api/graph/status" | jq '.'
echo ""
echo ""

echo "3. Qdrant 向量库状态"
echo "--------------------"
curl -s "$BASE_URL/api/qdrant/status" | jq '.'
echo ""
echo ""

echo "4. Qdrant 集合列表"
echo "------------------"
curl -s "$BASE_URL/api/qdrant/collections" | jq '.'
echo ""
echo ""

echo "5. 搜索 Memories (语义搜索)"
echo "---------------------------"
curl -s "$BASE_URL/api/memories?q=python" | jq '.'
echo ""
echo ""

echo "6. 搜索 All Content"
echo "-------------------"
curl -s "$BASE_URL/api/search?q=python" | jq '.'
echo ""
echo ""

echo "7. 获取 Memories 统计"
echo "---------------------"
curl -s "$BASE_URL/api/memories/stats" | jq '.'
echo ""
echo ""

echo "8. 图谱查询 - 获取所有会话"
echo "---------------------------"
curl -s "$BASE_URL/api/graph/query?query=MATCH%20(n:Session)%20RETURN%20n%20LIMIT%205" | jq '.'
echo ""
echo ""

echo "演示完成！"
