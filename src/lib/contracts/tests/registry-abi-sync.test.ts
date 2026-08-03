// Drift guard for the hand-embedded registry ABIs.
//
// `CONTRACTS_REGISTRY_ABI` / `CONTRACTS_REGISTRY_PROXY_ABI` in
// `src/abi/registry.ts` are hand-copied mirrors of the `abi` arrays that
// `cargo pvm-contract build` writes to `target/release/*.abi.json`. This test
// deep-compares the constructor/function entries (name, input/output types
// and tuple structure, stateMutability) whenever the generated artifacts
// exist, closing the historical hand-copy desync risk. Output NAMES are
// deliberately not compared: the generated JSON leaves them empty while the
// embedded ABI uses descriptive decode keys (`isSome`/`value`, ...).
//
// Skips cleanly when the artifacts are absent (they require the PolkaVM
// toolchain via `pnpm build:registry`), so plain `pnpm test` stays
// binary-independent.

import { describe, test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AbiEntry, AbiParam } from "@parity/product-sdk-contracts";
import { CONTRACTS_REGISTRY_ABI, CONTRACTS_REGISTRY_PROXY_ABI } from "../src/abi/registry";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RELEASE_DIR = resolve(__dirname, "../../../../target/release");
const IMPL_ABI_JSON = resolve(RELEASE_DIR, "contract-registry.abi.json");
const PROXY_ABI_JSON = resolve(RELEASE_DIR, "contract-registry-proxy.abi.json");

interface NormalizedParam {
    type: string;
    components?: NormalizedParam[];
}

interface NormalizedEntry {
    type: string;
    name?: string;
    stateMutability?: string;
    inputs: NormalizedParam[];
    outputs: NormalizedParam[];
}

function normalizeParam(param: AbiParam): NormalizedParam {
    const out: NormalizedParam = { type: param.type };
    if (param.components) out.components = param.components.map(normalizeParam);
    return out;
}

function normalizeEntry(entry: AbiEntry): NormalizedEntry {
    return {
        type: entry.type,
        name: entry.name,
        stateMutability: entry.stateMutability,
        inputs: (entry.inputs ?? []).map(normalizeParam),
        outputs: (entry.outputs ?? []).map(normalizeParam),
    };
}

/** Constructor + function entries, normalized, in ABI order. */
function callableEntries(abi: AbiEntry[]): NormalizedEntry[] {
    return abi.filter((e) => e.type === "function" || e.type === "constructor").map(normalizeEntry);
}

function readGeneratedAbi(path: string): AbiEntry[] {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { abi: AbiEntry[] };
    return parsed.abi;
}

describe.skipIf(!existsSync(IMPL_ABI_JSON))("registry ABI matches generated artifact", () => {
    test("constructor/function entries are in sync", () => {
        const generated = readGeneratedAbi(IMPL_ABI_JSON);
        expect(callableEntries(CONTRACTS_REGISTRY_ABI)).toEqual(callableEntries(generated));
    });

    test("error and event entries are in sync", () => {
        const generated = readGeneratedAbi(IMPL_ABI_JSON);
        const nonCallable = (abi: AbiEntry[]) =>
            abi.filter((e) => e.type === "error" || e.type === "event").map(normalizeEntry);
        expect(nonCallable(CONTRACTS_REGISTRY_ABI)).toEqual(nonCallable(generated));
    });
});

describe.skipIf(!existsSync(PROXY_ABI_JSON))("proxy ABI matches generated artifact", () => {
    test("all entries are in sync", () => {
        const generated = readGeneratedAbi(PROXY_ABI_JSON);
        expect(CONTRACTS_REGISTRY_PROXY_ABI.map(normalizeEntry)).toEqual(
            generated.map(normalizeEntry),
        );
    });
});
