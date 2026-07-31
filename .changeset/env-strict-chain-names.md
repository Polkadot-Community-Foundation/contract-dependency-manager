---
"@parity/cdm-env": minor
---

`getRegistryAddress` now throws an actionable error for unknown chain names instead of returning an empty address, and chain-name validation is derived from the KNOWN_CHAINS presets in one place (`normalizeChainName`), so typo'd chain names fail fast everywhere.
