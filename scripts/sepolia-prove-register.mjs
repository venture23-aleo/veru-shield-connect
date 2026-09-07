#!/usr/bin/env node
/**
 * Sepolia DRY RUN: prove a registration (SetViewingKey) for an account through a
 * self-hosted transaction prover — and do NOT submit it.
 *
 * Validates the whole live pipeline at zero cost: SDK → prover (re-executes
 * against a finalized Sepolia block, runs the virtual OS, returns a Stwo
 * proof + proof facts) → a submittable call. Submitting is a separate,
 * deliberate step (`--submit`): registration binds the viewing key to the
 * account permanently.
 *
 *   node scripts/sepolia-prove-register.mjs [--submit]
 *
 * Env: STRK20_MSG_PRIVATE_KEY (account key), ACCOUNT_ADDRESS, optional
 *      PROVING_URL (default http://127.0.0.1:3000), RPC_URL (Cartridge v0_10),
 *      STARKNET_PRIVACY (else the Scarb-vendored checkout).
 * The viewing key is generated once and kept in ~/.strk20-msg/sepolia-viewing-key (0600).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";

const POOL = "0x254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const RPC_URL = process.env.RPC_URL ?? "https://api.cartridge.gg/x/starknet/sepolia/rpc/v0_10";
const PROVING_URL = process.env.PROVING_URL ?? "http://127.0.0.1:3000";
const SUBMIT = process.argv.includes("--submit");

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

// --deposit=N or --deposit N, in wei (1 STRK = 1000000000000000000).
const di = process.argv.findIndex((a) => a === "--deposit" || a.startsWith("--deposit="));
const rawDeposit = di < 0 ? null : process.argv[di].includes("=") ? process.argv[di].split("=")[1] : process.argv[di + 1];
if (di >= 0 && !/^[0-9]+$/.test(rawDeposit ?? "")) {
  console.error(`--deposit needs an integer amount in wei, e.g. --deposit=10000000000000000000 (10 STRK); got: ${rawDeposit ?? "(nothing)"}`);
  process.exit(2);
}
const DEPOSIT = rawDeposit ? BigInt(rawDeposit) : 0n;
if (di >= 0 && DEPOSIT === 0n) {
  console.error("--deposit amount must be greater than zero");
  process.exit(2);
}

const address = process.env.ACCOUNT_ADDRESS;
const pk = process.env.STRK20_MSG_PRIVATE_KEY;
if (!address || !pk) {
  console.error("set ACCOUNT_ADDRESS and STRK20_MSG_PRIVATE_KEY (testnet account only)");
  process.exit(2);
}

// The viewing key IS the identity once registered: generate once, keep forever.
const vkDir = join(homedir(), ".strk20-msg");
// Each account needs its OWN viewing key. Override the file per account with
// VIEWING_KEY_FILE (an absolute path or a bare name under ~/.strk20-msg), so a
// second account does not silently reuse the first account's key.
const vkOverride = process.env.VIEWING_KEY_FILE;
const vkFile = vkOverride
  ? (vkOverride.includes("/") ? vkOverride : join(vkDir, vkOverride))
  : join(vkDir, "sepolia-viewing-key");
let viewingKey;
if (existsSync(vkFile)) {
  viewingKey = readFileSync(vkFile, "utf8").trim();
  console.log(`viewing key: reusing ${vkFile}`);
} else {
  mkdirSync(vkDir, { recursive: true, mode: 0o700 });
  viewingKey = "0x" + randomBytes(31).toString("hex"); // < STARK prime, well inside MAX_VIEWING_KEY
  writeFileSync(vkFile, viewingKey + "\n", { mode: 0o600 });
  console.log(`viewing key: generated and saved to ${vkFile} (0600) — back it up; it is your inbox`);
}

const P = findCheckout();
// starknet.js from the SDK's own node_modules: the root workspace has no copy,
// and one instance shared with the SDK avoids cross-copy type mismatches.
const { Account, Contract, RpcProvider } = await import(pathToFileURL(`${P}/sdk/node_modules/starknet/dist/index.js`).href);
const sdk = await import(pathToFileURL(`${P}/sdk/dist/index.js`).href);
const { PrivacyPoolABI } = await import(pathToFileURL(`${P}/sdk/dist/internal/abi.js`).href);
const { ContractDiscoveryProvider } = await import(pathToFileURL(`${P}/sdk/dist/internal/contract-discovery.js`).href);

const provider = new RpcProvider({ nodeUrl: RPC_URL });
const account = new Account({ provider, address, signer: pk });
const chainId = await provider.getChainId();
const pool = new Contract({ abi: PrivacyPoolABI, address: POOL, providerOrAccount: provider }).typedv2(PrivacyPoolABI);

const already = BigInt(await pool.get_public_key(BigInt(address)));
console.log(`chain ${chainId} · account ${address.slice(0, 12)}… · registered on pool: ${already !== 0n ? "YES (pk " + already.toString(16).slice(0, 10) + "…)" : "no"}`);
if (already !== 0n && DEPOSIT === 0n && !process.argv.includes("--balance")) {
  // SetViewingKey is write-once: registering again reverts (NON_ZERO_VALUE).
  console.log("nothing to do: this account already has a viewing key on the pool (use --deposit=<wei> to shield)");
  process.exit(0);
}
const fee = await pool.get_fee_amount();
console.log(`pool fee: ${Number(fee) / 1e18} STRK per transaction`);

const transfers = sdk.createPrivateTransfers({
  account,
  viewingKeyProvider: { getViewingKey: async () => BigInt(viewingKey) },
  provingProvider: { url: PROVING_URL, chainId, nodeUrl: RPC_URL, ohttp: false, requestTimeoutMs: 600_000 },
  discoveryProvider: new ContractDiscoveryProvider(pool),
  poolContractAddress: POOL,
});

// --balance: what the pool holds for this viewing key — the sum of our notes,
// per token, straight from the pool contract over RPC. This is the "private"
// balance a payment can spend; the wallet's STRK is not it.
if (process.argv.includes("--balance")) {
  const { ContractDiscoveryProvider: CDP } = await import(pathToFileURL(`${P}/sdk/dist/internal/contract-discovery.js`).href);
  const discovery = new CDP(pool);
  const { notes } = await discovery.discoverNotes(BigInt(address), BigInt(viewingKey), {});
  let any = false;
  for (const [token, list] of notes?.entries?.() ?? []) {
    const spendable = list.filter((n) => BigInt(n.amount) > 0n);
    const sum = spendable.reduce((a, n) => a + BigInt(n.amount), 0n);
    const zero = list.length - spendable.length;
    const name = BigInt(token) === BigInt(STRK) ? "STRK" : "0x" + BigInt(token).toString(16).slice(0, 10) + "…";
    console.log(`${name}: ${Number(sum) / 1e18} spendable in ${spendable.length} note(s)` + (zero ? ` (+${zero} zero-amount carrier note(s), unspendable)` : ""));
    any = true;
  }
  if (!any) console.log("no notes in the pool for this viewing key — private balance 0");
  process.exit(0);
}

const head = await provider.getBlockNumber();
const provingBlockId = head - 10; // notes mature 10 blocks; head risks reorgs (D2′)
let callAndProof;
const t0 = Date.now();
if (DEPOSIT > 0n) {
  // Shielding: approve the pool, then a proven Deposit. The pool screens
  // deposits (TransferFrom → screening attestation); without the operator's
  // screener this is expected to fail — at proving, i.e. for free.
  const { CallData } = await import(pathToFileURL(`${P}/sdk/node_modules/starknet/dist/index.js`).href);
  const [lo, hi] = await provider.callContract({ contractAddress: STRK, entrypoint: "allowance", calldata: [address, POOL] });
  if (BigInt(lo) + (BigInt(hi) << 128n) < DEPOSIT) {
    console.log(`approving the pool for ${Number(DEPOSIT) / 1e18} STRK …`);
    const tx = await account.execute([{ contractAddress: STRK, entrypoint: "approve", calldata: CallData.compile([POOL, { low: DEPOSIT, high: 0n }]) }], { tip: 0n });
    await provider.waitForTransaction(tx.transaction_hash);
  }
  console.log(`proving a DEPOSIT of ${Number(DEPOSIT) / 1e18} STRK at block ${provingBlockId} via ${PROVING_URL} …`);
  ({ callAndProof } = await transfers
    .build({ autoRegister: true, autoSetup: true, autoDiscover: { notes: "refresh", channels: "refresh" } })
    .with(STRK)
    .deposit({ amount: DEPOSIT })
    .surplusTo(address)
    .execute({ provingBlockId }));
} else {
  console.log(`proving a registration at block ${provingBlockId} (head ${head}) via ${PROVING_URL} …`);
  ({ callAndProof } = await transfers.build({}).register().execute({ provingBlockId }));
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);
const facts = callAndProof.proof?.proofFacts ?? [];
const proofBytes = JSON.stringify(callAndProof.proof?.data ?? "").length;
console.log(`✓ proved in ${secs} s · proof_facts: ${facts.length} felts · proof payload: ${proofBytes} bytes`);
const calls = Array.isArray(callAndProof.call) ? callAndProof.call : [callAndProof.call];
console.log(`call → ${calls.map((c) => c.contractAddress.slice(0, 12) + "…" + " " + (c.entrypoint ?? "")).join(", ")}`);

const proofDetails = facts.length ? { proofFacts: facts, proof: callAndProof.proof.data } : {};

if (process.argv.includes("--validate")) {
  // Free signature check: estimate WITHOUT skipping __validate__. "invalid
  // signature" here means the node's hash of a proof-carrying tx differs from
  // starknet.js's; EMPTY_PROOF_FACTS means the signature was accepted.
  try {
    await account.estimateInvokeFee(callAndProof.call, { tip: 0n, skipValidate: false, ...proofDetails });
    console.log("✓ validate+estimate passed (unexpected — facts reached the pool?)");
  } catch (err) {
    if (err?.baseError) {
      const b = err.baseError;
      const data = typeof b.data === "string" ? b.data : JSON.stringify(b.data ?? "");
      console.log(`validate result: [${b.code}] ${b.message} — ${data.split("Nested error:").pop().trim().slice(-220)}`);
    } else {
      const msg = String(err?.message ?? err);
      console.log(`validate result (${err?.name ?? "error"}): ${msg.slice(0, 260).replace(/\s+/g, " ")}`);
    }
  }
}

if (process.argv.includes("--estimate")) {
  // Fee estimation sends the full proof-carrying transaction shape to the RPC
  // without submitting — exactly what a client does before execute().
  try {
    const est = await account.estimateInvokeFee(callAndProof.call, { tip: 0n, ...proofDetails });
    console.log(`✓ estimateFee OK via ${RPC_URL}: overall_fee ${Number(est.overall_fee) / 1e18} STRK`);
  } catch (err) {
    const msg = String(err?.message ?? err);
    console.log(`✗ estimateFee FAILED via ${RPC_URL}`);
    console.log("  reason (tail):", msg.slice(-600).replace(/\s+/g, " "));
    for (const k of ["errorCode", "baseError", "code", "data"]) if (err?.[k] !== undefined) console.log(`  ${k}:`, JSON.stringify(err[k]).slice(0, 600));
  }
}

// --submit-gateway: sign with starknet.js (hash INCLUDES proof facts — verified
// against a mined pool tx) and post straight to StarkWare's Sepolia gateway,
// bypassing RPC proxies whose write path mangles the privacy fields.
if (process.argv.includes("--submit-gateway")) {
  const GATEWAY = process.env.GATEWAY_URL ?? "https://alpha-sepolia.starknet.io/gateway/add_transaction";
  const block = await provider.getBlockWithTxHashes("latest");
  const price = (p) => (BigInt(p?.price_in_fri ?? "0x0") * 3n) / 2n + 1n;
  const resourceBounds = {
    l1_gas: { max_amount: 0n, max_price_per_unit: price(block.l1_gas_price) },
    l2_gas: { max_amount: 250_000_000n, max_price_per_unit: price(block.l2_gas_price) },
    l1_data_gas: { max_amount: 20_000n, max_price_per_unit: price(block.l1_data_gas_price) },
  };
  const nonce = await account.getNonce();
  const calls = Array.isArray(callAndProof.call) ? callAndProof.call : [callAndProof.call];
  const details = {
    walletAddress: account.address, nonce, version: "0x3", chainId, cairoVersion: "1",
    resourceBounds, tip: 0n, paymasterData: [], accountDeploymentData: [],
    nonceDataAvailabilityMode: "L1", feeDataAvailabilityMode: "L1", ...proofDetails,
  };
  const signature = await account.signer.signTransaction(calls, details);
  const { stark, transaction } = await import(pathToFileURL(`${P}/sdk/node_modules/starknet/dist/index.js`).href);
  // The account's __execute__ calldata for these calls (Cairo 1 encoding) —
  // the same bytes signTransaction hashed above.
  const calldata = transaction.getExecuteCalldata(calls, "1");
  if (!calldata.length) throw new Error("empty execute calldata — refusing to submit");
  const toHex = (v) => "0x" + BigInt(v).toString(16);
  const body = {
    // The gateway wants 0x-hex everywhere; starknet.js emits decimal strings.
    type: "INVOKE_FUNCTION", version: "0x3", sender_address: account.address,
    calldata: calldata.map(toHex), signature: stark.formatSignature(signature).map(toHex),
    nonce: toHex(nonce), tip: "0x0", paymaster_data: [], account_deployment_data: [],
    nonce_data_availability_mode: 0, fee_data_availability_mode: 0,
    resource_bounds: {
      L1_GAS: { max_amount: toHex(resourceBounds.l1_gas.max_amount), max_price_per_unit: toHex(resourceBounds.l1_gas.max_price_per_unit) },
      L2_GAS: { max_amount: toHex(resourceBounds.l2_gas.max_amount), max_price_per_unit: toHex(resourceBounds.l2_gas.max_price_per_unit) },
      L1_DATA_GAS: { max_amount: toHex(resourceBounds.l1_data_gas.max_amount), max_price_per_unit: toHex(resourceBounds.l1_data_gas.max_price_per_unit) },
    },
    ...(facts.length ? { proof_facts: facts.map(toHex), proof: callAndProof.proof.data } : {}),
  };
  console.log(`posting to ${GATEWAY} (nonce ${toHex(nonce)}, ${calldata.length} calldata felts, ${facts.length} facts) …`);
  const res = await fetch(GATEWAY, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  console.log(`gateway HTTP ${res.status}: ${text.slice(0, 600)}`);
  const parsed = (() => { try { return JSON.parse(text); } catch { return null; } })();
  if (parsed?.transaction_hash) {
    console.log(`submitted ${parsed.transaction_hash} — https://sepolia.voyager.online/tx/${parsed.transaction_hash}`);
    const receipt = await provider.waitForTransaction(parsed.transaction_hash);
    const ok = receipt.isSuccess?.() ?? true;
    console.log(ok ? "✓ ACCEPTED — the account is registered on the Sepolia pool" : `✗ reverted: ${receipt.revert_reason ?? "unknown"}`);
    const now = BigInt(await pool.get_public_key(BigInt(address)));
    console.log(`get_public_key now: ${now !== 0n ? "0x" + now.toString(16) : "0 (not registered?)"}`);
  }
  process.exit(parsed?.transaction_hash ? 0 : 1);
}

if (!SUBMIT) {
  console.log(
    DEPOSIT > 0n
      ? `\nDRY RUN complete — the ${Number(DEPOSIT) / 1e18} STRK deposit was PROVED but NOT submitted; your STRK is still public. ` +
          "Re-run with --submit-gateway to send it (on Sepolia it reverts with SCREENING_REQUIRED until the operator screens you; ~2 STRK gas)."
      : "\nDRY RUN complete — nothing submitted. Re-run with --submit-gateway to register (permanent)."
  );
  process.exit(0);
}

console.log("submitting from the account itself (public by design) …");
try {
  // No estimation for proof-carrying txs: a simulation never verifies the
  // proof, so the pool sees no facts (EMPTY_PROOF_FACTS). Explicit bounds.
  const block = await provider.getBlockWithTxHashes("latest");
  const price = (p) => (BigInt(p?.price_in_fri ?? "0x0") * 3n) / 2n + 1n;
  const resourceBounds = {
    l1_gas: { max_amount: 0n, max_price_per_unit: price(block.l1_gas_price) },
    l2_gas: { max_amount: 250_000_000n, max_price_per_unit: price(block.l2_gas_price) },
    l1_data_gas: { max_amount: 20_000n, max_price_per_unit: price(block.l1_data_gas_price) },
  };
  const tx = await account.execute(callAndProof.call, { tip: 0n, resourceBounds, ...proofDetails });
  console.log(`submitted ${tx.transaction_hash} — https://sepolia.voyager.online/tx/${tx.transaction_hash}`);
  const receipt = await provider.waitForTransaction(tx.transaction_hash);
  const ok = receipt.isSuccess?.() ?? true;
  console.log(ok ? "✓ ACCEPTED — the account is registered on the Sepolia pool" : `✗ reverted: ${receipt.revert_reason ?? "unknown"}`);
  const now = BigInt(await pool.get_public_key(BigInt(address)));
  console.log(`get_public_key now: ${now !== 0n ? "0x" + now.toString(16) : "0 (not registered?)"}`);
} catch (err) {
  transfers.invalidateProofNonceCache?.();
  throw err;
}
