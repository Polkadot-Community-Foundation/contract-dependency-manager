#!/usr/bin/env node
/**
 * rescope-pack.mjs — stage a PCF-scoped tarball of this CLI as
 * `@polkadot-community-foundation/cdm-cli`, WITHOUT renaming it in-tree.
 *
 * Why: this is a fork of paritytech/contract-dependency-manager. The CLI package is named
 * `@parity/cdm-cli` in-tree (and depends on the in-tree `@parity/cdm-{utils,env,codegen,builder}`
 * workspace packages), so we keep the upstream name to stay merge-clean with
 * `git merge upstream/main`. PCF publishes the CLI under its own scope.
 *
 * Why BUNDLE (unlike cdm-env, which ships dist/ + external @parity/* deps):
 *   The in-tree `@parity/cdm-{env,codegen,builder}` versions are AHEAD of npm (e.g. in-tree
 *   cdm-builder 3.1.6 vs npm 3.1.5). An external-deps tarball would therefore depend on
 *   UNPUBLISHED versions and be uninstallable. Bundling everything into a single node-runnable
 *   `dist/cli.js` (the same approach `dotns-cli` uses) sidesteps that entirely AND bakes in the
 *   in-tree cdm-env carrying the deployed Summit/W3S registry address. The bundle is self-contained
 *   (zero runtime deps; the only wasm is inlined hashing — no external .wasm, smoldot is not used).
 *
 * What it does:
 *   1. `bun run` the embed-templates generator (produces src/generated/templates.ts).
 *   2. `bun build src/cli.ts --target node --format esm` -> dist/cli.js (bun preserves the shebang).
 *   3. Stage a clean public package.json (name -> @polkadot-community-foundation/cdm-cli, version,
 *      bin `cdm`, files [dist], NO dependencies — all bundled) + dist/cli.js + LICENSE + README.
 *   4. `npm pack` into pack-output/ — the tarball the npm-publish-automation expects.
 *
 * Assumes the workspace libs (@parity/cdm-builder, @parity/cdm-codegen) are already BUILT — the
 * publish workflow runs `pnpm --filter ... build` first. Run from anywhere (it cd's itself).
 *
 * Usage: node scripts/rescope-pack.mjs
 *   env PCF_CLI_VERSION=0.8.23 overrides the published version (default = the in-tree version).
 *
 * See summit-deployer-skills/guides/PCF_NPM_PUBLISHING.md and
 * Polkadot-Community-Foundation/npm-publish-automation (publishable-packages.json).
 */
import { execSync } from "node:child_process";
import {
    chmodSync,
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(PKG_DIR, "../../..");
const PUBLISHED_NAME = "@polkadot-community-foundation/cdm-cli";
const OUT_DIR = join(PKG_DIR, "pack-output");

const inTree = JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf8"));
const PUBLISHED_VERSION = process.env.PCF_CLI_VERSION || inTree.version;

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: ["ignore", "pipe", "inherit"] }).toString().trim();

console.log(`[rescope-pack] embedding templates`);
run(`bun run ${join(REPO_ROOT, "src/lib/scripts/embed-templates.ts")}`, REPO_ROOT);

console.log(`[rescope-pack] bundling ${PKG_DIR}/src/cli.ts -> dist/cli.js`);
run("bun build src/cli.ts --target node --format esm --outfile dist/cli.js", PKG_DIR);
chmodSync(join(PKG_DIR, "dist/cli.js"), 0o755);

const stage = mkdtempSync(join(tmpdir(), "pcf-cdm-cli-"));
mkdirSync(join(stage, "dist"), { recursive: true });
copyFileSync(join(PKG_DIR, "dist/cli.js"), join(stage, "dist/cli.js"));
chmodSync(join(stage, "dist/cli.js"), 0o755);
copyFileSync(join(REPO_ROOT, "LICENSE"), join(stage, "LICENSE"));

const pkg = {
    name: PUBLISHED_NAME,
    version: PUBLISHED_VERSION,
    description:
        "Contract Dependency Manager CLI (cdm) for PolkaVM smart contracts — builds, installs, and deploys CDM libraries. Ships with the Summit/W3S network preset.",
    type: "module",
    license: "MIT",
    bin: { cdm: "./dist/cli.js" },
    files: ["dist"],
    engines: { node: ">=20" },
    publishConfig: { access: "public" },
    repository: {
        type: "git",
        url: "git+https://github.com/Polkadot-Community-Foundation/contract-dependency-manager.git",
        directory: "src/apps/cli",
    },
    homepage:
        "https://github.com/Polkadot-Community-Foundation/contract-dependency-manager/tree/main/src/apps/cli",
    keywords: ["cdm", "polkadot", "polkavm", "pallet-revive", "smart-contracts", "cli", "summit"],
};
writeFileSync(join(stage, "package.json"), JSON.stringify(pkg, null, 4) + "\n");

const readme = `# ${PUBLISHED_NAME}

The **Contract Dependency Manager** CLI (\`cdm\`) for PolkaVM smart contracts — build, install, and
deploy CDM contract libraries. This is the Polkadot Community Foundation distribution; it ships with
the **Summit / W3S** network preset (the deployed \`ContractRegistry\` address) baked in.

\`\`\`sh
npm install -g ${PUBLISHED_NAME}
cdm --help
\`\`\`

The CLI is bundled into a single self-contained executable (no runtime dependencies).

Source: https://github.com/Polkadot-Community-Foundation/contract-dependency-manager (\`src/apps/cli\`).
`;
writeFileSync(join(stage, "README.md"), readme);

if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });
run(`npm pack --pack-destination ${OUT_DIR}`, stage);
rmSync(stage, { recursive: true, force: true });

const outTgz = readdirSync(OUT_DIR).find((f) => f.endsWith(".tgz"));
console.log("");
console.log(`[rescope-pack] ${inTree.name}@${inTree.version} -> ${PUBLISHED_NAME}@${PUBLISHED_VERSION}`);
console.log(`[rescope-pack] staged tarball: ${join(OUT_DIR, outTgz)}`);
console.log(
    "[rescope-pack] hand this tarball to npm-publish-automation (allowlist @polkadot-community-foundation/cdm-cli), or `npm publish` it with an @polkadot-community-foundation token.",
);
