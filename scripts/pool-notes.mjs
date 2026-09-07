#!/usr/bin/env node
// Read-only: scan the STRK20 pool for notes and incoming channels belonging to
// an account, using its viewing key. No prover, no signing, no writes.
//
//   ACCOUNT_ADDRESS=0x...   (required)
//   POOL_ADDRESS=0x...      (optional, defaults to Sepolia STRK20 pool)
//   RPC_URL=https://...     (optional)
//   VIEWING_KEY=0x...       (optional; else read ~/.strk20-msg/sepolia-viewing-key)
//
//   node scripts/pool-notes.mjs

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

function findCheckout() {
  if (process.env.STARKNET_PRIVACY) return process.env.STARKNET_PRIVACY;
  const base = join(homedir(), ".cache/scarb/registry/git/checkouts");
  for (const dir of existsSync(base) ? readdirSync(base) : []) {
    if (!dir.startsWith("starknet-privacy-")) continue;
    const c = join(base, dir, "bc75e4b");
    if (existsSync(join(c, "sdk/dist/index.js"))) return c;
  }
  throw new Error("no built starknet-privacy checkout; set STARKNET_PRIVACY");
}

const RPC_URL = process.env.RPC_URL ?? "https://starknet-sepolia.drpc.org";
const POOL = process.env.POOL_ADDRESS ?? "0x254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";
const address = process.env.ACCOUNT_ADDRESS;
if (!address) { console.error("set ACCOUNT_ADDRESS"); process.exit(2); }

let viewingKey = process.env.VIEWING_KEY;
if (!viewingKey) {
  const f = join(homedir(), ".strk20-msg/sepolia-viewing-key");
  if (existsSync(f)) viewingKey = readFileSync(f, "utf8").trim();
}
if (!viewingKey) { console.error("no VIEWING_KEY and no ~/.strk20-msg/sepolia-viewing-key"); process.exit(2); }

const P = findCheckout();
const { Contract, RpcProvider, num } = await import(pathToFileURL(`${P}/sdk/node_modules/starknet/dist/index.js`).href);
const { PrivacyPoolABI } = await import(pathToFileURL(`${P}/sdk/dist/internal/abi.js`).href);
const { ContractDiscoveryProvider } = await import(pathToFileURL(`${P}/sdk/dist/internal/contract-discovery.js`).href);

const provider = new RpcProvider({ nodeUrl: RPC_URL });
const pool = new Contract({ abi: PrivacyPoolABI, address: POOL, providerOrAccount: provider }).typedv2(PrivacyPoolABI);

const reg = BigInt(await pool.get_public_key(num.toBigInt(address)));
console.log(`account   ${address}`);
console.log(`pool      ${POOL}`);
console.log(`registered ${reg !== 0n ? "YES (viewing pubkey 0x" + reg.toString(16) + ")" : "NO"}`);
if (reg === 0n) { console.log("Not registered — nothing to scan."); process.exit(0); }

const disc = new ContractDiscoveryProvider(pool);
const vk = num.toBigInt(viewingKey);

const head = await provider.getBlockNumber();
console.log(`head block ${head}\n`);

// The SDK returns map-backed collections: { map: { id: value, ... } }.
const values = (coll) => (coll && coll.map ? Object.values(coll.map) : Array.isArray(coll) ? coll : []);

// Notes owned by this account (incoming private value).
const notes = await disc.discoverNotes(num.toBigInt(address), vk, {});
const list = values(notes?.notes);
console.log(`=== notes: ${list.length} ===`);
let spendable = 0n, maturing = 0n;
for (const n of list) {
  const amt = BigInt(n.amount ?? n.value ?? 0n);
  const created = Number(n.blockNumber ?? n.createdAtBlock ?? 0);
  const mature = created > 0 ? created + 10 : 0;
  const ready = mature && head >= mature;
  if (BigInt(amt) > 0n) (ready ? (spendable += amt) : (maturing += amt));
  const tok = (n.token ?? n.tokenAddress ?? "?").toString();
  console.log(`  amount ${amt}  token ${tok.slice(0, 12)}…  created@${created || "?"}  ${amt === 0n ? "(carrier/zero)" : ready ? "spendable" : "maturing (" + (mature - head) + " blocks)"}`);
}
console.log(`  spendable total: ${spendable}  maturing: ${maturing}\n`);

// Incoming lanes: channels others opened TO this account (from the notes cursor),
// plus this account's own channel list.
const incoming = values(notes?.cursor?.incomingChannels);
console.log(`=== incoming channels (senders who opened a lane to you): ${incoming.length} ===`);
for (const c of incoming) {
  const peer = (c.peer ?? c.counterparty ?? c.sender ?? c.senderAddress ?? "?").toString();
  console.log(`  from ${peer.slice(0, 16)}…`);
}

const own = await disc.discoverChannels(num.toBigInt(address), vk, [], {});
const ownList = values(own?.channels);
console.log(`\n=== your own channels: ${ownList.length} ===`);
for (const c of ownList) {
  const peer = (c.peer ?? c.recipient ?? c.counterparty ?? "?").toString();
  console.log(`  to ${peer.slice(0, 16)}…`);
}
