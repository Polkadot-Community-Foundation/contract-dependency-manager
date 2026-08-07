---
"@parity/cdm-cli": minor
"@parity/cdm-env": minor
"@parity/cdm-builder": patch
---

Update product-sdk to the 0.21.0 release line (descriptors 0.9.0, host 0.15.1, contracts 0.10.1, tx 0.4.1, chain-client 0.10.0, cloud-storage 0.10.0). Descriptors 0.9.0 regenerates the paseo-bulletin bindings for the `v0.0.22-paseo` runtime (new `DataRenewal` pallet), fixing commands like `cdm account bal -n paseo` that broke against the upgraded Bulletin chain. Following descriptors 0.8.0's removal of the decommissioned Web3 Summit chains, the `w3s` chain preset is removed (`paseo`, `devnet`, `polkadot`, and `local` are unaffected). Template scaffolds pin the updated product-sdk versions.
