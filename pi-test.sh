#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check for --no-env flag
NO_ENV=false
ARGS=()
for arg in "$@"; do
  if [[ "$arg" == "--no-env" ]]; then
    NO_ENV=true
  else
    ARGS+=("$arg")
  fi
done

if [[ "$NO_ENV" == "true" ]]; then
  # Unset API keys (see packages/ai/src/env-api-keys.ts)
  unset ANTHROPIC_API_KEY
  unset ANTHROPIC_OAUTH_TOKEN
  unset OPENAI_API_KEY
  unset GEMINI_API_KEY
  unset GROQ_API_KEY
  unset CEREBRAS_API_KEY
  unset XAI_API_KEY
  OPENROUTER_API_KEY
  unset ZAI_API_KEY
  MISTRAL_API_KEY
  unset MINIMAX_CN_API_KEY
  unset AI_GATEWAY_API_KEY
  OPENCODE_API_KEY
  COPILOT_GITHUB_TOKEN
  GH_TOKEN
  GITHUB_TOKEN
  GOOGLE_APPLICATION_CREDENTIALS
  GOOGLE_CLOUD_PROJECT
  GCLOUD_PROJECT
  GOOGLE_CLOUD_LOCATION
  AWS_PROFILE
  AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY
  AWS_SESSION_TOKEN
 AWS_REGION
  AWS_DEFAULT_REGION
  AWS_BEARER_TOKEN_BEDROCK
  AWS_CONTAINER_CREDENTIALS_RELATIVE_URI
  AWS_CONTAINER_CREDENTIALS_FULL_URI
  AWS_WEB_IDENTITY_FILE
  AZURE_OPENAI_API_KEY
  AZURE_OPENAI_BASE_URL
  AZURE_OPENAI_RESOURCE_NAME
  echo "Running without API keys..."
fi

# Disable cache_control for JD Cloud anthropic endpoint (doesn't support it, returns 400)
export PI_CACHE_RETENTION=none
export DEBUG_ANTHROPIC_REQUEST=1

echo "PI-TEST: Starting pi at $(date)" > /tmp/pi-test-debug.log 2>&1
echo "PI-TEST: DEBUG_ANTHROPIC_REQUEST=$DEBUG_ANTHROPIC_REQUEST" >> /tmp/pi-test-debug.log 2>&1
echo "PI-TEST: CWD=$(pwd)" >> /tmp/pi-test-debug.log 2>&1

TSX_BIN="$SCRIPT_DIR/node_modules/.bin/tsx"
if [[ ! -x "$TSX_BIN" ]]; then
  echo "tsx not found at $TSX_BIN. Run npm install from the repo root first." >&2
  exit 1
fi

"$TSX_BIN" "$SCRIPT_DIR/packages/coding-agent/src/cli.ts" ${ARGS[@]+"${ARGS[@]}"} 2>/tmp/pi-stderr.log
