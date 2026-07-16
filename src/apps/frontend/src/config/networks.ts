import { getRegistryAddress, type ProductSdkEnvironment } from "@parity/cdm-env/registry";
import { paseo_asset_hub } from "@parity/product-sdk-descriptors/paseo-asset-hub";
import { summit_asset_hub } from "@parity/product-sdk-descriptors/summit-asset-hub";
import { devnet_asset_hub } from "@parity/product-sdk-descriptors/devnet-asset-hub";

export type NetworkKey = "paseo" | "w3s" | "devnet";
type AssetHubDescriptor = typeof paseo_asset_hub | typeof summit_asset_hub | typeof devnet_asset_hub;

export interface NetworkConfig {
    key: NetworkKey;
    label: string;
    installName: string;
    productSdkEnvironment: ProductSdkEnvironment | "";
    assetHubDescriptor: AssetHubDescriptor | null;
    registryAddress: `0x${string}` | "";
}

function registryAddressFor(name: string): `0x${string}` | "" {
    const registryAddress = getRegistryAddress(name);
    if (!registryAddress) return "";
    return registryAddress as `0x${string}`;
}

export const NETWORKS: Record<NetworkKey, NetworkConfig> = {
    paseo: {
        key: "paseo",
        label: "Paseo",
        installName: "paseo",
        productSdkEnvironment: "paseo",
        assetHubDescriptor: paseo_asset_hub,
        registryAddress: registryAddressFor("paseo"),
    },
    w3s: {
        key: "w3s",
        label: "W3S",
        installName: "w3s",
        productSdkEnvironment: "summit",
        assetHubDescriptor: summit_asset_hub,
        registryAddress: registryAddressFor("w3s"),
    },
    devnet: {
        key: "devnet",
        label: "Devnet",
        installName: "devnet",
        productSdkEnvironment: "devnet",
        assetHubDescriptor: devnet_asset_hub,
        // PCF-owned CDM ContractRegistry on the public products devnet (Paseo AH
        // 1000). Sourced from @parity/cdm-env's devnet preset — keep in sync with
        // DEVNET.md / @parity/cdm-env registry.ts (0x59b0245778917af55224e5f8fb55f7f8d452619f).
        registryAddress: registryAddressFor("devnet"),
    },
};

export const DEFAULT_NETWORK: NetworkKey = "devnet";
export const NETWORK_OPTIONS = Object.values(NETWORKS);

export function resolveNetworkKey(value: string | null | undefined): NetworkKey | null {
    if (!value) return null;
    return value in NETWORKS ? (value as NetworkKey) : null;
}
