export type ProductSdkEnvironment = "paseo" | "devnet";

const POLKADOT_REGISTRY_ADDRESS = "";
// New-generation registry (EIP-1967 proxy via the CREATE3 factory,
// @cdm/registry.2). Migrated from 0x7671a84f5e7b1bf704f0ad3f43a185ff3d4b303f
// on 2026-08-05; the old registry remains on-chain but is unmaintained.
const PASEO_REGISTRY_ADDRESS = "0xc1a73a4f93fde65b1cb1680baead248073566cb0";
// PCF-owned CDM ContractRegistry on the public products devnet (standard Paseo
// Asset Hub, para 1000, EVM chain id 420420417). Deployed/operated by PCF.
// New-generation registry (EIP-1967 proxy via the CREATE3 factory,
// @cdm/registry.2), deployed 2026-09-04 and migrated from
// 0x59b0245778917af55224e5f8fb55f7f8d452619f with all 69 names and their
// original owners. That predecessor is a pre-proxy build with no admin: it
// traps with `Revive.ContractTrapped` when a brand-new name is appended to its
// name index (products-devnet-issues #10/#12), and cannot be upgraded in place,
// which is why this is a new address rather than a `setCode`. It stays on-chain
// serving reads, unmaintained, so consumers can migrate at their own pace.
const DEVNET_REGISTRY_ADDRESS = "0x05662b3dbd5dd9f2ff92d67630477e84b0b37c1f";
// PCF-owned CDM ContractRegistry on Asset Hub Next (para 1500, paseo-next preset).
// Deliberately still the old address: this is a SEPARATE deployment on a
// different chain that shares the devnet predecessor's address because CREATE3
// makes it a pure function of (factory, salt). The devnet redeploy above does
// not touch it — do not "fix" this to match.
const PASEO_NEXT_REGISTRY_ADDRESS = "0x59b0245778917af55224e5f8fb55f7f8d452619f";
// The Summit (`w3s`) preset is gone: those chains are decommissioned and
// product-sdk dropped the summit-* descriptors at descriptors 0.8.0. devnet is
// the live target; the Summit register stays in summit-net-deployments.
const LOCAL_REGISTRY_ADDRESS = "";

const REGISTRY_ADDRESSES: Record<string, string> = {
    polkadot: POLKADOT_REGISTRY_ADDRESS,
    paseo: PASEO_REGISTRY_ADDRESS,
    "paseo-next": PASEO_NEXT_REGISTRY_ADDRESS,
    devnet: DEVNET_REGISTRY_ADDRESS,
    local: LOCAL_REGISTRY_ADDRESS,
};

/**
 * Registry address for a known chain name. Throws for unknown names so a
 * typo'd chain never silently flows into builds as an empty registry address.
 * Note "polkadot" and "local" legitimately resolve to "" — no registry is
 * deployed there.
 */
export function getRegistryAddress(name = "paseo"): string {
    const normalized = name === "paseo-next-v2" || name === "paseo-v2" ? "paseo" : name;
    const address = REGISTRY_ADDRESSES[normalized];
    if (address === undefined) {
        throw new Error(
            `Unknown chain "${name}" for registry address. Valid names: ${Object.keys(REGISTRY_ADDRESSES).join(", ")}`,
        );
    }
    return address;
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("getRegistryAddress throws for unknown chain names instead of returning an empty address", () => {
        expect(() => getRegistryAddress("pasoe")).toThrow(/Unknown chain "pasoe"/);
        expect(() => getRegistryAddress("pasoe")).toThrow(/paseo/);
    });

    test("getRegistryAddress resolves paseo aliases and known chains", () => {
        expect(getRegistryAddress()).toBe(PASEO_REGISTRY_ADDRESS);
        expect(getRegistryAddress("paseo-next")).toBe(PASEO_NEXT_REGISTRY_ADDRESS);
        expect(getRegistryAddress("paseo-next-v2")).toBe(PASEO_REGISTRY_ADDRESS);
        expect(getRegistryAddress("paseo-v2")).toBe(PASEO_REGISTRY_ADDRESS);
        expect(getRegistryAddress("devnet")).toBe(DEVNET_REGISTRY_ADDRESS);
        expect(getRegistryAddress("local")).toBe("");
    });
}
