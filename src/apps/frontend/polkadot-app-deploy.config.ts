// Product manifest for polkadot-app-deploy, found by walking up from the build
// directory. Besides the content, a deploy writes the `manifest` text record on
// contracts.dot and the `app.contracts.dot` executable that hosts load.
// A plain object: the CLI is installed globally, so `defineConfig` cannot be imported.
export default {
    domain: "contracts.dot",
    displayName: "Contracts",
    description:
        "Browse the Contract Dependency Manager registry on Polkadot. Explore published contracts, their versions, ABIs, and on-chain addresses — indexed by the CDM ContractRegistry on Asset Hub.",
    icon: { path: "./src/assets/logo.png", format: "png" },
    executables: [
        {
            kind: "app",
            path: "./dist",
            appVersion: [0, 2, 0],
        },
    ],
};
