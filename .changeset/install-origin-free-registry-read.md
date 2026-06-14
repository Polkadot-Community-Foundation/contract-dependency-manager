---
"@parity/cdm-cli": patch
---

Fix `cdm install` failing with `Revive.AccountUnmapped` on live chains. The registry is now read with no origin (pallet-revive's mapping-free query fallback, matching the web frontend) instead of an ss58 `defaultOrigin` that must be mapped on-chain. Previously a consumer with an unmapped account — or no saved account at all (the fallback was the unmapped `ALICE_SS58`) — could not `install` from a registry on Summit.
