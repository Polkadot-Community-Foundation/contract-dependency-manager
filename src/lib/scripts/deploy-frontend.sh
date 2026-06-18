#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: src/lib/scripts/deploy-frontend.sh <suri> [polkadot-app-deploy args...]

Builds the CDM frontend and deploys it to contracts.dot with the PCF fork
polkadot-app-deploy (renamed bulletin-deploy).

Examples:
  src/lib/scripts/deploy-frontend.sh '//Alice'
  src/lib/scripts/deploy-frontend.sh "$CDM_DEPLOY_SURI" --tag frontend

Environment:
  BULLETIN_DEPLOY_ENV       Target deploy env. Default: summit
  SKIP_BULLETIN_INSTALL     Set to 1 to skip the global npm install of the CLI
EOF
}

if [[ $# -lt 1 || "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 1
fi

SURI="$1"
shift

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd)"
FRONTEND_DIST="$ROOT/src/apps/frontend/dist"
DOMAIN="contracts.dot"
ENV_ID="${BULLETIN_DEPLOY_ENV:-summit}"

cd "$ROOT"

if [[ "${SKIP_BULLETIN_INSTALL:-0}" != "1" ]]; then
    # PCF fork of bulletin-deploy (renamed); pinned to a known-good Summit-capable
    # release that ships under the @polkadot-community-foundation scope.
    npm install -g @polkadot-community-foundation/polkadot-app-deploy@0.11.2
fi

pnpm turbo build --filter=@parity/cdm-frontend

export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=8192"

# The Bulletin upload (worker) reads --suri, but the DotNS owner leg
# (setContenthash on contracts.dot) reads the MNEMONIC / DOTNS_MNEMONIC env var
# (src/dotns.ts) — without it that step falls back to the interactive
# phone/SSO signer and aborts in CI. Export it so both legs sign headlessly.
export MNEMONIC="$SURI"

polkadot-app-deploy \
    --env "$ENV_ID" \
    --suri "$SURI" \
    "$FRONTEND_DIST" \
    "$DOMAIN" \
    "$@"
