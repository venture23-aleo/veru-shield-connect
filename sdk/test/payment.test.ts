import { describe, expect, it } from "vitest";
import {
  decodePaymentMemo,
  encodePaymentMemo,
  open,
  PAYMENT_HEADER_LEN,
  seal,
} from "../src/index.js";

const TOKEN = 0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938dn;
const CK = 0x29f111f2674fda971bbee26106be4792a4336860bea7f3c4289d9c8dc16a948n;

describe("payment memos — the pairing the chain cannot give you", () => {
  it("round-trips token, amount and text", () => {
    const body = encodePaymentMemo(TOKEN, 25_000_000_000_000_000_000n, "invoice 4412");
    const memo = decodePaymentMemo(body);
    expect(memo).toEqual({
      token: TOKEN,
      amount: 25_000_000_000_000_000_000n,
      text: "invoice 4412",
    });
  });

  it("survives the seal/open round trip — it lives inside the AEAD", () => {
    const sealed = seal({
      channelKey: CK,
      index: 0,
      sender: 0x123n,
      timestamp: 1_760_000_000n,
      body: encodePaymentMemo(TOKEN, 1n, "for the coffee"),
    });
    const frame = open(CK, 0, sealed.felts);
    const memo = decodePaymentMemo(frame.body);
    expect(memo?.amount).toBe(1n);
    expect(memo?.text).toBe("for the coffee");
    // The sender is still authenticated by the frame, not by the memo.
    expect(frame.sender).toBe(0x123n);
  });

  it("a plain message is not a payment", () => {
    expect(decodePaymentMemo(new TextEncoder().encode("hello through the pool"))).toBeNull();
  });

  it("a body too short to hold a header is not a payment", () => {
    expect(decodePaymentMemo(new Uint8Array(PAYMENT_HEADER_LEN - 1))).toBeNull();
  });

  it("a body that is exactly a header decodes with empty text", () => {
    const memo = decodePaymentMemo(encodePaymentMemo(TOKEN, 7n, ""));
    expect(memo).toEqual({ token: TOKEN, amount: 7n, text: "" });
  });

  it("holds the full u128 range, and rejects past it", () => {
    const max = (1n << 128n) - 1n;
    expect(decodePaymentMemo(encodePaymentMemo(TOKEN, max, "x"))?.amount).toBe(max);
    expect(() => encodePaymentMemo(TOKEN, 1n << 128n, "x")).toThrow(RangeError);
    expect(() => encodePaymentMemo(0n, 1n, "x")).toThrow(RangeError);
  });

  it("keeps utf-8 bodies intact", () => {
    const memo = decodePaymentMemo(encodePaymentMemo(TOKEN, 1n, "café — 支払い ✅"));
    expect(memo?.text).toBe("café — 支払い ✅");
  });
});

describe("payment requests — text, so they ride the ordinary message path", () => {
  it("round-trips token, amount and text, and decodes from bytes or string", async () => {
    const { encodePaymentRequest, decodePaymentRequest } = await import("../src/index.js");
    const s = encodePaymentRequest(TOKEN, 5_000_000_000_000_000_000n, "dinner, your half");
    expect(s.startsWith("REQ1 0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d 5000000000000000000\n")).toBe(true);
    const want = { token: TOKEN, amount: 5_000_000_000_000_000_000n, text: "dinner, your half" };
    expect(decodePaymentRequest(s)).toEqual(want);
    expect(decodePaymentRequest(new TextEncoder().encode(s))).toEqual(want);
  });

  it("an empty text and multi-line text both survive", async () => {
    const { encodePaymentRequest, decodePaymentRequest } = await import("../src/index.js");
    expect(decodePaymentRequest(encodePaymentRequest(TOKEN, 1n, ""))?.text).toBe("");
    expect(decodePaymentRequest(encodePaymentRequest(TOKEN, 1n, "line 1\nline 2"))?.text).toBe("line 1\nline 2");
  });

  it("a plain message, a PAY1 memo, and near-misses are not requests", async () => {
    const { decodePaymentRequest } = await import("../src/index.js");
    expect(decodePaymentRequest("REQ1 is what I call my dog")).toBeNull();
    expect(decodePaymentRequest("hello")).toBeNull();
    expect(decodePaymentRequest(encodePaymentMemo(TOKEN, 5n, "REQ1 0x1 5"))).toBeNull();
    expect(decodePaymentRequest("REQ1 0x1 0")).toBeNull();
    expect(decodePaymentRequest("REQ1 0x1 340282366920938463463374607431768211456")).toBeNull();
    expect(decodePaymentRequest(new Uint8Array([0xff, 0xfe, 0x41]))).toBeNull();
  });

  it("rejects a zero amount or token at encode time", async () => {
    const { encodePaymentRequest } = await import("../src/index.js");
    expect(() => encodePaymentRequest(TOKEN, 0n, "x")).toThrow(RangeError);
    expect(() => encodePaymentRequest(0n, 1n, "x")).toThrow(RangeError);
  });
});
