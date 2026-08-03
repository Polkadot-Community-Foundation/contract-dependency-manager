#!/usr/bin/env bun
/**
 * Deploy the ContractRegistry to Asset Hub — a two-step deploy: the
 * implementation blob first, then the EIP-1967 proxy pointing at it. The
 * proxy address is the stable registry address (CONTRACTS_REGISTRY_ADDR).
 *
 * Usage:
 *   bun run src/lib/scripts/deploy-registry.ts --name local
 *   bun run src/lib/scripts/deploy-registry.ts --assethub-url ws://127.0.0.1:10020
 *   bun run src/lib/scripts/deploy-registry.ts --name local
 *   bun run src/lib/scripts/deploy-registry.ts --assethub-url wss://... --registry-address 0x...
 *   bun run src/lib/scripts/deploy-registry.ts -n paseo --migrate-from-registry 0x...
 */
import { dirname, resolve } from "path";
import { existsSync, mkdirSync } from "fs";
import { parseArgs } from "util";
import {
    createCdmAssetHubClient,
    prepareSigner,
    prepareSignerFromMnemonic,
    prepareSignerFromSuri,
    getChainPreset,
    ss58Address,
    type CdmDeployAssetHubApi,
} from "@parity/cdm-env";
import { CONTRACTS_REGISTRY_PACKAGE } from "@parity/cdm-utils";
import { getAccount } from "@parity/cdm-utils/accounts";
import {
    ContractDeployer,
    CONTRACTS_REGISTRY_CRATE,
    CONTRACTS_REGISTRY_PROXY_CRATE,
    predictRegistryDeploy,
    deployRegistryWithProxy,
} from "@parity/cdm-builder";
import {
    exportRegistrySnapshot,
    importRegistrySnapshot,
    writeRegistrySnapshot,
} from "@parity/cdm-migrations/registry";

const { values: opts } = parseArgs({
    args: process.argv.slice(2),
    options: {
        name: { type: "string", short: "n" },
        "assethub-url": { type: "string" },
        "registry-address": { type: "string" },
        "migrate-from-registry": { type: "string" },
        "migration-json": { type: "string" },
        "migration-batch-size": { type: "string" },
        suri: { type: "string" },
    },
});

const preset = opts.name ? getChainPreset(opts.name) : undefined;
let assethubUrl = opts["assethub-url"];
if (opts.name) {
    assethubUrl = assethubUrl ?? preset?.assethubUrl;
}
const selectedRegistryAddress = opts["registry-address"] ?? preset?.registryAddress;
const hasExplicitRegistryAddress = Boolean(opts["registry-address"]);
if (!assethubUrl) {
    console.error("Error: --assethub-url or --name is required");
    process.exit(1);
}

const rootDir = resolve(import.meta.dir, "../../..");
const implPvmPath = resolve(rootDir, `target/release/${CONTRACTS_REGISTRY_CRATE}.polkavm`);
const proxyPvmPath = resolve(rootDir, `target/release/${CONTRACTS_REGISTRY_PROXY_CRATE}.polkavm`);
const migrationBatchSize = opts["migration-batch-size"] ? Number(opts["migration-batch-size"]) : 10;

function timestampForFileName(): string {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

function resolveMigrationJsonPath(): string {
    return (
        opts["migration-json"] ??
        resolve(
            rootDir,
            "dist",
            `registry-migration-${opts.name ?? "custom"}-${timestampForFileName()}.json`,
        )
    );
}

for (const path of [implPvmPath, proxyPvmPath]) {
    if (!existsSync(path)) {
        console.error(`Registry not built: ${path}`);
        console.error("Run: pnpm build:registry");
        process.exit(1);
    }
}

function resolveSigner() {
    if (opts.suri) return prepareSignerFromSuri(opts.suri);
    if (opts.name) {
        const account = getAccount(opts.name);
        if (account) return prepareSignerFromMnemonic(account.mnemonic);
    }
    return prepareSigner("Alice");
}

const migrationSnapshotPath = opts["migrate-from-registry"]
    ? resolveMigrationJsonPath()
    : undefined;
const migrationSourceRegistryAddress = opts["migrate-from-registry"];
const migrationSnapshot = opts["migrate-from-registry"]
    ? await (async () => {
          if (!Number.isInteger(migrationBatchSize) || migrationBatchSize <= 0) {
              console.error(
                  `Error: invalid --migration-batch-size ${opts["migration-batch-size"]}`,
              );
              process.exit(1);
          }

          console.log(`Exporting registry data from ${opts["migrate-from-registry"]}...`);
          const snapshot = await exportRegistrySnapshot({
              name: opts.name,
              assethubUrl,
              registryAddress: opts["migrate-from-registry"],
          });
          mkdirSync(dirname(migrationSnapshotPath!), { recursive: true });
          await writeRegistrySnapshot(migrationSnapshotPath!, snapshot);
          console.log(
              `Exported ${snapshot.contracts.length} contracts to ${migrationSnapshotPath}`,
          );
          return snapshot;
      })()
    : undefined;

// Connect
console.log(`Connecting to ${assethubUrl}...`);
const signer = resolveSigner();
const chainClient = await createCdmAssetHubClient(assethubUrl, opts.name);
await chainClient.raw.assetHub.getChainSpecData();
console.log("Connected.");
const deployAssetHubApi = chainClient.assetHub as CdmDeployAssetHubApi;

const deployer = new ContractDeployer(
    signer,
    ss58Address(signer.publicKey),
    chainClient.raw.assetHub,
    deployAssetHubApi,
);

// Map account (required on fresh chains, harmless if already mapped)
try {
    await chainClient.assetHub.tx.Revive.map_account().signAndSubmit(signer);
    console.log("Account mapped.");
} catch {
    // already mapped
}

// Predict both CREATE2 addresses (implementation + proxy). The proxy address
// is the registry address consumers use, so all idempotence/preflight checks
// below compare against `expected.proxy.address`.
const expected = await predictRegistryDeploy(deployer, implPvmPath, proxyPvmPath);

async function finishWithRegistry(address: string, alreadyDeployed: boolean): Promise<void> {
    try {
        if (migrationSnapshot) {
            if (migrationSourceRegistryAddress?.toLowerCase() === address.toLowerCase()) {
                throw new Error(
                    `Refusing to import migration snapshot back into its source registry ${address}`,
                );
            }

            console.log(
                `${alreadyDeployed ? "Importing" : "Uploading"} migrated registry data into ${address}...`,
            );
            await importRegistrySnapshot(
                migrationSnapshot,
                {
                    name: opts.name,
                    assethubUrl,
                    registryAddress: address,
                    suri: opts.suri,
                    batchSize: migrationBatchSize,
                },
                ({ imported, total, batchIndex, totalBatches }) => {
                    console.log(
                        `  Imported ${imported}/${total} contracts (${batchIndex}/${totalBatches})`,
                    );
                },
            );
        }

        console.log(`\nCONTRACTS_REGISTRY_IMPL_ADDR=${expected.impl.address}`);
        console.log(`CONTRACTS_REGISTRY_ADDR=${address}`);
    } finally {
        chainClient.destroy();
    }
}

if (selectedRegistryAddress) {
    const info = await chainClient.assetHub.query.Revive.AccountInfoOf.getValue(
        selectedRegistryAddress as `0x${string}`,
    );
    if (info?.account_type.type === "Contract") {
        if (expected.proxy.address.toLowerCase() === selectedRegistryAddress.toLowerCase()) {
            console.log(`ContractRegistry already deployed at ${selectedRegistryAddress}`);
            await finishWithRegistry(selectedRegistryAddress, true);
            process.exit(0);
        }
    }
}

if (
    hasExplicitRegistryAddress &&
    selectedRegistryAddress &&
    expected.proxy.address.toLowerCase() !== selectedRegistryAddress.toLowerCase()
) {
    console.error(
        `Refusing to deploy ContractRegistry: signer ${ss58Address(signer.publicKey)} and current bytecode would deploy ${expected.proxy.address}, but the selected target uses ${selectedRegistryAddress}.`,
    );
    console.error(
        "Use the matching deployer/bytecode for this target, or pass --registry-address for a separate registry target.",
    );
    chainClient.destroy();
    process.exit(1);
}

const expectedInfo = await chainClient.assetHub.query.Revive.AccountInfoOf.getValue(
    expected.proxy.address as `0x${string}`,
);
if (expectedInfo?.account_type.type === "Contract") {
    console.log(`ContractRegistry already deployed at ${expected.proxy.address}`);
    await finishWithRegistry(expected.proxy.address, true);
    process.exit(0);
}

if (
    !hasExplicitRegistryAddress &&
    selectedRegistryAddress &&
    expected.proxy.address.toLowerCase() !== selectedRegistryAddress.toLowerCase()
) {
    console.warn(
        `Selected preset currently points at ${selectedRegistryAddress}, but this deployment will create ${expected.proxy.address}.`,
    );
    console.warn("Update the preset registry address after deployment.");
}

// Deploy with CREATE2 for deterministic addresses: implementation blob first
// (skipped when already on-chain), then the proxy pointing at it.
console.log(
    `Deploying ContractRegistry implementation + proxy (proxy CREATE2 salt: "${CONTRACTS_REGISTRY_PACKAGE}")...`,
);
const { implAddress, proxyAddress } = await deployRegistryWithProxy(
    deployer,
    implPvmPath,
    proxyPvmPath,
    expected,
);
console.log(`Implementation deployed at ${implAddress}`);
await finishWithRegistry(proxyAddress, false);
