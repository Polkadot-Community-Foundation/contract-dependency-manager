---
"@parity/cdm-builder": major
---

Breaking: `pvmContractBuild`/`pvmContractBuildAsync` and `buildContracts` now require an explicit `registryAddress` — omitting it no longer silently embeds the paseo registry. Also: registry query errors are only classified as "contract not found" for viem zero-data decode errors (with the original error attached as `cause`), the deploy pipeline dry-runs each contract once via `planDeploy` instead of twice (address precompute errors now propagate instead of being swallowed), and `--contracts` filtering matches Rust contracts by CDM package name and display name like Solidity targets.
