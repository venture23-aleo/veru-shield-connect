/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Browser wallets (Braavos, Ready) through the Starknet Wallet API — the
 * SNIP-36 STRK20 methods included. The wallet holds the account key AND the
 * viewing key: it proves, signs and submits. The app never sees either.
 *
 * Injected objects only (`window.starknet_braavos`, `window.starknet_ready`,
 * `window.starknet_argentX`): no discovery library, no extra dependency —
 * every wallet that matters injects, and `request({ type, params })` is the
 * whole protocol.
 *
 * What the STRK20 wallet route gives up versus holding keys ourselves: notes
 * are not enumerable (`wallet_strk20Balances` is a sum), and pool channel keys
 * are the wallet's — so message lanes in wallet mode are the address-derived
 * pair lanes (devPairLane), not pool channels. Payments are the pool's.
 */

export interface InjectedWallet {
  id: string;
  name: string;
  version?: string;
  icon?: string;
  request: (call: { type: string; params?: unknown }) => Promise<any>;
  on?: (event: string, handler: (...args: any[]) => void) => void;
  off?: (event: string, handler: (...args: any[]) => void) => void;
}

/** STRK20 action shapes, as in @starknet-io/types-js 0.10 (wallet-api/components). */
export type Strk20Action =
  | { type: "deposit"; token: string; amount: string }
  | { type: "withdraw"; token: string; amount: string; recipient: string }
  | { type: "transfer"; token: string; amount: string | "OPEN"; recipient: string }
  | { type: "invoke"; contract: string; calldata: string[] };

export const CHAIN_IDS: Record<string, string> = {
  SN_SEPOLIA: "0x534e5f5345504f4c4941",
  SN_MAIN: "0x534e5f4d41494e",
};

export function chainName(chainId: string): string {
  const id = normalizeChainId(chainId);
  return id === CHAIN_IDS.SN_SEPOLIA ? "Sepolia" : id === CHAIN_IDS.SN_MAIN ? "mainnet" : chainId;
}

/** Wallets answer `wallet_requestChainId` as hex or as the short string; compare either. */
export function normalizeChainId(chainId: string): string {
  if (/^0x[0-9a-fA-F]+$/.test(chainId)) return chainId.toLowerCase();
  return CHAIN_IDS[chainId] ?? chainId;
}

/**
 * Every injected Starknet wallet on this page. Ready first: it is the wallet
 * the Privacy Wallet API shipped with, and the one that answers
 * `wallet_strk20*` (Braavos 2026-09 returns "Not implemented"). Ready injects
 * both `starknet_ready` and the legacy `starknet_argentX` alias — one entry.
 */
const KNOWN_KEYS = ["starknet_ready", "starknet_argentX", "starknet_braavos", "starknet"];

export function detectWallets(): InjectedWallet[] {
  if (typeof window === "undefined") return [];
  const found: InjectedWallet[] = [];
  const seen = new Set<unknown>();
  const seenIds = new Set<string>();
  // Extensions define their objects with defineProperty, often non-enumerable:
  // Object.keys misses them. Known names first, then every own property.
  const keys = [...KNOWN_KEYS, ...Object.getOwnPropertyNames(window)];
  for (const key of keys) {
    if (!key.startsWith("starknet")) continue;
    const obj = (window as any)[key];
    if (!obj || typeof obj.request !== "function" || seen.has(obj)) continue;
    const id = String(obj.id ?? key.replace(/^starknet_?/, "") ?? key).toLowerCase();
    if (seenIds.has(id)) continue;
    seen.add(obj);
    seenIds.add(id);
    found.push({
      id: String(obj.id ?? key.replace(/^starknet_?/, "") ?? key),
      name: String(obj.name ?? key),
      version: obj.version ? String(obj.version) : undefined,
      icon: typeof obj.icon === "string" ? obj.icon : obj.icon?.light,
      request: (call) => obj.request(call),
      on: obj.on?.bind(obj),
      off: obj.off?.bind(obj),
    });
  }
  return found.sort((a, b) => rank(a) - rank(b));
}

function rank(w: InjectedWallet): number {
  const id = `${w.id} ${w.name}`.toLowerCase();
  return id.includes("ready") || id.includes("argent") ? 0 : id.includes("braavos") ? 1 : 2;
}

export function isReady(w: InjectedWallet): boolean {
  return rank(w) === 0;
}

/** The wallets the UI offers: Ready X only — the one that implements the STRK20 wallet API. */
export function readyWallets(): InjectedWallet[] {
  return detectWallets().filter(isReady);
}

/**
 * Is `address` registered on `pool` (a `ViewingKeySet` happened)? Read
 * straight from the chain, independent of the wallet — the one fact that
 * separates "this account never shielded here" from "the wallet's privacy
 * backend does not serve this network".
 */
export async function registeredOnPool(rpcUrl: string, pool: string, address: string): Promise<boolean> {
  const { RpcProvider } = await import("starknet");
  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  const r = await provider.callContract({ contractAddress: pool, entrypoint: "get_public_key", calldata: [address] });
  return BigInt(r[0] ?? "0x0") !== 0n;
}

export const READY_NAME = "Ready X";
export const READY_INSTALL_URL = "https://www.ready.co/";

/**
 * Extensions inject after the page's first paint, sometimes seconds later.
 * Calls `onFound` as soon as Ready X shows up; gives up after ~6 s. Returns a
 * cancel function.
 */
export function watchForReady(onFound: (w: InjectedWallet[]) => void): () => void {
  const delays = [0, 250, 600, 1200, 2500, 4000, 6000];
  const timers = delays.map((ms) =>
    setTimeout(() => {
      const w = readyWallets();
      if (w.length) {
        timers.forEach(clearTimeout);
        onFound(w);
      }
    }, ms)
  );
  return () => timers.forEach(clearTimeout);
}

export function walletById(id: string): InjectedWallet | undefined {
  return detectWallets().find((w) => w.id === id);
}

export async function connectWallet(w: InjectedWallet): Promise<{ address: string; chainId: string }> {
  const accounts: string[] = await w.request({ type: "wallet_requestAccounts", params: { silent_mode: false } });
  const address = accounts?.[0];
  if (!address) throw new Error(`${w.name} returned no account`);
  const chainId: string = await w.request({ type: "wallet_requestChainId" });
  return { address, chainId: normalizeChainId(String(chainId)) };
}

export async function switchChain(w: InjectedWallet, chainId: string): Promise<boolean> {
  return !!(await w.request({ type: "wallet_switchStarknetChain", params: { chainId } }));
}

export type Strk20Support =
  | { ok: true; registered: boolean; balances: { token: string; balance: bigint }[]; hint?: string }
  | {
      ok: false;
      /** "unsupported": the method is missing. "error": the method exists but the wallet could not answer. "refused": the user declined. */
      kind: "unsupported" | "error" | "refused";
      reason: string;
      /** What the CHAIN says about it (explainProbe): who registered this account, and what to do. */
      hint?: string;
    };

const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

/**
 * Does this wallet speak STRK20? `wallet_strk20Balances` is read-only, so it
 * is the safe probe: a balance list or NOT_REGISTERED both mean "yes"; a
 * method-not-found style error means "no". Never assume — there is no
 * published list of which wallet versions implement it (Day 0 guide).
 *
 * Asked twice when needed: first for "all shielded tokens" (`tokens: []`,
 * per spec), then for STRK by address — a wallet that cannot enumerate may
 * still answer a named token.
 */
export async function probeStrk20(w: InjectedWallet): Promise<Strk20Support> {
  const ask = async (tokens: string[]) => {
    const entries: { token: string; balance: string }[] = await w.request({ type: "wallet_strk20Balances", params: { tokens } });
    return (entries ?? []).map((e) => ({ token: e.token, balance: BigInt(e.balance) }));
  };
  let first: unknown;
  try {
    return { ok: true, registered: true, balances: await ask([]) };
  } catch (err) {
    first = err;
  }
  const kind = classifyWalletError(first);
  if (kind === "NOT_REGISTERED") return { ok: true, registered: false, balances: [] };
  if (kind === "USER_REFUSED_OP") return { ok: false, kind: "refused", reason: "you declined the request in the wallet — try again and approve it" };
  if (kind === "UNSUPPORTED") return { ok: false, kind: "unsupported", reason: `${w.name} does not implement the STRK20 wallet methods (wallet_strk20*) — its answer: "${errorText(first)}"` };
  // The method exists. Try the named-token form before giving up.
  try {
    return { ok: true, registered: true, balances: await ask([STRK]) };
  } catch (err2) {
    const kind2 = classifyWalletError(err2);
    if (kind2 === "NOT_REGISTERED") return { ok: true, registered: false, balances: [] };
    if (kind2 === "USER_REFUSED_OP") return { ok: false, kind: "refused", reason: "you declined the request in the wallet — try again and approve it" };
    return {
      ok: false,
      kind: "error",
      reason: `${w.name} has the STRK20 API but could not answer wallet_strk20Balances — "${errorText(first)}"${errorText(err2) !== errorText(first) ? ` / with STRK named: "${errorText(err2)}"` : ""}`,
    };
  }
}

/**
 * When the wallet cannot use the account on the pool, the chain usually knows
 * why: `get_public_key(account)` on the pool is non-zero when SOMEONE already
 * registered a viewing key for it. If that someone was not this wallet — the
 * app's pool mode, the CLI, a script — the wallet holds no key that decrypts
 * anything, answers UNKNOWN_ERROR to every STRK20 call, and never will:
 * registration is once per account. The only fix is another account.
 */
export async function explainProbe(
  support: Strk20Support,
  account: string,
  rpcUrl: string,
  poolAddress: string,
  appHeldAccounts: string[] = []
): Promise<Strk20Support> {
  if (support.ok && support.registered) return support;
  let pk = 0n;
  try {
    const { RpcProvider, hash } = await import("starknet");
    const provider = new RpcProvider({ nodeUrl: rpcUrl });
    const r = await provider.callContract({ contractAddress: poolAddress, entrypoint: "get_public_key", calldata: [account] });
    pk = BigInt(r[0] ?? "0x0");
    void hash;
  } catch {
    return support; // no RPC answer: nothing to add
  }
  const sameAddr = (a: string, b: string) => {
    try {
      return BigInt(a) === BigInt(b);
    } catch {
      return false;
    }
  };
  const appHeld = appHeldAccounts.some((a) => sameAddr(a, account));
  if (pk !== 0n) {
    const who = appHeld ? "this project's own deployer/pool-mode account — its viewing key lives in the app's scripts" : "a client other than this wallet (this app's pool mode, the CLI, or a script)";
    return {
      ...support,
      hint:
        `The pool already holds a viewing key for ${account.slice(0, 8)}…${account.slice(-4)}, registered by ${who}. ` +
        `The wallet does not have that key, so it cannot read or spend this account's notes, and registration is once per account — this will never work from the wallet. ` +
        `Fix: in the wallet, create a NEW account (never used with this app's pool mode or CLI), fund it, shield a small amount inside the wallet — that registers the wallet's own viewing key — wait 10 blocks, then connect that account here.`,
    };
  }
  return {
    ...support,
    hint: `This account has no viewing key on the pool yet. Shield any amount inside the wallet once (that registers it), wait 10 blocks, then reconnect.`,
  };
}

export type WalletErrorKind =
  | "NOT_REGISTERED"
  | "USER_REFUSED_OP"
  | "INSUFFICIENT_PRIVATE_BALANCE"
  | "PRIVACY_LEAK"
  | "INVALID_REQUEST_PAYLOAD"
  | "API_VERSION_NOT_SUPPORTED"
  | "UNSUPPORTED"
  | "UNKNOWN";

/**
 * Wallet errors arrive as SNIP-36 {code, message} (113 refused, 114 bad
 * payload, 118 not registered, 119 insufficient, 162 api version, 163
 * unknown), as strings, or as nested causes. "UNSUPPORTED" is reserved for a
 * method the wallet does not have at all — a payload the wallet dislikes is
 * INVALID_REQUEST_PAYLOAD, and the raw text always travels with it (errorText).
 */
export function classifyWalletError(err: unknown): WalletErrorKind {
  const text = errorText(err).toUpperCase();
  const code = Number((err as { code?: number | string })?.code);
  if (code === 118 || text.includes("NOT_REGISTERED") || text.includes("NOT REGISTERED")) return "NOT_REGISTERED";
  if (code === 113 || text.includes("USER_REFUSED") || text.includes("USER REJECTED") || text.includes("REJECTED BY USER") || text.includes("USER ABORT")) return "USER_REFUSED_OP";
  if (code === 119 || text.includes("INSUFFICIENT_PRIVATE_BALANCE") || text.includes("INSUFFICIENT PRIVATE")) return "INSUFFICIENT_PRIVATE_BALANCE";
  if (text.includes("PRIVACY_LEAK")) return "PRIVACY_LEAK";
  if (code === 162 || text.includes("API_VERSION_NOT_SUPPORTED")) return "API_VERSION_NOT_SUPPORTED";
  if (code === 114 || text.includes("INVALID_REQUEST_PAYLOAD") || text.includes("INVALID REQUEST") || text.includes("INVALID PARAMS")) return "INVALID_REQUEST_PAYLOAD";
  // "unsupported action type: invoke" — the wallet has the method but not this action: a payload matter, no fallback.
  if (/\bACTIONS?\b/.test(text) && /UNSUPPORTED|NOT SUPPORTED|INVALID|UNKNOWN/.test(text)) return "INVALID_REQUEST_PAYLOAD";
  if (
    code === -32601 ||
    text.includes("NOT IMPLEMENTED") ||
    text.includes("METHOD NOT FOUND") ||
    text.includes("UNKNOWN METHOD") ||
    text.includes("INVALID METHOD") ||
    text.includes("UNSUPPORTED METHOD") ||
    text.includes("METHOD NOT SUPPORTED") ||
    text.includes("UNKNOWN REQUEST") ||
    text.includes("UNKNOWN TYPE") ||
    text.includes("UNSUPPORTED TYPE") ||
    /NOT SUPPORTED.*WALLET_|WALLET_\w+.*NOT SUPPORTED/.test(text) ||
    /UNSUPPORTED.*WALLET_|WALLET_\w+.*UNSUPPORTED/.test(text)
  ) {
    return "UNSUPPORTED";
  }
  return "UNKNOWN";
}

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  const e = err as { message?: unknown; code?: unknown; data?: unknown } | null;
  if (e && typeof e === "object") {
    const parts = [e.code !== undefined ? `code ${String(e.code)}` : "", e.message !== undefined ? String(e.message) : "", e.data !== undefined ? JSON.stringify(e.data) : ""];
    const s = parts.filter(Boolean).join(": ");
    if (s) return s;
    try {
      return JSON.stringify(err);
    } catch {
      /* fallthrough */
    }
  }
  return String(err);
}

export async function strk20Invoke(w: InjectedWallet, actions: Strk20Action[]): Promise<string> {
  const r: { transaction_hash: string } = await w.request({ type: "wallet_strk20InvokeTransaction", params: { actions } });
  if (!r?.transaction_hash) throw new Error(`${w.name} returned no transaction hash`);
  return r.transaction_hash;
}

export interface CallAndProof {
  call: { contract_address: string; entry_point: string; calldata: string[] };
  proof: { data: string; output: string[]; proof_facts: string[] };
}

/** The two-step route: the wallet builds call + proof, then signs a regular invoke that carries the proof. */
export async function strk20Prepare(w: InjectedWallet, actions: Strk20Action[], simulate = false): Promise<CallAndProof> {
  const r: CallAndProof = await w.request({ type: "wallet_strk20PrepareInvoke", params: { actions, simulate } });
  if (!r?.call) throw new Error(`${w.name} returned no call from wallet_strk20PrepareInvoke`);
  return r;
}

export async function addInvokeWithProof(w: InjectedWallet, cap: CallAndProof): Promise<string> {
  return addInvokeTransaction(w, [cap.call], cap.proof);
}

export interface WalletCall {
  contract_address: string;
  entry_point: string;
  calldata: string[];
}

/**
 * A regular invoke through the wallet — with the SNIP-36 `proof` attached
 * when the call is a pool transaction we proved ourselves. The wallet signs
 * (the hash folds the proof facts in) and submits through its own node.
 */
export async function addInvokeTransaction(w: InjectedWallet, calls: WalletCall[], proof?: CallAndProof["proof"]): Promise<string> {
  const r: { transaction_hash: string } = await w.request({ type: "wallet_addInvokeTransaction", params: { calls, ...(proof ? { proof } : {}) } });
  if (!r?.transaction_hash) throw new Error(`${w.name} returned no transaction hash from wallet_addInvokeTransaction`);
  return r.transaction_hash;
}

/**
 * A viewing key of OUR choosing, derived from a wallet signature — the Day 0
 * guide's route for wallets without (usable) STRK20 support: sign a fixed
 * SNIP-12 message, fold every signature felt with Poseidon, reduce into the
 * curve order. Deterministic: reconnecting re-derives the same key, so the
 * key needs no backup beyond the wallet. Distinct from the wallet's own
 * privacy key (Ready's lives on its backend); the pool holds one key per
 * account, so an account uses either this app's route or the wallet's, not both.
 */
export function viewingKeyTypedData(chainId: string, pool: string, address: string) {
  return {
    types: {
      StarknetDomain: [
        { name: "name", type: "shortstring" },
        { name: "version", type: "shortstring" },
        { name: "chainId", type: "shortstring" },
        { name: "revision", type: "shortstring" },
      ],
      ViewingKey: [
        { name: "purpose", type: "string" },
        { name: "pool", type: "ContractAddress" },
        { name: "account", type: "ContractAddress" },
      ],
    },
    primaryType: "ViewingKey",
    domain: { name: "STRK20 Messages", version: "1", chainId, revision: "1" },
    message: { purpose: "strk20-messaging/viewing-key/v1", pool, account: address },
  };
}

export async function deriveViewingKey(w: InjectedWallet, address: string, chainId: string, pool: string): Promise<string> {
  const sig: unknown = await w.request({ type: "wallet_signTypedData", params: viewingKeyTypedData(chainId, pool, address) });
  return foldSignature(sig);
}

/** Poseidon over the signature felts, reduced into the STARK curve order, never zero. Exported for tests. */
export async function foldSignature(sig: unknown): Promise<string> {
  const felts = (Array.isArray(sig) ? sig : (sig as { r?: unknown; s?: unknown })?.r !== undefined ? [(sig as any).r, (sig as any).s] : []).map((x) => BigInt(x as string | number | bigint));
  if (felts.length < 2) throw new Error("the wallet returned no signature");
  const { ec, hash } = await import("starknet");
  const folded = BigInt(hash.computePoseidonHashOnElements(felts));
  const n = ec.starkCurve.CURVE.n;
  const reduced = folded % n;
  return "0x" + (reduced === 0n ? 1n : reduced).toString(16);
}

export class WalletRequestError extends Error {
  constructor(
    readonly method: string,
    readonly kind: WalletErrorKind,
    readonly raw: string,
    readonly walletName: string
  ) {
    super(`${walletName} rejected ${method}: ${raw}`);
  }
}

/**
 * Submit STRK20 actions by whichever route the wallet has. First the one-shot
 * `wallet_strk20InvokeTransaction`; if the wallet lacks THAT METHOD (not if it
 * dislikes the payload), fall back to prepare + `wallet_addInvokeTransaction`
 * with the proof attached. Every failure carries the wallet's own words.
 */
export async function strk20Submit(w: InjectedWallet, actions: Strk20Action[]): Promise<{ txHash: string; route: "invoke" | "prepare+add" }> {
  try {
    return { txHash: await strk20Invoke(w, actions), route: "invoke" };
  } catch (err) {
    const kind = classifyWalletError(err);
    // UNKNOWN_ERROR (163) is the wallet's catch-all — its one-shot path gave
    // up without saying why. The two-step route goes through different wallet
    // code (assemble + prove, then a plain signed invoke), so try it once
    // before giving up; a wallet that actually submitted would refuse the
    // second attempt (spent notes), so this cannot double-pay.
    if (kind !== "UNSUPPORTED" && kind !== "UNKNOWN") throw new WalletRequestError("wallet_strk20InvokeTransaction", kind, errorText(err), w.name);
    const first = errorText(err);
    let cap: CallAndProof;
    try {
      cap = await strk20Prepare(w, actions);
    } catch (err2) {
      const kind2 = classifyWalletError(err2);
      throw new WalletRequestError(
        "wallet_strk20InvokeTransaction",
        kind === "UNKNOWN" && kind2 === "UNKNOWN" ? "UNKNOWN" : kind2 === "UNSUPPORTED" ? "UNSUPPORTED" : kind2,
        kind2 === "UNSUPPORTED" || kind === "UNKNOWN" ? `${first} · and wallet_strk20PrepareInvoke: ${errorText(err2)}` : `(fallback wallet_strk20PrepareInvoke) ${errorText(err2)}`,
        w.name
      );
    }
    try {
      return { txHash: await addInvokeWithProof(w, cap), route: "prepare+add" };
    } catch (err3) {
      throw new WalletRequestError("wallet_addInvokeTransaction (with proof)", classifyWalletError(err3), errorText(err3), w.name);
    }
  }
}

/**
 * Which part of an action list does the wallet choke on? Simulate-only
 * prepares (no proof, nothing spent, though the wallet may prompt) of the
 * full list and of each half. The wallet's own words per shape are the
 * answer to "UNKNOWN_ERROR".
 */
export async function isolateActions(w: InjectedWallet, actions: Strk20Action[]): Promise<DiagnosticLine[]> {
  const transfers = actions.filter((a) => a.type === "transfer");
  const invokes = actions.filter((a) => a.type === "invoke");
  const shapes: { method: string; actions: Strk20Action[] }[] = [{ method: `all ${actions.length} actions`, actions }];
  if (transfers.length && invokes.length) {
    shapes.push({ method: `${transfers.length} transfer${transfers.length > 1 ? "s" : ""} only`, actions: transfers });
    if (transfers[0]) shapes.push({ method: "invoke only (+ a zero note to self)", actions: [{ type: "transfer", token: transfers[0].token, amount: "0x0", recipient: "self" }, ...invokes] });
  }
  const out: DiagnosticLine[] = [];
  for (const sh of shapes) {
    try {
      const r = await strk20Prepare(w, sh.actions, true);
      out.push({ method: sh.method, ok: true, detail: `accepted — call ${r.call.entry_point} with ${r.call.calldata.length} felts` });
    } catch (err) {
      out.push({ method: sh.method, ok: false, detail: `${classifyWalletError(err)} — ${errorText(err)}` });
    }
  }
  return out;
}

export interface DiagnosticLine {
  method: string;
  ok: boolean;
  detail: string;
}

/**
 * What does this wallet actually answer? Read-only and simulate-only calls,
 * so nothing is signed or spent — though a wallet may still prompt. The
 * raw answers are the point: this is what to paste into an issue.
 */
export async function diagnoseStrk20(w: InjectedWallet, sample: Strk20Action[]): Promise<DiagnosticLine[]> {
  const out: DiagnosticLine[] = [];
  const run = async (method: string, call: () => Promise<unknown>, render: (r: any) => string) => {
    try {
      out.push({ method, ok: true, detail: render(await call()) });
    } catch (err) {
      out.push({ method, ok: false, detail: `${classifyWalletError(err)} — ${errorText(err)}` });
    }
  };
  await run("wallet_supportedWalletApi", () => w.request({ type: "wallet_supportedWalletApi" }), (r) => `versions ${JSON.stringify(r)}`);
  await run("wallet_supportedSpecs", () => w.request({ type: "wallet_supportedSpecs" }), (r) => `specs ${JSON.stringify(r)}`);
  await run("wallet_strk20Balances", () => w.request({ type: "wallet_strk20Balances", params: { tokens: [] } }), (r) => `${JSON.stringify(r)}`);
  await run(
    "wallet_strk20PrepareInvoke (simulate)",
    () => w.request({ type: "wallet_strk20PrepareInvoke", params: { actions: sample, simulate: true } }),
    (r) => `call to ${r?.call?.contract_address ?? "?"} · ${r?.call?.entry_point ?? "?"} · ${r?.call?.calldata?.length ?? 0} felts (empty proof, as expected in simulate)`
  );
  return out;
}

export async function strk20Balances(w: InjectedWallet, tokens: string[]): Promise<{ token: string; balance: bigint }[]> {
  const entries: { token: string; balance: string }[] = await w.request({ type: "wallet_strk20Balances", params: { tokens } });
  return (entries ?? []).map((e) => ({ token: e.token, balance: BigInt(e.balance) }));
}

const hex = (v: bigint) => "0x" + v.toString(16);

/**
 * The action list for one of our transactions: the value moves first, the
 * helper call last (the pool runs invoke actions after the notes settle).
 * A message-only send carries a carrier note to self — the WriteOnce replay
 * protection the pool demands (M0 § S1); `carrierAmount` is 0 unless the
 * wallet refuses zero, then 1 wei.
 */
export function buildActions(
  transfers: { token: string; recipient: string; amount: bigint }[],
  invoke: { contract: string; calldata: string[] } | null,
  carrier: { token: string; self: string; amount: bigint } | null
): Strk20Action[] {
  const actions: Strk20Action[] = transfers.map((t) => ({ type: "transfer", token: t.token, amount: hex(t.amount), recipient: t.recipient }));
  if (actions.length === 0 && carrier) actions.push({ type: "transfer", token: carrier.token, amount: hex(carrier.amount), recipient: carrier.self });
  if (invoke) actions.push({ type: "invoke", contract: invoke.contract, calldata: invoke.calldata });
  if (actions.length === 0) throw new Error("nothing to submit");
  return actions;
}
