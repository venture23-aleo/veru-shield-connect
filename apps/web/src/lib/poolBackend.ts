/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Pool mode in the browser — Arch 1 (16-arch1-plan.md): the payer submits
 * from their own account and is public by design; the recipient and the
 * amount stay private. A port of apps/cli/src/pool.ts onto the web Backend.
 *
 *   - message-only send: 1-wei carrier note to self (the WriteOnce replay
 *     protection the pool demands, M0 § S1) + one InvokeExternal
 *   - payment: the real transfer + the same InvokeExternal — no carrier, the
 *     transfer's enc notes are the replay protection
 *   - `autoSelectNotes: "all"` is documented as "requires surplus handling"
 *     (sdk/src/interfaces.ts:288): hence the mandatory `surplusTo`
 *
 * Local testing: with `local: true` proving is the SDK's mock prover and
 * discovery reads the pool contract over RPC — both browser-safe — against a
 * devnet seeded by scripts/pool-devnet.mjs. That is how this is exercised
 * without the production proving endpoint (15 § B2).
 */
import { privacyInvokeCalldata, type Sealed, type SlotReader } from "@strk20-messaging/sdk";
import type { Account, RpcProvider } from "starknet";
import type { Backend, DiscoveredLane, PoolControls, PoolNote, PoolTransfer, SubmitOptions, SubmitState } from "./backend.js";
import { loadPrivacySdk, type PrivacySdk } from "./privacySdk.js";
import { submitViaGateway, type ProofDetails, type ResourceBounds } from "./gateway.js";
import { rpcReader } from "./rpcReader.js";
import { addInvokeTransaction, classifyWalletError, errorText, walletById } from "./wallet.js";

export interface PoolSettings {
  rpcUrl: string;
  helperAddress: string;
  poolAddress: string;
  accountAddress: string;
  /** The account's private key — OR `walletId`: an injected wallet (Ready X) that signs instead. */
  accountKey?: string;
  /** Sign every transaction (pool ones with their proof attached) through this injected wallet; no key in the app. */
  walletId?: string;
  /** Hex. Coerced to bigint at the boundary — a hex string discovers nothing (M0 § S4). */
  viewingKey: string;
  /** Local devnet: MOCK proving (and the devnet block-mining dance). Proving only. */
  local: boolean;
  /** Real prover, JSON-RPC. Ignored when `local`. */
  provingUrl?: string;
  /** Indexer URL; empty = read the pool contract over RPC (works anywhere, slower). */
  discoveryUrl?: string;
  /**
   * OHTTP for proving and discovery. Default: on, except toward a localhost
   * prover/indexer, which has no OHTTP gateway. Never hides the witness.
   */
  ohttp?: boolean;
  /** Token for the carrier note on message-only sends. */
  carrierToken?: string;
  /**
   * Where proof-carrying transactions are SUBMITTED (not proved). Live
   * networks: StarkWare's gateway, via the dev server's `/gateway` proxy
   * (gateway.ts says why the RPC cannot be used). Empty on local devnet.
   */
  gatewayUrl?: string;
  /** Prover that also issues screening attestations (the operator's); deposits prove there. */
  screeningProvingUrl?: string;
}

const BUILD_OPTIONS = {
  autoSetup: true,
  autoRegister: true,
  autoSelectNotes: "all",
  autoDiscover: { notes: "refresh", channels: "refresh" },
} as const;

/**
 * Who signs. `key`: a starknet.js Account (the pasted key), submitting proof
 * transactions to StarkWare's gateway (gateway.ts says why). `wallet`: an
 * injected wallet signs and submits through its own node — plain calls via
 * `wallet_addInvokeTransaction`, pool calls the same way with the SNIP-36
 * `proof` attached. Either way the SDK only ever sees the address.
 */
type Signer =
  | { kind: "key"; account: Account }
  | { kind: "wallet"; walletId: string };

interface Ready {
  sdk: PrivacySdk;
  provider: RpcProvider;
  /**
   * What the SDK sees. It needs `address` and a `signer` for the PROOF
   * invocation only — a synthetic invoke with the pool as sender, nonce 0 and
   * validation skipped (sdk/internal/proof-invocation-factory.ts), whose
   * signature is never verified. Real signing goes through `signer` below.
   */
  account: { address: string; signer: unknown };
  signer: Signer;
  pool: any;
  transfers: any;
  /** Kept: incoming channels are only reachable through its notes scan. */
  discovery: any;
}

const hex = (v: bigint) => "0x" + v.toString(16);
/** STRK, the pool's fee token — the same address on Sepolia, mainnet and devnet. */
const STRK_FEE_TOKEN = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

export class PoolBackend implements Backend {
  private readonly ready: Promise<Ready>;
  readonly reader: SlotReader;
  private readonly me: bigint;
  private readonly vk: bigint;

  constructor(readonly settings: PoolSettings) {
    this.me = BigInt(settings.accountAddress);
    this.vk = BigInt(settings.viewingKey);
    if (this.vk <= 0n) throw new Error("viewing key must be a positive hex felt");
    this.ready = this.init();
    this.ready.catch(() => {}); // surfaced by whichever call awaits it
    this.reader = rpcReader(
      this.ready.then((r) => r.provider),
      settings.helperAddress
    );
  }

  private async init(): Promise<Ready> {
    const s = this.settings;
    const [{ RpcProvider, Account, Contract, Signer, stark }, sdk] = await Promise.all([import("starknet"), loadPrivacySdk()]);
    const provider = new RpcProvider({ nodeUrl: s.rpcUrl });
    if (!s.accountKey && !s.walletId) throw new Error("pool mode needs either the account's private key or a wallet to sign with");
    const signer: Signer = s.accountKey
      ? { kind: "key", account: new Account({ provider, address: s.accountAddress, signer: s.accountKey }) }
      : { kind: "wallet", walletId: s.walletId! };
    // Wallet route: a throwaway key signs the unverified proof invocation; the
    // wallet signs everything that reaches the chain.
    const account = signer.kind === "key" ? signer.account : { address: s.accountAddress, signer: new Signer(stark.randomAddress()) };
    const chainId = await provider.getChainId();
    const pool = new (Contract as any)({
      abi: sdk.PrivacyPoolABI,
      address: s.poolAddress,
      providerOrAccount: provider,
    }).typedv2(sdk.PrivacyPoolABI);

    // OHTTP needs a gateway in front of the service; a self-hosted prover or
    // indexer has none. Plain http:// (localhost, a LAN address, a forwarded
    // port) therefore means "no OHTTP" unless explicitly set.
    const isPlainHttp = (u?: string) => /^http:\/\//i.test((u ?? "").trim());
    let provingProvider: unknown;
    if (s.local) {
      const MockProver = await sdk.mockProver();
      provingProvider = new MockProver(provider, chainId);
    } else {
      if (!s.provingUrl) throw new Error("pool mode needs a proving service URL (or local devnet mode)");
      // A `/path` URL is the dev server's proxy to a prover on the same
      // machine (vite.config.ts): same origin, and never OHTTP — there is no
      // gateway behind a proxy.
      const proxied = s.provingUrl.trim().startsWith("/");
      provingProvider = {
        url: resolveProvingUrl(s.provingUrl),
        chainId,
        nodeUrl: s.rpcUrl,
        ohttp: proxied ? false : (s.ohttp ?? !isPlainHttp(s.provingUrl)),
      };
    }
    // Discovery: an indexer if given (constructed here — handed a plain config
    // the factory drops the ohttp option, sdk/src/factory.ts:108), otherwise
    // straight from the pool contract over RPC.
    const discoveryProvider: unknown = s.discoveryUrl
      ? new sdk.IndexerDiscoveryProvider(s.discoveryUrl, s.poolAddress, { ohttp: s.ohttp ?? !isPlainHttp(s.discoveryUrl) })
      : new sdk.ContractDiscoveryProvider(pool);
    const transfers = sdk.createPrivateTransfers({
      account,
      viewingKeyProvider: { getViewingKey: async () => this.vk },
      provingProvider,
      discoveryProvider,
      poolContractAddress: s.poolAddress,
    });
    return { sdk, provider, account, signer, pool, transfers, discovery: discoveryProvider };
  }

  /** A plain invoke (approve, …) by whichever signer we have. Returns the tx hash. */
  private async plainInvoke(calls: { contractAddress: string; entrypoint: string; calldata: string[] }[]): Promise<string> {
    const { signer } = await this.ready;
    if (signer.kind === "key") return (await signer.account.execute(calls, { tip: 0n })).transaction_hash;
    const w = walletById(signer.walletId);
    if (!w) throw new Error(`wallet "${signer.walletId}" is not injected in this page — is the extension enabled?`);
    try {
      return await addInvokeTransaction(
        w,
        calls.map((c) => ({ contract_address: c.contractAddress, entry_point: c.entrypoint, calldata: c.calldata }))
      );
    } catch (err) {
      throw new Error(walletFailure(w.name, "wallet_addInvokeTransaction", err));
    }
  }

  /** A proof-carrying pool invoke by whichever signer we have. Returns the tx hash. */
  private async proofInvoke(call: any, resourceBounds: ResourceBounds, proofDetails: ProofDetails, rawProof: any): Promise<string> {
    const { signer, provider } = await this.ready;
    if (signer.kind === "key") {
      const gateway = this.settings.local ? undefined : this.settings.gatewayUrl?.trim();
      return gateway
        ? submitViaGateway(resolveProvingUrl(gateway), signer.account, provider, call, resourceBounds, proofDetails)
        : (await signer.account.execute(call, { tip: 0n, resourceBounds, ...proofDetails } as any)).transaction_hash;
    }
    const w = walletById(signer.walletId);
    if (!w) throw new Error(`wallet "${signer.walletId}" is not injected in this page — is the extension enabled?`);
    const calls = (Array.isArray(call) ? call : [call]).map((c: any) => ({
      contract_address: c.contractAddress ?? c.contract_address,
      entry_point: c.entrypoint ?? c.entry_point,
      calldata: (c.calldata ?? []).map((x: unknown) => "0x" + BigInt(x as string | number | bigint).toString(16)),
    }));
    // SNIP-36 wire shape: { data, output, proof_facts }. The SDK gives { data, proofFacts, output? }.
    const proof = proofDetails.proofFacts?.length
      ? {
          data: String(rawProof?.data ?? ""),
          output: ((rawProof?.output ?? []) as unknown[]).map((x) => "0x" + BigInt(x as string | number | bigint).toString(16)),
          proof_facts: proofDetails.proofFacts.map((x) => "0x" + BigInt(x as string | number | bigint).toString(16)),
        }
      : undefined;
    try {
      return await addInvokeTransaction(w, calls, proof);
    } catch (err) {
      throw new Error(walletFailure(w.name, "wallet_addInvokeTransaction (with proof)", err));
    }
  }

  /** `get_public_key(addr)` on the pool: zero means no `SetViewingKey` yet. */
  async publicKeyOf(address: string | bigint): Promise<bigint> {
    const { pool } = await this.ready;
    return BigInt(await pool.get_public_key(BigInt(address)));
  }

  async isRegistered(address: string): Promise<boolean> {
    return (await this.publicKeyOf(address)) !== 0n;
  }

  async register(): Promise<void> {
    /* autoRegister: SetViewingKey rides the first real transaction */
  }

  async submitBatch(
    sealed: Sealed[],
    onState: (s: SubmitState) => void,
    opts: SubmitOptions = {}
  ): Promise<{ txHash: string }> {
    const carrier = this.settings.carrierToken;
    if (!carrier) throw new Error("pool mode needs a carrier token for message-only sends");
    // The carrier note goes to the PEER (zero amount), not to self: autoSetup
    // then opens the channel exactly when it is missing and never twice — the
    // pool's channel marker is write-once, so an explicit second `setup(peer)`
    // reverts, which is how a message could fail after another client had
    // already opened the channel. Group lanes have no peer: carrier to self.
    const recipient = opts.setupPeer ?? this.settings.accountAddress;
    const attempt = (amount: bigint) =>
      this.submit(onState, (b) => b.with(carrier, (t: any) => t.transfer({ recipient, amount })), sealed);
    // The carrier note. The pool sanctions ZERO (M0 § S1) — no funds needed at
    // all, which is what makes a message-only send possible without a screened
    // deposit. The stock SDK refuses zero client-side; our vendored copy is
    // patched. If an unpatched SDK is in use, fall back to 1 wei.
    try {
      return await attempt(0n);
    } catch (err) {
      if (!/must be positive/.test(String(err))) throw err;
      // An UNPATCHED SDK refused the zero note (`pnpm run sdk:patch` + rebuild
      // fixes that). Fall back to 1 wei — which needs a spendable note.
      try {
        return await attempt(1n);
      } catch (err2) {
        const notes = await this.pool.poolNotes(carrier).catch(() => null);
        const have = notes ? `spendable ${notes.spendable} · maturing ${notes.maturing} (${notes.maturesInBlocks} blocks)` : "unknown";
        throw new Error(
          `message-only send failed twice. The bundled Privacy SDK refused a zero-value carrier note (it is unpatched: run \`pnpm run sdk:patch\`, rebuild sdk/dist, restart the dev server), ` +
            `and the 1 wei fallback needs a spendable note of the carrier token under THIS viewing key — ${have}. ` +
            `Notes shielded inside a wallet live under the wallet's own viewing key and are invisible here. (${String(err2).slice(0, 200)})`
        );
      }
    }
  }

  readonly pool: PoolControls = {
    pay: (transfer: PoolTransfer, sealed: Sealed[], onState) => this.pool.payMany([transfer], sealed, onState),

    // One `with` block per token, N transfers inside it: the builder's token
    // scope collects transfers (e2e-pool.test.ts:125-127 calls it twice in
    // one scope), and surplusTo on the builder absorbs each token's change.
    payMany: (transfers: PoolTransfer[], sealed: Sealed[], onState) => {
      if (transfers.length === 0) throw new Error("nothing to pay");
      const byToken = new Map<string, PoolTransfer[]>();
      for (const t of transfers) byToken.set(hex(BigInt(t.token)), [...(byToken.get(hex(BigInt(t.token))) ?? []), t]);
      return this.submit(
        onState,
        (b) => {
          for (const [token, list] of byToken) {
            b = b.with(token, (t: any) => {
              for (const x of list) t.transfer({ recipient: x.recipient, amount: x.amount });
            });
          }
          return b;
        },
        sealed
      );
    },

    notes: async (token: string): Promise<PoolNote[]> => {
      const { discovery } = await this.ready;
      const { notes } = await discovery.discoverNotes(this.me, this.vk, { tokens: [BigInt(token)] });
      const out: PoolNote[] = [];
      for (const [, list] of notes?.entries?.() ?? []) {
        for (const n of list as { amount: bigint | string; created?: number | bigint }[]) {
          const amount = BigInt(n.amount);
          if (amount === 0n) continue; // carriers
          out.push({ token, amount, ...(n.created === undefined ? {} : { created: Number(n.created) }) });
        }
      }
      return out;
    },

    outKeyFor: async (peer: string) => {
      const { sdk } = await this.ready;
      const pk = await this.publicKeyOf(peer);
      if (pk === 0n) throw new Error(`${peer} has not registered on the pool (no SetViewingKey) — nothing to encrypt to`);
      return hex(sdk.computeChannelKey(this.me, this.vk, BigInt(peer), pk));
    },

    registerSelf: (onState) => this.submit(onState, (b) => b.register(), []),

    shield: async (token: string, amount: bigint, onState) => {
      const { provider } = await this.ready;
      if (amount <= 0n) throw new Error("shield amount must be positive");
      // 1. approve the pool to pull the tokens (a plain transaction).
      const [lo, hi] = await provider.callContract({ contractAddress: token, entrypoint: "allowance", calldata: [this.settings.accountAddress, this.settings.poolAddress] });
      if (BigInt(lo!) + (BigInt(hi!) << 128n) < amount) {
        const txHash = await this.plainInvoke([
          { contractAddress: token, entrypoint: "approve", calldata: [this.settings.poolAddress, hex(amount & ((1n << 128n) - 1n)), hex(amount >> 128n)] },
        ]);
        await provider.waitForTransaction(txHash);
      }
      // 2. the proven Deposit — through the screening prover when configured.
      return this.submit(
        onState,
        (b) => b.with(token, (t: any) => t.deposit({ amount })),
        [],
        this.settings.screeningProvingUrl?.trim() || undefined
      );
    },

    poolNotes: async (token: string) => {
      const { discovery, provider } = await this.ready;
      const head = await provider.getBlockNumber();
      const { notes } = await discovery.discoverNotes(this.me, this.vk, { tokens: [BigInt(token)] });
      let spendable = 0n;
      let maturing = 0n;
      let maturesIn = 0;
      for (const [, list] of notes?.entries?.() ?? []) {
        for (const n of list as { amount: bigint | string; created?: number | bigint }[]) {
          const amount = BigInt(n.amount);
          if (amount === 0n) continue;
          const age = n.created === undefined ? 10 : head - Number(n.created);
          if (age >= 10) spendable += amount;
          else {
            maturing += amount;
            maturesIn = Math.max(maturesIn, 10 - age);
          }
        }
      }
      return { spendable, maturing, maturesInBlocks: maturesIn };
    },

    poolBalance: async (token: string) => {
      const { discovery } = await this.ready;
      const { notes } = await discovery.discoverNotes(this.me, this.vk, { tokens: [BigInt(token)] });
      let sum = 0n;
      for (const [, list] of notes?.entries?.() ?? []) {
        for (const n of list as { amount: bigint | string }[]) sum += BigInt(n.amount);
      }
      return sum;
    },

    discoverLanes: async () => {
      const { transfers, discovery } = await this.ready;
      const lanes: DiscoveredLane[] = [];
      // Outgoing: `discoverChannels` enumerates OUR channels, keyed by recipient.
      const out = await transfers.discoverChannels("all", {});
      for (const [addr, ch] of out?.channels?.entries?.() ?? []) {
        const peer = BigInt(addr);
        if (peer === this.me) continue; // the self-channel
        lanes.push({ peer: hex(peer), key: hex(BigInt((ch as any).key)), direction: "out" });
      }
      // Incoming: only the notes scan decrypts the channel infos filed under
      // OUR address (`get_channel_info(me, i)`), keyed by sender — and it does
      // so for every opened channel, notes or not.
      const { cursor } = await discovery.discoverNotes(this.me, this.vk, {});
      for (const [sender, ic] of cursor?.incomingChannels?.entries?.() ?? []) {
        const peer = BigInt(sender);
        if (peer === this.me) continue;
        lanes.push({ peer: hex(peer), key: hex(BigInt((ic as any).channelKey)), direction: "in" });
      }
      return lanes;
    },
  };

  /**
   * Prove, submit from OUR account, wait. Local devnet: prove at head and
   * mine ten blocks before submitting (the blockifier wants
   * proof_block ≤ head − 10); live: prove at head − 10 (notes mature 10 blocks).
   */
  /**
   * The pool collects its fee (`get_fee_amount`, STRK) from the caller by
   * `TransferFrom` — it needs an allowance, and the SDK does not bundle the
   * approval (the proof is bound to the exact pool call, so it cannot ride
   * in the same transaction). Approve once for many transactions; a zero fee
   * (devnet) needs nothing.
   */
  private async ensureFeeAllowance(): Promise<void> {
    const { provider, pool } = await this.ready;
    const fee = BigInt(await pool.get_fee_amount());
    if (fee === 0n) return;
    const strk = STRK_FEE_TOKEN;
    const call = async (entrypoint: string, calldata: string[]) =>
      provider.callContract({ contractAddress: strk, entrypoint, calldata });
    const [lo, hi] = await call("allowance", [this.settings.accountAddress, this.settings.poolAddress]);
    const allowance = BigInt(lo!) + (BigInt(hi!) << 128n);
    if (allowance >= fee) return;
    const amount = fee * 50n; // fifty transactions before the next approval
    const txHash = await this.plainInvoke([
      { contractAddress: strk, entrypoint: "approve", calldata: [this.settings.poolAddress, "0x" + (amount & ((1n << 128n) - 1n)).toString(16), "0x" + (amount >> 128n).toString(16)] },
    ]);
    const receipt = await provider.waitForTransaction(txHash);
    if (!((receipt as { isSuccess?: () => boolean }).isSuccess?.() ?? true)) {
      throw new Error(`fee approval reverted: ${txHash}`);
    }
  }

  /** A second SDK instance bound to another prover (deposits → the screening one). */
  private alt = new Map<string, Promise<any>>();
  private async transfersFor(provingUrl?: string): Promise<any> {
    const ready = await this.ready;
    if (!provingUrl || this.settings.local) return ready.transfers;
    let p = this.alt.get(provingUrl);
    if (!p) {
      p = (async () => {
        const chainId = await ready.provider.getChainId();
        return ready.sdk.createPrivateTransfers({
          account: ready.account, // address only
          viewingKeyProvider: { getViewingKey: async () => this.vk },
          provingProvider: { url: resolveProvingUrl(provingUrl), chainId, nodeUrl: this.settings.rpcUrl, ohttp: false },
          discoveryProvider: ready.discovery,
          poolContractAddress: this.settings.poolAddress,
        });
      })();
      this.alt.set(provingUrl, p);
    }
    return p;
  }

  private async submit(
    onState: (s: SubmitState) => void,
    shape: (builder: any) => any,
    sealed: Sealed[],
    provingUrl?: string
  ): Promise<{ txHash: string }> {
    const { provider } = await this.ready;
    const transfers = await this.transfersFor(provingUrl);
    await this.ensureFeeAllowance();
    const head = await provider.getBlockNumber();
    const provingBlockId = this.settings.local ? head : Math.max(0, head - 10);

    let builder = transfers.build(BUILD_OPTIONS).surplusTo(this.settings.accountAddress);
    builder = shape(builder);
    // A registration-only transaction carries no message; the invoke phase is
    // for the helper, and a bare SetViewingKey is its own replay protection.
    if (sealed.length > 0) {
      builder = builder.invoke(() => ({
        contractAddress: this.settings.helperAddress,
        calldata: privacyInvokeCalldata(sealed),
      }));
    }
    const { callAndProof } = await builder.execute({ provingBlockId });
    if (this.settings.local) await this.mineBlocks(10);

    const proof = callAndProof.proof ?? {};
    // The SDK's shape is { proofFacts, data }; the wire shape is { proofFacts, proof }.
    const proofDetails: { proofFacts?: unknown[]; proof?: unknown } = proof.proofFacts?.length
      ? { proofFacts: proof.proofFacts, proof: proof.data }
      : {};
    try {
      const resourceBounds = await proofTxResourceBounds(provider, this.settings.accountAddress);
      const txHash = await this.proofInvoke(callAndProof.call, resourceBounds, proofDetails, proof);
      onState("submitted");
      const receipt = await provider.waitForTransaction(txHash);
      const ok = (receipt as { isSuccess?: () => boolean }).isSuccess?.() ?? true;
      if (!ok) {
        const reason = (receipt as { revert_reason?: string }).revert_reason ?? "unknown";
        throw new Error(`transaction ${txHash} reverted: ${reason}`);
      }
      return { txHash };
    } catch (err) {
      // Or the retry loops on proofs the chain keeps rejecting (tail.ts).
      transfers.invalidateProofNonceCache?.();
      throw err;
    }
  }

  private async mineBlocks(n: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      await fetch(this.settings.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "devnet_createBlock" }),
      });
    }
  }
}

/**
 * Reach the prover from the browser and say exactly what happened — the
 * diagnostic for "Failed to fetch": unreachable (wrong host, port not
 * forwarded), blocked (CORS), or fine (it answers `starknet_specVersion`).
 */
/** `/prover` → this page's origin + `/prover` (the dev-server proxy); absolute URLs pass through. */
export function resolveProvingUrl(url: string): string {
  const u = url.trim();
  return u.startsWith("/") ? `${globalThis.location?.origin ?? ""}${u}` : u;
}

export async function probeProver(url: string): Promise<{ ok: boolean; detail: string }> {
  const target = resolveProvingUrl(url);
  if (!/^https?:\/\//i.test(target)) return { ok: false, detail: "URL must start with http:// or https://, or be a /path proxied by the dev server" };
  try {
    const res = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "starknet_specVersion", params: [] }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json()) as { result?: string; error?: { message?: string } };
    if (body.result) return { ok: true, detail: `prover answers · RPC spec ${body.result}` };
    return { ok: false, detail: `prover answered but oddly: ${body.error?.message ?? JSON.stringify(body).slice(0, 80)}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      ok: false,
      detail: timedOut
        ? `no answer from ${target} within 10 s — something accepts the connection but never replies. ` +
          "A port forward that isn't actually connected does this: open the URL in a new tab; if that hangs too, " +
          "remove and re-add the forward (VS Code → Ports), and check it targets this machine's port 3000."
        : `${msg} — the browser cannot reach ${target}. If this browser is not on the machine running the ` +
          "prover, forward port 3000 (VS Code → Ports) or use that machine's address instead of localhost.",
    };
  }
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

/** What a wallet refusal means for the user, with the wallet's own words kept. */
function walletFailure(walletName: string, method: string, err: unknown): string {
  const kind = classifyWalletError(err);
  const raw = errorText(err);
  const advice =
    kind === "USER_REFUSED_OP"
      ? "you declined the transaction in the wallet"
      : kind === "UNSUPPORTED" || kind === "INVALID_REQUEST_PAYLOAD"
        ? "the wallet did not accept a proof-carrying invoke (SNIP-36 `proof` on wallet_addInvokeTransaction) — this wallet build cannot sign pool transactions proved outside it; use a pasted key instead"
        : "";
  return `${walletName} rejected ${method}: ${raw}${advice ? ` — ${advice}` : ""}`;
}
