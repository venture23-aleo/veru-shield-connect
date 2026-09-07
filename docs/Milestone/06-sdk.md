# 06 — SDK

An extension to the existing **Privacy SDK** (TypeScript, Apache 2.0), not a new client. It
reuses that SDK's viewing-key management, channel derivation, action building, proving
backend, and submission path, and adds messaging on top.

## Public surface

```ts
class Messaging {
  constructor(sdk: PrivacyClient, helper: string);   // helper = anonymizer address

  /** Queue a message; returns actions to add to a pool transaction. */
  buildSend(to: Address, body: Uint8Array, opts?: SendOptions): Promise<Action[]>;

  /** Build, prove and submit a message-only transaction. */
  send(to: Address, body: Uint8Array, opts?: SendOptions): Promise<TxReceipt>;

  /** Walk derived slots for every known channel and decrypt. */
  discover(opts?: DiscoverOptions): Promise<DecryptedMessage[]>;
}

interface SendOptions {
  padTo?: 256 | 1024 | 4096;   // default: smallest bucket that fits
  batch?: Uint8Array[];        // extra messages to fit in the same InvokeExternal
  submit?: 'paymaster' | 'direct';   // 'direct' exposes the submitter address
}
```

`buildSend` returning *actions* rather than submitting is the important part of the design. It
lets a caller compose a memo into a transfer's action batch — one proven transaction, atomic,
with no anonymity penalty — which is exactly what the payment-memo product needs.

## Batching is not optional

The pool permits **at most one `InvokeExternal` per transaction**, and proving costs ~29 s.
Sending three messages as three transactions costs ~87 s and three fees; sending them as one
`InvokeExternal` carrying three payloads costs ~29 s and one fee.

The SDK should therefore make batching the default path and single-message send the special
case — the inverse of how a normal chat client is built. UI implications are real: a client
that feels like a chat app on top of this will need a local outbox that accumulates and
flushes, not a send-on-enter loop.

## discover

```
for each known channel (from the Privacy SDK's channel scan):
    for index = 0, 1, 2, ...:
        slot = h(MSG_ID_TAG, channel_key, index)
        read via starknet_getStorageAt; stop at the first empty slot
    decrypt each payload with key_i, verify the Poly1305 tag
```

Channel discovery itself is inherited — the Privacy SDK already trial-decrypts channel records
to find new counterparties. We add only the per-channel message walk.

Cost is proportional to **your own** channels and messages, not to pool volume. There is no
global scan, no trial decryption of other people's traffic, and therefore no need for the
Fuzzy Message Detection escape hatch the previous revision reserved room for.

Two practical notes: reads should be batched or multicalled where the RPC allows, since a
naive implementation issues one round trip per index; and the last-known index per channel
should be cached, with the walk resuming from there.

## State

Client state is `{ channel → lastSeenIndex }` and nothing else. Losing it costs a re-walk from
index 0, which is cheap and needs only the viewing key. This is a genuinely better position
than the previous revision, where state loss meant re-scanning the chain.

## Implementation notes

- Reuse the Privacy SDK's Poseidon and STARK-curve code. Do not introduce a second
  implementation of either — divergence in domain separation is the most likely integration
  bug in the system.
- `@noble/ciphers` for ChaCha20-Poly1305.
- Never log key material, including in error paths. Wrap secrets in a type whose `toString`
  and `toJSON` return `[redacted]`.
- Constant-time comparison for MAC checks.
- The proving backend is configurable; a hosted prover sees the witness. Teams handling
  sensitive traffic should self-host — surface this as a first-class configuration choice,
  not a footnote.
