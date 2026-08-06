// E2E test harness: spawn revive-dev-node, deploy the registry, tear down.
//
// Modelled on cargo-pvm-contract's `pvm-contract-e2e-tests::SubstrateDevNode`
// (per-test port allocation + Drop kills the child), but native to the CDM TS
// stack so vitest can drive it directly. Each call to `spawnReviveNode()`
// returns a fresh `NodeHandle` whose `.kill()` is meant to run in an
// `afterAll` hook.
//
// Requires:
//   - `revive-dev-node` on $PATH (install:
//       cargo install --git https://github.com/paritytech/polkadot-sdk --bin revive-dev-node)
//   - `@parity/cdm-builder` + `@parity/cdm-env` + `@parity/cdm-utils` dist/ built (pnpm build:ts)
//   - the registry implementation + proxy .polkavm binaries (built lazily on
//     first `deployRegistry()` call via `pnpm build:registry`)

import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { HexString } from "polkadot-api";

// Deploy via `bun run src/lib/scripts/deploy-registry.ts` rather than
// invoking `ContractDeployer` programmatically: the deploy dry-run behaves
// differently under Node than under Bun on the dev-node — Node reports
// `Module(Revive(StackUnderflow))` for the exact same code path that
// succeeds under Bun. Until the divergence is rooted out (likely papi's
// encoding of the upload payload), the script is the canonical deploy path.

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/lib/contracts/tests/e2e -> repo root is 5 levels up
const ROOT_DIR = resolve(__dirname, "../../../../..");
// Keep these aligned with the paths `deploy-registry.ts` reads from.
const REGISTRY_PVM = resolve(ROOT_DIR, "target/release/contract-registry.polkavm");
const REGISTRY_PROXY_PVM = resolve(ROOT_DIR, "target/release/contract-registry-proxy.polkavm");

// Per-process port counter. Different vitest workers would collide; we don't
// fan out e2e suites across workers today (vitest.e2e.config.ts pins
// `--no-file-parallelism`).
let nextPort = 29545;
function allocatePort(): number {
    return nextPort++;
}

export interface NodeHandle {
    wsUrl: string;
    port: number;
    /** SIGTERM the child; SIGKILL after 3s if it hasn't exited. */
    kill(): Promise<void>;
}

async function pollRpcReady(port: number, timeoutMs = 60_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(`http://127.0.0.1:${port}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    method: "system_chain",
                    params: [],
                }),
                signal: AbortSignal.timeout(2000),
            });
            if (res.ok) {
                const json = (await res.json()) as { result?: string };
                if (typeof json.result === "string") return;
            }
        } catch {
            // not ready
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`revive-dev-node did not become ready on port ${port} within ${timeoutMs}ms`);
}

export async function spawnReviveNode(): Promise<NodeHandle> {
    const port = allocatePort();
    const child = spawn(
        "revive-dev-node",
        ["--dev", "--rpc-port", String(port), "--no-prometheus", "--log", "error"],
        { stdio: ["ignore", "pipe", "pipe"] },
    );

    if (child.pid === undefined) {
        throw new Error(
            "Failed to spawn `revive-dev-node`. Install:\n" +
                "  cargo install --git https://github.com/paritytech/polkadot-sdk --bin revive-dev-node",
        );
    }

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
    });
    child.once("error", (err) => {
        throw new Error(
            `revive-dev-node spawn error: ${err.message}\n(node stderr so far: ${stderr})`,
        );
    });

    try {
        await pollRpcReady(port);
    } catch (e) {
        child.kill();
        throw new Error(`${(e as Error).message}\n(node stderr: ${stderr})`);
    }

    return {
        wsUrl: `ws://127.0.0.1:${port}`,
        port,
        async kill() {
            if (child.exitCode !== null) return;
            child.kill("SIGTERM");
            for (let i = 0; i < 30; i++) {
                if (child.exitCode !== null) return;
                await new Promise((r) => setTimeout(r, 100));
            }
            child.kill("SIGKILL");
        },
    };
}

async function ensureRegistryBuilt(): Promise<void> {
    if (existsSync(REGISTRY_PVM) && existsSync(REGISTRY_PROXY_PVM)) return;
    await execFileAsync("pnpm", ["build:registry"], {
        cwd: ROOT_DIR,
        maxBuffer: 16 * 1024 * 1024,
    });
    for (const pvm of [REGISTRY_PVM, REGISTRY_PROXY_PVM]) {
        if (!existsSync(pvm)) {
            throw new Error(`Registry .polkavm not produced at ${pvm} after pnpm build:registry`);
        }
    }
}

export interface DeployedRegistry {
    /** The stable registry address — the EIP-1967 proxy, CREATE3-derived. */
    address: HexString;
    /** The implementation blob the proxy delegates to. */
    implAddress: HexString;
    /** The CREATE3 factory the proxy was deployed through. */
    factoryAddress: HexString;
}

/**
 * Build the registry blobs (if needed) and deploy them against `wsUrl` —
 * CREATE3 factory bootstrap first (frozen artifacts), then the
 * implementation blob (plain CREATE2), then the proxy THROUGH the factory.
 * Returns the proxy address (the registry address consumers use) plus the
 * implementation and factory addresses.
 *
 * Spawns `bun run src/lib/scripts/deploy-registry.ts`. See the import-site
 * note above for why we don't invoke `ContractDeployer` directly under Node.
 */
export async function deployRegistry(wsUrl: string): Promise<DeployedRegistry> {
    await ensureRegistryBuilt();
    const { stdout } = await execFileAsync(
        "bun",
        ["run", "src/lib/scripts/deploy-registry.ts", "--assethub-url", wsUrl],
        { cwd: ROOT_DIR, maxBuffer: 16 * 1024 * 1024 },
    );
    const match = stdout.match(/^CONTRACTS_REGISTRY_ADDR=(0x[a-fA-F0-9]+)/m);
    if (!match) {
        throw new Error(
            `Could not parse registry address from deploy-registry.ts output:\n${stdout}`,
        );
    }
    const implMatch = stdout.match(/^CONTRACTS_REGISTRY_IMPL_ADDR=(0x[a-fA-F0-9]+)/m);
    if (!implMatch) {
        throw new Error(
            `Could not parse registry implementation address from deploy-registry.ts output:\n${stdout}`,
        );
    }
    const factoryMatch = stdout.match(/^CREATE3_FACTORY_ADDR=(0x[a-fA-F0-9]+)/m);
    if (!factoryMatch) {
        throw new Error(
            `Could not parse CREATE3 factory address from deploy-registry.ts output:\n${stdout}`,
        );
    }
    return {
        address: match[1] as HexString,
        implAddress: implMatch[1] as HexString,
        factoryAddress: factoryMatch[1] as HexString,
    };
}
