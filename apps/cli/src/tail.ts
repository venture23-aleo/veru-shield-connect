import type { Account, Call, RpcProvider } from "starknet";
import { GATEWAYS, submitViaGateway } from "./gateway.js";

/**
 * THE submission tail — written once, never hand-written elsewhere
 * (11-implementation.md). Every documented footgun lives here:
 *   - `tip: 0n` is mandatory on v3 transactions
 *   - `proofFacts` must be OMITTED when absent, never passed as []
 *   - on any failure, invalidate the proof-nonce cache before rebuilding,
 *     or the retry loops on proofs the chain keeps rejecting
 */

export interface CallAndProof {
  call: Call | Call[];
  proof: { data?: unknown; proofFacts?: unknown[] };
}

export interface TailEvents {
  onSubmitted?: (txHash: string) => void;
}

export async function submitDirect(
  account: Account,
  provider: RpcProvider,
  calls: Call[],
  events: TailEvents = {}
) {
  const tx = await account.execute(calls, { tip: 0n });
  events.onSubmitted?.(tx.transaction_hash);
  return await awaitSuccess(provider, tx.transaction_hash);
}

export async function submitPool(
  account: Account,
  provider: RpcProvider,
  callAndProof: CallAndProof,
  invalidateProofNonceCache: () => void,
  events: TailEvents = {},
  opts: { gatewayUrl?: string | false } = {}
) {
  const proofDetails = callAndProof.proof.proofFacts?.length
    ? { proofFacts: callAndProof.proof.proofFacts, proof: callAndProof.proof.data }
    : {};
  try {
    // No estimation for proof-carrying txs (see proofTxResourceBounds).
    const resourceBounds = await proofTxResourceBounds(provider, account.address);
    // Live networks: the gateway. `false` (or an unknown chain, i.e. devnet): the RPC.
    const gateway = opts.gatewayUrl === false ? undefined : (opts.gatewayUrl ?? GATEWAYS[await provider.getChainId()]);
    const txHash = gateway
      ? await submitViaGateway(gateway, account, provider, callAndProof.call, resourceBounds, proofDetails)
      : (
          await account.execute(callAndProof.call, {
            tip: 0n,
            resourceBounds,
            ...proofDetails,
          } as Parameters<Account["execute"]>[1])
        ).transaction_hash;
    events.onSubmitted?.(txHash);
    return await awaitSuccess(provider, txHash);
  } catch (err) {
    invalidateProofNonceCache();
    throw err;
  }
}

async function awaitSuccess(provider: RpcProvider, txHash: string) {
  const receipt = await provider.waitForTransaction(txHash);
  const ok = (receipt as { isSuccess?: () => boolean }).isSuccess?.() ?? true;
  if (!ok) {
    const reason = (receipt as { revert_reason?: string }).revert_reason ?? "unknown";
    throw new Error(`transaction ${txHash} reverted: ${reason}`);
  }
  return { txHash, receipt };
}

/**
 * Resource bounds for a proof-carrying transaction, computed from the latest
 * block's gas prices. Fee ESTIMATION is impossible for these: it is a
 * simulation in which the OS never verifies the proof, so the pool's syscall
 * sees no facts and reverts with EMPTY_PROOF_FACTS (found on Sepolia
 * 2026-09-07). starknet.js skips estimation when bounds are given; the SDK's
 * own client never estimates either. Amounts are generous ceilings, not a
 * price — only actual usage is paid.
 * Ceilings, calibrated on the first mined registration (tx 0x7c0196fc…5700e:
 * 0 l1_gas, 79.8 M l2_gas, 704 l1_data_gas, 2.27 STRK): l1_gas is unused by an
 * L2-only transaction, so 0 — the gateway requires the balance to cover
 * amount × price for EVERY bound, and a lazy l1_gas ceiling alone was 24 STRK.
 * l2_gas at 250 M covers helper writes with margin; l1_data_gas 20 000 is 28×.
 */
const STRK_FEE_TOKEN = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

export async function proofTxResourceBounds(provider: RpcProvider, accountAddress?: string) {
  const block = (await provider.getBlockWithTxHashes("latest")) as {
    l1_gas_price?: { price_in_fri?: string };
    l2_gas_price?: { price_in_fri?: string };
    l1_data_gas_price?: { price_in_fri?: string };
  };
  const price = (p?: { price_in_fri?: string }) => (BigInt(p?.price_in_fri ?? "0x0") * 3n) / 2n + 1n;
  const l2Price = price(block.l2_gas_price);
  const dataPrice = price(block.l1_data_gas_price);
  const L1_DATA = 20_000n;
  let l2Max = 250_000_000n;
  if (accountAddress) {
    // The gateway requires balance ≥ Σ max_amount × max_price. Fit the l2
    // ceiling to the balance (95 %, minus the data bound) rather than fail
    // — but never below what a real send needs (~90 M observed): that would
    // only turn a clear refusal into an out-of-gas revert that still costs.
    const [lo, hi] = await provider.callContract({
      contractAddress: STRK_FEE_TOKEN,
      entrypoint: "balanceOf",
      calldata: [accountAddress],
    });
    const balance = BigInt(lo!) + (BigInt(hi!) << 128n);
    const budget = (balance * 95n) / 100n - L1_DATA * dataPrice;
    const affordable = budget > 0n ? budget / l2Price : 0n;
    const MIN_L2 = 120_000_000n;
    if (affordable < MIN_L2) {
      const need = Number((MIN_L2 * l2Price + L1_DATA * dataPrice) / 10n ** 15n) / 1000;
      throw new Error(
        `insufficient STRK for gas: ${Number(balance / 10n ** 15n) / 1000} STRK, a send needs about ${need} STRK of gas ceiling ` +
          "plus the pool fee — top up this account"
      );
    }
    if (affordable < l2Max) l2Max = affordable;
  }
  return {
    l1_gas: { max_amount: 0n, max_price_per_unit: price(block.l1_gas_price) },
    l2_gas: { max_amount: l2Max, max_price_per_unit: l2Price },
    l1_data_gas: { max_amount: L1_DATA, max_price_per_unit: dataPrice },
  };
}
