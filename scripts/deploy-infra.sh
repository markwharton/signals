#!/usr/bin/env bash
# Deploy signals infrastructure to Azure.
#
# Optional MCP_API_KEYS is sourced from scripts/.env.${ENVIRONMENT} when
# present; in CI it comes from the workflow's secrets. No secret is required
# for a core signals deployment — the daily job runs as a timer trigger,
# not a Logic App HTTP call, and the only authenticated endpoint
# (/api/mcp) is provisioned only when MCP_API_KEYS is non-empty.
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

az group create -n "$RG" -l australiaeast --query id -o tsv > /dev/null

az deployment group create \
  --resource-group "$RG" \
  --template-file infra/main.bicep \
  --parameters "infra/parameters.${ENVIRONMENT}.json" \
  --parameters mcpApiKeys="${MCP_API_KEYS:-}"

echo
echo "Infra deployed. Next step:"
echo "  pnpm run deploy   # build + bundle + swa deploy the app"
