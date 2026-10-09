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
        "abi-dir": {
            type: "string",
            default: "/home/alemart/Projects/PCF/dotns/out/abis",
        },
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
    "@dotns/registrar-controller": "0x59dcF8BfFFa7239243785C3fC336D8Bb22312e8c",
    "@dotns/registrar": "0xc609e0c2DAB4433d55a32FB098Db8788C1956302",
    "@dotns/registry": "0xb052E5EfC5ADEff1f21d48DEfb5169Cb394A1a73",
    "@dotns/pop-rules": "0xD5Ee34610F06f7FF4668aB4fabE2393B65a43AE7",
    "@dotns/resolver": "0xFcB74C073a2d14dc65B178Bb873f4dE51318DDC2",
    "@dotns/reverse-resolver": "0x736e067290AE71f841399575ABfc8b2BAA5Eed7E",
    "@dotns/content-resolver": "0x7e75491ecfb04900EB05ee63CABA2B33900aABB5",
    "@dotns/store-factory": "0x5Df012daA06cA2602DA153309C2E3A83284Cb879",
    "@dotns/multicall3": "0x92640655c5c7ee7E42F0B5aD68D205a8A767b81C",
    "@dotns/protocol-registry": "0xdDF3D3838Ff056F15602fC5a65927f185679C36F",
    "@dotns/pop-controller": "0xC3a3EdAb753F91488fD84E6134b5b0325dc22452",
    "@dotns/pop-resolver": "0x398912c9bb03180Ff049f0E034FE2E0024fb8406",
    "@dotns/name-escrow": "0xb50269322010DeeF2afb162c009Caf897971952C",
};

// ABI source per package: the dotns release ABI directory (dotns-abis-<tag>.zip unpacked, one
// <Contract>.json per contract) for every contract the release ships; Multicall3 is not part of it
// and keeps the dotns-sdk cdm.json snapshot.
const RELEASE_ABI_FILES: Record<string, string> = {
    "@dotns/registrar-controller": "DotnsRegistrarController.json",
    "@dotns/registrar": "DotnsRegistrar.json",
    "@dotns/registry": "DotnsRegistry.json",
    "@dotns/pop-rules": "PopRules.json",
    "@dotns/resolver": "DotnsResolver.json",
    "@dotns/reverse-resolver": "DotnsReverseResolver.json",
    "@dotns/content-resolver": "DotnsContentResolver.json",
    "@dotns/store-factory": "StoreFactory.json",
    "@dotns/protocol-registry": "DotnsProtocolRegistry.json",
    "@dotns/pop-controller": "DotnsPopController.json",
    "@dotns/pop-resolver": "DotnsPopResolver.json",
    "@dotns/name-escrow": "DotnsNameEscrow.json",
};

const rawCdm = JSON.parse(readFileSync(opts["cdm-json"]!, "utf8"));
const contractsBucket: Record<string, any> = Object.values(rawCdm.contracts ?? {})[0] ?? {};
function abiFor(pkg: string): any[] {
    const file = RELEASE_ABI_FILES[pkg];
    let abi = contractsBucket[pkg]?.abi;
    if (file) {
        const path = `${opts["abi-dir"]}/${file}`;
        const release = JSON.parse(readFileSync(path, "utf8"));
        abi = Array.isArray(release) ? release : release.abi;
    }
    if (!Array.isArray(abi) || abi.length === 0) {
        const source = file ? opts["abi-dir"] : opts["cdm-json"];
        throw new Error(`No ABI for ${pkg} in ${source}`);
    }
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
// Same address, different ABI (an in-place contract upgrade) also appends a version.
async function publishedAbi(pkg: string): Promise<unknown> {
    const q = assertQuery(await registry.getMetadataUri.query(pkg), `getMetadataUri(${pkg})`);
    const cid = unwrapOption<string>(q.value);
    if (!cid) return undefined;
    const res = await fetch(`${preset.ipfsGatewayUrl}/${cid}`);
    if (!res.ok) throw new Error(`Fetching ${pkg} metadata ${cid}: HTTP ${res.status}`);
    return ((await res.json()) as { abi?: unknown }).abi;
}

for (const [pkg, addr] of Object.entries(DOTNS_DEVNET)) {
    const q = assertQuery(await registry.getAddress.query(pkg), `getAddress(${pkg})`);
    const cur = unwrapOption<string>(q.value);
    if (cur && lc(cur) === lc(addr)) {
        const abiChanged = JSON.stringify(await publishedAbi(pkg)) !== JSON.stringify(abiFor(pkg));
        plan.push({
            name: pkg,
            address: addr,
            action: abiChanged ? "publish" : "skip",
            note: abiChanged
                ? "same address, ABI changed → append new version"
                : "already registered to this address with this ABI",
        });
    } else if (cur)
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
