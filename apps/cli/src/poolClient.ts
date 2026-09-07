import { pathToFileURL } from "node:url";
import { RpcProvider, type Account } from "starknet";
import { poolConfig, viewingKey, type CliConfig } from "./config.js";

/**
 * The ONE place the Privacy SDK is constructed.
 *
 * There used to be two call sites — `pool.ts` and `channels.ts` — and they
 * disagreed with each other AND with the SDK. `createPrivateTransfers` takes
 * `poolContractAddress`, `provingProvider` and a REQUIRED `viewingKeyProvider`
 * (sdk/src/factory.ts:43-49); both call sites passed `poolAddress` and a bare
 * `provingUrl`, and the send path passed no viewing key at all. Nothing caught
 * it because the only end-to-end test builds `transfers` from the SDK's own
 * devnet harness and never touches our factory.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function loadPrivacySdk(cfg: CliConfig): Promise<any> {
  const { sdkPath } = poolConfig(cfg);
  return (await import(pathToFileURL(`${sdkPath}/sdk/dist/index.js`).href)) as any;
}

export interface TransfersOptions {
  /** Required to build or submit; omitted for read-only channel discovery. */
  account?: Account;
  provider?: RpcProvider;
}

export interface DiscoveryOptions {
  url: string;
  ohttp: boolean | { relayUrl?: string };
}

/**
 * OHTTP is the default, not an option (07-discovery.md), and it applies to the
 * proving service too. It does NOT hide the witness from the prover — nothing
 * does (02-threat-model.md) — but it keeps the client's IP out of both
 * services' logs, and costs nothing.
 */
export function discoveryOptions(cfg: {
  discoveryUrl: string;
  ohttp?: boolean | { relayUrl?: string };
}): DiscoveryOptions {
  if (cfg.ohttp === false) {
    // Explicit opt-out is honored but loud.
    console.error("warning: OHTTP disabled — the discovery service can see your IP address");
    return { url: cfg.discoveryUrl, ohttp: false };
  }
  return { url: cfg.discoveryUrl, ohttp: cfg.ohttp ?? true };
}

export async function createTransfers(
  cfg: CliConfig,
  opts: TransfersOptions = {}
): Promise<{ sdk: any; transfers: any; discovery: any }> {
  const pool = poolConfig(cfg);
  const sdk = await loadPrivacySdk(cfg);
  const provider = opts.provider ?? new RpcProvider({ nodeUrl: cfg.rpcUrl });

  // OHTTP needs a gateway in front of the service; a self-hosted prover or
  // indexer has none — plain http:// means no OHTTP unless explicitly set.
  const isPlainHttp = (u?: string) => /^http:\/\//i.test((u ?? "").trim());
  let discoveryProvider: unknown;
  let ohttp: boolean | { relayUrl?: string } = pool.ohttp ?? true;
  if (pool.discoveryUrl) {
    // Construct the discovery provider ourselves: handed a plain CONFIG, the
    // factory builds IndexerDiscoveryProvider without the ohttp option
    // (sdk/src/factory.ts:108), silently dropping it.
    ({ ohttp } = discoveryOptions({ discoveryUrl: pool.discoveryUrl, ohttp: pool.ohttp ?? !isPlainHttp(pool.discoveryUrl) }));
    discoveryProvider = new sdk.IndexerDiscoveryProvider(pool.discoveryUrl, pool.poolAddress, { ohttp });
  } else {
    // No indexer: read the pool contract over RPC. Works anywhere, slower.
    const { Contract } = await import("starknet");
    const abi = (await import(pathToFileURL(`${pool.sdkPath}/sdk/dist/internal/abi.js`).href)).PrivacyPoolABI;
    const { ContractDiscoveryProvider } = await import(
      pathToFileURL(`${pool.sdkPath}/sdk/dist/internal/contract-discovery.js`).href
    );
    const poolContract = new (Contract as any)({ abi, address: pool.poolAddress, providerOrAccount: provider }).typedv2(abi);
    discoveryProvider = new ContractDiscoveryProvider(poolContract);
  }

  const key = viewingKey(cfg);
  const params: Record<string, unknown> = {
    poolContractAddress: pool.poolAddress,
    viewingKeyProvider: { getViewingKey: async () => key },
    discoveryProvider,
    // Discovery-only callers pass no signing account, but the SDK still reads
    // `account.address` to know whose channels to scan (PrivateTransfersUser
    // is { address, signer }; the signer is only touched when proving).
    account: opts.account ?? { address: cfg.account.address, signer: undefined },
  };

  if (pool.provingUrl) {
    params.provingProvider = {
      url: pool.provingUrl,
      chainId: await provider.getChainId(),
      nodeUrl: cfg.rpcUrl, // pool-nonce cache; invalidateProofNonceCache() on failure
      // A self-hosted prover on localhost has no OHTTP gateway.
      ohttp: pool.ohttp ?? !isPlainHttp(pool.provingUrl),
    };
  }

  // The provider is returned too: incoming channels are only reachable
  // through its notes scan (see channels.ts).
  return { sdk, transfers: sdk.createPrivateTransfers(params), discovery: discoveryProvider };
}
