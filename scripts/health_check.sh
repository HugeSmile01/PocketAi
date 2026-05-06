#!/usr/bin/env bash
# PocketAI — Health Check
# Usage: bash scripts/health_check.sh

PORT="${SERVER_PORT:-8080}"
echo -e "\n  Checking PocketAI server on port $PORT...\n"

if curl -sf "http://127.0.0.1:$PORT/health" > /dev/null 2>&1; then
  echo -e "  ✓ Server is running"
  MODEL=$(curl -sf "http://127.0.0.1:$PORT/props" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('default_generation_settings',{}).get('model','unknown'))" 2>/dev/null || echo "unknown")
  echo -e "  ✓ Model: $MODEL"
  echo -e "  ✓ Ready at http://127.0.0.1:$PORT/v1/chat/completions\n"
else
  echo -e "  ✗ Server not responding"
  echo -e "  → Run: bash scripts/launch.sh\n"
  exit 1
fi
