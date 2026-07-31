#!/usr/bin/env bash
set -euo pipefail

# Builds the on-chain ContractRegistry (src/contract) to a PolkaVM blob at
# target/contract-registry.release.polkavm.
#
# Why the pinned toolchain: the registry deliberately stays on the OLD
# pvm_contract SDK line (git branch charles/cdm-integration, Cargo.lock-pinned).
# Its allocator and entry points are injected only by the MATCHING old-line
# cargo-pvm-contract (the PVM_ENTRY_POINT_CRATE mechanism that never merged to
# main), so the main-line tool structurally cannot build it ("no global memory
# allocator found"). The globally installed cargo-pvm-contract stays on main
# for new-SDK contracts; this script installs a rev-pinned old-line copy under
# ~/.cdm/toolchain (one-time, ~3 min) and prefixes it onto PATH for this build
# only.

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd)"

TOOLCHAIN_ROOT="$HOME/.cdm/toolchain/registry-cargo-pvm-contract"
TOOLCHAIN_REV="d886ab2aa80ffdd0e66133320bcbb4921ff2fc8c"

if [[ ! -x "$TOOLCHAIN_ROOT/bin/cargo-pvm-contract" ]]; then
    echo "Installing rev-pinned cargo-pvm-contract ($TOOLCHAIN_REV) for the registry build (one-time, ~3 min)..."
    cargo install --locked \
        --root "$TOOLCHAIN_ROOT" \
        --git https://github.com/paritytech/cargo-pvm-contract \
        --rev "$TOOLCHAIN_REV" \
        cargo-pvm-contract
fi

PATH="$TOOLCHAIN_ROOT/bin:$PATH" \
    cargo pvm-contract build --manifest-path "$ROOT/Cargo.toml" -p contract-registry
