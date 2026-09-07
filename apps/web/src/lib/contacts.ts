/**
 * A contact spans TWO directional channels (04-cryptography.md): me->them
 * (outKey) and them->me (inKey), each with independent dense indices. The
 * thread view stitches both lanes into one conversation, and must stay
 * coherent while the two lanes confirm on different schedules.
 */
import { decodePaymentMemo, decodePaymentRequest, type HistoryRecord } from "@strk20-messaging/sdk";

export interface Contact {
  label: string;
  peer: string;
  /**
   * Pool mode: sender-derived (h(TAG, me, my_sk, peer, peer_pk)), so it exists
   * before any transaction — empty only while the peer is unregistered.
   */
  outKey: string;
  /**
   * Pool mode: THEIR derivation, which only the pool's channel scan can hand
   * us — empty until they have set up a channel toward us and we discovered it.
   */
  inKey: string;
  /** Unregistered peers cannot receive; compose is disabled until this is true. */
  registered: boolean;
  /**
   * Lanes derived from the two addresses (dev mode): the peer pairs by simply
   * adding YOUR address — but anyone who guesses the pair can derive the keys.
   * Invite-created contacts carry random keys and stay confidential.
   */
  derived?: boolean;
  /** Pool mode: our channel to them is open on-chain (first payment/message done). */
  setupDone?: boolean;
}

/**
 * Invites pair two clients onto the same pair of lanes. The invite is written
 * from the RECEIVER's point of view: their outKey is our inKey and vice versa,
 * so pasting it creates the exactly mirrored contact.
 */
export interface Invite {
  "strk20msg-invite": 1;
  /** The inviter's address — becomes the receiver's contact.peer. */
  peer: string;
  /** Lane the receiver sends on (= inviter's inKey). */
  yourOutKey: string;
  /** Lane the receiver reads on (= inviter's outKey). */
  yourInKey: string;
}

export function makeInvite(contact: Contact, myAddress: string): Invite {
  return {
    "strk20msg-invite": 1,
    peer: myAddress,
    yourOutKey: contact.inKey,
    yourInKey: contact.outKey,
  };
}

export function parseInvite(text: string): Invite | null {
  try {
    const raw = JSON.parse(text) as Partial<Invite>;
    if (
      raw["strk20msg-invite"] === 1 &&
      typeof raw.peer === "string" &&
      /^0x[0-9a-fA-F]+$/.test(raw.yourOutKey ?? "") &&
      /^0x[0-9a-fA-F]+$/.test(raw.yourInKey ?? "")
    ) {
      return raw as Invite;
    }
  } catch {
    /* not an invite */
  }
  return null;
}

export interface ThreadMessage {
  direction: "sent" | "received";
  body: string;
  timestamp: number;
  index: number;
  channelKey: string;
  /** Set when the body carried a PAY1 header: the transfer this memo rode with. */
  payment?: { token: string; amount: string };
  /**
   * Set when the body is a REQ1 line: someone asked for a payment. `settledBy`
   * is the index (on the payer's lane) of the PAY1 memo that answered it, when
   * one exists — matched by token and amount, first unmatched payment after
   * the request wins (settleRequests).
   */
  request?: { token: string; amount: string; settledBy?: number };
}

export function stitchThread(history: HistoryRecord[], contact: Contact): ThreadMessage[] {
  const lane = (records: HistoryRecord[], key: string, direction: "sent" | "received") =>
    records
      .filter((r) => r.channelKey === key)
      .map((r) => {
        const bytes = fromB64(r.bodyBase64);
        const payment = decodePaymentMemo(bytes);
        const request = payment ? null : decodePaymentRequest(bytes);
        const value = payment ?? request;
        return {
          direction,
          body: value ? value.text : new TextDecoder().decode(bytes),
          timestamp: r.timestamp,
          index: r.index,
          channelKey: r.channelKey,
          ...(payment
            ? { payment: { token: "0x" + payment.token.toString(16), amount: payment.amount.toString() } }
            : request
              ? { request: { token: "0x" + request.token.toString(16), amount: request.amount.toString() } }
              : {}),
        };
      });

  const thread = [...lane(history, contact.outKey, "sent"), ...lane(history, contact.inKey, "received")].sort(
    (a, b) =>
      // Timestamp first; ties break deterministically (received lane first,
      // then index) so the stitched order never flickers between syncs.
      a.timestamp - b.timestamp ||
      (a.direction === b.direction ? a.index - b.index : a.direction === "received" ? -1 : 1)
  );
  return settleRequests(thread);
}

/**
 * Pair requests with the payments that answered them. A request from THEM is
 * settled by a later payment from ME with the same token and amount (and vice
 * versa); each payment settles at most one request, oldest first. Pure:
 * chain state has no notion of "settled" — this is the two clients agreeing
 * on the obvious reading of their own history.
 */
export function settleRequests(thread: ThreadMessage[]): ThreadMessage[] {
  const used = new Set<ThreadMessage>();
  return thread.map((m, i) => {
    if (!m.request) return m;
    const answer = thread.find(
      (p, j) =>
        j > i &&
        p.payment !== undefined &&
        p.direction !== m.direction &&
        !used.has(p) &&
        sameHex(p.payment.token, m.request!.token) &&
        p.payment.amount === m.request!.amount
    );
    if (!answer) return m;
    used.add(answer);
    return { ...m, request: { ...m.request, settledBy: answer.index } };
  });
}

function sameHex(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return a.toLowerCase() === b.toLowerCase();
  }
}

function fromB64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
