---
"@parity/cdm-cli": minor
---

Warn on startup when a newer CDM release is available. The check runs in a detached background process and caches its result in `~/.cdm/update-check.json`, so commands never wait on the network; being a major version behind triggers a stronger warning about a potentially stale CDM registry. Opt out with `CDM_NO_UPDATE_CHECK=1`.
