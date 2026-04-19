#!/usr/bin/env bash
# Deploy signals infrastructure to Azure.
#
# Secrets (DAILY_RAW_KEY, DAILY_API_KEYS, optionally MCP_API_KEYS) are sourced
# from scripts/.env.${ENVIRONMENT} when present; in CI they come from the
# workflow's secrets.
#
# Usage:
#   pnpm run deploy:infra                 # ENVIRONMENT=prod
#   ENVIRONMENT=dev pnpm run deploy:infra

set -euo pipefail

: "${ENVIRONMENT:=prod}"
RG="rg-signals-${ENVIRONMENT}"
ENV_FILE="scripts/.env.${ENVIRONMENT}"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

if [[ -z "${DAILY_RAW_KEY:-}" ]]; then
  echo "ERROR: DAILY_RAW_KEY is not set. Source $ENV_FILE or export it before running." >&2
  exit 1
fi
if [[ -z "${DAILY_API_KEYS:-}" ]]; then
  echo "ERROR: DAILY_API_KEYS is not set. Source $ENV_FILE or export it before running." >&2
  exit 1
fi

az group create -n "$RG" -l australiaeast --query id -o tsv > /dev/null

az deployment group create \
  --resource-group "$RG" \
  --template-file infra/main.bicep \
  --parameters "infra/parameters.${ENVIRONMENT}.json" \
  --parameters dailyRawKey="$DAILY_RAW_KEY" \
               dailyApiKeys="$DAILY_API_KEYS" \
               mcpApiKeys="${MCP_API_KEYS:-}"

echo
echo "Infra deployed. Next step:"
echo "  pnpm run deploy   # build + bundle + swa deploy the app"
