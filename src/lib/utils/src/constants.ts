// Alice's well-known SS58 address (used for read-only contract queries)
export const ALICE_SS58 = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";

// Generous defaults - work for most contracts, unused gas is refunded
export const GAS_LIMIT = { refTime: 500_000_000_000n, proofSize: 2_000_000n };

export const STORAGE_DEPOSIT_LIMIT = 100_000_000_000_000n;

// The contracts registry is the bootstrap - it's deployed first and has no CDM macro
export const CONTRACTS_REGISTRY_CRATE = "contract-registry";

// EIP-1967 proxy crate in front of the registry implementation. The proxy
// holds the stable registry address; all calls delegate to the implementation.
export const CONTRACTS_REGISTRY_PROXY_CRATE = "contract-registry-proxy";

// CREATE2 salt material for the ContractRegistry PROXY deployment — this is
// the stable address every consumer uses. Bump the suffix when deliberately
// deploying a new registry generation.
export const CONTRACTS_REGISTRY_PACKAGE = "@cdm/registry.2";

// CREATE2 salt material for the registry IMPLEMENTATION blob the proxy
// delegates to. Bump independently when shipping a new implementation build
// (upgrades go through `setCode`, never a proxy redeploy).
export const CONTRACTS_REGISTRY_IMPL_PACKAGE = "@cdm/registry-impl.1";

// Default WebSocket URL for local development
export const DEFAULT_NODE_URL = "ws://127.0.0.1:10020";
