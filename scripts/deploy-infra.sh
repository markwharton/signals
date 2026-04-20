#!/usr/bin/env bash
# Deploy signals infrastructure to Azure.
#
# Secrets (DAILY_RAW_KEY, DAILY_API_KEYS, GITHUB_CLIENT_ID,
# GITHUB_CLIENT_SECRET required; MCP_API_KEYS and ADMIN_API_KEYS
# optional) are sourced from scripts/.env.${ENVIRONMENT} when present;
# in CI they come from the workflow's secrets.
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
if [[ -z "${GITHUB_CLIENT_ID:-}" ]]; then
  echo "ERROR: GITHUB_CLIENT_ID is not set. Source $ENV_FILE or export it before running." >&2
  exit 1
fi
if [[ -z "${GITHUB_CLIENT_SECRET:-}" ]]; then
  echo "ERROR: GITHUB_CLIENT_SECRET is not set. Source $ENV_FILE or export it before running." >&2
  exit 1
fi

az group create -n "$RG" -l australiaeast --query id -o tsv > /dev/null

az deployment group create \
  --resource-group "$RG" \
  --template-file infra/main.bicep \
  --parameters "infra/parameters.${ENVIRONMENT}.json" \
  --parameters dailyRawKey="$DAILY_RAW_KEY" \
               dailyApiKeys="$DAILY_API_KEYS" \
               mcpApiKeys="${MCP_API_KEYS:-}" \
               adminApiKeys="${ADMIN_API_KEYS:-}" \
               githubClientId="$GITHUB_CLIENT_ID" \
               githubClientSecret="$GITHUB_CLIENT_SECRET"

echo
echo "Infra deployed. Next step:"
echo "  pnpm run deploy   # build + swa deploy the app and api together"
