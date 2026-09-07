/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The ONE place the Privacy SDK is loaded in the browser — the counterpart of
 * apps/cli/src/poolClient.ts. Module ids are aliases into a built checkout
 * (vite.config.ts); here they are turned into the handful of things pool mode
 * needs, with the SDK's real parameter names pinned in one spot
 * (sdk/src/factory.ts:43-49: `poolContractAddress`, `provingProvider`, a
 * REQUIRED `viewingKeyProvider`).
 */

export interface PrivacySdk {
  createPrivateTransfers: (params: Record<string, unknown>) => any;
  IndexerDiscoveryProvider: new (url: string, poolAddress: string, opts?: { ohttp?: unknown }) => unknown;
  /** Sender-side channel key: h(TAG, sender, sender_sk, recipient, recipient_pk). */
  computeChannelKey: (sender: bigint, senderSk: bigint, recipient: bigint, recipientPk: bigint) => bigint;
  PrivacyPoolABI: readonly unknown[];
  ContractDiscoveryProvider: new (pool: unknown, opts?: unknown) => unknown;
  mockProver: () => Promise<new (node: unknown, chainId: string) => unknown>;
}

export const sdkAvailable = (): boolean => !!import.meta.env.VITE_POOL_SDK_AVAILABLE;

let cached: Promise<PrivacySdk> | null = null;

export function loadPrivacySdk(): Promise<PrivacySdk> {
  cached ??= (async () => {
    const [root, hashes, abi, discovery] = await Promise.all([
      import("privacy-sdk"),
      import("privacy-sdk/hashes"),
      import("privacy-sdk/abi"),
      import("privacy-sdk/contract-discovery"),
    ]);
    if ((root as { __privacySdkMissing?: boolean }).__privacySdkMissing) {
      throw new Error((root as { MISSING_MESSAGE: string }).MISSING_MESSAGE);
    }
    return {
      createPrivateTransfers: root.createPrivateTransfers,
      IndexerDiscoveryProvider: root.IndexerDiscoveryProvider,
      computeChannelKey: hashes.compute_channel_key,
      PrivacyPoolABI: abi.PrivacyPoolABI,
      ContractDiscoveryProvider: discovery.ContractDiscoveryProvider,
      // Testing code, loaded only for local devnet mode: it is the one module
      // that touched Node globals at import time, and Sepolia never needs it.
      mockProver: async () => (await import("privacy-sdk/mock-proving")).ScreeningCallMockProofProvider,
    };
  })();
  return cached;
}
