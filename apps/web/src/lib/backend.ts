/**
 * Chain backends. `demo` simulates the pool in the browser — WriteOnce slots
 * in localStorage, the real ~29 s proving latency (honest by default: the
 * product must work AS a designed-for constraint, not hide it), a peer
 * registry for the unregistered-recipient flow, and a demo counterparty who
 * replies. `direct` talks to a real helper over RPC (dev mode semantics, as in
 * the CLI). `pool` follows the CLI's gated path and needs live credentials.
 */
import { msgId, seal, type Sealed, type SlotReader } from "@strk20-messaging/sdk";
import type { Contact } from "./contacts.js";

export type SubmitState = "proving" | "submitted";

export interface Backend {
  reader: SlotReader;
  submitBatch(
    sealed: Sealed[],
    onState: (s: SubmitState) => void,
    signal?: AbortSignal
  ): Promise<{ txHash: string }>;
  isRegistered(address: string): Promise<boolean>;
  register(address: string): Promise<void>;
  /** Demo affordances are absent on real backends. */
  demo?: DemoControls;
}

export interface DemoControls {
  /** Pretend the peer ran SetViewingKey (the unregistered-recipient flow's happy end). */
  simulatePeerRegistration(address: string): void;
  /** The demo counterparty answers on the IN lane a moment after a flush confirms. */
  scheduleReply(contact: Contact, onArrived: () => void): void;
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
}

export class DemoBackend implements Backend {
  constructor(private readonly provingSeconds: number) {}

  private load(): DemoChain {
    try {
      const raw = localStorage.getItem(CHAIN_KEY);
      if (raw) return JSON.parse(raw) as DemoChain;
    } catch {
      /* fresh chain */
    }
    return { block: 1, slots: {}, registered: [] };
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

  async submitBatch(
    sealed: Sealed[],
    onState: (s: SubmitState) => void,
    signal?: AbortSignal
  ): Promise<{ txHash: string }> {
    onState("proving");
    await delayCancellable(this.provingSeconds * 1000, signal);
    if (signal?.aborted) throw new DOMException("Flush cancelled", "AbortError");
    onState("submitted");
    await delayCancellable(1200, signal);
    if (signal?.aborted) throw new DOMException("Flush cancelled", "AbortError");
    const chain = this.load();
    for (const s of sealed) {
      const key = "0x" + s.msgId.toString(16);
      if (chain.slots[key]) throw new Error("SLOT_OCCUPIED");
      chain.slots[key] = s.felts.map((f) => "0x" + f.toString(16));
    }
    chain.block += 1;
    this.save(chain);
    return { txHash: "0x" + crypto.getRandomValues(new Uint8Array(16)).reduce((a, b) => a + b.toString(16).padStart(2, "0"), "") };
  }

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
    scheduleReply: (contact, onArrived) => {
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
            body: new TextEncoder().encode(REPLIES[index % REPLIES.length]!),
          });
          chain.slots["0x" + reply.msgId.toString(16)] = reply.felts.map((f) => "0x" + f.toString(16));
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
  }

  readonly reader: SlotReader = {
    slotLens: async (ids) => {
      const { provider } = await this.providerP;
      const res = await provider.callContract({
        contractAddress: this.helperAddress,
        entrypoint: "slot_lens",
        calldata: ["0x" + BigInt(ids.length).toString(16), ...ids.map((i) => "0x" + i.toString(16))],
      });
      return res.slice(1).map(Number);
    },
    slots: async (id) => {
      const { provider } = await this.providerP;
      const res = await provider.callContract({
        contractAddress: this.helperAddress,
        entrypoint: "slots",
        calldata: ["0x" + id.toString(16)],
      });
      return res.slice(1).map(BigInt);
    },
    blockNumber: async () => (await this.providerP).provider.getBlockNumber(),
  };

  async submitBatch(
    sealed: Sealed[],
    onState: (s: SubmitState) => void,
    signal?: AbortSignal
  ): Promise<{ txHash: string }> {
    if (signal?.aborted) throw new DOMException("Flush cancelled", "AbortError");
    // Direct mode has no long local proving wait — cancel is only meaningful before execute.
    const { privacyInvokeCalldata } = await import("@strk20-messaging/sdk");
    const { provider, account } = await this.providerP;
    if (signal?.aborted) throw new DOMException("Flush cancelled", "AbortError");
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

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function delayCancellable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Flush cancelled", "AbortError"));
      return;
    }
    const step = 200;
    let waited = 0;
    const tick = () => {
      if (signal?.aborted) {
        reject(new DOMException("Flush cancelled", "AbortError"));
        return;
      }
      waited += step;
      if (waited >= ms) resolve();
      else setTimeout(tick, step);
    };
    setTimeout(tick, Math.min(step, ms));
  });
}
