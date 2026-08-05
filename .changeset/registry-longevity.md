---
"@parity/cdm-builder": major
"@parity/cdm-utils": minor
"@parity/cdm-cli": minor
---

Registry longevity: rewrite the ContractRegistry on mainline cargo-pvm-contract behind an EIP-1967 proxy with `setCode` upgrades and `freeze`/`unfreeze`, drop on-chain prefix search, and deploy the proxy through a new CREATE3 factory (new `@cdm/registry.2` generation): the registry address is now a pure function of (factory, salt) — independent of bytecode and constructor input, stable across rebuilds and identical on every network bootstrapped by the same account.

Breaking for `@parity/cdm-builder`: `searchContractNames` is removed from the exported `CONTRACTS_REGISTRY_ABI`, and the registry now sits behind an EIP-1967 proxy with `setCode`/`freeze` admin entry points. Wire compatibility with already-deployed old-generation registries is preserved — multi-value returns keep the historical single-tuple encoding — so existing CLIs keep working.
