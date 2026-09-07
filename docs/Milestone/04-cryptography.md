# 04 — Cryptography

Almost all of this is inherited. The section is short by design: the parts we add are the
parts worth auditing.

Notation: `h` is Poseidon over the STARK field, `G` the STARK-curve generator, `·` scalar
multiplication.

## 1 · Inherited from STRK20 — do not reimplement

**Identity.** Every participant registers a viewing keypair once, via `SetViewingKey`:
`K = k·G` on the STARK curve, immutable thereafter. `k` never leaves the device (except as
the escrowed auditor copy — see [02](02-threat-model.md#the-escrowed-auditor-key)).

**Channel establishment.** ECDH with a fresh ephemeral key per channel:

```
sender picks random r,  publishes rG
shared          = r·K                    // recipient computes k·(rG) = r·K
enc_channel_key = h(ENC_CHANNEL_KEY_TAG, shared.x) + channel_key
```

where the channel key itself is

```
channel_key = h(CHANNEL_KEY_TAG, sender_addr, sender_sk, recipient_addr, recipient_pk)
```

Channels are **directional**. Alice↔Bob is two channels. A message thread therefore uses two
lanes, and the client is responsible for stitching them into one conversation view.

**Slot addressing.** The pool derives note locations from the channel key:

```
note_id = h(NOTE_ID_TAG, channel_key, token, index, 0)
```

Dense sequential indices, WriteOnce cells. Without the channel key these are indistinguishable
from random storage slots. **This is a tag ratchet already in production** — the previous
revision specified one from scratch; that work is deleted.

## 2 · What we add — message slots

Messages get their own domain-separated derivation, in the helper's storage:

```
msg_id  = h(MSG_ID_TAG,  channel_key, index)
key_i   = h(MSG_KEY_TAG, channel_key, index)
```

The domain tags must be distinct from every tag the pool uses, so a message slot can never
collide with or be mistaken for a note slot. Dense and sequential, matching the pool's
convention, so the same walk-until-empty scan works.

## 3 · What we add — authenticated encryption

STRK20 masks note fields with domain-separated hash-and-add:
`enc_amount = h(TAG, channel_key, …, salt) + amount`. That is correct for a `u128` whose
integrity is separately guaranteed by the pool's balance invariant — a tampered amount breaks
the "balances end at zero" check.

**A message body has no such invariant behind it.** Hash-and-add is malleable: flipping bits
in the ciphertext flips bits in the plaintext, with no MAC to detect it. So we do not extend
their masking to bodies.

```
AEAD:   ChaCha20-Poly1305
key:    key_i          (unique per message ⇒ nonce may be a constant zero)
AAD:    msg_id         (ciphertext cannot be replayed into another slot)
```

Plaintext layout before sealing:

```
| version : 1 B | sender_addr : 32 B | timestamp : 8 B | len : 4 B | body | padding |
```

The sender address inside the ciphertext authenticates the sender to the recipient. It is
MACed under a *shared* secret rather than signed, so the recipient cannot prove authorship to
a third party. Note this is weaker than it sounds given the auditor can recover both sides'
keys.

**Padding buckets:** 256 B, 1 KiB, 4 KiB. Larger payloads should be chunked or stored
off-chain with only a locator and key in the body — see
[D9](09-open-decisions.md#d9--where-does-the-payload-live) for why the ceiling is low.

## 4 · Field packing

31 bytes per `felt252`:

```
felts = [ ceil(len/31), chunk_0, chunk_1, ... ]     // little-endian per chunk
```

A 1 KiB bucket is 34 felts — and therefore 34 WriteOnce storage slots, which is the cost
driver that keeps buckets small.

## 5 · What we deliberately do not build

| Previously specified | Why it is gone |
| --- | --- |
| Membership circuit | The pool's STARK proof already proves membership and authorization |
| Garaga verifier contract | Starknet verifies STRK20 proofs in-protocol |
| RLN nullifiers for spam control | Posting requires a valid pool transaction; gas plus proving cost is the rate limit |
| Bespoke tag ratchet | `note_id` / `msg_id` derivation is the same construction, already deployed |
| Fuzzy Message Detection | Discovery cost scales with your own channels, not global volume |

Two hash functions across a system is a classic source of subtle bugs. Poseidon everywhere for
derivation, one AEAD for bodies, and nothing else.

## 6 · Test vectors

Derivations must match the Privacy SDK's exactly, or discovery silently returns nothing. Freeze
byte-for-byte vectors for `channel_key`, `msg_id`, `key_i`, and the felt packing, shared
between the Cairo tests and the TypeScript tests, before writing either.
