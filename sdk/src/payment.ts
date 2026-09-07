/**
 * Payment memos: the value details travel INSIDE the sealed body.
 *
 * A memo and its transfer ride the same pool transaction, but the helper
 * stores only opaque ciphertext — it never sees the notes, and the recipient
 * cannot correlate a decrypted memo with a discovered note from chain state
 * alone (that is the point of the design: the note's amount is encrypted and
 * its recipient lives in the proof).
 *
 * So the sender, who knows both, writes the pairing into the plaintext:
 *
 *   | magic "PAY1" : 4 B | token : 32 B | amount : 16 B (u128 BE) | utf8 text |
 *
 * It is inside the AEAD, so it is private and authenticated by the same MAC
 * that authenticates the sender. A body without the magic is a plain message,
 * which is what every existing message already is — this is purely additive
 * and does not touch the frame layout or the frozen vectors.
 */

export const PAYMENT_MAGIC = new Uint8Array([0x50, 0x41, 0x59, 0x31]); // "PAY1"
export const PAYMENT_HEADER_LEN = 4 + 32 + 16;

export interface PaymentMemo {
  /** Token contract address. */
  token: bigint;
  /** Amount in the token's smallest unit; u128, as the pool's notes are. */
  amount: bigint;
  text: string;
}

export function encodePaymentMemo(token: bigint, amount: bigint, text: string): Uint8Array {
  if (token <= 0n) throw new RangeError("token must be a non-zero address");
  if (amount < 0n || amount >= 1n << 128n) throw new RangeError("amount must fit u128");
  const body = new TextEncoder().encode(text);
  const out = new Uint8Array(PAYMENT_HEADER_LEN + body.length);
  out.set(PAYMENT_MAGIC, 0);
  writeBE(out, 4, token, 32);
  writeBE(out, 36, amount, 16);
  out.set(body, PAYMENT_HEADER_LEN);
  return out;
}

/** `null` for an ordinary message — callers render those unchanged. */
export function decodePaymentMemo(body: Uint8Array): PaymentMemo | null {
  if (body.length < PAYMENT_HEADER_LEN) return null;
  for (let i = 0; i < PAYMENT_MAGIC.length; i++) {
    if (body[i] !== PAYMENT_MAGIC[i]) return null;
  }
  return {
    token: readBE(body, 4, 32),
    amount: readBE(body, 36, 16),
    text: new TextDecoder().decode(body.subarray(PAYMENT_HEADER_LEN)),
  };
}

function writeBE(out: Uint8Array, offset: number, value: bigint, bytes: number): void {
  let v = value;
  for (let i = bytes - 1; i >= 0; i--) {
    out[offset + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}

function readBE(src: Uint8Array, offset: number, bytes: number): bigint {
  let v = 0n;
  for (let i = 0; i < bytes; i++) v = (v << 8n) | BigInt(src[offset + i]!);
  return v;
}

/**
 * Payment REQUESTS are plain text, not a binary header: a request moves no
 * value, so it rides the ordinary message path (outbox → batch → carrier
 * note) and needs nothing the sender's pool balance would have to cover.
 *
 *   REQ1 <token hex> <amount decimal>\n<utf8 text>
 *
 * The payer's client recognises the line, offers "pay", and the resulting
 * PAY1 memo settles it (matched by token + amount, see the web app's
 * settleRequests). Only the two parties ever see it — it is inside the AEAD.
 */
export const REQUEST_MAGIC = "REQ1";

export interface PaymentRequest {
  token: bigint;
  amount: bigint;
  text: string;
}

export function encodePaymentRequest(token: bigint, amount: bigint, text: string): string {
  if (token <= 0n) throw new RangeError("token must be a non-zero address");
  if (amount <= 0n || amount >= 1n << 128n) throw new RangeError("amount must be positive and fit u128");
  return `${REQUEST_MAGIC} 0x${token.toString(16)} ${amount.toString()}\n${text}`;
}

const REQUEST_RE = /^REQ1 (0x[0-9a-fA-F]{1,64}) ([0-9]{1,39})(?:\n([\s\S]*))?$/;

/** `null` for anything that is not a request — including a PAY1 memo. */
export function decodePaymentRequest(body: Uint8Array | string): PaymentRequest | null {
  const text = typeof body === "string" ? body : safeDecode(body);
  if (text === null) return null;
  const m = REQUEST_RE.exec(text);
  if (!m) return null;
  const amount = BigInt(m[2]!);
  if (amount === 0n || amount >= 1n << 128n) return null;
  return { token: BigInt(m[1]!), amount, text: m[3] ?? "" };
}

function safeDecode(bytes: Uint8Array): string | null {
  // A PAY1 body is binary; the header bytes are never valid text of this shape.
  if (bytes.length >= PAYMENT_MAGIC.length && PAYMENT_MAGIC.every((b, i) => bytes[i] === b)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
