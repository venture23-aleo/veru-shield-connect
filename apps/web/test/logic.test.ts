import { describe, expect, it } from "vitest";
import { seal, MemorySyncStore, SyncEngine } from "@strk20-messaging/sdk";
import { exportBackup, parseBackup } from "../src/lib/backup.js";
import { stitchThread, type Contact } from "../src/lib/contacts.js";
import { MAX_BODY_BYTES, batchPreview, tierPreview } from "../src/lib/costs.js";

const contact: Contact = {
  label: "bob",
  peer: "0xb0b",
  outKey: "0x29f111f2674fda971bbee26106be4792a4336860bea7f3c4289d9c8dc16a948",
  inKey: "0x5a0aa03c5d8649895810c86ed63b62d91895734e6d3ab2e80ada6f6fb400c84",
  registered: true,
};

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const fromB64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
const rec = (channelKey: string, index: number, timestamp: number, body: string) => ({
  channelKey,
  index,
  sender: "0xa11ce",
  timestamp,
  bodyBase64: b64(body),
});

describe("tierPreview — padding-tier cost preview with boundary warnings", () => {
  it("shows the tier and cost for a small message, with no warning", () => {
    const p = tierPreview("hello");
    expect(p.tier).toBe(256);
    expect(p.usd).toBeGreaterThan(0);
    expect(p.boundary).toBeUndefined();
  });

  it("warns near a boundary with the byte distance and price delta", () => {
    // 256 − header(45) = 211 max; 200 bytes leaves 11 left — inside the warn window
    const p = tierPreview("x".repeat(200));
    expect(p.tier).toBe(256);
    expect(p.boundary).toBeDefined();
    expect(p.boundary!.bytesLeft).toBe(11);
    expect(p.boundary!.nextTier).toBe(1024);
    expect(p.boundary!.extraUsd).toBeGreaterThan(0);
  });

  it("crosses the boundary into the next tier", () => {
    expect(tierPreview("x".repeat(212)).tier).toBe(1024);
  });

  it("rejects over-ceiling bodies with the overage", () => {
    const p = tierPreview("x".repeat(MAX_BODY_BYTES + 7));
    expect(p.tier).toBeNull();
    expect(p.overBy).toBe(7);
  });

  it("batchPreview sums cost and reports the single-transaction shape", () => {
    const b = batchPreview([256, 256, 1024], 29);
    expect(b.count).toBe(3);
    expect(b.seconds).toBe(29);
    expect(b.usd).toBeGreaterThan(0);
  });
});

describe("stitchThread — two directional lanes, one conversation", () => {
  it("merges both lanes by timestamp and tags direction", () => {
    const history = [
      rec(contact.outKey, 0, 100, "hi bob"),
      rec(contact.inKey, 0, 150, "hi alice"),
      rec(contact.outKey, 1, 200, "how are you"),
      rec(contact.inKey, 1, 250, "good!"),
    ];
    const thread = stitchThread(history, contact);
    expect(thread.map((m) => m.body)).toEqual(["hi bob", "hi alice", "how are you", "good!"]);
    expect(thread.map((m) => m.direction)).toEqual(["sent", "received", "sent", "received"]);
  });

  it("keeps a deterministic order when timestamps tie", () => {
    const history = [rec(contact.outKey, 0, 100, "A"), rec(contact.inKey, 0, 100, "B")];
    const a = stitchThread(history, contact);
    const b = stitchThread([...history].reverse(), contact);
    expect(a.map((m) => m.body)).toEqual(b.map((m) => m.body));
    expect(a[0]!.direction).toBe("received"); // ties: received lane first
  });

  it("ignores other channels' records", () => {
    const history = [rec("0xdead", 0, 100, "noise"), rec(contact.outKey, 0, 120, "real")];
    expect(stitchThread(history, contact).map((m) => m.body)).toEqual(["real"]);
  });
});

describe("invite — pairing two clients onto the same lanes", () => {
  it("round-trips with mirrored lanes: my out is their in, and vice versa", async () => {
    const { makeInvite, parseInvite } = await import("../src/lib/contacts.js");
    const invite = parseInvite(JSON.stringify(makeInvite(contact, "0xa11ce")))!;
    expect(invite).not.toBeNull();
    expect(invite.peer).toBe("0xa11ce");
    expect(invite.yourOutKey).toBe(contact.inKey); // they send on what I read
    expect(invite.yourInKey).toBe(contact.outKey); // they read what I send

    // the receiver's contact, built from the invite, stitches the SAME thread
    const theirContact: Contact = {
      label: "alice",
      peer: invite.peer,
      outKey: invite.yourOutKey,
      inKey: invite.yourInKey,
      registered: true,
    };
    const history = [rec(contact.outKey, 0, 100, "from me"), rec(contact.inKey, 0, 200, "from them")];
    const mine = stitchThread(history, contact).map((m) => [m.body, m.direction]);
    const theirs = stitchThread(history, theirContact).map((m) => [m.body, m.direction]);
    expect(mine).toEqual([
      ["from me", "sent"],
      ["from them", "received"],
    ]);
    expect(theirs).toEqual([
      ["from me", "received"],
      ["from them", "sent"],
    ]);
  });

  it("rejects garbage and near-misses", async () => {
    const { parseInvite } = await import("../src/lib/contacts.js");
    expect(parseInvite("hello")).toBeNull();
    expect(parseInvite(JSON.stringify({ peer: "0x1" }))).toBeNull();
    expect(
      parseInvite(JSON.stringify({ "strk20msg-invite": 1, peer: "0x1", yourOutKey: "nope", yourInKey: "0x2" }))
    ).toBeNull();
  });
});

describe("credentials paste — multi-account sncast files", () => {
  const sncast = JSON.stringify({
    "alpha-sepolia": {
      deployer: { address: "0x03ab7fda95", private_key: "0xdeb107e4", public_key: "0x1" },
      safari: { address: "0x07b08b08fd", private_key: "0x5afa41c0de", public_key: "0x2" },
    },
  });

  it("prefers the account matching the current address field", async () => {
    const { parseCredentialsPaste } = await import("../src/lib/presets.js");
    const creds = parseCredentialsPaste(sncast, "0x3ab7fda95")!; // no leading zero — BigInt compare
    expect(creds.accountAddress).toBe("0x03ab7fda95");
    expect(creds.privateKey).toBe("0xdeb107e4");
    expect(creds.source).toContain("deployer");
    expect(creds.source).toContain("2");
  });

  it("names which account it took when nothing matches", async () => {
    const { parseCredentialsPaste } = await import("../src/lib/presets.js");
    const creds = parseCredentialsPaste(sncast, "0x999")!;
    expect(creds.source).toContain("deployer"); // first entry, named
  });

  it("a bare key fills only the key", async () => {
    const { parseCredentialsPaste } = await import("../src/lib/presets.js");
    const creds = parseCredentialsPaste("0x" + "ab".repeat(30))!;
    expect(creds.privateKey).toBeDefined();
    expect(creds.accountAddress).toBe("");
  });
});

describe("groups — lanes, invites, stitching", () => {
  const GK = "0x5a0aa03c5d8649895810c86ed63b62d91895734e6d3ab2e80ada6f6fb400c84";
  const group = {
    name: "escrow-deal",
    groupKey: GK,
    members: [
      { address: "0xa11ce", label: "you" },
      { address: "0xb0b", label: "Bob" },
      { address: "0xca401" },
    ],
  };

  it("group invite round-trips and validates", async () => {
    const { makeGroupInvite, parseGroupInvite } = await import("../src/lib/groups.js");
    const inv = parseGroupInvite(JSON.stringify(makeGroupInvite(group)))!;
    expect(inv.name).toBe("escrow-deal");
    expect(inv.members.length).toBe(3);
    expect(parseGroupInvite("junk")).toBeNull();
    expect(parseGroupInvite(JSON.stringify({ "strk20msg-group-invite": 1, name: "x", groupKey: "nope", members: [] }))).toBeNull();
  });

  it("stitches all members' lanes with attribution; my lane reads as sent", async () => {
    const { groupLanes, myLane, stitchGroupThread } = await import("../src/lib/groups.js");
    const lanes = groupLanes(group, "0xa11ce");
    expect(lanes.length).toBe(3); // me already listed — not duplicated
    const laneOf = (addr: string) => lanes.find((l) => BigInt(l.member.address) === BigInt(addr))!.laneKey;
    expect(myLane(group, "0xa11ce")).toBe(laneOf("0xa11ce"));

    const history = [
      rec(laneOf("0xa11ce"), 0, 100, "terms attached"),
      rec(laneOf("0xb0b"), 0, 150, "reviewing"),
      rec(laneOf("0xca401"), 0, 200, "lgtm"),
      rec(laneOf("0xa11ce"), 1, 250, "executing"),
      rec("0xdead", 0, 120, "noise from another channel"),
    ];
    const thread = stitchGroupThread(history, group, "0xa11ce");
    expect(thread.map((m) => m.body)).toEqual(["terms attached", "reviewing", "lgtm", "executing"]);
    expect(thread.map((m) => m.direction)).toEqual(["sent", "received", "received", "sent"]);
    expect(thread[1]!.senderLabel).toBe("Bob");
    expect(thread[2]!.senderLabel).toMatch(/^0xca401$|…/); // unlabeled member falls back to address
  });

  it("a joiner not in the member list still gets a lane of their own", async () => {
    const { groupLanes } = await import("../src/lib/groups.js");
    const lanes = groupLanes(group, "0xd0e");
    expect(lanes.length).toBe(4);
    expect(lanes.some((l) => l.member.label === "you")).toBe(true);
  });
});

describe("backup — key export and restore", () => {
  it("round-trips key, address and contacts", () => {
    const json = exportBackup({
      viewingKey: "0x123abc",
      accountAddress: "0xa11ce",
      contacts: [contact],
    });
    const restored = parseBackup(json);
    expect(restored.viewingKey).toBe("0x123abc");
    expect(restored.contacts[0]!.outKey).toBe(contact.outKey);
  });

  it("rejects garbage, wrong versions, and missing keys", () => {
    expect(() => parseBackup("not json")).toThrow(/JSON/);
    expect(() => parseBackup(JSON.stringify({ version: 2 }))).toThrow(/version/);
    expect(() => parseBackup(JSON.stringify({ version: 1, viewingKey: "hello" }))).toThrow(/viewing key/);
    expect(() =>
      parseBackup(JSON.stringify({ version: 1, viewingKey: "0x1", accountAddress: "0xa", contacts: [{}] }))
    ).toThrow(/contact/);
  });

  it("a restored key rebuilds history via sync — backup needs no message data", async () => {
    // Simulate: messages exist on 'chain'; a fresh device restores the backup
    // (keys only) and syncs. Mirrors the M5 guarantee end to end in the web model.
    const slots = new Map<string, bigint[]>();
    const s = seal({
      channelKey: BigInt(contact.outKey),
      index: 0,
      sender: 0xa11cen,
      timestamp: 1000n,
      body: new TextEncoder().encode("survives reinstall"),
    });
    slots.set(s.msgId.toString(), s.felts);
    const reader = {
      slotLens: async (ids: bigint[]) => ids.map((id) => slots.get(id.toString())?.length ?? 0),
      slots: async (id: bigint) => slots.get(id.toString())!,
      blockNumber: async () => 7,
    };
    const restored = parseBackup(exportBackup({ viewingKey: "0x1", accountAddress: "0xa", contacts: [contact] }));
    const engine = new SyncEngine(reader, new MemorySyncStore());
    await engine.sync(restored.contacts.flatMap((c) => [c.outKey, c.inKey]));
    const history = engine.history();
    expect(history.length).toBe(1);
    expect(fromB64(history[0]!.bodyBase64)).toBe("survives reinstall");
  });
});

describe("payments in threads — the PAY1 header rides inside the ciphertext", () => {
  it("a paid memo stitches as a payment with the text, not as bytes", async () => {
    const { encodePaymentMemo } = await import("@strk20-messaging/sdk");
    const body = encodePaymentMemo(0x4718f5an, 4_412_337n, "invoice 4412");
    const rawB64 = btoa(String.fromCharCode(...body));
    const history = [
      { channelKey: contact.outKey, index: 0, sender: "0xa11ce", timestamp: 100, bodyBase64: rawB64 },
      rec(contact.inKey, 0, 101, "thanks, received"),
    ];
    const thread = stitchThread(history, contact);
    expect(thread[0]).toMatchObject({
      direction: "sent",
      body: "invoice 4412",
      payment: { token: "0x4718f5a", amount: "4412337" },
    });
    expect(thread[1]?.payment).toBeUndefined();
    expect(thread[1]?.body).toBe("thanks, received");
  });

  it("a lane that is not discovered yet contributes nothing, and breaks nothing", () => {
    const undiscovered: Contact = { ...contact, inKey: "" };
    const thread = stitchThread([rec(contact.outKey, 0, 100, "hi")], undiscovered);
    expect(thread.map((m) => m.direction)).toEqual(["sent"]);
  });
});

describe("local devnet env — the block scripts/pool-devnet.mjs prints", () => {
  const good = {
    "strk20msg-devnet": 1,
    rpcUrl: "http://127.0.0.1:6050",
    helperAddress: "0x1",
    poolAddress: "0x2",
    carrierToken: "0x3",
    accounts: [
      { name: "alice", address: "0xa", privateKey: "0xb", viewingKey: "0xA11CE" },
      { name: "bob", address: "0xc", privateKey: "0xd", viewingKey: "0xB0B" },
    ],
  };

  it("accepts the block and keeps every account", async () => {
    const { parseDevnetEnv } = await import("../src/lib/presets.js");
    expect(parseDevnetEnv(JSON.stringify(good))?.accounts.map((a) => a.name)).toEqual(["alice", "bob"]);
  });

  it("rejects near-misses: wrong marker, non-hex, empty accounts, garbage", async () => {
    const { parseDevnetEnv } = await import("../src/lib/presets.js");
    expect(parseDevnetEnv(JSON.stringify({ ...good, "strk20msg-devnet": 2 }))).toBeNull();
    expect(parseDevnetEnv(JSON.stringify({ ...good, poolAddress: "nope" }))).toBeNull();
    expect(parseDevnetEnv(JSON.stringify({ ...good, accounts: [] }))).toBeNull();
    expect(parseDevnetEnv("{not json")).toBeNull();
  });
});

describe("explorer links — only where an explorer exists", () => {
  it("Sepolia and mainnet link to Voyager; demo and devnet link nowhere", async () => {
    const { explorerTxUrl } = await import("../src/lib/explorer.js");
    const h = "0x7a43b60e20316dbd1b5d1a4d89a26aa58b098c523f55f5bb2e86e87bcc62c22";
    expect(explorerTxUrl({ mode: "pool", rpcUrl: "https://api.cartridge.gg/x/starknet/sepolia" }, h)).toBe(`https://sepolia.voyager.online/tx/${h}`);
    expect(explorerTxUrl({ mode: "pool", rpcUrl: "https://api.cartridge.gg/x/starknet/mainnet" }, h)).toBe(`https://voyager.online/tx/${h}`);
    expect(explorerTxUrl({ mode: "pool", rpcUrl: "http://127.0.0.1:6050", poolLocal: true }, h)).toBeNull();
    expect(explorerTxUrl({ mode: "demo" }, h)).toBeNull();
  });
});

describe("amounts — STRK at the boundary, smallest units everywhere else", () => {
  it("parses decimal STRK and formats it back", async () => {
    const { parseAmount, formatAmount, describeAmount, isStrk, STRK_TOKEN } = await import("../src/lib/amounts.js");
    expect(parseAmount("2.5", 18)).toBe(2_500_000_000_000_000_000n);
    expect(parseAmount("0.000000000000000001", 18)).toBe(1n);
    expect(parseAmount("100", 18)).toBe(100n * 10n ** 18n);
    expect(formatAmount(2_500_000_000_000_000_000n, 18)).toBe("2.5");
    expect(formatAmount(1_234_000n * 10n ** 18n, 18)).toBe("1,234,000");
    expect(describeAmount(5n * 10n ** 18n, STRK_TOKEN)).toBe("5 STRK");
    expect(isStrk("0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d")).toBe(true);
  });

  it("rejects zero, garbage, too many decimals, and non-integers for 0-decimal tokens", async () => {
    const { parseAmount, describeAmount } = await import("../src/lib/amounts.js");
    expect(parseAmount("0", 18)).toBeNull();
    expect(parseAmount("", 18)).toBeNull();
    expect(parseAmount("1.2.3", 18)).toBeNull();
    expect(parseAmount("1." + "0".repeat(19), 18)).toBeNull();
    expect(parseAmount("2.5", 0)).toBeNull();
    expect(parseAmount("4412337", 0)).toBe(4_412_337n);
    expect(describeAmount(4_412_337n, "0x0abc")).toMatch(/^4,412,337 units of /);
  });
});

describe("payment requests in threads — asked, then settled by the matching payment", () => {
  const strk = 0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938dn;
  const five = 5n * 10n ** 18n;

  it("a REQ1 line from them stitches as a request; my later PAY1 of the same amount settles it", async () => {
    const { encodePaymentMemo, encodePaymentRequest } = await import("@strk20-messaging/sdk");
    const payB64 = btoa(String.fromCharCode(...encodePaymentMemo(strk, five, "for: dinner")));
    const history = [
      rec(contact.inKey, 0, 100, encodePaymentRequest(strk, five, "dinner")),
      { channelKey: contact.outKey, index: 0, sender: "0xa11ce", timestamp: 150, bodyBase64: payB64 },
    ];
    const thread = stitchThread(history, contact);
    expect(thread[0]).toMatchObject({
      direction: "received",
      body: "dinner",
      request: { token: "0x" + strk.toString(16), amount: five.toString(), settledBy: 0 },
    });
    expect(thread[1]).toMatchObject({ direction: "sent", payment: { amount: five.toString() } });
  });

  it("a payment before the request, a different amount, or my own payment on my own request does not settle it", async () => {
    const { encodePaymentMemo, encodePaymentRequest } = await import("@strk20-messaging/sdk");
    const pay = (amount: bigint, key: string, index: number, ts: number) => ({
      channelKey: key,
      index,
      sender: "0xa11ce",
      timestamp: ts,
      bodyBase64: btoa(String.fromCharCode(...encodePaymentMemo(strk, amount, ""))),
    });
    const before = stitchThread([pay(five, contact.outKey, 0, 50), rec(contact.inKey, 0, 100, encodePaymentRequest(strk, five, ""))], contact);
    expect(before[1]?.request?.settledBy).toBeUndefined();
    const wrong = stitchThread([rec(contact.inKey, 0, 100, encodePaymentRequest(strk, five, "")), pay(five + 1n, contact.outKey, 0, 150)], contact);
    expect(wrong[0]?.request?.settledBy).toBeUndefined();
    // I asked, and I paid myself? No: only the OTHER direction settles.
    const self = stitchThread([rec(contact.outKey, 0, 100, encodePaymentRequest(strk, five, "")), pay(five, contact.outKey, 1, 150)], contact);
    expect(self[0]?.direction).toBe("sent");
    expect(self[0]?.request?.settledBy).toBeUndefined();
  });

  it("each payment settles one request: two identical requests need two payments", async () => {
    const { encodePaymentMemo, encodePaymentRequest } = await import("@strk20-messaging/sdk");
    const payB64 = btoa(String.fromCharCode(...encodePaymentMemo(strk, five, "")));
    const thread = stitchThread(
      [
        rec(contact.inKey, 0, 100, encodePaymentRequest(strk, five, "first")),
        rec(contact.inKey, 1, 101, encodePaymentRequest(strk, five, "second")),
        { channelKey: contact.outKey, index: 0, sender: "0xa11ce", timestamp: 150, bodyBase64: payB64 },
      ],
      contact
    );
    expect(thread[0]?.request?.settledBy).toBe(0);
    expect(thread[1]?.request?.settledBy).toBeUndefined();
  });

  it("a plain message that merely mentions REQ1 is a plain message", () => {
    const thread = stitchThread([rec(contact.inKey, 0, 100, "REQ1 was the old ticket id")], contact);
    expect(thread[0]?.request).toBeUndefined();
    expect(thread[0]?.body).toBe("REQ1 was the old ticket id");
  });
});

describe("group splits — one memo on the payer's lane, read by everyone", () => {
  it("a PAY1 memo on a member's group lane stitches as a payment with attribution", async () => {
    const { encodePaymentMemo, groupLaneKey } = await import("@strk20-messaging/sdk");
    const { stitchGroupThread } = await import("../src/lib/groups.js");
    const group = { name: "trip", groupKey: "0x77", members: [{ address: "0xa11ce", label: "alice" }, { address: "0xb0b", label: "bob" }, { address: "0xca401", label: "carol" }] };
    const aliceLane = "0x" + groupLaneKey(0x77n, 0xa11cen).toString(16);
    const body = encodePaymentMemo(0x4718f5an, 2n * 10n ** 18n, "to bob, carol — dinner");
    const history = [{ channelKey: aliceLane, index: 0, sender: "0xa11ce", timestamp: 100, bodyBase64: btoa(String.fromCharCode(...body)) }];
    const asBob = stitchGroupThread(history, group, "0xb0b");
    expect(asBob[0]).toMatchObject({
      direction: "received",
      senderLabel: "alice",
      body: "to bob, carol — dinner",
      payment: { token: "0x4718f5a", amount: (2n * 10n ** 18n).toString() },
    });
    const asAlice = stitchGroupThread(history, group, "0xa11ce");
    expect(asAlice[0]?.direction).toBe("sent");
    expect(asAlice[0]?.payment?.amount).toBe((2n * 10n ** 18n).toString());
  });
});
