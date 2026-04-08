#!/bin/bash

# OpenViking API Demo

echo "🔍 OpenViking API Demo"
echo "======================"
echo ""

BASE_URL="http://localhost:8001"

echo "1. Health Check"
echo "---------------"
curl -s "$BASE_URL/health" | jq '.'
echo ""
echo ""

echo "2. List All Memories"
echo "--------------------"
curl -s "$BASE_URL/api/memories" | jq '.'
echo ""

echo "3. Get User Profile"
echo "-------------------"
curl -s "$BASE_URL/api/memories/user/profile" | jq '.'
echo ""

echo "4. List All Resources"
echo "---------------------"
curl -s "$BASE_URL/api/resources" | jq '.'
echo ""

echo "5. List All Skills"
echo "------------------"
curl -s "$BASE_URL/api/skills" | jq '.'
echo ""

echo "6. Search for 'typescript'"
echo "--------------------------"
curl -s -X POST "$BASE_URL/api/search" \
  -H "Content-Type: application/json" \
  -d '{"query": "typescript"}' | jq '.'
echo ""
echo ""

echo "7. Search for 'git'"
echo "-------------------"
curl -s -X POST "$BASE_URL/api/search" \
  -H "Content-Type: application/json" \
  -d '{"query": "git"}' | jq '.'
echo ""
echo ""

echo "✅ Demo complete!"
echo ""
echo "Try these yourself:"
echo "  curl $BASE_URL/api/memories"
echo "  curl $BASE_URL/api/resources"
echo "  curl $BASE_URL/api/skills"
echo "  curl -X POST $BASE_URL/api/search -H 'Content-Type: application/json' -d '{\"query\": \"your search\"}'"
