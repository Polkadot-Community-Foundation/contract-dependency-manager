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
ENV_ID="${BULLETIN_DEPLOY_ENV:-devnet}"

cd "$ROOT"

if [[ "${SKIP_BULLETIN_INSTALL:-0}" != "1" ]]; then
    # PCF fork of bulletin-deploy (renamed); pinned to a known-good Summit-capable
    # release that ships under the @polkadot-community-foundation scope.
    npm install -g @polkadot-community-foundation/polkadot-app-deploy@0.12.1
fi

pnpm turbo build --filter=@parity/cdm-frontend

export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=8192"

# Use --mnemonic (NOT --suri): --mnemonic is the DotNS *owner* key, which gives
# signerMode "direct" (5Fk8 storage — Summit Bulletin rejects the pool signer)
# AND signs setContenthash headlessly. --suri only sets the upload worker + pool
# mode and wires a session signer that forces the interactive phone prompt for
# the owner write (it aborts in CI). This is the suite-wide "--mnemonic FLAG for
# direct Bulletin upload" rule (see simple-survey / webviews).
polkadot-app-deploy \
    --env "$ENV_ID" \
    --mnemonic "$SURI" \
    "$FRONTEND_DIST" \
    "$DOMAIN" \
    "$@"
