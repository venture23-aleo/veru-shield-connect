/**
 * Wallet mode: a Braavos/Ready account through the STRK20 wallet API
 * (wallet.ts). The wallet proves, signs and submits; we assemble actions and
 * read the helper's storage over RPC. No private key, no viewing key, no
 * proving URL in this app.
 *
 * Message lanes are address-derived (like direct mode — store.ts takes the
 * non-pool branch because `isPool` is false); the pool is used for value and
 * as the transaction carrier. Payments still ride with their memo in ONE
 * transaction: N transfer actions + one invoke action on the helper.
 */
import { privacyInvokeCalldata, type Sealed, type SlotReader } from "@strk20-messaging/sdk";
import type { RpcProvider } from "starknet";
import type { Backend, PoolControls, PoolNote, PoolTransfer, SubmitOptions, SubmitState } from "./backend.js";
import { rpcReader } from "./rpcReader.js";
import { buildActions, classifyWalletError, errorText, isolateActions, strk20Balances, strk20Submit, walletById, WalletRequestError, type InjectedWallet } from "./wallet.js";

export interface WalletSettings {
  rpcUrl: string;
  helperAddress: string;
  poolAddress: string;
  accountAddress: string;
  /** The injected wallet's id (wallet.ts detectWallets), e.g. "braavos". */
  walletId: string;
  /** Token for the carrier note on message-only sends. */
  carrierToken?: string;
}

export class WalletBackend implements Backend {
  private readonly providerP: Promise<RpcProvider>;
  readonly reader: SlotReader;

  constructor(readonly settings: WalletSettings) {
    this.providerP = import("starknet").then(({ RpcProvider }) => new RpcProvider({ nodeUrl: settings.rpcUrl }));
    this.reader = rpcReader(this.providerP, settings.helperAddress);
  }

  private wallet(): InjectedWallet {
    const w = walletById(this.settings.walletId);
    if (!w) throw new Error(`wallet "${this.settings.walletId}" is not injected in this page — is the extension enabled?`);
    return w;
  }

  /** `get_public_key(addr)` on the pool: zero means no viewing key registered. */
  async publicKeyOf(address: string): Promise<bigint> {
    const provider = await this.providerP;
    const r = await provider.callContract({ contractAddress: this.settings.poolAddress, entrypoint: "get_public_key", calldata: [address] });
    return BigInt(r[0] ?? "0x0");
  }

  /** Messaging pairs by address here, so anyone can be written to; the pool's registry gates PAYMENTS (payMany). */
  async isRegistered(): Promise<boolean> {
    return true;
  }
  async register(): Promise<void> {
    /* the wallet registers the viewing key itself, on its first shield */
  }

  async submitBatch(sealed: Sealed[], onState: (s: SubmitState) => void, opts: SubmitOptions = {}): Promise<{ txHash: string }> {
    const carrier = this.settings.carrierToken;
    if (!carrier) throw new Error("wallet mode needs a carrier token for message-only sends");
    const invoke = { contract: this.settings.helperAddress, calldata: privacyInvokeCalldata(sealed) };
    // The carrier: the pool accepts a zero-amount note (M0 § S1), but the
    // wallet proves with the STOCK SDK, whose client-side check refuses it
    // ("Created note amount must be positive") — and we cannot patch a
    // wallet. So the carrier is 1 wei from the start. It goes to the PEER
    // when they are registered on the pool — the shape proven live on
    // Sepolia (15 § B8: carrier to peer, channel opened by autoSetup), and
    // never a self-transfer, which a wallet may refuse as a privacy leak.
    // Group lanes have no peer: self. Needs a spendable note of the carrier
    // token inside the wallet (shield once, 10 blocks ago or more).
    let recipient = this.settings.accountAddress;
    if (opts.setupPeer) {
      try {
        if ((await this.publicKeyOf(opts.setupPeer)) !== 0n) recipient = opts.setupPeer;
      } catch {
        /* unreadable: carrier to self */
      }
    }
    try {
      return await this.submit(onState, buildActions([], invoke, { token: carrier, self: recipient, amount: 1n }), sealed);
    } catch (err) {
      const text = err instanceof WalletRequestError ? err.raw : errorText(err);
      const kind = err instanceof WalletRequestError ? err.kind : classifyWalletError(err);
      if (kind === "INSUFFICIENT_PRIVATE_BALANCE" || /insufficient|no notes|not enough/i.test(text)) {
        throw new Error(
          `a message needs a 1 wei carrier note to yourself, and the wallet has no spendable shielded ${carrierName(carrier)} to make it from — shield a small amount inside the wallet (notes mature after 10 blocks), then send again. (${text})`
        );
      }
      throw err;
    }
  }

  readonly pool: PoolControls = {
    pay: (transfer, sealed, onState) => this.pool.payMany([transfer], sealed, onState),
    payMany: async (transfers: PoolTransfer[], sealed: Sealed[], onState) => {
      if (transfers.length === 0) throw new Error("nothing to pay");
      for (const t of transfers) {
        if ((await this.publicKeyOf(t.recipient)) === 0n) {
          throw new Error(`${t.recipient} has not registered on the pool (no viewing key) — the pool cannot encrypt a note to them`);
        }
      }
      const invoke = sealed.length ? { contract: this.settings.helperAddress, calldata: privacyInvokeCalldata(sealed) } : null;
      return this.submit(onState, buildActions(transfers, invoke, null), sealed);
    },
    simulate: async (transfers: PoolTransfer[], sealed: Sealed[]) => {
      const invoke = sealed.length ? { contract: this.settings.helperAddress, calldata: privacyInvokeCalldata(sealed) } : null;
      const actions = buildActions(transfers, invoke, { token: this.settings.carrierToken ?? transfers[0]?.token ?? "0x0", self: this.settings.accountAddress, amount: 0n });
      return isolateActions(
        this.wallet(),
        actions.map((a) => (a.type === "transfer" && a.recipient === "self" ? { ...a, recipient: this.settings.accountAddress } : a))
      );
    },
    /** The wallet API sums notes; it does not list them. Receipts fall back to the balance. */
    notes: async (): Promise<PoolNote[] | null> => null,
    poolNotes: async (token) => ({ spendable: await this.pool.poolBalance(token), maturing: 0n, maturesInBlocks: 0 }),
    poolBalance: async (token) => {
      const entries = await strk20Balances(this.wallet(), [token]).catch((err) => {
        if (classifyWalletError(err) === "NOT_REGISTERED") return [];
        throw err;
      });
      return entries.reduce((a, e) => (BigInt(e.token) === BigInt(token) ? a + e.balance : a), 0n);
    },
    shield: (token, amount, onState) => this.submit(onState, [{ type: "deposit", token, amount: "0x" + amount.toString(16) }]),
    outKeyFor: async () => {
      throw new Error("wallet mode pairs by address; pool channels stay inside the wallet");
    },
    discoverLanes: async () => [],
    registerSelf: async () => {
      throw new Error("the wallet registers your viewing key itself — shield any amount in the wallet once");
    },
  };

  private async submit(onState: (s: SubmitState) => void, actions: ReturnType<typeof buildActions>, sealed: Sealed[] = []): Promise<{ txHash: string }> {
    onState("proving"); // the wallet proves and signs behind its own prompt
    let txHash: string;
    try {
      ({ txHash } = await strk20Submit(this.wallet(), actions));
    } catch (err) {
      // A wallet timeout is ambiguous: proving took too long, the prompt sat
      // unanswered — or it DID submit and only the answer was lost. Sending
      // again would duplicate the message, so look for it on-chain first.
      if (/timeout|timed out/i.test(errorText(err)) && sealed.length) {
        onState("submitted");
        const landed = await this.waitForSlots(sealed, 4 * 60_000);
        if (landed) return { txHash: WALLET_TIMEOUT_TX };
        throw new Error(
          `${this.wallet().name} answered "Timeout" and the message did not appear on-chain within 4 minutes. ` +
            `Wallet proving can take a minute or more: keep the wallet popup open and approve it promptly, then try again. ` +
            `If the wallet's proving service keeps timing out on this network, pool mode with the app's own prover avoids it (Settings → Pool → sign with ${this.wallet().name}).`
        );
      }
      const e = err instanceof WalletRequestError ? err : new WalletRequestError("wallet_strk20InvokeTransaction", classifyWalletError(err), errorText(err), this.settings.walletId);
      // UNKNOWN_ERROR is the wallet's catch-all. Two things we CAN find out
      // without the wallet's help: how old the newest shield is (notes spend
      // only after 10 blocks), and what the wallet says when asked to
      // assemble the same actions without proving, whole and in halves.
      let found = "";
      if (e.kind === "UNKNOWN") {
        try {
          const age = await this.newestDepositAge();
          if (age !== null && age < 10) found += ` Your newest shield is ${age} block${age === 1 ? "" : "s"} old — notes can be spent only after 10 blocks (~${(10 - age) * 30} s more).`;
          else if (age !== null) found += ` (Your newest shield is ${age} blocks old — mature.)`;
        } catch {
          /* no RPC: skip */
        }
        try {
          const lines = await isolateActions(this.wallet(), actions);
          found += " Assembly test (no proof, nothing spent): " + lines.map((l) => `${l.method}: ${l.ok ? "accepted" : l.detail}`).join(" · ");
        } catch {
          /* the wallet refused the probe: nothing to add */
        }
      }
      const advice =
        e.kind === "USER_REFUSED_OP"
          ? "you declined the transaction in the wallet"
          : e.kind === "NOT_REGISTERED"
            ? "your wallet is not registered on the pool yet — shield any amount in the wallet once, which registers your viewing key"
            : e.kind === "INSUFFICIENT_PRIVATE_BALANCE"
              ? "not enough shielded balance in the pool — shield more first"
              : e.kind === "PRIVACY_LEAK"
                ? "the wallet refused: this transaction would leak privacy (e.g. paying yourself, or spending notes too young)"
                : e.kind === "API_VERSION_NOT_SUPPORTED"
                  ? "the wallet wants a different STRK20 API version"
                  : e.kind === "INVALID_REQUEST_PAYLOAD"
                    ? "the wallet rejected the action list (payload) — run the STRK20 diagnostic in Settings and see which action it dislikes"
                    : e.kind === "UNSUPPORTED"
                      ? "this wallet has neither wallet_strk20InvokeTransaction nor the prepare route — update it, or use Ready / pool mode"
                      : e.kind === "UNKNOWN"
                        ? "the wallet gave no reason (UNKNOWN_ERROR): usually its proving service failed, notes younger than 10 blocks, or an action it cannot assemble." + found
                        : "";
      throw new WalletRequestError(e.method, e.kind, `${e.raw}${advice ? ` — ${advice}` : ""}`, e.walletName);
    }
    onState("submitted");
    const provider = await this.providerP;
    const receipt = await provider.waitForTransaction(txHash);
    const ok = (receipt as { isSuccess?: () => boolean }).isSuccess?.() ?? true;
    if (!ok) throw new Error(`transaction ${txHash} reverted: ${(receipt as { revert_reason?: string }).revert_reason ?? "unknown"}`);
    return { txHash };
  }

  /**
   * Blocks since OUR newest `Deposit` on the pool (user_addr is an event key,
   * so the node filters server-side). null when there is none in range.
   */
  async newestDepositAge(): Promise<number | null> {
    const provider = await this.providerP;
    const { hash } = await import("starknet");
    const head = await provider.getBlockNumber();
    const r = await provider.getEvents({
      address: this.settings.poolAddress,
      from_block: { block_number: Math.max(0, head - 20_000) },
      to_block: "latest",
      keys: [[hash.getSelectorFromName("Deposit")], [this.settings.accountAddress]],
      chunk_size: 100,
    });
    const newest = (r.events ?? []).reduce((m, e) => Math.max(m, Number((e as { block_number?: number }).block_number ?? 0)), -1);
    return newest < 0 ? null : head - newest;
  }

  /** Poll the helper for every sealed message's slot; true once all are written. */
  private async waitForSlots(sealed: Sealed[], maxMs: number): Promise<boolean> {
    const ids = sealed.map((s) => s.msgId);
    const until = Date.now() + maxMs;
    while (Date.now() < until) {
      try {
        const lens = await this.reader.slotLens(ids);
        if (lens.every((l) => l > 0)) return true;
      } catch {
        /* RPC hiccup: keep polling */
      }
      await new Promise((r) => setTimeout(r, 10_000));
    }
    return false;
  }
}

/** Sentinel tx hash when the wallet timed out but the message was found on-chain. */
export const WALLET_TIMEOUT_TX = "submitted-by-wallet";

function carrierName(token: string): string {
  try {
    return BigInt(token) === BigInt("0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d") ? "STRK" : `token ${token.slice(0, 8)}…`;
  } catch {
    return "token";
  }
}
