export type ProductSdkEnvironment = "paseo" | "devnet" | "summit";

const POLKADOT_REGISTRY_ADDRESS = "";
const PASEO_REGISTRY_ADDRESS = "0x7671a84f5e7b1bf704f0ad3f43a185ff3d4b303f";
// ContractRegistry operated by the Polkadot Community Foundation on the Paseo
// testnet Asset Hub (para 1000, EVM chain id 420420417) for its public
// "products devnet". Community-owned, not deployed by this repo's tooling.
const DEVNET_REGISTRY_ADDRESS = "0x59b0245778917af55224e5f8fb55f7f8d452619f";
const W3S_REGISTRY_ADDRESS = "0xa5747e60ae27f93e92019e4021abfc4957050141";
const LOCAL_REGISTRY_ADDRESS = "";

const REGISTRY_ADDRESSES: Record<string, string> = {
    polkadot: POLKADOT_REGISTRY_ADDRESS,
    paseo: PASEO_REGISTRY_ADDRESS,
    devnet: DEVNET_REGISTRY_ADDRESS,
    w3s: W3S_REGISTRY_ADDRESS,
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
        expect(getRegistryAddress("paseo-next-v2")).toBe(PASEO_REGISTRY_ADDRESS);
        expect(getRegistryAddress("paseo-v2")).toBe(PASEO_REGISTRY_ADDRESS);
        expect(getRegistryAddress("local")).toBe("");
    });
}
