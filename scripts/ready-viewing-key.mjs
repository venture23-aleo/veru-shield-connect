#!/usr/bin/env node
// Recover the STRK20 viewing key for a Ready (Argent X) account and verify it
// against the key registered on-chain in the privacy pool.
//
// WHAT READY ACTUALLY DOES (reverse-engineered from the v5.33.9 extension bundle):
//   - Ledger accounts: the viewing key is derived LOCALLY by signing a fixed
//     typed-data message and grinding the signature through Poseidon
//     (`deriveViewingKeyFromSignature`). Reproducible here from the account key.
//   - Normal seed accounts: the viewing key is NOT derived from the seed. The
//     wallet fetches it, HPKE-encrypted, from Argent's backend
//     (cloud.argent-api.com/v1/privacy/.../privacyPoolViewingKey). It is
//     server-custodied and CANNOT be reproduced offline from the seed. The
//     seed-based HD path exists in the code but its derivation-path constant is
//     not compiled into the shipped build.
//
// So this script is a best-effort recoverer: it computes every candidate a
// local party CAN compute and checks each against the chain. If your account is
// a normal Ready seed account, expect NO candidate to match — that is the proof
// the key lives on Argent's backend, not in your seed.
//
// Usage (all inputs via env; nothing is printed except the final key):
//   ACCOUNT_ADDRESS=0x...            (required) the account's address
//   POOL_ADDRESS=0x...               (optional) defaults to Sepolia STRK20 pool
//   RPC_URL=https://...              (optional) defaults to a public Sepolia RPC
//   ACCOUNT_PRIVATE_KEY=0x...        (optional) stark private key -> signature + SDK candidates
//   SEED=0x... | MNEMONIC="w1 w2..." (optional) BIP39 seed/mnemonic -> HD candidates
//   PASSPHRASE="..."                 (optional) -> SDK passphrase candidate
//
//   node scripts/ready-viewing-key.mjs
//
// Reads keys from the environment only. It never writes them anywhere and
// prints only the recovered viewing key (or "no match").

import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const sha256 = (buf) => createHash("sha256").update(buf).digest();

// The workspace root has no top-level `starknet`/`@scure` symlinks; resolve the
// pinned copies straight out of the pnpm store so this runs from anywhere.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PNPM = join(ROOT, "node_modules", ".pnpm");
function fromStore(prefix, sub) {
  const dir = readdirSync(PNPM).find((d) => d.startsWith(prefix));
  if (!dir) throw new Error(`cannot find ${prefix}* in ${PNPM} — run pnpm install`);
  return pathToFileURL(join(PNPM, dir, "node_modules", sub)).href;
}
const starknet = await import(fromStore("starknet@", "starknet/dist/index.js"));
const { HDKey } = await import(fromStore("@scure+bip32@", "@scure/bip32/lib/esm/index.js"));
const bip39 = await import(fromStore("@scure+bip39@", "@scure/bip39/index.js"));
const { ec, num, hash, typedData: td, RpcProvider, TypedDataRevision } = starknet;

const CURVE_N = ec.starkCurve.CURVE.n;
const HALF_ORDER = CURVE_N >> 1n; // == Ready's MAX_VIEWING_KEY (t2 = starkCurve.CURVE.n / 2n)
const poseidon = ec.starkCurve.poseidonHashMany;

const REQ = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing required env ${k}`);
  return v;
};
const OPT = (k) => process.env[k] || undefined;

const ACCOUNT = num.toHex(num.toBigInt(REQ("ACCOUNT_ADDRESS")));
const POOL = num.toHex(
  num.toBigInt(OPT("POOL_ADDRESS") ?? "0x254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91")
);
const RPC = OPT("RPC_URL") ?? "https://starknet-sepolia.drpc.org";

/** Reduce any scalar to a canonical viewing key (non-zero, < HALF_ORDER). */
function canonical(key) {
  let s = ((key % CURVE_N) + CURVE_N) % CURVE_N;
  if (s >= HALF_ORDER) s = CURVE_N - s;
  return s === 0n || s >= HALF_ORDER ? 1n : s;
}

// --- Candidate 1: Ready's deriveViewingKeyFromSignature (Ledger path) ---------
// Sign the "ready-wallet/privacy-viewing-key/v1" typed data with the account
// key, then grind: vk = first Poseidon([r, s, i]) below the field cap, mod
// half-order + 1. Exactly mirrors the bundle's `u()`.
function fromSignature(privHex) {
  const message = {
    types: {
      StarknetDomain: [
        { name: "name", type: "shortstring" },
        { name: "version", type: "shortstring" },
        { name: "chainId", type: "shortstring" },
        { name: "revision", type: "shortstring" },
      ],
      PrivacyViewingKey: [
        { name: "purpose", type: "string" },
        { name: "account", type: "ContractAddress" },
      ],
    },
    primaryType: "PrivacyViewingKey",
    // NB: the bundle hardcodes SN_MAIN in the domain even for the Ledger builder.
    domain: { name: "Ready Privacy", version: "1", chainId: "SN_MAIN", revision: TypedDataRevision.ACTIVE },
    message: { purpose: "ready-wallet/privacy-viewing-key/v1", account: ACCOUNT },
  };
  const msgHash = td.getMessageHash(message, ACCOUNT);
  const sig = ec.starkCurve.sign(msgHash, num.toHex(num.toBigInt(privHex)));
  const r = BigInt(sig.r), s = BigInt(sig.s);
  const FP = ec.starkCurve.CURVE.Fp.ORDER;
  const cap = FP - (FP % HALF_ORDER);
  for (let i = 0n; i <= 100000n; i++) {
    const h = num.toBigInt(hash.computePoseidonHashOnElements([r, s, i]));
    if (h < cap) return canonical((h % HALF_ORDER) + 1n);
  }
  return null;
}

// --- Candidate 2: Ready's grindViewingKey over an HD child key (seed path) ----
// grind: vk = first sha256(childPriv || varint(i)) below 2^256-cap, mod
// half-order + 1. Mirrors the bundle's `o()`; child from BIP32 at a path.
function grindSeed(childPrivBytes) {
  const cap = (1n << 256n) - ((1n << 256n) % HALF_ORDER);
  for (let i = 0; i <= 100000; i++) {
    const suffix = varBytesBE(BigInt(i));
    const digest = sha256(Buffer.concat([Buffer.from(childPrivBytes), suffix]));
    const h = BigInt("0x" + digest.toString("hex"));
    if (h < cap) return canonical((h % HALF_ORDER) + 1n);
  }
  return null;
}
function varBytesBE(n) {
  if (n === 0n) return Buffer.from([0]);
  const out = [];
  while (n > 0n) { out.unshift(Number(n & 0xffn)); n >>= 8n; }
  return Buffer.from(out);
}

// --- Candidate 3: the STRK20 client SDK's deriveViewingKey(passphrase, addr) --
function fromPassphrase(passphrase, address) {
  const salt = num.toBigInt(address);
  const bytes = new TextEncoder().encode(passphrase);
  const felts = [BigInt(bytes.length)];
  for (let o = 0; o < bytes.length; o += 31) {
    let limb = 0n;
    for (const b of bytes.subarray(o, o + 31)) limb = (limb << 8n) | BigInt(b);
    felts.push(limb);
  }
  let key = poseidon([...felts, salt]);
  for (let r = 1; r < 1000; r++) key = poseidon([key, salt]);
  return canonical(key);
}

async function registeredKey() {
  const provider = new RpcProvider({ nodeUrl: RPC });
  const res = await provider.callContract({ contractAddress: POOL, entrypoint: "get_public_key", calldata: [ACCOUNT] });
  return num.toBigInt(res[0]);
}

function candidates() {
  const out = [];
  const priv = OPT("ACCOUNT_PRIVATE_KEY");
  if (priv) {
    try { const vk = fromSignature(priv); if (vk) out.push(["signature (Ledger-style)", vk]); } catch (e) { out.push(["signature (failed)", null, String(e)]); }
  }
  const pass = OPT("PASSPHRASE");
  if (pass) out.push(["SDK passphrase", fromPassphrase(pass, ACCOUNT)]);

  const seedHex = OPT("SEED");
  const mnemonic = OPT("MNEMONIC");
  let seed;
  if (seedHex) seed = Buffer.from(num.toHex(num.toBigInt(seedHex)).slice(2).padStart(128, "0"), "hex");
  else if (mnemonic) seed = Buffer.from(bip39.mnemonicToSeedSync(mnemonic.trim()));
  if (seed) {
    const master = HDKey.fromMasterSeed(seed);
    // Try the common Starknet derivation paths (EIP-2645 and Argent's own),
    // at indices 0 and 1, since the exact standard path isn't in the build.
    const paths = [
      "m/2645'/1195502025'/1148870696'/0'/0'",
      "m/2645'/1195502025'/1148870696'/1'/0'",
      "m/44'/9004'/0'/0/0",
      "m/44'/9004'/1'/0/0",
      "m/43'/9004'/0'/0'/0'",
      "m/43'/9004'/1581'/0'/0'",
    ];
    for (const p of paths) {
      try {
        const child = master.derive(p);
        if (child.privateKey) out.push([`seed HD ${p}`, grindSeed(child.privateKey)]);
      } catch { /* skip bad path */ }
    }
  }
  return out;
}

(async () => {
  const reg = await registeredKey();
  if (reg === 0n) {
    console.error(`account ${ACCOUNT} has NO viewing key registered on the pool at ${POOL}.`);
    console.error("Nothing to recover: it hasn't shielded / registered yet.");
    process.exit(2);
  }
  const cands = candidates();
  if (cands.length === 0) {
    console.error("no inputs given. Provide ACCOUNT_PRIVATE_KEY and/or SEED/MNEMONIC (and optionally PASSPHRASE).");
    process.exit(2);
  }
  let match = null;
  for (const [label, vk, err] of cands) {
    if (!vk) { console.error(`  ${label}: ${err ?? "no candidate"}`); continue; }
    const pub = num.toBigInt(ec.starkCurve.getStarkKey(num.toHex(vk)));
    const ok = pub === reg;
    console.error(`  ${label}: ${ok ? "MATCH" : "no match"}`);
    if (ok) match = vk;
  }
  console.error("");
  if (match) {
    console.error("Recovered viewing key (paste into Settings -> Pool -> Viewing key):");
    console.log(num.toHex(match));
    process.exit(0);
  }
  console.error(`No local candidate matched the on-chain key for ${ACCOUNT}.`);
  console.error("For a normal Ready seed account this is expected: the viewing key is");
  console.error("held by Argent's backend and is not derivable offline from the seed.");
  process.exit(1);
})().catch((e) => { console.error("error:", e.message); process.exit(3); });
