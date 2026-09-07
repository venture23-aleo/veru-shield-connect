import type { Sealed } from "@strk20-messaging/sdk";
import { CallData, type Account, type RpcProvider } from "starknet";
import { poolConfig, type CliConfig } from "./config.js";
import { privacyInvokeCalldata } from "./helper.js";
import { createTransfers } from "./poolClient.js";
import { submitPool, type TailEvents } from "./tail.js";

/**
 * Pool-mode send: one proven STRK20 transaction carrying our InvokeExternal.
 *
 * Verified requirements (M0, from pool source):
 *   - an invoke-only action list is rejected with NO_REPLAY_PROTECTION; the
 *     transaction must carry one WriteOnce action. On the memo path the real
 *     transfer's enc notes ARE that action, so no carrier is needed; a
 *     message-only send adds one.
 *   - prove at head − 10 (notes mature 10 blocks)
 *   - at most one invoke-phase action per transaction
 *
 * Arch 1 (16-arch1-plan.md): the payer submits this themselves and is the
 * public `sender_address`. That is the deliberate trade — the recipient and
 * the amount stay private because `CreateEncNote`'s recipient fields are
 * client-action inputs carried in the proof, and enc notes pack an encrypted
 * amount (privacy/src/objects.cairo:95).
 */
export interface PoolTransfer {
  token: string;
  recipient: string;
  amount: bigint;
}

/**
 * Shared by both branches. `autoSelectNotes: "all"` is documented as
 * "requires surplus handling" (sdk/src/interfaces.ts:288) — hence the
 * mandatory `surplusTo` below. Without it the pool's balance invariant has no
 * change note to absorb the remainder and the transaction reverts.
 */
const BUILD_OPTIONS = {
  autoSetup: true,
  autoRegister: true,
  autoSelectNotes: "all",
  autoDiscover: { notes: "refresh", channels: "refresh" },
} as const;

export async function poolSend(
  cfg: CliConfig,
  account: Account,
  provider: RpcProvider,
  sealed: Sealed[],
  events: TailEvents & { onProving?: () => void } = {},
  opts: {
    /** A real private transfer riding the same action batch (memo case). */
    transfer?: PoolTransfer;
    /** Reuse a provingBlockId fetched by the resilience loop. */
    provingBlockId?: number;
    /** Carrier note amount; default 0 (pool-sanctioned), 1 wei if the SDK refuses zero. */
    carrierAmount?: bigint;
    /**
     * The recipient the carrier note is addressed to. Addressing the peer lets
     * autoSetup open the channel on first contact — and only then. Absent for
     * group lanes (carrier to self).
     */
    setupPeer?: string;
  } = {}
) {
  const poolCfg = poolConfig(cfg);
  const { transfers } = await createTransfers(cfg, { account, provider });
  await ensureFeeAllowance(cfg, account, provider);

  // Prove at head − 10: notes mature 10 blocks; proving at head risks reorgs.
  const provingBlockId = opts.provingBlockId ?? (await provider.getBlockNumber()) - 10;

  events.onProving?.();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let builder = transfers.build(BUILD_OPTIONS) as any;
  // Every selected note's remainder comes back to us as a change note.
  builder = builder.surplusTo(account.address);

  if (opts.transfer) {
    // Memo case: the real transfer's enc notes are the WriteOnce replay
    // protection — no carrier needed. One action batch, atomic by construction.
    const { token, recipient, amount } = opts.transfer;
    builder = builder.with(token, (t: any) => t.transfer({ recipient, amount }));
  } else {
    const carrierToken = poolCfg.carrierToken;
    if (!carrierToken) throw new Error("config.pool.carrierToken is required for the carrier note");
    // Replay-protection carrier: an enc note to self. The pool sanctions ZERO
    // (M0/S1) — no funds needed, no screened deposit needed. Our vendored SDK
    // is patched to allow it; an unpatched SDK refuses zero client-side, in
    // which case fall back to 1 wei (private churn, nothing leaves the pool).
    // Carrier to the PEER when there is one: autoSetup opens the channel only
    // when missing (an explicit second setup reverts on the write-once marker).
    builder = builder.with(carrierToken, (t: any) => {
      t.transfer({ recipient: opts.setupPeer ?? account.address, amount: opts.carrierAmount ?? 0n });
    });
  }
  builder = builder.invoke(() => ({
    contractAddress: cfg.helperAddress,
    calldata: CallData.compile(privacyInvokeCalldata(sealed)),
  }));
  let callAndProof;
  try {
    ({ callAndProof } = await builder.execute({ provingBlockId }));
  } catch (err) {
    if (opts.transfer || opts.carrierAmount !== undefined || !/must be positive/.test(String(err))) throw err;
    return poolSend(cfg, account, provider, sealed, events, { ...opts, carrierAmount: 1n });
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return submitPool(account, provider, callAndProof, () => transfers.invalidateProofNonceCache(), events, {
    gatewayUrl: poolCfg.gatewayUrl,
  });
}

/** STRK, the pool's fee token — the same address on Sepolia, mainnet and devnet. */
const STRK_FEE_TOKEN = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

/**
 * The pool collects its fee (`get_fee_amount`, STRK) from the caller by
 * `TransferFrom`; the SDK does not bundle the approval and the proof is bound
 * to the exact pool call, so it is its own transaction. Approve for fifty.
 */
async function ensureFeeAllowance(cfg: CliConfig, account: Account, provider: RpcProvider): Promise<void> {
  const pool = poolConfig(cfg).poolAddress;
  const [feeRaw] = await provider.callContract({ contractAddress: pool, entrypoint: "get_fee_amount", calldata: [] });
  const fee = BigInt(feeRaw!);
  if (fee === 0n) return;
  const [lo, hi] = await provider.callContract({
    contractAddress: STRK_FEE_TOKEN,
    entrypoint: "allowance",
    calldata: [account.address, pool],
  });
  if (BigInt(lo!) + (BigInt(hi!) << 128n) >= fee) return;
  const amount = fee * 50n;
  const tx = await account.execute(
    [{ contractAddress: STRK_FEE_TOKEN, entrypoint: "approve", calldata: [pool, "0x" + (amount & ((1n << 128n) - 1n)).toString(16), "0x" + (amount >> 128n).toString(16)] }],
    { tip: 0n }
  );
  const receipt = await provider.waitForTransaction(tx.transaction_hash);
  if (!((receipt as { isSuccess?: () => boolean }).isSuccess?.() ?? true)) {
    throw new Error(`fee approval reverted: ${tx.transaction_hash}`);
  }
}
