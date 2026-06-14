#!/usr/bin/env bun
/**
 * Converge CDM registry package names onto the `@polkadot/<name>` namespace and
 * register the ContractRegistry contract itself under a package name.
 *
 * WHY THIS EXISTS
 * ---------------
 * The on-chain `ContractRegistry` is APPEND-ONLY: `publishLatest` can create a
 * name or add a version, but there is no rename and no delete. So "converging"
 * a name can only be additive — we publish a NEW `@polkadot/*` name pointing at
 * the SAME address (and reusing the SAME Bulletin metadata CID) as the existing
 * off-pattern entry. The old `@mock/*` / `@w3s/*` names stay on-chain forever
 * (they cannot be removed, and at least `@mock/reputation` MUST stay because the
 * deployed playground registry resolves it at runtime).
 *
 * WHAT IT DOES (Summit / `w3s` preset, registry 0xa5747e60…0141)
 *   1. @mock/disputes            → @polkadot/disputes            (mirror addr + CID)
 *   2. @mock/reputation          → @polkadot/reputation          (mirror addr + CID)
 *   3. @w3s/playground-registry  → @polkadot/playground-registry (mirror addr + CID)
 *   4. (new) @polkadot/contract-registry → registry address      (fresh Bulletin metadata)
 *
 * SAFETY
 *   - DEFAULT IS A DRY RUN. It connects, reads the live registry, and prints the
 *     exact plan + idempotency status. Nothing is submitted without `--execute`.
 *   - Idempotent: a target already registered to the intended address is skipped.
 *   - Ownership guard: refuses to publish unless the signer's mapped owner matches
 *     the owner of the existing canonical `@polkadot/*` names (so the new entries
 *     land under the same owner, keeping the namespace consistent).
 *
 * The publishing account must be the SAME owner as the existing names
 * (W3S publisher 5Fk8… / 0xF8d1…D2dD) and, for step 4, Bulletin-authorized.
 *
 * Usage:
 *   # dry run (default) — prints the plan, submits nothing
 *   bun run src/lib/scripts/converge-registry-names.ts -n w3s
 *   # execute on-chain (irreversible, append-only writes)
 *   bun run src/lib/scripts/converge-registry-names.ts -n w3s --execute --suri "<mnemonic>"
 */
import { parseArgs } from "util";
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
        name: { type: "string", short: "n", default: "w3s" },
        suri: { type: "string" },
        "read-as": { type: "string" },
        execute: { type: "boolean", default: false },
    },
});

const chainName = opts.name!;
const dryRun = !opts.execute;

// Additive renames: read the existing entry's address + metadata CID live and
// republish under the canonical name (no hardcoded addresses/CIDs).
const RENAMES = [
    { from: "@mock/disputes", to: "@polkadot/disputes" },
    { from: "@mock/reputation", to: "@polkadot/reputation" },
    { from: "@w3s/playground-registry", to: "@polkadot/playground-registry" },
];

const REGISTRY_PACKAGE = "@polkadot/contract-registry";

// Canonical reference name used to read the intended owner for the guard.
const OWNER_REFERENCE_NAME = "@polkadot/contexts";

function resolveSigner() {
    if (opts.suri) return prepareSignerFromSuri(opts.suri);
    const account = getAccount(chainName);
    if (account) return prepareSignerFromMnemonic(account.mnemonic);
    throw new Error(
        `No signer: pass --suri "<mnemonic>" or save an account for "${chainName}" (cdm init -n ${chainName}).`,
    );
}

function unwrapOption<T>(val: unknown): { isSome: boolean; value: T | undefined } {
    if (val && typeof val === "object" && "isSome" in val) {
        const opt = val as { isSome: boolean; value: T };
        return { isSome: opt.isSome, value: opt.isSome ? opt.value : undefined };
    }
    return { isSome: false, value: undefined };
}

const lc = (v: unknown) => String(v).toLowerCase();

const preset = getChainPreset(chainName);
const registryAddress = preset.registryAddress as HexString | undefined;
if (!registryAddress) throw new Error(`No registry address configured for "${chainName}".`);

console.log(`\nCDM registry name convergence — chain="${chainName}" registry=${registryAddress}`);
console.log(dryRun ? "MODE: DRY RUN (no transactions will be submitted)\n" : "MODE: EXECUTE\n");

// A signer is only needed to SIGN writes (execute mode). Reads use a mapped
// origin address, not a key — so a dry run needs no mnemonic at all.
const signer = dryRun && !opts.suri && !getAccount(chainName) ? null : resolveSigner();
if (signer) console.log(`Signer (SS58): ${ss58Address(signer.publicKey)}`);
if (!signer) console.log("Signer: none (dry run, read-only)");

// Registry view methods are PUBLIC and need NO mapped account. With no origin
// configured, the SDK uses pallet-revive's query-dry-run fallback — the same
// mapping-free path the public frontend reads with. So default to no origin and
// never depend on a mapped/funded read account. Only honor an explicit
// --read-as override; note that an UNMAPPED ss58 origin makes the eth_call path
// fail with `Revive.AccountUnmapped` (an ss58→H160 mapping precondition, NOT a
// read permission — there is no such thing here).
const readOrigin = opts["read-as"];
console.log(`Read origin: ${readOrigin ?? "(none — pallet-revive query fallback)"}`);

console.log(`Connecting to ${preset.assethubUrl} + ${preset.bulletinUrl}...`);
const chainClient = await createCdmChainClient(chainName);
await chainClient.raw.assetHub.getChainSpecData();
console.log("Connected.\n");

// map_account is required before the signer can originate revive *writes*; harmless if
// already mapped. Reads don't need it, so this is execute-only — a dry run never submits.
if (!dryRun && signer) {
    try {
        await chainClient.assetHub.tx.Revive.map_account().signAndSubmit(signer);
        console.log("Account mapped.\n");
    } catch {
        /* already mapped */
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const registry: any = await createContractFromClient(
    chainClient.raw.assetHub,
    chainClient.descriptors.assetHub,
    registryAddress,
    CONTRACTS_REGISTRY_ABI,
    {
        defaultSigner: signer ?? undefined,
        ...(readOrigin ? { defaultOrigin: readOrigin } : {}),
    },
);

// Assert a query succeeded; surface AccountUnmapped (etc.) loudly instead of
// silently treating a failed read as "name not registered" — that would make
// the planner try to publish names that may already exist.
function assertQuery<T extends { success: boolean; value: unknown }>(r: T, label: string): T {
    if (!r?.success) {
        const err = JSON.stringify(r?.value);
        throw new Error(
            `Registry read failed (${label}): ${err}. ` +
                `If this is "AccountUnmapped", the read origin ${readOrigin} is not mapped on ${chainName} — ` +
                `pass --read-as <a-mapped-ss58> (e.g. the W3S publisher 5Fk8…).`,
        );
    }
    return r;
}

// ---- Ownership guard ----------------------------------------------------
// The new @polkadot/* names should land under the SAME owner as the existing
// canonical entries. publishLatest assigns first-publisher ownership, so the
// signer's mapped EVM address must equal the existing canonical owner.
const referenceOwner = assertQuery(
    await registry.getOwner.query(OWNER_REFERENCE_NAME),
    `getOwner(${OWNER_REFERENCE_NAME})`,
);
const intendedOwner = lc(referenceOwner.value);
console.log(`Existing owner of ${OWNER_REFERENCE_NAME}: ${intendedOwner}`);
console.log(
    "  → the signer must map to this EVM address, or the new names land under a different owner.\n",
);

async function currentEntry(name: string) {
    const [addr, uri] = await Promise.all([
        registry.getAddress.query(name),
        registry.getMetadataUri.query(name),
    ]);
    assertQuery(addr, `getAddress(${name})`);
    assertQuery(uri, `getMetadataUri(${name})`);
    return {
        address: unwrapOption<string>(addr.value).value,
        metadataUri: unwrapOption<string>(uri.value).value,
    };
}

type Plan = {
    name: string;
    address: string;
    metadataUri: string;
    action: "publish" | "skip" | "blocked";
    note: string;
};
const plan: Plan[] = [];

// ---- Steps 1-3: additive renames ---------------------------------------
for (const { from, to } of RENAMES) {
    const src = await currentEntry(from);
    const dst = await currentEntry(to);
    if (!src.address) {
        plan.push({
            name: to,
            address: "",
            metadataUri: "",
            action: "blocked",
            note: `source ${from} not found on-chain`,
        });
        continue;
    }
    if (dst.address && lc(dst.address) === lc(src.address)) {
        plan.push({
            name: to,
            address: src.address,
            metadataUri: src.metadataUri ?? "",
            action: "skip",
            note: "already registered to the same address",
        });
        continue;
    }
    if (dst.address) {
        plan.push({
            name: to,
            address: dst.address,
            metadataUri: dst.metadataUri ?? "",
            action: "blocked",
            note: `already registered to a DIFFERENT address ${dst.address}`,
        });
        continue;
    }
    plan.push({
        name: to,
        address: src.address,
        metadataUri: src.metadataUri ?? "",
        action: "publish",
        note: `mirror of ${from}`,
    });
}

// ---- Step 4: register the registry contract itself ----------------------
const regExisting = await currentEntry(REGISTRY_PACKAGE);
let registryMetadata: Metadata | null = null;
if (regExisting.address && lc(regExisting.address) === lc(registryAddress)) {
    plan.push({
        name: REGISTRY_PACKAGE,
        address: registryAddress,
        metadataUri: regExisting.metadataUri ?? "",
        action: "skip",
        note: "already registered to the registry address",
    });
} else if (regExisting.address) {
    plan.push({
        name: REGISTRY_PACKAGE,
        address: regExisting.address,
        metadataUri: regExisting.metadataUri ?? "",
        action: "blocked",
        note: `already registered to a DIFFERENT address ${regExisting.address}`,
    });
} else {
    const finalized = await chainClient.raw.assetHub.getFinalizedBlock();
    registryMetadata = {
        publish_block: Number(finalized.number),
        published_at: new Date().toISOString(),
        description:
            "CDM on-chain ContractRegistry: maps @org/name → address + metadata URI, append-only with per-name first-publisher ownership.",
        readme:
            "# @polkadot/contract-registry\n\n" +
            "The CDM `ContractRegistry` — the on-chain index every CDM deploy publishes into. " +
            "It stores `name → version → (address, metadataUri)` mappings with per-name first-publisher ownership. " +
            "Source: `src/contract/src/lib.rs` (PolkaVM / pallet-revive).\n",
        authors: ["Polkadot Community Foundation"],
        homepage: "https://contracts.dot.li",
        repository: "https://github.com/Polkadot-Community-Foundation/contract-dependency-manager",
        abi: CONTRACTS_REGISTRY_ABI,
    };
    plan.push({
        name: REGISTRY_PACKAGE,
        address: registryAddress,
        metadataUri: "(fresh Bulletin upload)",
        action: "publish",
        note: "self-registration of the ContractRegistry",
    });
}

// ---- Print the plan -----------------------------------------------------
console.log("Plan:");
for (const p of plan) {
    const tag = p.action === "publish" ? "PUBLISH" : p.action === "skip" ? "skip   " : "BLOCKED";
    console.log(`  [${tag}] ${p.name}`);
    console.log(`           address: ${p.address || "—"}`);
    console.log(`           metadata: ${p.metadataUri || "—"}`);
    console.log(`           ${p.note}`);
}
const blocked = plan.filter((p) => p.action === "blocked");
const toPublish = plan.filter((p) => p.action === "publish");
console.log("");
if (blocked.length)
    console.log(`⚠️  ${blocked.length} target(s) BLOCKED — resolve before executing.\n`);

if (dryRun) {
    console.log(
        `DRY RUN complete. ${toPublish.length} name(s) would be published. Re-run with --execute to submit.\n`,
    );
    chainClient.destroy();
    process.exit(0);
}

if (!toPublish.length) {
    console.log("Nothing to publish. Exiting.\n");
    chainClient.destroy();
    process.exit(0);
}

// ---- Execute ------------------------------------------------------------
if (!signer) throw new Error("Execute mode requires a signer (--suri or a saved account).");
if (blocked.length) {
    throw new Error(
        `Refusing to execute: ${blocked.length} target(s) are BLOCKED (see plan above). Resolve them first.`,
    );
}
const publisher = new MetadataPublisher(signer, chainClient.bulletin, chainClient.raw.bulletin);

for (const p of toPublish) {
    let metadataUri = p.metadataUri;
    if (p.name === REGISTRY_PACKAGE && registryMetadata) {
        console.log(`Publishing ${REGISTRY_PACKAGE} metadata to Bulletin...`);
        const { cid } = await publisher.publish(registryMetadata);
        metadataUri = cid;
        console.log(`  → CID ${cid}`);
    }
    console.log(`publishLatest("${p.name}", ${p.address}, "${metadataUri}")...`);
    const r = await registry.publishLatest.tx(p.name, p.address as HexString, metadataUri);
    if (!r?.ok) throw new Error(`publishLatest failed for ${p.name}: ${JSON.stringify(r)}`);
    console.log(`  ✓ ${p.name} published.`);
}

// ---- Verify -------------------------------------------------------------
console.log("\nVerification:");
let okOwner = true;
for (const p of toPublish) {
    const e = await currentEntry(p.name);
    const owner = lc((await registry.getOwner.query(p.name)).value);
    const addrOk = e.address && lc(e.address) === lc(p.address);
    const ownerOk = owner === intendedOwner;
    if (!ownerOk) okOwner = false;
    console.log(
        `  ${p.name}: addr=${e.address ?? "—"} ${addrOk ? "✓" : "✗"}  owner=${owner} ${ownerOk ? "✓" : "✗ (DIFFERENT OWNER)"}`,
    );
}
if (!okOwner) {
    console.log(
        `\n⚠️  Some names were published under an owner different from ${OWNER_REFERENCE_NAME}'s owner (${intendedOwner}).`,
    );
    console.log(
        "   The signer's mapped EVM address did not match. These names are now owned by the signer and cannot be transferred.",
    );
}

console.log("\nDone.\n");
chainClient.destroy();
