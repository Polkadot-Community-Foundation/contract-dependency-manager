import { CONTRACTS_REGISTRY_IMPL_PACKAGE, CONTRACTS_REGISTRY_PACKAGE } from "@parity/cdm-utils";
import type { ContractDeployer } from "./deployer";

/**
 * Two-step ContractRegistry deployment: the implementation blob first, then
 * the EIP-1967 proxy whose constructor takes the implementation address. The
 * proxy address is the stable registry address every consumer uses; upgrades
 * go through the registry's `setCode(address)` (called via the proxy by the
 * admin — the proxy's deployer), never a proxy redeploy.
 *
 * Both deploys use CREATE2: the implementation with the
 * `CONTRACTS_REGISTRY_IMPL_PACKAGE` salt, the proxy with the
 * `CONTRACTS_REGISTRY_PACKAGE` salt. Under pallet-revive, CREATE2 addresses
 * also commit to the constructor input data, so the proxy address is a pure
 * function of (deployer, proxy code, salt, implementation address).
 */

/**
 * ABI-encode a single `address` constructor argument (32 bytes, left-padded).
 */
export function encodeConstructorAddress(address: string): Uint8Array {
    const hex = address.toLowerCase().replace(/^0x/, "");
    if (!/^[0-9a-f]{40}$/.test(hex)) {
        throw new Error(`Invalid address for constructor encoding: ${address}`);
    }
    const out = new Uint8Array(32);
    for (let i = 0; i < 20; i++) {
        out[12 + i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}

export interface RegistryDeployPrediction {
    impl: Awaited<ReturnType<ContractDeployer["dryRunDeploy"]>>;
    proxy: Awaited<ReturnType<ContractDeployer["dryRunDeploy"]>>;
    /** ABI-encoded proxy constructor argument (the implementation address). */
    constructorData: Uint8Array;
}

/**
 * Dry-run both registry deploys to predict their addresses without submitting
 * anything. `proxy.address` is the registry address consumers will use.
 */
export async function predictRegistryDeploy(
    deployer: ContractDeployer,
    implPvmPath: string,
    proxyPvmPath: string,
): Promise<RegistryDeployPrediction> {
    const impl = await deployer.dryRunDeploy(implPvmPath, CONTRACTS_REGISTRY_IMPL_PACKAGE);
    const constructorData = encodeConstructorAddress(impl.address);
    const proxy = await deployer.dryRunDeploy(
        proxyPvmPath,
        CONTRACTS_REGISTRY_PACKAGE,
        undefined,
        undefined,
        constructorData,
    );
    return { impl, proxy, constructorData };
}

/**
 * Deploy the registry implementation (skipped when its CREATE2 address is
 * already a contract) and then the proxy pointing at it. Returns both
 * addresses; `proxyAddress` is the registry address.
 */
export async function deployRegistryWithProxy(
    deployer: ContractDeployer,
    implPvmPath: string,
    proxyPvmPath: string,
    prediction?: RegistryDeployPrediction,
): Promise<{ implAddress: string; proxyAddress: string }> {
    const plan = prediction ?? (await predictRegistryDeploy(deployer, implPvmPath, proxyPvmPath));

    const implCode = await deployer.getOnChainCode(plan.impl.address);
    if (implCode === null) {
        await deployer.deploy(implPvmPath, CONTRACTS_REGISTRY_IMPL_PACKAGE);
    }

    const { address: proxyAddress } = await deployer.deploy(
        proxyPvmPath,
        CONTRACTS_REGISTRY_PACKAGE,
        undefined,
        undefined,
        plan.constructorData,
    );

    return { implAddress: plan.impl.address, proxyAddress };
}

if (import.meta.vitest) {
    const { describe, test, expect } = import.meta.vitest;

    describe("encodeConstructorAddress", () => {
        test("left-pads a 20-byte address to 32 bytes", () => {
            const encoded = encodeConstructorAddress("0x1111111111111111111111111111111111111111");
            expect(encoded.length).toBe(32);
            expect(Array.from(encoded.slice(0, 12))).toEqual(new Array(12).fill(0));
            expect(Array.from(encoded.slice(12))).toEqual(new Array(20).fill(0x11));
        });

        test("rejects malformed addresses", () => {
            expect(() => encodeConstructorAddress("0x1234")).toThrow();
            expect(() => encodeConstructorAddress("not-an-address")).toThrow();
        });
    });
}
