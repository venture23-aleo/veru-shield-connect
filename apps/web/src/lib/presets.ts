/**
 * Wallet mode against mainnet: the live STRK20 pool (hackathon Day 0 guide)
 * and Cartridge's mainnet RPC (spec 0.10.2, the one starknet.js 10.5 accepts;
 * the guide's lava endpoint is discontinued). The helper is empty until the
 * message_anonymizer is deployed on mainnet with `pool` = this pool — fill it
 * from DEPLOYMENTS.md then.
 */
export const MAINNET_WALLET_PRESET = {
  label: "Mainnet · wallet mode (STRK20 pool)",
  rpcUrl: "https://api.cartridge.gg/x/starknet/mainnet/rpc/v0_10",
  helperAddress: "",
  poolAddress: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
  carrierToken: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  chainId: "0x534e5f4d41494e",
};

/** Wallet mode against Sepolia: the pool-mode helper and the Sepolia pool, over the v0_10 RPC. */
export const SEPOLIA_WALLET_PRESET = {
  label: "Sepolia · wallet mode (STRK20 pool)",
  rpcUrl: "https://api.cartridge.gg/x/starknet/sepolia/rpc/v0_10",
  helperAddress: "0x016f77a566ed28f2945e315f2de971b8f3e83a03b93340e8927a311277f6e0b6",
  poolAddress: "0x254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91",
  carrierToken: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  chainId: "0x534e5f5345504f4c4941",
};

/**
 * Connection presets and the pre-save probe. Preset values mirror
 * DEPLOYMENTS.md — update both in the same commit as any redeployment.
 */

export interface ConnectionPreset {
  label: string;
  rpcUrl: string;
  helperAddress: string;
  /** Public — safe to prefill. The private key is never part of a preset. */
  accountAddress: string;
}

// DIRECT mode needs the helper whose `pool` is YOUR account — that is the
// Phase-A helper below. The pool-mode helper (Phase B, pool = the real STRK20
// pool, 0x016f77a5…f6e0b6) would reject a direct write with CALLER_NOT_POOL;
// it becomes relevant only when this app grows a `pool` backend (16 § W8).
export const SEPOLIA_PRESET: ConnectionPreset = {
  label: "Sepolia · project deployment",
  rpcUrl: "https://api.cartridge.gg/x/starknet/sepolia",
  helperAddress: "0x06409a4a8c1962bbfd6b04ea9ab1f745be8e7bceddc61f4e322dcbc7781ae032",
  accountAddress: "0x03ab7fda95f39c9b5be0572bd2a115db1bff1db87c88fbcff872473f1f2afac4",
};

/** Pool mode against Sepolia — the Phase-B helper, pinned to the real STRK20 pool. */
export interface PoolPreset {
  label: string;
  rpcUrl: string;
  helperAddress: string;
  poolAddress: string;
  carrierToken: string;
}

export const SEPOLIA_POOL_PRESET: PoolPreset = {
  label: "Sepolia · pool mode (needs a proving URL)",
  rpcUrl: "https://api.cartridge.gg/x/starknet/sepolia",
  helperAddress: "0x016f77a566ed28f2945e315f2de971b8f3e83a03b93340e8927a311277f6e0b6",
  poolAddress: "0x254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91",
  carrierToken: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
};

/**
 * The block `scripts/pool-devnet.mjs` prints: one paste fills every pool-mode
 * field for a local, mock-proved run against the real pool contract.
 */
export interface DevnetEnv {
  "strk20msg-devnet": 1;
  rpcUrl: string;
  helperAddress: string;
  poolAddress: string;
  carrierToken: string;
  accounts: { name: string; address: string; privateKey: string; viewingKey: string }[];
}

export function parseDevnetEnv(text: string): DevnetEnv | null {
  try {
    const raw = JSON.parse(text) as Partial<DevnetEnv>;
    if (
      raw["strk20msg-devnet"] === 1 &&
      typeof raw.rpcUrl === "string" &&
      isHex(raw.helperAddress ?? "") &&
      isHex(raw.poolAddress ?? "") &&
      isHex(raw.carrierToken ?? "") &&
      Array.isArray(raw.accounts) &&
      raw.accounts.length > 0 &&
      raw.accounts.every((a) => isHex(a.address) && isHex(a.privateKey) && isHex(a.viewingKey) && !!a.name)
    ) {
      return raw as DevnetEnv;
    }
  } catch {
    /* not a devnet block */
  }
  return null;
}

export const isHex = (v: string): boolean => /^0x[0-9a-fA-F]+$/.test(v.trim());

/**
 * Accepts either an sncast accounts file (~/.starknet_accounts/…json) or this
 * app's own backup JSON, and extracts { accountAddress, privateKey? }. When the
 * file holds several accounts, the one matching `preferAddress` wins (so a
 * preset-filled address keeps its OWN key), otherwise the first — and the
 * source names which account was taken, because address/key mismatches fail
 * later as an opaque "invalid signature".
 */
export interface SncastAccount {
  name: string;
  address: string;
  privateKey: string;
}

/** All accounts in an sncast file, for the "who are you?" chooser. */
export function listSncastAccounts(text: string): SncastAccount[] {
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    const found: SncastAccount[] = [];
    for (const network of Object.values(obj)) {
      if (typeof network !== "object" || network === null) continue;
      for (const [name, acct] of Object.entries(network as Record<string, unknown>)) {
        const a = acct as { address?: string; private_key?: string };
        if (typeof a?.address === "string" && typeof a?.private_key === "string") {
          found.push({ name, address: a.address, privateKey: a.private_key });
        }
      }
    }
    return found;
  } catch {
    return [];
  }
}

export function parseCredentialsPaste(
  text: string,
  preferAddress?: string
): { accountAddress: string; privateKey?: string; source: string } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // a bare private key or address is also acceptable
    const t = text.trim();
    if (isHex(t) && t.length > 50) return { accountAddress: "", privateKey: t, source: "raw key" };
    return null;
  }
  const obj = raw as Record<string, unknown>;

  // App backup: { version: 1, viewingKey, accountAddress, ... }
  if (obj.version === 1 && typeof obj.accountAddress === "string") {
    return { accountAddress: obj.accountAddress, source: "app backup" };
  }

  // sncast: { "<network>": { "<name>": { address, private_key, ... } } }
  const found: { name: string; address: string; privateKey: string }[] = [];
  for (const network of Object.values(obj)) {
    if (typeof network !== "object" || network === null) continue;
    for (const [name, acct] of Object.entries(network as Record<string, unknown>)) {
      const a = acct as { address?: string; private_key?: string };
      if (typeof a?.address === "string" && typeof a?.private_key === "string") {
        found.push({ name, address: a.address, privateKey: a.private_key });
      }
    }
  }
  if (found.length === 0) return null;
  const preferred =
    (preferAddress &&
      isHex(preferAddress) &&
      found.find((f) => BigInt(f.address) === BigInt(preferAddress))) ||
    found[0]!;
  return {
    accountAddress: preferred.address,
    privateKey: preferred.privateKey,
    source: `sncast account “${preferred.name}”${found.length > 1 ? ` (file holds ${found.length})` : ""}`,
  };
}

const POOL_SELECTOR = "0x35b2940ca10a9581573918a0d9ed2422f97cc9196f63510c77f5a0ed5393cfd";
const GET_PUBLIC_KEY_SELECTOR = "0x1a35984e05126dbecb7c3bb9929e7dd9106d460c59b1633739a5c733a5fb13b";

export interface ProbeResult {
  ok: boolean;
  detail: string;
}

/**
 * Verify RPC reachability, that a MessageAnonymizer lives at the helper
 * address, that its pool is the given account — and, when a key is provided,
 * that the key actually CONTROLS that account (derived public key vs the
 * account contract's get_public_key), so an address/key mix-up surfaces here
 * instead of as "Account: invalid signature" at send time.
 */
export async function probeConnection(
  rpcUrl: string,
  helperAddress: string,
  accountAddress: string,
  accountKey?: string
): Promise<ProbeResult> {
  let res: { result?: string[]; error?: { message?: string } };
  try {
    const r = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "starknet_call",
        params: [
          { contract_address: helperAddress, entry_point_selector: POOL_SELECTOR, calldata: [] },
          "latest",
        ],
      }),
    });
    res = await r.json();
  } catch (e) {
    return { ok: false, detail: `RPC unreachable: ${e instanceof Error ? e.message : e}` };
  }
  if (res.error || !res.result?.[0]) {
    return {
      ok: false,
      detail: `helper not found at that address (${res.error?.message ?? "no pool() response"})`,
    };
  }
  const pool = BigInt(res.result[0]);
  if (accountAddress && isHex(accountAddress) && pool !== BigInt(accountAddress)) {
    return {
      ok: false,
      detail:
        `helper found, but its pool is 0x${pool.toString(16).slice(0, 8)}… — not your account. ` +
        "Direct mode can only write through the helper's registered pool account.",
    };
  }
  if (accountKey && isHex(accountKey) && isHex(accountAddress)) {
    try {
      const [{ ec }, keyRes] = await Promise.all([
        import("starknet"),
        fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "starknet_call",
            params: [
              { contract_address: accountAddress, entry_point_selector: GET_PUBLIC_KEY_SELECTOR, calldata: [] },
              "latest",
            ],
          }),
        }).then((r) => r.json() as Promise<{ result?: string[] }>),
      ]);
      const onChain = keyRes.result?.[0];
      if (onChain) {
        const derived = BigInt(ec.starkCurve.getStarkKey(accountKey));
        if (derived !== BigInt(onChain)) {
          return {
            ok: false,
            detail:
              "this key belongs to a different account than the address above — sends would " +
              "fail with “invalid signature”. Fix: paste the sncast file (it picks the key " +
              "matching this address). If you're trying to BE a different person in this " +
              "browser, keep this account and key as they are and put the other address in " +
              "“Messaging identity” below instead — the signer and your identity are separate.",
          };
        }
        return { ok: true, detail: "helper found · pool() matches · key controls the account · ready to send" };
      }
    } catch {
      /* key check is best-effort; fall through to the basic OK */
    }
  }
  return { ok: true, detail: "helper found · pool() matches your account · ready to send" };
}

/**
 * Does this private key control this account? OpenZeppelin/Argent/Braavos
 * accounts expose their signer's public key; compare with getStarkKey(key).
 * The pool rejects a proven transaction signed by the wrong key with a bare
 * INVALID_SIGNATURE, deep in the failure bar — better to refuse at Save.
 */
export async function probeSigner(
  rpcUrl: string,
  accountAddress: string,
  privateKey: string
): Promise<{ ok: boolean; detail: string }> {
  if (!isHex(accountAddress) || !isHex(privateKey)) return { ok: false, detail: "address and key must be 0x-hex" };
  const { RpcProvider, ec } = await import("starknet");
  let mine: bigint;
  try {
    mine = BigInt(ec.starkCurve.getStarkKey(privateKey.trim()));
  } catch {
    return { ok: false, detail: "that private key is not a valid STARK-curve scalar" };
  }
  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  for (const entrypoint of ["get_public_key", "getPublicKey", "get_owner"]) {
    try {
      const res = await provider.callContract({ contractAddress: accountAddress, entrypoint, calldata: [] });
      const onChain = BigInt(res[0] ?? "0x0");
      if (onChain === mine) return { ok: true, detail: "the key controls this account" };
      return {
        ok: false,
        detail: `this key does NOT control ${accountAddress.slice(0, 10)}… (its signer is 0x${onChain.toString(16).slice(0, 10)}…) — the pool would reject every send with INVALID_SIGNATURE`,
      };
    } catch {
      /* try the next accessor */
    }
  }
  return { ok: false, detail: "could not read the account's signer key (unknown account class) — proceed with care" };
}

const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

/** STRK balance, allowance to the pool, and the pool's fee — what a send costs against what you have. */
export async function probeBalance(
  rpcUrl: string,
  accountAddress: string,
  poolAddress: string
): Promise<{ strk: number; allowance: number; fee: number }> {
  const { RpcProvider } = await import("starknet");
  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  const u256 = (r: string[]) => Number((BigInt(r[0] ?? "0x0") + (BigInt(r[1] ?? "0x0") << 128n)) / 10n ** 15n) / 1000;
  const [bal, allow, fee] = await Promise.all([
    provider.callContract({ contractAddress: STRK, entrypoint: "balanceOf", calldata: [accountAddress] }),
    provider.callContract({ contractAddress: STRK, entrypoint: "allowance", calldata: [accountAddress, poolAddress] }),
    provider.callContract({ contractAddress: poolAddress, entrypoint: "get_fee_amount", calldata: [] }),
  ]);
  return { strk: u256(bal), allowance: u256(allow), fee: Number(BigInt(fee[0] ?? "0x0") / 10n ** 15n) / 1000 };
}
