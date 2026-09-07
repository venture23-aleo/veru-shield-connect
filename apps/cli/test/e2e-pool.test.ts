/**
 * POOL MODE, against the real privacy pool contract — the sender-anonymity
 * mechanics, end to end:
 *
 *   - our helper is deployed with pool = the actual pool contract
 *   - the message rides a pool transaction (carrier + InvokeExternal), built
 *     by the same shapes as apps/cli/src/pool.ts
 *   - the pool — not the user — calls privacy_invoke (CALLER_NOT_POOL proves it)
 *   - the transaction is submitted via outside execution: the SENDER'S ACCOUNT
 *     APPEARS NOWHERE in the transaction envelope
 *
 * Runs on devnet via the Privacy SDK's own test harness (real pool contract,
 * mock proving). On Sepolia the identical path needs only the production
 * proving-service URL — the one credential that is not public.
 *
 * Gated: RUN_POOL_E2E=1 STARKNET_PRIVACY=<built starknet-privacy checkout>
 *        + starknet-devnet v0.8.0-rc.3 on PATH.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  decodePaymentMemo,
  encodePaymentMemo,
  msgId,
  open,
  privacyInvokeCalldata,
  seal,
} from "@strk20-messaging/sdk";
import { CallData } from "starknet";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HelperClient } from "../src/helper.js";
import { submitPool } from "../src/tail.js";

const RUN = process.env.RUN_POOL_E2E === "1" && !!process.env.STARKNET_PRIVACY;
const CONTRACTS = join(import.meta.dirname, "../../../contracts/target/dev");
const CK = 0x29f111f2674fda971bbee26106be4792a4336860bea7f3c4289d9c8dc16a948n;

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The blockifier requires proof_block <= head - 10 (notes mature 10 blocks), so
 * a locally-submitted pool tx needs the chain advanced first. `executeOutside`
 * does this internally; submitting through our own tail does not.
 */
async function createBlock(rpcUrl: string): Promise<void> {
  await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "devnet_createBlock" }),
  });
}

let devnet: any;
let env: any;
let transfers: any;
let helperAddress: string;
let messageTxHash = "";
let carrierUsed = "";

describe.skipIf(!RUN)("pool mode: sender anonymity through the real pool", () => {
  beforeAll(async () => {
    const harness: any = await import(
      pathToFileURL(`${process.env.STARKNET_PRIVACY}/sdk/dist/testing/index.js`).href
    );
    devnet = new harness.Devnet();
    ({ env, transfers } = await harness.createDevnetTestEnv(devnet));

    // Our M2 helper, pinned to the REAL pool contract as its pool.
    const contract = JSON.parse(
      readFileSync(join(CONTRACTS, "message_anonymizer_MessageAnonymizer.contract_class.json"), "utf8")
    );
    const casm = JSON.parse(
      readFileSync(
        join(CONTRACTS, "message_anonymizer_MessageAnonymizer.compiled_contract_class.json"),
        "utf8"
      )
    );
    const declared = await env.alice.declareAndDeploy(
      { contract, casm, constructorCalldata: [env.privacy.address] },
      { tip: 0n }
    );
    helperAddress = declared.deploy.contract_address;
  }, 300_000);

  afterAll(async () => {
    await devnet?.cleanup?.();
  });

  it("a message rides a pool transaction; the sender never appears", { timeout: 300_000 }, async () => {
    // 1. Alice enters the pool: approve, then shield 100 of the STRK-like token.
    await env.alice.execute({
      contractAddress: env.strk,
      entrypoint: "approve",
      calldata: [env.privacy.address, 100n, 0n],
    });
    const dep = await transfers.alice
      .build({
        autoRegister: true,
        autoSetup: true,
        autoDiscover: { notes: "refresh", channels: "refresh" },
      })
      .with(env.strk)
      .deposit({ amount: 100n })
      .surplusTo(env.alice.address)
      .execute();
    const depReceipt = await devnet.executeOutside(dep.callAndProof);
    expect(depReceipt.isReverted()).toBe(false);

    // 2. Seal the message — same crypto as every other mode.
    const sealed = seal({
      channelKey: CK,
      index: 0,
      sender: BigInt(env.alice.address),
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
      body: new TextEncoder().encode("hello through the pool"),
    });

    // 3. The pool.ts shape: replay-protection carrier + one InvokeExternal.
    //    Preferred carrier is the zero-amount enc note (M0/S1); fall back to a
    //    1-wei self-transfer if the SDK's client-side validation refuses zero.
    const buildMsgTx = (carrierAmount: bigint) =>
      transfers.alice
        .build({ autoSetup: true, autoSelectNotes: "all", autoDiscover: { notes: "refresh", channels: "refresh" } })
        .with(env.strk, (t: any) => {
          t.transfer({ recipient: env.alice.address, amount: carrierAmount });
          t.surplusTo(env.alice.address); // change note back to self
        })
        .invoke(() => ({
          contractAddress: helperAddress,
          calldata: CallData.compile(privacyInvokeCalldata([sealed])),
        }))
        .execute();

    // M0/S1: the POOL sanctions zero-amount notes. The stock SDK refuses them
    // client-side; our vendored copy is patched to allow them (the free,
    // funds-less carrier). Whichever SDK is in use, the message must land.
    let msgCall: any;
    try {
      msgCall = await buildMsgTx(0n);
      carrierUsed = "zero-amount enc note (pool-sanctioned; SDK patched)";
    } catch (err) {
      expect(String(err)).toMatch(/must be positive/);
      msgCall = await buildMsgTx(1n);
      carrierUsed = "1-wei self-transfer (stock SDK refuses zero client-side)";
    }
    const receipt = await devnet.executeOutside(msgCall.callAndProof);
    expect(receipt.isReverted()).toBe(false);
    messageTxHash = receipt.transaction_hash;

    // 4. The helper stored it — and the helper only accepts calls from the
    //    pool contract, so the pool WAS the caller.
    const helper = new HelperClient(env.node, helperAddress);
    const felts = await helper.slots(msgId(CK, 0));
    expect(felts.length).toBe(9);
    const frame = open(CK, 0, felts);
    expect(new TextDecoder().decode(frame.body)).toBe("hello through the pool");
    expect(frame.sender).toBe(BigInt(env.alice.address)); // authenticated INSIDE the ciphertext

    // 5. Sender anonymity, on the wire: alice's address appears NOWHERE in the
    //    transaction envelope — not as sender, not in calldata.
    const tx: any = await env.node.getTransaction(messageTxHash);
    const alice = BigInt(env.alice.address);
    expect(BigInt(tx.sender_address)).not.toBe(alice); // submitter is the outside executor
    const calldata: bigint[] = (tx.calldata ?? []).map((c: string) => BigInt(c));
    expect(calldata).not.toContain(alice);
    // the visible parties are the pool and the helper — by design
    expect(calldata).toContain(BigInt(helperAddress));

    console.log(
      `carrier: ${carrierUsed} · tx sender: ${tx.sender_address} (admin/outside executor) · alice absent from envelope`
    );
  });

  /**
   * ARCH 1 (16-arch1-plan.md): the payer is public on purpose, and buys
   * recipient + amount privacy with it. This is the shape the product ships,
   * so it is asserted rather than assumed — including the property the
   * previous test inverts: alice IS the sender_address here.
   */
  it("Arch 1: a payment and its memo ride one transaction; payer public, payee private", { timeout: 300_000 }, async () => {
    // Collision-proof: small integers also appear in calldata as array
    // lengths, which would make the envelope assertion below meaningless.
    const AMOUNT = 4_412_337n;
    const DEPOSIT = 10_000_000n;
    const INDEX = 1; // index 0 is taken by the test above — slots are WriteOnce

    // Bob must be registered before he can receive anything (runbook B4).
    const reg = await transfers.bob.build({ autoRegister: true }).register().execute();
    await devnet.executeOutside(reg.callAndProof);

    // Alice needs shielded funds to send.
    await env.alice.execute({
      contractAddress: env.strk,
      entrypoint: "approve",
      calldata: [env.privacy.address, DEPOSIT, 0n],
    });
    const dep = await transfers.alice
      .build({
        autoRegister: true,
        autoSetup: true,
        autoDiscover: { notes: "refresh", channels: "refresh" },
      })
      .with(env.strk)
      .deposit({ amount: DEPOSIT })
      .surplusTo(env.alice.address)
      .execute();
    await devnet.executeOutside(dep.callAndProof);

    // The memo carries the payment details INSIDE the ciphertext — the
    // recipient cannot pair a memo with a note from chain state, because the
    // note's amount is encrypted and its owner lives in the proof.
    const sealed = seal({
      channelKey: CK,
      index: INDEX,
      sender: BigInt(env.alice.address),
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
      body: encodePaymentMemo(BigInt(env.strk), AMOUNT, "invoice 4412"),
    });

    // Exactly the shape apps/cli/src/pool.ts builds for the memo case.
    const paid = await transfers.alice
      .build({
        autoSetup: true,
        autoRegister: true,
        autoSelectNotes: "all",
        autoDiscover: { notes: "refresh", channels: "refresh" },
      })
      .surplusTo(env.alice.address)
      .with(env.strk, (t: any) => t.transfer({ recipient: env.bob.address, amount: AMOUNT }))
      .invoke(() => ({
        contractAddress: helperAddress,
        calldata: CallData.compile(privacyInvokeCalldata([sealed])),
      }))
      .execute();

    // Submit the way the CLI does — alice's own account, through our tail —
    // rather than via outside execution. Advance past the maturity buffer
    // first (blockifier requires proof_block <= head - 10).
    for (let i = 0; i < 10; i++) await createBlock(env.node.channel.nodeUrl);
    const { txHash } = await submitPool(
      env.alice,
      env.node,
      paid.callAndProof,
      () => transfers.alice.invalidateProofNonceCache()
    );

    // 1. The memo is stored, decrypts, and reads as a payment.
    const helper = new HelperClient(env.node, helperAddress);
    const frame = open(CK, INDEX, await helper.slots(msgId(CK, INDEX)));
    const memo = decodePaymentMemo(frame.body);
    expect(memo).not.toBeNull();
    expect(memo!.amount).toBe(AMOUNT);
    expect(memo!.text).toBe("invoice 4412");
    expect(BigInt(memo!.token)).toBe(BigInt(env.strk));

    // 2. Bob really holds the value — privately.
    const { notes } = await transfers.bob.discoverNotes({ tokens: [BigInt(env.strk)] });
    const bobNotes = notes.get(BigInt(env.strk)) ?? [];
    expect(bobNotes.some((n: any) => BigInt(n.amount) === AMOUNT)).toBe(true);

    // 3. The Arch 1 trade, on the wire.
    const tx: any = await env.node.getTransaction(txHash);
    expect(BigInt(tx.sender_address)).toBe(BigInt(env.alice.address));
    const calldata: bigint[] = (tx.calldata ?? []).map((c: string) => BigInt(c));
    // Positive control first: an empty envelope would make every `not.toContain`
    // below pass vacuously. The helper address is always public, so it must be here.
    expect(calldata).toContain(BigInt(helperAddress));
    console.log(
      `arch1 envelope: ${calldata.length} felts · bob present: ${calldata.includes(BigInt(env.bob.address))} · amount present: ${calldata.includes(AMOUNT)}`
    );
    // The amount is never public — enc notes pack an encrypted amount.
    expect(calldata).not.toContain(AMOUNT);
    // But the FIRST payment to a recipient opens the channel, and the pool's
    // `Append` server action names `recipient_addr` in the clear because it
    // must know whose storage vector to append the EncChannelInfo to
    // (privacy/src/actions.cairo:372). This is the documented channel-open
    // leak (02-threat-model.md) and it is structural, not a bug.
    expect(calldata).toContain(BigInt(env.bob.address));

    // 4. On an ALREADY-OPEN channel there is no Append, and the recipient
    //    disappears. This is the steady state, and the property Arch 1 claims.
    const sealed2 = seal({
      channelKey: CK,
      index: INDEX + 1,
      sender: BigInt(env.alice.address),
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
      body: encodePaymentMemo(BigInt(env.strk), AMOUNT, "invoice 4413"),
    });
    const paid2 = await transfers.alice
      .build({
        autoSetup: true,
        autoRegister: true,
        autoSelectNotes: "all",
        autoDiscover: { notes: "refresh", channels: "refresh" },
      })
      .surplusTo(env.alice.address)
      .with(env.strk, (t: any) => t.transfer({ recipient: env.bob.address, amount: AMOUNT }))
      .invoke(() => ({
        contractAddress: helperAddress,
        calldata: CallData.compile(privacyInvokeCalldata([sealed2])),
      }))
      .execute();
    for (let i = 0; i < 10; i++) await createBlock(env.node.channel.nodeUrl);
    const second = await submitPool(env.alice, env.node, paid2.callAndProof, () =>
      transfers.alice.invalidateProofNonceCache()
    );
    const tx2: any = await env.node.getTransaction(second.txHash);
    const calldata2: bigint[] = (tx2.calldata ?? []).map((c: string) => BigInt(c));
    expect(calldata2).toContain(BigInt(helperAddress)); // positive control, as above
    expect(BigInt(tx2.sender_address)).toBe(BigInt(env.alice.address));
    expect(calldata2).not.toContain(BigInt(env.bob.address));
    expect(calldata2).not.toContain(AMOUNT);
  });
});
