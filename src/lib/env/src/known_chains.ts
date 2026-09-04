import { BULLETIN_RPCS } from "@parity/product-sdk-host";
import { getRegistryAddress, type ProductSdkEnvironment } from "./registry";

export interface ChainFaucet {
    label: string;
    url: string;
}

export type { ProductSdkEnvironment };

export interface ChainPreset {
    assethubUrl: string;
    bulletinUrl: string;
    ipfsGatewayUrl: string;
    registryAddress?: string;
    productSdkEnvironment?: ProductSdkEnvironment;
    faucets?: readonly ChainFaucet[];
}

// Product SDK exports Bulletin RPCs, but its Asset Hub RPC presets are internal
// to @parity/product-sdk-chain-client. Keep these CLI fallbacks aligned with
// the descriptor package's generated .papi wsUrl values.
const PASEO_ASSET_HUB_URL = "wss://paseo-asset-hub-next-rpc.polkadot.io";
const PASEO_IPFS_GATEWAY_URL = "https://paseo-bulletin-next-ipfs.polkadot.io/ipfs";

// The Paseo testnet Asset Hub (para 1000, EVM chain id 420420417, genesis
// 0xd6eec2…11ef2) and its Bulletin ("Bulletin Paseo"). Distinct from the
// `paseo` preset above, which targets the paseo-next preview network.
// The Asset Hub URL mirrors the devnet-asset-hub descriptor's wsUrl; the
// Bulletin URL comes from product-sdk's BULLETIN_RPCS. The devnet Bulletin
// collator speaks Bitswap only and does not announce to the public IPFS DHT,
// so its content is NOT reachable via public gateways (ipfs.io etc.) — metadata
// must go through the Kubo gateway PCF runs alongside the collator.
const DEVNET_ASSET_HUB_URL = "wss://asset-hub-paseo-rpc.n.dwellir.com";
const DEVNET_IPFS_GATEWAY_URL = "https://devnet-ipfs.api.polkadotcommunity.foundation/ipfs";

export const KNOWN_CHAINS = {
    polkadot: {
        assethubUrl: "wss://polkadot-asset-hub-rpc.polkadot.io",
        bulletinUrl: "wss://polkadot-bulletin-rpc.polkadot.io",
        ipfsGatewayUrl: "https://polkadot-bulletin-rpc.polkadot.io/ipfs",
        registryAddress: getRegistryAddress("polkadot"),
    },
    paseo: {
        assethubUrl: PASEO_ASSET_HUB_URL,
        bulletinUrl: BULLETIN_RPCS.paseo[0],
        ipfsGatewayUrl: PASEO_IPFS_GATEWAY_URL,
        registryAddress: getRegistryAddress("paseo"),
        productSdkEnvironment: "paseo",
        faucets: [
            { label: "Asset Hub", url: "https://faucet.polkadot.io/?parachain=1500" },
            {
                label: "Bulletin",
                url: "https://paritytech.github.io/polkadot-bulletin-chain/authorizations?tab=faucet",
            },
        ],
    },
    // PCF-owned re-home: same Paseo Next interim chains as `paseo`, but resolves
    // through PCF's OWN CDM ContractRegistry. NOTE: shares assethubUrl with
    // `paseo`, so findKnownChainByAssetHubUrl (first match) resolves that URL to
    // `paseo` — select this preset explicitly by name (`-n paseo-next`).
    "paseo-next": {
        assethubUrl: PASEO_ASSET_HUB_URL,
        bulletinUrl: BULLETIN_RPCS.paseo[0],
        ipfsGatewayUrl: PASEO_IPFS_GATEWAY_URL,
        registryAddress: getRegistryAddress("paseo-next"),
        productSdkEnvironment: "paseo",
        faucets: [
            { label: "Asset Hub", url: "https://faucet.polkadot.io/?parachain=1500" },
            {
                label: "Bulletin",
                url: "https://paritytech.github.io/polkadot-bulletin-chain/authorizations?tab=faucet",
            },
        ],
    },
    // Public products devnet = standard public Paseo (Asset Hub para 1000,
    // Bulletin para 1010) — a DIFFERENT chain from `paseo`/`paseo-next`, which
    // target Asset Hub Next. Uses product-sdk's dedicated devnet descriptors;
    // ipfsGatewayUrl is the PCF Kubo gateway (see DEVNET_IPFS_GATEWAY_URL).
    devnet: {
        assethubUrl: DEVNET_ASSET_HUB_URL,
        bulletinUrl: BULLETIN_RPCS.devnet[0],
        ipfsGatewayUrl: DEVNET_IPFS_GATEWAY_URL,
        registryAddress: getRegistryAddress("devnet"),
        productSdkEnvironment: "devnet",
        faucets: [{ label: "Asset Hub", url: "https://faucet.polkadot.io/?parachain=1000" }],
    },
    local: {
        assethubUrl: "ws://127.0.0.1:10020",
        bulletinUrl: "ws://127.0.0.1:10030",
        // PPN (product-preview-net) serves its IPFS gateway on 8080
        // (config/ports.env IPFS_GATEWAY_PORT).
        ipfsGatewayUrl: "http://127.0.0.1:8080/ipfs",
        registryAddress: getRegistryAddress("local"),
    },
} as const satisfies Record<string, ChainPreset>;

export type KnownChainName = keyof typeof KNOWN_CHAINS;

export function normalizeChainName(name: string): KnownChainName | "custom" | undefined {
    if (name === "paseo-next") return "paseo-next";
    if (name === "paseo-next-v2" || name === "paseo-v2") return "paseo";
    if (Object.hasOwn(KNOWN_CHAINS, name)) return name as KnownChainName;
    if (name === "custom") return "custom";
}

export function isKnownChainPreset(name: string): boolean {
    const normalized = normalizeChainName(name);
    return normalized !== undefined && normalized !== "custom";
}

export function getChainPreset(name: string): ChainPreset {
    const normalized = normalizeChainName(name);
    const preset = normalized && normalized !== "custom" ? KNOWN_CHAINS[normalized] : undefined;
    if (!preset) {
        const valid = Object.keys(KNOWN_CHAINS).join(", ");
        throw new Error(`Unknown chain "${name}". Valid names: ${valid}`);
    }
    return preset;
}

export function findKnownChainByAssetHubUrl(url: string): KnownChainName | undefined {
    const normalizedUrl = url.replace(/\/+$/, "");
    return Object.entries(KNOWN_CHAINS).find(
        ([, preset]) => preset.assethubUrl.replace(/\/+$/, "") === normalizedUrl,
    )?.[0] as KnownChainName | undefined;
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("devnet preset targets the Paseo testnet Asset Hub registry", () => {
        const preset = getChainPreset("devnet");

        expect(preset.assethubUrl).toBe("wss://asset-hub-paseo-rpc.n.dwellir.com");
        expect(preset.bulletinUrl).toBe("wss://bulletin-paseo.tservices.es:8443");
        expect(preset.registryAddress).toBe("0x05662b3dbd5dd9f2ff92d67630477e84b0b37c1f");
        expect(preset.productSdkEnvironment).toBe("devnet");
    });

    test("normalizeChainName accepts devnet alongside the paseo-next aliases", () => {
        expect(normalizeChainName("devnet")).toBe("devnet");
        expect(isKnownChainPreset("devnet")).toBe(true);
        expect(normalizeChainName("paseo-next-v2")).toBe("paseo");
        expect(normalizeChainName("paseo-v2")).toBe("paseo");
    });

    test("normalizeChainName accepts every KNOWN_CHAINS key and custom, and rejects typos", () => {
        for (const name of Object.keys(KNOWN_CHAINS)) {
            expect(normalizeChainName(name)).toBe(name);
        }
        expect(normalizeChainName("custom")).toBe("custom");
        expect(normalizeChainName("pasoe")).toBeUndefined();
    });
}
