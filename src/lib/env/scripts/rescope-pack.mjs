#!/usr/bin/env node
/**
 * rescope-pack.mjs — stage a PCF-scoped tarball of this package without renaming it in-tree.
 *
 * Why: this is a fork of paritytech/contract-dependency-manager. The package is named
 * `@parity/cdm-env` in-tree (and 5 workspace packages depend on it by that name), so we keep
 * the upstream name to stay merge-clean with `git merge upstream/main`. But PCF publishes it
 * under its own scope as `@polkadot-community-foundation/cdm-env` (it carries PCF-deployed data — the Summit/W3S registry
 * address in src/registry.ts — that Parity's npm release does not).
 *
 * What it does:
 *   1. `pnpm build` + `pnpm pack` this package — pnpm resolves `catalog:`/`workspace:*` deps to
 *      concrete published versions (e.g. @parity/cdm-utils@0.4.1, @parity/product-sdk-* — all on npm).
 *   2. Rewrites only `name` -> @polkadot-community-foundation/cdm-env and `version` in the packed package.json.
 *   3. Repacks into pack-output/ as the @polkadot-community-foundation tarball the npm-publish-automation expects.
 *
 * The published @polkadot-community-foundation/cdm-env therefore depends on the already-published @parity/cdm-utils — no
 * monorepo-wide rename, no republish of utils. See summit-deployer-skills/guides/CDM_NPM_PUBLISHING.md
 * and Polkadot-Community-Foundation/npm-publish-automation (publishable-packages.json `rescope_at_publish`).
 *
 * Usage: node scripts/rescope-pack.mjs   (run from the env package dir, or anywhere — it cd's itself)
 *   env PCF_ENV_VERSION=2.1.1 overrides the published version.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLISHED_NAME = "@polkadot-community-foundation/cdm-env";
// Fresh @polkadot-community-foundation scope -> independent versioning. Default 2.1.0 (the first @polkadot-community-foundation release; carries the
// deployed W3S registry address). Bump for subsequent releases. Note: @parity/cdm-env@2.0.5 is a
// different package on npm; the numbers are intentionally not aligned.
const PUBLISHED_VERSION = process.env.PCF_ENV_VERSION || "2.1.0";
const OUT_DIR = join(PKG_DIR, "pack-output");

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: ["ignore", "pipe", "inherit"] }).toString().trim();

console.log(`[rescope-pack] building ${PKG_DIR}`);
run("pnpm build", PKG_DIR);

const stage = mkdtempSync(join(tmpdir(), "pcf-cdm-env-"));
console.log(`[rescope-pack] pnpm pack -> ${stage}`);
run(`pnpm pack --pack-destination ${stage}`, PKG_DIR);

const srcTgz = readdirSync(stage).find((f) => f.endsWith(".tgz"));
if (!srcTgz) throw new Error("pnpm pack produced no .tgz");
run(`tar -xzf ${join(stage, srcTgz)} -C ${stage}`, stage); // -> ${stage}/package/

const pkgJsonPath = join(stage, "package", "package.json");
const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
const upstreamName = pkg.name;
pkg.name = PUBLISHED_NAME;
pkg.version = PUBLISHED_VERSION;
writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 4) + "\n");

if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });
run(`npm pack --pack-destination ${OUT_DIR}`, join(stage, "package"));
rmSync(stage, { recursive: true, force: true });

const outTgz = readdirSync(OUT_DIR).find((f) => f.endsWith(".tgz"));
console.log("");
console.log(`[rescope-pack] ${upstreamName}@${pkg.version} -> ${PUBLISHED_NAME}@${PUBLISHED_VERSION}`);
console.log(`[rescope-pack] staged tarball: ${join(OUT_DIR, outTgz)}`);
console.log(`[rescope-pack] @parity/cdm-utils dep: ${pkg.dependencies?.["@parity/cdm-utils"]} (published on npm — not rescoped)`);
console.log("[rescope-pack] hand this tarball to npm-publish-automation (allowlisted as @polkadot-community-foundation/cdm-env), or `npm publish` it with an @polkadot-community-foundation token.");
