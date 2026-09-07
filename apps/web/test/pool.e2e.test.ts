/**
 * POOL MODE IN THE WEB BACKEND, against the real pool contract — Arch 1
 * (16-arch1-plan.md § W8), the same standard the CLI met:
 *
 *   - two PoolBackends (alice, bob), local devnet: mock proving, discovery
 *     straight from the pool contract — exactly what the browser runs
 *   - alice pays bob with a memo in ONE transaction, from her own account
 *   - the sender-side channel-key derivation the app relies on equals the
 *     channel the SDK actually opened — proven by bob DISCOVERING that key
 *   - bob reads the memo as a payment; alice is the public sender
 *
 * Gated: RUN_POOL_E2E=1 (+ STARKNET_PRIVACY=<built checkout>, else the one Scarb
 * vendors — vite.config.ts aliases the SDK the same way) + starknet-devnet on PATH.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { decodePaymentMemo, encodePaymentMemo, groupLaneKey, msgId, open, seal } from "@strk20-messaging/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PoolBackend } from "../src/lib/poolBackend.js";

/** STARKNET_PRIVACY, else the checkout Scarb vendors — the same default as vite.config.ts. */
function findCheckout(): string | null {
  if (process.env.STARKNET_PRIVACY) return process.env.STARKNET_PRIVACY;
  const base = join(homedir(), ".cache/scarb/registry/git/checkouts");
  if (!existsSync(base)) return null;
  for (const dir of readdirSync(base)) {
    if (!dir.startsWith("starknet-privacy-")) continue;
    const c = join(base, dir, "bc75e4b");
    if (existsSync(join(c, "sdk/dist/index.js"))) return c;
  }
  return null;
}
const CHECKOUT = findCheckout();
const RUN = process.env.RUN_POOL_E2E === "1" && !!CHECKOUT;
const CONTRACTS = join(import.meta.dirname, "../../../contracts/target/dev");
const DEPOSIT = 10_000_000n;
const AMOUNT = 4_412_337n;

let devnet: any;
let env: any;
let helperAddress: string;
let alice: PoolBackend;
let bob: PoolBackend;

const pkOf = (account: any): string => {
  const pk = String(account.signer.pk);
  return pk.startsWith("0x") ? pk : `0x${pk}`;
};

describe.skipIf(!RUN)("web PoolBackend: a payment with a memo, both sides, through the real pool", () => {
  beforeAll(async () => {
    const harness: any = await import(
      pathToFileURL(`${CHECKOUT}/sdk/dist/testing/index.js`).href
    );
    devnet = new harness.Devnet({ userAccounts: 3 }); // alice, bob + an unregistered carol
    let transfers: any;
    ({ env, transfers } = await harness.createDevnetTestEnv(devnet));

    const contract = JSON.parse(
      readFileSync(join(CONTRACTS, "message_anonymizer_MessageAnonymizer.contract_class.json"), "utf8")
    );
    const casm = JSON.parse(
      readFileSync(join(CONTRACTS, "message_anonymizer_MessageAnonymizer.compiled_contract_class.json"), "utf8")
    );
    const declared = await env.alice.declareAndDeploy(
      { contract, casm, constructorCalldata: [env.privacy.address] },
      { tip: 0n }
    );
    helperAddress = declared.deploy.contract_address;

    // Seed exactly as scripts/pool-devnet.mjs does.
    for (const [account, t] of [
      [env.alice, transfers.alice],
      [env.bob, transfers.bob],
    ]) {
      await account.execute({
        contractAddress: env.strk,
        entrypoint: "approve",
        calldata: [env.privacy.address, DEPOSIT, 0n],
      });
      const dep = await t
        .build({ autoRegister: true, autoSetup: true, autoDiscover: { notes: "refresh", channels: "refresh" } })
        .with(env.strk)
        .deposit({ amount: DEPOSIT })
        .surplusTo(account.address)
        .execute();
      await devnet.executeOutside(dep.callAndProof);
    }

    const common = {
      rpcUrl: env.node.channel.nodeUrl as string,
      helperAddress,
      poolAddress: env.privacy.address as string,
      local: true,
      carrierToken: env.strk as string,
    };
    alice = new PoolBackend({ ...common, accountAddress: env.alice.address, accountKey: pkOf(env.alice), viewingKey: "0xA11CE" });
    bob = new PoolBackend({ ...common, accountAddress: env.bob.address, accountKey: pkOf(env.bob), viewingKey: "0xB0B" });
  }, 300_000);

  afterAll(async () => {
    await devnet?.cleanup?.();
  });

  it("a registration-only transaction puts a fresh account on the pool", { timeout: 300_000 }, async () => {
    // The chrome's "Register on the pool" button: no message, no funds — the
    // first two people in a pool need this or they wait for each other forever.
    const carol = env.extraAccounts?.[0];
    expect(carol, "harness provides a third account").toBeDefined();
    const backend = new PoolBackend({
      rpcUrl: env.node.channel.nodeUrl as string,
      helperAddress,
      poolAddress: env.privacy.address as string,
      local: true,
      carrierToken: env.strk as string,
      accountAddress: carol.address,
      accountKey: pkOf(carol),
      viewingKey: "0xca201",
    });
    expect(await backend.isRegistered(carol.address)).toBe(false);
    const states: string[] = [];
    const { txHash } = await backend.pool.registerSelf((s) => states.push(s));
    expect(states).toEqual(["submitted"]);
    expect(txHash).toMatch(/^0x/);
    expect(await backend.isRegistered(carol.address)).toBe(true);
    // Now alice can derive a lane to carol — the whole point of registering.
    expect(await alice.pool.outKeyFor(carol.address)).toMatch(/^0x/);
  });

  it("the whole thing: shield 10 STRK, pay 4 with a memo, the recipient reads it", { timeout: 300_000 }, async () => {
    // Public → private → private transfer → discovered: the sequence Sepolia
    // is blocked on at step one (SCREENING_REQUIRED). Here the harness's mock
    // prover screens with its own key, so it runs end to end.
    const carol = env.extraAccounts[0];
    const carolBackend = new PoolBackend({
      rpcUrl: env.node.channel.nodeUrl as string,
      helperAddress,
      poolAddress: env.privacy.address as string,
      local: true,
      carrierToken: env.strk as string,
      accountAddress: carol.address,
      accountKey: pkOf(carol),
      viewingKey: "0xca201",
    });
    const STRK = env.strk as string;
    expect(await carolBackend.pool.poolBalance(STRK)).toBe(0n);

    // 1. shield: approve + proven Deposit → a private note worth 10 STRK
    const states: string[] = [];
    const { txHash: shieldTx } = await carolBackend.pool.shield(STRK, 10n * 10n ** 18n, (s) => states.push(s));
    expect(states).toEqual(["submitted"]);
    expect(shieldTx).toMatch(/^0x/);
    expect(await carolBackend.pool.poolBalance(STRK)).toBe(10n * 10n ** 18n);

    // 2. pay bob 4 STRK with a memo, from the shielded note (change comes back to carol)
    const outKey = await carolBackend.pool.outKeyFor(env.bob.address);
    const sealed = seal({
      channelKey: BigInt(outKey),
      index: 0,
      sender: BigInt(carol.address),
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
      body: encodePaymentMemo(BigInt(STRK), 4n * 10n ** 18n, "shielded, then paid"),
    });
    await carolBackend.pool.pay({ token: STRK, recipient: env.bob.address, amount: 4n * 10n ** 18n }, [sealed], () => {});
    expect(await carolBackend.pool.poolBalance(STRK)).toBe(6n * 10n ** 18n); // 10 − 4, as a change note

    // 3. bob discovers carol's lane and reads the payment
    const lane = (await bob.pool.discoverLanes()).find((l) => BigInt(l.peer) === BigInt(carol.address) && l.direction === "in");
    expect(lane, "bob sees carol's incoming lane").toBeDefined();
    const frame = open(BigInt(lane!.key), 0, await bob.reader.slots(msgId(BigInt(lane!.key), 0)));
    const memo = decodePaymentMemo(frame.body);
    expect(memo).toMatchObject({ amount: 4n * 10n ** 18n, text: "shielded, then paid" });
    expect(await bob.pool.poolBalance(STRK)).toBeGreaterThanOrEqual(4n * 10n ** 18n);
  });

  it("registration is read from the pool, not assumed", async () => {
    expect(await alice.isRegistered(env.bob.address)).toBe(true);
    expect(await alice.isRegistered("0x1234")).toBe(false);
    await expect(alice.pool.outKeyFor("0x1234")).rejects.toThrow(/not registered/);
  });

  it("alice pays bob with a memo; bob discovers the lane and reads a payment", { timeout: 300_000 }, async () => {
    // The app derives the lane BEFORE any transaction exists.
    const outKey = await alice.pool.outKeyFor(env.bob.address);
    const sealed = seal({
      channelKey: BigInt(outKey),
      index: 0,
      sender: BigInt(env.alice.address),
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
      body: encodePaymentMemo(BigInt(env.strk), AMOUNT, "invoice 4412"),
    });

    const states: string[] = [];
    const { txHash } = await alice.pool.pay(
      { token: env.strk, recipient: env.bob.address, amount: AMOUNT },
      [sealed],
      (s) => states.push(s)
    );
    expect(states).toEqual(["submitted"]);

    // Arch 1 on the wire: alice is the public sender.
    const tx: any = await env.node.getTransaction(txHash);
    expect(BigInt(tx.sender_address)).toBe(BigInt(env.alice.address));

    // Bob's side: the pool's scan hands him alice's lane — and it is the very
    // key alice derived locally, which is what makes the app's sender-side
    // derivation trustworthy rather than assumed.
    const lanes = await bob.pool.discoverLanes();
    const fromAlice = lanes.find((l) => BigInt(l.peer) === BigInt(env.alice.address) && l.direction === "in");
    expect(fromAlice, `lanes seen by bob: ${JSON.stringify(lanes)}`).toBeDefined();
    expect(BigInt(fromAlice!.key)).toBe(BigInt(outKey));

    // And the memo reads as a payment through bob's own reader.
    const felts = await bob.reader.slots(msgId(BigInt(fromAlice!.key), 0));
    const frame = open(BigInt(fromAlice!.key), 0, felts);
    const memo = decodePaymentMemo(frame.body);
    expect(memo).toMatchObject({ amount: AMOUNT, text: "invoice 4412" });
    expect(frame.sender).toBe(BigInt(env.alice.address));

    // Alice sees the same lane as outgoing.
    const mine = (await alice.pool.discoverLanes()).find((l) => BigInt(l.peer) === BigInt(env.bob.address));
    expect(mine?.direction).toBe("out");
  });

  it("a message-only send rides a carrier note and opens the channel to a new peer", { timeout: 300_000 }, async () => {
    // Bob writes back to alice: first contact from his side, no payment.
    const outKey = await bob.pool.outKeyFor(env.alice.address);
    const sealed = seal({
      channelKey: BigInt(outKey),
      index: 0,
      sender: BigInt(env.bob.address),
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
      body: new TextEncoder().encode("thanks — received"),
    });
    await bob.submitBatch([sealed], () => {}, { setupPeer: env.alice.address });

    const lanes = await alice.pool.discoverLanes();
    const fromBob = lanes.find((l) => BigInt(l.peer) === BigInt(env.bob.address) && l.direction === "in");
    expect(fromBob, `lanes seen by alice: ${JSON.stringify(lanes)}`).toBeDefined();
    const frame = open(BigInt(fromBob!.key), 0, await alice.reader.slots(msgId(BigInt(fromBob!.key), 0)));
    expect(new TextDecoder().decode(frame.body)).toBe("thanks — received");
  });

  it("a group split: alice pays bob AND carol in ONE transaction, with one memo on her group lane", { timeout: 300_000 }, async () => {
    // GroupView's "split": N transfers inside one token scope + one invoke —
    // the multi-transfer builder shape payMany relies on, against the real pool.
    const carol = env.extraAccounts[0];
    const STRK = env.strk as string;
    const EACH = 1_000_000n;
    const carolBackend = new PoolBackend({
      rpcUrl: env.node.channel.nodeUrl as string,
      helperAddress,
      poolAddress: env.privacy.address as string,
      local: true,
      carrierToken: STRK,
      accountAddress: carol.address,
      accountKey: pkOf(carol),
      viewingKey: "0xca201",
    });
    const before = {
      alice: await alice.pool.poolBalance(STRK),
      bob: await bob.pool.poolBalance(STRK),
      carol: await carolBackend.pool.poolBalance(STRK),
    };
    const lane = groupLaneKey(0x7717n, BigInt(env.alice.address)); // alice's lane in group 0x7717
    const sealed = seal({
      channelKey: lane,
      index: 0,
      sender: BigInt(env.alice.address),
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
      body: encodePaymentMemo(BigInt(STRK), EACH, "to bob, carol — dinner"),
    });
    const states: string[] = [];
    const { txHash } = await alice.pool.payMany(
      [
        { token: STRK, recipient: env.bob.address, amount: EACH },
        { token: STRK, recipient: carol.address, amount: EACH },
      ],
      [sealed],
      (s) => states.push(s)
    );
    expect(states).toEqual(["submitted"]);
    const tx: any = await env.node.getTransaction(txHash);
    expect(BigInt(tx.sender_address)).toBe(BigInt(env.alice.address));

    // Every balance moved by exactly one transaction's worth.
    expect(await alice.pool.poolBalance(STRK)).toBe(before.alice - 2n * EACH);
    expect(await bob.pool.poolBalance(STRK)).toBe(before.bob + EACH);
    expect(await carolBackend.pool.poolBalance(STRK)).toBe(before.carol + EACH);

    // The receipt pairing: each recipient now holds a note of exactly EACH.
    expect((await bob.pool.notes(STRK))?.some((n) => n.amount === EACH)).toBe(true);
    expect((await carolBackend.pool.notes(STRK))?.some((n) => n.amount === EACH)).toBe(true);

    // The memo is on alice's group lane, readable by any member with the group key.
    const frame = open(lane, 0, await bob.reader.slots(msgId(lane, 0)));
    expect(decodePaymentMemo(frame.body)).toMatchObject({ amount: EACH, text: "to bob, carol — dinner" });
  });
});
