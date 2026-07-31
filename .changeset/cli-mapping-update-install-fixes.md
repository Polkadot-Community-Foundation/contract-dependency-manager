---
"@parity/cdm-cli": minor
---

Account mapping now only reports "already mapped" when Revive actually returns `AccountAlreadyMapped` (other failures surface and fail the command), `cdm update` no longer honors an ambient `VERSION` env var (use `--tag` or `CDM_TAG`) and resolves the release tag once, `cdm install --assethub-url` always wins over `--name` presets (no commander default), and `cdm deploy` gains `--ipfs-gateway-url`.
