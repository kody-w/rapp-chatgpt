#!/bin/bash
# Deploys to Kody's PERSONAL Azure subscription only. Uses an isolated az profile so the
# Microsoft work login on this machine can never be the target.
set -euo pipefail
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
export AZURE_CONFIG_DIR="$HOME/.azure-personal"
cd "$(dirname "$0")"
USER_NAME=$(az account show --query user.name -o tsv)
[[ "$USER_NAME" == *@microsoft.com ]] && { echo "Refusing: logged in as a Microsoft work account ($USER_NAME)"; exit 1; }
RG=${RG:-rapp-chatgpt}; LOC=${LOC:-eastus2}; APP=${APP:-rapp-agent-builder}
SA=${SA:-rappagentbuilder$(az account show --query id -o tsv | tr -d - | cut -c1-6)}
rm -rf src/core && mkdir -p src/core && cp ../src/index.js ../src/template.js src/core/
npm install --omit=dev --silent
az group create -n "$RG" -l "$LOC" -o none
az storage account show -n "$SA" -g "$RG" -o none 2>/dev/null || az storage account create -n "$SA" -g "$RG" -l "$LOC" --sku Standard_LRS --allow-blob-public-access false -o none
az functionapp show -n "$APP" -g "$RG" -o none 2>/dev/null || az functionapp create -n "$APP" -g "$RG" -s "$SA" --flexconsumption-location "$LOC" --runtime node --runtime-version 22 -o none
func azure functionapp publish "$APP" --javascript
echo "MCP endpoint: https://$(az functionapp show -n "$APP" -g "$RG" --query defaultHostName -o tsv)/mcp"
