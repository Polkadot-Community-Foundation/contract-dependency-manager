---
"@parity/cdm-builder": minor
"@parity/cdm-utils": minor
"@parity/cdm-cli": minor
---

Registry longevity: rewrite the ContractRegistry on mainline cargo-pvm-contract behind an EIP-1967 proxy with `setCode` upgrades and `freeze`/`unfreeze`, drop on-chain prefix search, and switch deploys to the two-step implementation + proxy flow (new `@cdm/registry.2` generation).
