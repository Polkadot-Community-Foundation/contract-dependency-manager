---
"@parity/cdm-env": minor
---

Point the `devnet` preset at the new-generation ContractRegistry (`0x05662b3dbd5dd9f2ff92d67630477e84b0b37c1f`) — the EIP-1967 proxy deployed through the CREATE3 factory on 2026-09-04 and migrated from `0x59b0245778917af55224e5f8fb55f7f8d452619f`, carrying all 69 registered names and their 168 versions with each name's original owner preserved.

The predecessor is a pre-proxy build that traps with `Revive.ContractTrapped` when a brand-new name is appended to its name index, so `cdm deploy` fails for any contract whose CDM name is not already registered (products-devnet-issues #10/#12). It has no admin, so it could not be fixed with `setCode` — hence a new address. Verified against the reported cases: `publishLatest` dry-runs for `@thebutton/chirp` and `@thebutton/zzz-brand-new` trap on the old registry and succeed on the new one.

The old registry stays on-chain and keeps serving reads, so consumers still pinning it are not broken and can move at their own pace. Note the `paseo-next` preset deliberately keeps the old address: it is a separate deployment on a different chain that shares the address because CREATE3 makes it a pure function of (factory, salt).
