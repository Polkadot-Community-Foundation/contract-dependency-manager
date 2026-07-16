// SPDX-License-Identifier: GPL-3.0-only
//
// Product manifest for `@polkadot-community-foundation/polkadot-app-deploy`
// (the Bulletin app-deploy CLI). The tool auto-discovers this file by name
// (`polkadot-app-deploy.config.{ts,js,mjs}`, walking up from the build dir)
// and reads the default export to publish the product manifest (display name,
// description, icon) alongside the content upload. A file named anything else
// is silently ignored — manifest publish skipped, no error.
//
// `defineConfig` is vendored as an identity function rather than imported from
// the deploy CLI: the tool is a global/npx CLI, not a package.json dependency,
// so importing from it would make config resolution fragile.
const defineConfig = <T>(config: T): T => config;

declare const process: { env?: Record<string, string | undefined> };

// APP_DOTNS_DOMAIN lets CI/preview deploys override the bare label; defaults to
// the production label. MUST match the domain the CLI is invoked with
// (deploy-frontend.sh passes `contracts.dot`).
const domain = process.env?.APP_DOTNS_DOMAIN ?? "contracts";
const label = domain.toLowerCase().replace(/\.dot$/, "");

export default defineConfig({
  domain: `${label}.dot`,
  displayName: "Contracts",
  description:
    "Browse the Contract Dependency Manager registry on Polkadot. Explore published contracts, their versions, ABIs, and on-chain addresses — indexed by the CDM ContractRegistry on Asset Hub.",
  icon: { path: "./src/assets/logo.png", format: "png" },
  executables: [
    {
      kind: "app",
      path: "./dist",
      appVersion: [0, 1, 0],
    },
  ],
});
