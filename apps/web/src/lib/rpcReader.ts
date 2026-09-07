import type { SlotReader } from "@strk20-messaging/sdk";
import type { RpcProvider } from "starknet";

/**
 * Helper storage over plain RPC — the same three reads in every real mode.
 * Discovery never needs more than an RPC URL (07-discovery.md); this is that
 * promise, in one place, shared by the direct and pool backends.
 */
export function rpcReader(providerP: Promise<RpcProvider>, helperAddress: string): SlotReader {
  const hex = (v: bigint) => "0x" + v.toString(16);
  return {
    slotLens: async (ids) => {
      const provider = await providerP;
      const res = await provider.callContract({
        contractAddress: helperAddress,
        entrypoint: "slot_lens",
        calldata: [hex(BigInt(ids.length)), ...ids.map(hex)],
      });
      return res.slice(1).map(Number);
    },
    slots: async (id) => {
      const provider = await providerP;
      const res = await provider.callContract({
        contractAddress: helperAddress,
        entrypoint: "slots",
        calldata: [hex(id)],
      });
      return res.slice(1).map(BigInt);
    },
    blockNumber: async () => (await providerP).getBlockNumber(),
  };
}
