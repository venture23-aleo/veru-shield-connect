/**
 * Chain backends. `demo` simulates the pool in the browser — WriteOnce slots
 * in localStorage, the real ~29 s proving latency (honest by default: the
 * product must work AS a designed-for constraint, not hide it), a peer
 * registry for the unregistered-recipient flow, and a demo counterparty who
 * replies. `direct` talks to a real helper over RPC (dev mode semantics, as in
 * the CLI). `pool` (poolBackend.ts) goes through the STRK20 pool — Arch 1:
 * public payer, private payee and amount.
 */
import { encodePaymentMemo, msgId, seal, type Sealed, type SlotReader } from "@strk20-messaging/sdk";
import type { Contact } from "./contacts.js";
import { rpcReader } from "./rpcReader.js";

export type SubmitState = "proving" | "submitted";

export interface SubmitOptions {
  /**
   * Pool mode: the recipient the carrier note is addressed to. Addressing the
   * peer lets autoSetup open the channel when (and only when) it is missing;
   * omitted for group lanes (carrier to self).
   */
  setupPeer?: string;
  /** Cancel while still proving locally (demo). Real backends ignore it past submission. */
  signal?: AbortSignal;
}

export interface PoolTransfer {
  token: string;
  recipient: string;
  amount: bigint;
}

export interface DiscoveredLane {
  peer: string;
  key: string;
  /** "out": my channel to them (derivable); "in": theirs to me (discovery only). */
  direction: "in" | "out";
}

/** One of OUR unspent notes in the pool, as discovery reports it. */
export interface PoolNote {
  token: string;
  amount: bigint;
  /** Block the note was created in, when the discovery provider says. */
  created?: number;
}

/**
 * Pool affordances. Real on the STRK20 pool (poolBackend.ts); simulated on
 * the demo backend so the public demo shows the same flow — and absent on
 * the direct dev helper, which has no notes to spend.
 */
export interface PoolControls {
  /** A payment and its memo in ONE transaction; reverts together. */
  pay(transfer: PoolTransfer, sealed: Sealed[], onState: (s: SubmitState) => void): Promise<{ txHash: string }>;
  /**
   * Wallet route only: ask the wallet to assemble (not prove, not submit) the
   * exact action list a payment would send, whole and in halves, and report
   * its words per shape. For "UNKNOWN_ERROR" — nothing is spent.
   */
  simulate?(transfers: PoolTransfer[], sealed: Sealed[]): Promise<{ method: string; ok: boolean; detail: string }[]>;
  /**
   * Several payments and their memos in ONE transaction — a group split or
   * tip: one private note per recipient, one proof, one fee. All or nothing.
   */
  payMany(transfers: PoolTransfer[], sealed: Sealed[], onState: (s: SubmitState) => void): Promise<{ txHash: string }>;
  /**
   * Our unspent notes of `token`, one per note. The receipt check pairs a
   * received PAY1 memo with a note of the same amount — the only pairing the
   * chain cannot make for us (payment.ts). `null` when the backend cannot
   * enumerate notes (the wallet API only sums them).
   */
  notes(token: string): Promise<PoolNote[] | null>;
  /** The lane I write to `peer` on — sender-derived, so it exists before any tx. Throws if they are unregistered. */
  outKeyFor(peer: string): Promise<string>;
  /** Every channel the pool's scan knows for me, classified by direction. */
  discoverLanes(): Promise<DiscoveredLane[]>;
  /** A registration-only transaction (SetViewingKey) — needed before anyone can write to you. */
  registerSelf(onState: (s: SubmitState) => void): Promise<{ txHash: string }>;
  /**
   * What a payment can actually spend: the sum of OUR notes of `token` inside
   * the pool (zero-amount carriers excluded). Not the wallet balance — that
   * only becomes spendable through a deposit, which the pool screens.
   */
  poolBalance(token: string): Promise<bigint>;
  /** Spendable now vs. still maturing (notes younger than 10 blocks cannot be spent yet). */
  poolNotes(token: string): Promise<{ spendable: bigint; maturing: bigint; maturesInBlocks: number }>;
  /**
   * Shield: public tokens → a private note (approve, then a proven Deposit).
   * The pool screens deposits: this proves through the screening prover when
   * one is configured, else the regular one — and on a live network without
   * the operator's attestation it reverts with SCREENING_REQUIRED.
   */
  shield(token: string, amount: bigint, onState: (s: SubmitState) => void): Promise<{ txHash: string }>;
}

export interface Backend {
  reader: SlotReader;
  submitBatch(
    sealed: Sealed[],
    onState: (s: SubmitState) => void,
    opts?: SubmitOptions
  ): Promise<{ txHash: string }>;
  isRegistered(address: string): Promise<boolean>;
  register(address: string): Promise<void>;
  /** Demo affordances are absent on real backends. */
  demo?: DemoControls;
  pool?: PoolControls;
}

export interface DemoControls {
  /** Pretend the peer ran SetViewingKey (the unregistered-recipient flow's happy end). */
  simulatePeerRegistration(address: string): void;
  /**
   * The demo counterparty answers on the IN lane a moment after a flush
   * confirms — with a payment when `answer` names one (they settle a request).
   */
  scheduleReply(contact: Contact, onArrived: () => void, answer?: { token: string; amount: bigint; text: string }): void;
}

const CHAIN_KEY = "strk20msg.demo.chain";
const REPLIES = [
  "got it, thanks!",
  "sounds good — confirming tomorrow.",
  "received. invoice matches.",
  "ok. same channel as always.",
  "noted, will get back to you.",
];

interface DemoChain {
  block: number;
  slots: Record<string, string[]>; // msgId hex -> felt hex[]
  registered: string[];
  /** Simulated pool: OUR unspent notes. Starts with 100 STRK "shielded" at genesis. */
  notes?: { token: string; amount: string; created: number }[];
}

const DEMO_STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const DEMO_GENESIS_NOTES = [{ token: DEMO_STRK, amount: (100n * 10n ** 18n).toString(), created: 0 }];

export class DemoBackend implements Backend {
  constructor(private readonly provingSeconds: number) {}

  private load(): DemoChain {
    try {
      const raw = localStorage.getItem(CHAIN_KEY);
      if (raw) {
        const chain = JSON.parse(raw) as DemoChain;
        chain.notes ??= DEMO_GENESIS_NOTES; // chains from before the simulated pool
        return chain;
      }
    } catch {
      /* fresh chain */
    }
    return { block: 1, slots: {}, registered: [], notes: DEMO_GENESIS_NOTES };
  }

  private save(chain: DemoChain): void {
    localStorage.setItem(CHAIN_KEY, JSON.stringify(chain));
  }

  readonly reader: SlotReader = {
    slotLens: async (ids) => {
      const chain = this.load();
      return ids.map((id) => chain.slots["0x" + id.toString(16)]?.length ?? 0);
    },
    slots: async (id) => {
      const felts = this.load().slots["0x" + id.toString(16)];
      if (!felts) throw new Error("empty slot");
      return felts.map(BigInt);
    },
    blockNumber: async () => this.load().block,
  };

  async submitBatch(sealed: Sealed[], onState: (s: SubmitState) => void, opts: SubmitOptions = {}): Promise<{ txHash: string }> {
    return this.transact(sealed, onState, (chain) => chain, opts.signal);
  }

  /** The simulated transaction: prove (visibly, cancellable), submit, then apply `mutate` and the slot writes atomically. */
  private async transact(
    sealed: Sealed[],
    onState: (s: SubmitState) => void,
    mutate: (chain: DemoChain) => DemoChain,
    signal?: AbortSignal
  ): Promise<{ txHash: string }> {
    onState("proving");
    await delayCancellable(this.provingSeconds * 1000, signal);
    onState("submitted");
    await delay(1200);
    const chain = mutate(this.load());
    for (const s of sealed) {
      const key = "0x" + s.msgId.toString(16);
      if (chain.slots[key]) throw new Error("SLOT_OCCUPIED");
      chain.slots[key] = s.felts.map((f) => "0x" + f.toString(16));
    }
    chain.block += 1;
    this.save(chain);
    return { txHash: "0x" + crypto.getRandomValues(new Uint8Array(16)).reduce((a, b) => a + b.toString(16).padStart(2, "0"), "") };
  }

  /** Spend notes of `token` for `total`; the remainder comes back as one change note, as in the pool. */
  private spend(chain: DemoChain, token: string, total: bigint): DemoChain {
    const notes = chain.notes ?? [];
    const mine = notes.filter((n) => sameToken(n.token, token));
    const have = mine.reduce((a, n) => a + BigInt(n.amount), 0n);
    if (have < total) throw new Error(`insufficient notes in the pool: have ${have}, need ${total}`);
    const rest = notes.filter((n) => !sameToken(n.token, token));
    const change = have - total;
    if (change > 0n) rest.push({ token, amount: change.toString(), created: chain.block + 1 });
    return { ...chain, notes: rest };
  }

  /** Simulated STRK20 pool: notes in localStorage, the same shapes as the real one. */
  readonly pool: PoolControls = {
    pay: (transfer, sealed, onState) => this.pool.payMany([transfer], sealed, onState),
    payMany: (transfers, sealed, onState) => {
      const total = transfers.reduce((a, t) => a + t.amount, 0n);
      const token = transfers[0]?.token ?? DEMO_STRK;
      if (transfers.some((t) => !sameToken(t.token, token))) throw new Error("demo pool: one token per transaction");
      return this.transact(sealed, onState, (chain) => this.spend(chain, token, total));
    },
    notes: async (token) =>
      (this.load().notes ?? []).filter((n) => sameToken(n.token, token)).map((n) => ({ token: n.token, amount: BigInt(n.amount), created: n.created })),
    poolNotes: async (token) => {
      const sum = ((await this.pool.notes(token)) ?? []).reduce((a, n) => a + n.amount, 0n);
      return { spendable: sum, maturing: 0n, maturesInBlocks: 0 };
    },
    poolBalance: async (token) => ((await this.pool.notes(token)) ?? []).reduce((a, n) => a + n.amount, 0n),
    shield: (token, amount, onState) =>
      this.transact([], onState, (chain) => ({
        ...chain,
        notes: [...(chain.notes ?? []), { token, amount: amount.toString(), created: chain.block + 1 }],
      })),
    outKeyFor: async () => {
      throw new Error("demo mode pairs by invite or address, not through the pool");
    },
    discoverLanes: async () => [],
    registerSelf: async () => {
      throw new Error("demo mode has no viewing-key registry");
    },
  };

  async isRegistered(address: string): Promise<boolean> {
    return this.load().registered.includes(address.toLowerCase());
  }

  async register(address: string): Promise<void> {
    const chain = this.load();
    const a = address.toLowerCase();
    if (!chain.registered.includes(a)) chain.registered.push(a);
    chain.block += 1;
    this.save(chain);
  }

  readonly demo: DemoControls = {
    simulatePeerRegistration: (address) => {
      void this.register(address);
    },
    scheduleReply: (contact, onArrived, answer) => {
      const runAt = 4000 + Math.random() * 4000;
      setTimeout(() => {
        void (async () => {
          const chain = this.load();
          const inKey = BigInt(contact.inKey);
          let index = 0;
          while (chain.slots["0x" + msgId(inKey, index).toString(16)]) index++;
          const reply = seal({
            channelKey: inKey,
            index,
            sender: BigInt(contact.peer),
            timestamp: BigInt(Math.floor(Date.now() / 1000)),
            body: answer
              ? encodePaymentMemo(BigInt(answer.token), answer.amount, answer.text)
              : new TextEncoder().encode(REPLIES[index % REPLIES.length]!),
          });
          chain.slots["0x" + reply.msgId.toString(16)] = reply.felts.map((f) => "0x" + f.toString(16));
          // Their payment lands as a new note of ours — what the real pool's discovery would find.
          if (answer) chain.notes = [...(chain.notes ?? []), { token: answer.token, amount: answer.amount.toString(), created: chain.block + 1 }];
          chain.block += 1;
          this.save(chain);
          onArrived();
        })();
      }, runAt);
    },
  };
}

/** Real helper over RPC — the CLI's direct dev mode, in the browser. */
export class DirectBackend implements Backend {
  private readonly providerP: Promise<{
    provider: import("starknet").RpcProvider;
    account: import("starknet").Account;
  }>;

  readonly reader: SlotReader;

  constructor(
    rpcUrl: string,
    private readonly helperAddress: string,
    accountAddress: string,
    privateKey: string
  ) {
    this.providerP = import("starknet").then(({ RpcProvider, Account }) => {
      const provider = new RpcProvider({ nodeUrl: rpcUrl });
      return { provider, account: new Account({ provider, address: accountAddress, signer: privateKey }) };
    });
    // After providerP: a field initializer would run before the constructor body.
    this.reader = rpcReader(
      this.providerP.then((p) => p.provider),
      helperAddress
    );
  }

  async submitBatch(sealed: Sealed[], onState: (s: SubmitState) => void): Promise<{ txHash: string }> {
    const { privacyInvokeCalldata } = await import("@strk20-messaging/sdk");
    const { provider, account } = await this.providerP;
    const tx = await account.execute(
      [
        {
          contractAddress: this.helperAddress,
          entrypoint: "privacy_invoke",
          calldata: privacyInvokeCalldata(sealed),
        },
      ],
      { tip: 0n }
    );
    onState("submitted");
    const receipt = await provider.waitForTransaction(tx.transaction_hash);
    const ok = (receipt as { isSuccess?: () => boolean }).isSuccess?.() ?? true;
    if (!ok) throw new Error(`transaction reverted: ${tx.transaction_hash}`);
    return { txHash: tx.transaction_hash };
  }

  async isRegistered(): Promise<boolean> {
    return true; // direct mode provisions channels out of band
  }
  async register(): Promise<void> {
    /* no registry in direct mode */
  }
}

function sameToken(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return a.toLowerCase() === b.toLowerCase();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** A wait that a cancel can interrupt — proving in the demo is the only cancellable phase. */
function delayCancellable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Flush cancelled", "AbortError"));
    if (signal?.aborted) return abort();
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      abort();
    });
  });
}
