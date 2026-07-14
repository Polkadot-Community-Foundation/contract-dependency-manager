#!/usr/bin/env bun
/**
 * Register the EXISTING devnet @dotns/* contracts into the devnet CDM
 * ContractRegistry (0xa5747e60…0141, `w3s` preset) — WITHOUT redeploying them.
 *
 * The dotns contracts are deployed on Summit (addresses in summit-net-deployments)
 * but were never published as CDM packages there, so the dotns UI's
 * `ContractManager.fromLiveClient` can't resolve @dotns/* via the registry. This
 * publishes each contract's metadata (ABI from the dotns-sdk cdm.json snapshot —
 * chain-independent) to Summit Bulletin and registers the LIVE address via the
 * append-only `publishLatest`. No contract is re-instantiated.
 *
 * Mirrors converge-registry-names.ts. DRY RUN by default; --execute to submit.
 * Signer = 5Fk8 (W3S publisher, Bulletin-authorized, owns the sibling @polkadot/* names).
 *
 *   bun run src/lib/scripts/register-dotns-summit.ts -n devnet                      # dry run
 *   bun run src/lib/scripts/register-dotns-summit.ts -n devnet --execute --suri "<5Fk8 mnemonic>"
 */
import { parseArgs } from "util";
import { readFileSync } from "fs";
import {
    createCdmChainClient,
    getChainPreset,
    prepareSignerFromMnemonic,
    prepareSignerFromSuri,
    ss58Address,
} from "@parity/cdm-env";
import { getAccount } from "@parity/cdm-utils/accounts";
import { MetadataPublisher, type Metadata } from "@parity/cdm-builder";
import { CONTRACTS_REGISTRY_ABI } from "@parity/cdm-builder/abi";
import { createContractFromClient } from "@parity/product-sdk-contracts";
import type { HexString } from "polkadot-api";

const { values: opts } = parseArgs({
    args: process.argv.slice(2),
    options: {
        name: { type: "string", short: "n", default: "devnet" },
        suri: { type: "string" },
        "read-as": { type: "string" },
        "cdm-json": {
            type: "string",
            default: "/home/alemart/Projects/PCF/dotns-sdk/packages/ui/cdm.json",
        },
        execute: { type: "boolean", default: false },
    },
});
const chainName = opts.name!;
const dryRun = !opts.execute;

// Live devnet @dotns addresses (summit-net-deployments register).
const DOTNS_DEVNET: Record<string, HexString> = {
    "@dotns/registrar-controller": "0x45fDEa4Ad7b8607Fc22DBC3DBE3cD8b350F8bede",
    "@dotns/registrar": "0x7f0dF075cc8B7FE7218E90fFC5a553450dB120F3",
    "@dotns/registry": "0x527b08a640b527a3dae0C4BE04D7344E430B6E50",
    "@dotns/pop-rules": "0x2181a14081fF2D4477BAA8FB1aEB4C9c44F5F2b0",
    "@dotns/resolver": "0xC28796526Bf3E9295f09655a1001F30f77AfCF0D",
    "@dotns/reverse-resolver": "0xfd2594FcF920B38A970011C486e1E3041563147F",
    "@dotns/content-resolver": "0x326bdE29315199c814B1c58b431D84D16EA5cE41",
    "@dotns/store-factory": "0xD81DC23FAa69B311C1FC553Ea63798772e7D253D",
    "@dotns/multicall3": "0x929EdB8d61461c29d07deC834ef747EbFDcf0B74",
};

const rawCdm = JSON.parse(readFileSync(opts["cdm-json"]!, "utf8"));
const contractsBucket: Record<string, any> = Object.values(rawCdm.contracts ?? {})[0] ?? {};
function abiFor(pkg: string): any[] {
    const abi = contractsBucket[pkg]?.abi;
    if (!Array.isArray(abi) || abi.length === 0)
        throw new Error(`No ABI for ${pkg} in ${opts["cdm-json"]}`);
    return abi;
}

const lc = (v: unknown) => String(v).toLowerCase();
function unwrapOption<T>(val: unknown): T | undefined {
    if (val && typeof val === "object" && "isSome" in val) {
        const o = val as { isSome: boolean; value: T };
        return o.isSome ? o.value : undefined;
    }
    return undefined;
}
function assertQuery<T extends { success: boolean; value: unknown }>(r: T, label: string): T {
    if (!r.success) throw new Error(`Query ${label} failed: ${JSON.stringify(r)}`);
    return r;
}
function resolveSigner() {
    if (opts.suri) return prepareSignerFromSuri(opts.suri);
    const account = getAccount(chainName);
    if (account) return prepareSignerFromMnemonic(account.mnemonic);
    throw new Error(
        `No signer: pass --suri "<5Fk8 mnemonic>" or save an account (cdm init -n ${chainName}).`,
    );
}

const preset = getChainPreset(chainName);
const registryAddress = preset.registryAddress as HexString | undefined;
if (!registryAddress) throw new Error(`No registry address configured for "${chainName}".`);
console.log(`\n@dotns → devnet CDM registry  chain="${chainName}" registry=${registryAddress}`);
console.log(dryRun ? "MODE: DRY RUN (no transactions submitted)\n" : "MODE: EXECUTE\n");

const signer = dryRun && !opts.suri && !getAccount(chainName) ? null : resolveSigner();
console.log(signer ? `Signer (SS58): ${ss58Address(signer.publicKey)}` : "Signer: none (dry run)");
const readOrigin = opts["read-as"];

const chainClient = await createCdmChainClient(chainName);
await chainClient.raw.assetHub.getChainSpecData();
console.log("Connected.\n");
if (!dryRun && signer) {
    try {
        await chainClient.assetHub.tx.Revive.map_account().signAndSubmit(signer);
    } catch {
        /* mapped */
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const registry: any = await createContractFromClient(
    chainClient.raw.assetHub,
    chainClient.descriptors.assetHub,
    registryAddress,
    CONTRACTS_REGISTRY_ABI,
    { defaultSigner: signer ?? undefined, ...(readOrigin ? { defaultOrigin: readOrigin } : {}) },
);

type Step = { name: string; address: HexString; action: "publish" | "skip"; note: string };
const plan: Step[] = [];
for (const [pkg, addr] of Object.entries(DOTNS_DEVNET)) {
    const q = assertQuery(await registry.getAddress.query(pkg), `getAddress(${pkg})`);
    const cur = unwrapOption<string>(q.value);
    if (cur && lc(cur) === lc(addr))
        plan.push({
            name: pkg,
            address: addr,
            action: "skip",
            note: "already registered to this address",
        });
    else if (cur)
        plan.push({
            name: pkg,
            address: addr,
            action: "publish",
            note: `currently ${cur} → append new version → ${addr}`,
        });
    else
        plan.push({
            name: pkg,
            address: addr,
            action: "publish",
            note: "not registered → fresh publish",
        });
}

console.log("Plan:");
for (const p of plan)
    console.log(
        `  [${p.action === "publish" ? "PUBLISH" : "skip   "}] ${p.name}  ${p.address}\n           ${p.note}`,
    );
const toPublish = plan.filter((p) => p.action === "publish");

if (dryRun) {
    console.log(
        `\nDRY RUN complete. ${toPublish.length} name(s) would be published. Re-run: --execute --suri "<5Fk8>"`,
    );
    chainClient.destroy();
    process.exit(0);
}
if (!toPublish.length) {
    console.log("\nNothing to publish.");
    chainClient.destroy();
    process.exit(0);
}
if (!signer) throw new Error("Execute requires --suri.");

const finalized = await chainClient.raw.assetHub.getFinalizedBlock();
const publisher = new MetadataPublisher(signer, chainClient.bulletin, chainClient.raw.bulletin);
for (const p of toPublish) {
    const meta: Metadata = {
        publish_block: Number(finalized.number),
        published_at: new Date().toISOString(),
        description: `${p.name} — DotNS contract on Paseo Asset Hub (devnet) (PolkaVM / pallet-revive).`,
        readme: `# ${p.name}\n\nDotNS contract registered into the devnet CDM ContractRegistry from its live deployed address.\nSource: https://github.com/Polkadot-Community-Foundation/dotns\n`,
        authors: ["Polkadot Community Foundation"],
        homepage: "https://dotns.dot.li",
        repository: "https://github.com/Polkadot-Community-Foundation/dotns",
        abi: abiFor(p.name),
    };
    console.log(`Publishing ${p.name} metadata to Bulletin...`);
    const { cid } = await publisher.publish(meta);
    console.log(`  → CID ${cid}`);
    console.log(`publishLatest("${p.name}", ${p.address}, "${cid}")...`);
    const r = await registry.publishLatest.tx(p.name, p.address, cid);
    if (!r?.ok) throw new Error(`publishLatest failed for ${p.name}: ${JSON.stringify(r)}`);
    console.log(`  ✓ ${p.name} registered.`);
}
console.log("\n✓ Done. Verify: cdm install -n devnet @dotns/registrar-controller …");
chainClient.destroy();
