import { useEffect, useMemo } from "react";
import { useRegistry } from "./useRegistry";

/**
 * Client-side registry search: filters the paged contract list that
 * `useRegistry` already fetches (getContracts + IPFS metadata enrichment) by
 * a case-insensitive substring match on the package name. The on-chain
 * prefix-search entry point (`searchContractNames`) was dropped from the
 * registry contract, so search is now purely local.
 *
 * While a query is active, pages are drained eagerly so results cover the
 * whole registry rather than only what infinite scroll happened to load.
 */
export function useRegistrySearch(query: string) {
    const { packages, loading, error, hasMore, loadMore, network } = useRegistry();

    const needle = query.trim().toLowerCase();

    useEffect(() => {
        if (needle && hasMore && !loading && !error) {
            loadMore();
        }
    }, [needle, hasMore, loading, error, loadMore]);

    const filtered = useMemo(() => {
        if (!needle) return [];
        return packages.filter((pkg) => pkg.name.toLowerCase().includes(needle));
    }, [packages, needle]);

    return {
        packages: filtered,
        loading,
        error,
        hasMore,
        loadMore,
        network,
    };
}
